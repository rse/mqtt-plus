/*
**  MQTT+ -- MQTT Communication Patterns
**  Copyright (c) 2018-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  built-in requirements  */
import { Readable }                                       from "node:stream"

/*  external requirements  */
import type { IClientPublishOptions,
    IClientSubscribeOptions }                             from "mqtt"
import { nanoid }                                         from "nanoid"

/*  internal requirements  */
import { CreditGate,
    streamToBuffer, sendBufferAsChunks,
    sendStreamAsChunks, makeMutuallyExclusiveFields }     from "./mqtt-plus-util"
import { run, Spool, ensureError }                        from "./mqtt-plus-error"
import type { SourceFetchRequest, SourceFetchResponse,
    SourceFetchChunk, SourceFetchCredit }                 from "./mqtt-plus-msg"
import type { APISchema, SourceKeys, Registration }       from "./mqtt-plus-api"
import type { WithInfo, InfoSource }                      from "./mqtt-plus-info"
import { ServiceTrait }                                   from "./mqtt-plus-service"
import type { AuthOption }                                from "./mqtt-plus-auth"

/*  Source Fetch Trait  */
export class SourceTrait<T extends APISchema = APISchema> extends ServiceTrait<T> {
    /*  source state  */
    private sourceCreditGates = new Map<string, CreditGate>()
    private sourceControllers = new Map<string, AbortController>()

    /*  destroy source trait  */
    override async destroy () {
        for (const controller of this.sourceControllers.values())
            controller.abort(new Error("source destroyed"))
        this.sourceControllers.clear()
        for (const gate of this.sourceCreditGates.values())
            gate.abort()
        this.sourceCreditGates.clear()
        await super.destroy()
    }

    /*  establish a source (for fetch requests)  */
    async source<K extends SourceKeys<T> & string> (
        name:     K,
        callback: WithInfo<T[K], InfoSource>
    ): Promise<Registration>
    async source<K extends SourceKeys<T> & string> (
        config: {
            name:      K,
            callback:  WithInfo<T[K], InfoSource>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        }
    ): Promise<Registration>
    async source<K extends SourceKeys<T> & string> (
        nameOrConfig: K | {
            name:      K,
            callback:  WithInfo<T[K], InfoSource>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        },
        ...args:       any[]
    ): Promise<Registration> {
        /*  determine actual parameters  */
        let name:     K
        let callback: WithInfo<T[K], InfoSource>
        let options:  Partial<IClientSubscribeOptions> = {}
        let share     = this.options.share
        let auth:     AuthOption | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name     = nameOrConfig.name
            callback = nameOrConfig.callback
            options  = nameOrConfig.options ?? {}
            share    = nameOrConfig.share   ?? this.options.share
            auth     = nameOrConfig.auth
        }
        else {
            /*  positional API  */
            name     = nameOrConfig
            callback = args[0]
        }

        /*  create a resource spool  */
        const spool = new Spool()

        /*  sanity check situation  */
        if (this.onRequest.has(`source-fetch-request:${name}`))
            throw new Error(`source: source "${name}" already registered`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS    = share !== "" ? `$share/${share}/${name}` : name
        const topicReqB = this.options.topicMake(topicS, "source-fetch-request")
        const topicReqD = this.options.topicMake(name,   "source-fetch-request", this.options.id)

        /*  remember the registration  */
        this.onRequest.set(`source-fetch-request:${name}`, async (request: SourceFetchRequest, topicName: string) => {
            /*  determine information  */
            const requestId = request.id
            const params    = request.params ?? []
            const sender    = request.sender
            if (sender === undefined || sender === "")
                throw new Error("invalid request: missing sender")
            const receiver  = request.receiver
            const info: InfoSource = { sender }
            if (receiver)
                info.receiver = receiver
            if (request.meta)
                info.meta = request.meta

            /*  generate corresponding MQTT topic (single topic for all responses)  */
            const responseTopic = this.options.topicMake(name, "source-fetch-response", sender)

            /*  callback for sending the ack/nak response  */
            const sendResponse = async (error?: string) => {
                const metaStore = this.metaStore(info.meta)
                const response = this.msg.makeSourceFetchResponse(requestId,
                    name, error, this.options.id, sender, metaStore)
                const message = this.codec.encode(response)
                await this.publishToTopic(responseTopic, message, { qos: options.qos ?? 2 })
            }

            /*  define abort controller and signal  */
            const abortController = new AbortController()
            this.sourceControllers.set(requestId, abortController)
            const abortSignal     = abortController.signal

            /*  ensure stream gets destroyed on abort  */
            abortSignal.addEventListener("abort", () => {
                if (info.stream instanceof Readable && !info.stream.destroyed)
                    info.stream.destroy(ensureError(abortSignal.reason))
            }, { once: true })

            /*  utility functions for timeout management  */
            const sourceTimerId = `source-fetch-send:${requestId}`
            const refreshSourceTimeout = () => this.timerRefresh(sourceTimerId, () => {
                const error = new Error(`source fetch "${name}" timed out`)
                abortController.abort(error)
                const gate = this.sourceCreditGates.get(requestId)
                if (gate !== undefined) {
                    gate.abort()
                    this.sourceCreditGates.delete(requestId)
                }
                this.sourceControllers.delete(requestId)
                this.onResponse.delete(`source-fetch-credit:${requestId}`)
            })
            const clearSourceTimeout   = () => this.timerClear(sourceTimerId)
            refreshSourceTimeout()

            /*  callback for creating and sending a chunk message  */
            const sendChunk = async (
                chunk: Uint8Array | undefined,
                error: string | undefined,
                final: boolean
            ): Promise<void> => {
                refreshSourceTimeout()
                const chunkMsg = this.msg.makeSourceFetchChunk(requestId,
                    name, chunk, error, final, this.options.id, sender)
                const message = this.codec.encode(chunkMsg)
                await this.publishToTopic(responseTopic, message, { qos: options.qos ?? 2 })
            }

            /*  call the handler callback  */
            let ackSent = false
            let creditGate: CreditGate | undefined
            try {
                if (topicName !== request.name)
                    throw new Error(`source name mismatch (topic: "${topicName}", payload: "${request.name}")`)
                if (auth)
                    info.authenticated = await this.authenticated(sender, request.auth, auth)
                if (info.authenticated !== undefined && !info.authenticated)
                    throw new Error(`source "${name}" failed authentication`)

                /*  handle credit-based flow control (if credit provided in request)  */
                const initialCredit = request.credit
                creditGate = (initialCredit !== undefined && initialCredit > 0)
                    ? new CreditGate(initialCredit) : undefined
                if (creditGate)
                    this.sourceCreditGates.set(requestId, creditGate)

                /*  register credit/cancel handler (unconditional for cancel support)  */
                this.onResponse.set(`source-fetch-credit:${requestId}`, (creditParsed: SourceFetchCredit) => {
                    if (creditParsed.credit === 0) {
                        /*  cancel signal from fetcher  */
                        abortController.abort(new Error(`source fetch "${name}" cancelled by fetcher`))
                        return
                    }
                    if (creditGate) {
                        creditGate.replenish(creditParsed.credit)
                        refreshSourceTimeout()
                    }
                })

                await callback(...params, info)

                /*  check for valid data source  */
                if (!(info.stream instanceof Readable) && !(info.buffer instanceof Promise))
                    throw new Error("handler did not provide data via info.stream or info.buffer fields")
                if (info.stream instanceof Readable && info.buffer instanceof Promise)
                    throw new Error("handler has set both info.stream and info.buffer fields")

                /*  send ack response  */
                await sendResponse()
                ackSent = true

                /*  dispatch according to data type  */
                if (info.stream instanceof Readable)
                    /*  handle Readable stream result  */
                    await sendStreamAsChunks(info.stream, this.options.chunkSize, sendChunk, creditGate, abortSignal)
                else if (info.buffer instanceof Promise)
                    /*  handle Buffer result  */
                    await sendBufferAsChunks(await info.buffer, this.options.chunkSize, sendChunk, creditGate, abortSignal)
            }
            catch (err: unknown) {
                /*  cleanup stream resource (if provided by handler)  */
                const error = ensureError(err, `handler for source "${name}" failed`)
                abortController.abort(error)

                /*  send error as nak response or as error chunk  */
                this.error(error)
                if (ackSent)
                    await sendChunk(undefined, error.message, true).catch(() => {})
                else
                    await sendResponse(error.message).catch(() => {})
            }
            finally {
                /*  cleanup resources  */
                clearSourceTimeout()
                if (creditGate) {
                    creditGate.abort()
                    this.sourceCreditGates.delete(requestId)
                }
                this.sourceControllers.delete(requestId)
                this.onResponse.delete(`source-fetch-credit:${requestId}`)
            }
        })
        spool.roll(() => { this.onRequest.delete(`source-fetch-request:${name}`) })

        /*  subscribe to MQTT topics  */
        await this.subscribeTopicAndSpool(spool, topicReqB, options)
        await this.subscribeTopicAndSpool(spool, topicReqD, options)

        /*  provide a registration for subsequent destruction  */
        return this.makeRegistration(spool, "source", name, `source-fetch-request:${name}`)
    }

    /*  fetch source  */
    async fetch<K extends SourceKeys<T> & string> (
        name:          K,
        ...params:     Parameters<T[K]>
    ): Promise<{
        stream:        Readable,
        buffer:        Promise<Uint8Array>,
        meta:          Promise<Record<string, any> | undefined>
    }>
    async fetch<K extends SourceKeys<T> & string> (
        config: {
            name:      K,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>
        }
    ): Promise<{
        stream:        Readable,
        buffer:        Promise<Uint8Array>,
        meta:          Promise<Record<string, any> | undefined>
    }>
    async fetch<K extends SourceKeys<T> & string> (
        nameOrConfig: K | {
            name:      K,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>
        },
        ...args:       any[]
    ): Promise<{
        stream:        Readable,
        buffer:        Promise<Uint8Array>,
        meta:          Promise<Record<string, any> | undefined>
    }> {
        /*  determine actual parameters  */
        let name:      K
        let params:    Parameters<T[K]>
        let receiver:  string | undefined
        let options:   IClientPublishOptions = {}
        let meta:      Record<string, any> | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name     = nameOrConfig.name
            params   = nameOrConfig.params
            receiver = nameOrConfig.receiver
            options  = nameOrConfig.options ?? {}
            meta     = nameOrConfig.meta
        }
        else {
            /*  positional API  */
            name     = nameOrConfig
            params   = args as Parameters<T[K]>
        }

        /*  create a resource spool  */
        const spool = new Spool()

        /*  generate unique request id  */
        let requestId = nanoid()
        while (
            this.onResponse.has(`source-fetch-response:${requestId}`)
            || this.onResponse.has(`source-fetch-chunk:${requestId}`))
            requestId = nanoid()

        /*  subscribe to single response topic (for ack/nak and data chunks)  */
        const responseTopic = this.options.topicMake(name, "source-fetch-response", this.options.id)
        await this.subscribeTopicAndSpool(spool, responseTopic, { qos: options.qos ?? 2 })

        /*  credit-based flow control state  */
        const chunkCredit  = this.options.chunkCredit
        let chunksReceived = 0
        let creditGranted  = chunkCredit
        let serverId:        string | undefined
        let streamEnded    = false

        /*  define timer  */
        const timerId = `source-fetch:${requestId}`
        let stream: Readable | undefined = undefined
        const refreshTimeout = () => {
            this.timerRefresh(timerId, () => {
                stream?.destroy(new Error("communication timeout"))
                spool.unroll()
            })
        }
        spool.roll(() => { this.timerClear(timerId) })

        /*  establish a readable for buffering received chunks  */
        stream = new Readable({
            highWaterMark: chunkCredit > 0 ? chunkCredit * this.options.chunkSize : 16 * 1024,
            read: (_size) => {
                if (chunkCredit <= 0 || !this.onResponse.has(`source-fetch-response:${requestId}`))
                    return
                const targetId = serverId ?? receiver
                if (!targetId)
                    return
                const creditToGrant = Math.max(0, chunksReceived + chunkCredit - creditGranted)
                if (creditToGrant > 0) {
                    creditGranted += creditToGrant
                    const creditMsg = this.msg.makeSourceFetchCredit(requestId,
                        name, creditToGrant, this.options.id, targetId)
                    const encoded = this.codec.encode(creditMsg)
                    const creditTopic = this.options.topicMake(name, "source-fetch-request", targetId)
                    this.publishToTopic(creditTopic, encoded, { qos: options.qos ?? 2 }).catch((err: Error) => {
                        this.error(err, `sending credit for fetch "${name}" failed`)
                    })
                    refreshTimeout()
                }
            }
        })

        /*  create promise for collecting stream chunks
            (PLazy: stays dormant until consumer accesses buffer)  */
        const buffer = streamToBuffer(stream)

        /*  create promise for meta (resolved on first chunk)  */
        let metaResolve!: (value: Record<string, any> | undefined) => void
        const metaP = new Promise<Record<string, any> | undefined>((resolve) => {
            metaResolve = resolve
        })
        spool.roll(() => { metaResolve(undefined) })

        /*  start timeout handler  */
        refreshTimeout()

        /*  ensure resources are released if consumer aborts stream early  */
        let cancelled = false
        const cancelAndUnroll = () => {
            if (!cancelled && !streamEnded) {
                cancelled = true
                const targetId = serverId ?? receiver
                if (targetId) {
                    const cancelMsg = this.msg.makeSourceFetchCredit(requestId,
                        name, 0, this.options.id, targetId)
                    const encoded = this.codec.encode(cancelMsg)
                    const cancelTopic = this.options.topicMake(name, "source-fetch-request", targetId)
                    this.publishToTopic(cancelTopic, encoded, { qos: options.qos ?? 2 }).catch(() => {})
                }
            }
            spool.unroll()
        }
        stream.once("close", cancelAndUnroll)
        stream.once("error", cancelAndUnroll)

        /*  register response dispatch callback (ack/nak)  */
        this.onResponse.set(`source-fetch-response:${requestId}`, (response: SourceFetchResponse) => {
            if (streamEnded)
                return
            if (response.name !== name) {
                streamEnded = true
                stream.destroy(new Error(`source name mismatch (expected "${name}", got "${response.name}")`))
                spool.unroll()
                return
            }
            if (response.sender)
                serverId = response.sender
            if (response.error) {
                streamEnded = true
                stream.destroy(new Error(response.error))
                spool.unroll()
            }
            else {
                metaResolve(response.meta)
                refreshTimeout()
            }
        })

        /*  register chunk dispatch callback (data chunks)  */
        this.onResponse.set(`source-fetch-chunk:${requestId}`, (response: SourceFetchChunk) => {
            if (streamEnded)
                return
            if (response.error) {
                streamEnded = true
                stream.destroy(new Error(response.error))
                spool.unroll()
            }
            else {
                refreshTimeout()
                if (response.chunk !== undefined) {
                    chunksReceived++
                    stream.push(response.chunk)
                }
                if (response.final) {
                    streamEnded = true
                    stream.push(null)
                    spool.unroll()
                }
            }
        })
        spool.roll(() => {
            this.onResponse.delete(`source-fetch-response:${requestId}`)
            this.onResponse.delete(`source-fetch-chunk:${requestId}`)
        })

        /*  generate encoded message  */
        const auth = this.authenticate()
        const metaStore = this.metaStore(meta)
        const credit = chunkCredit > 0 ? chunkCredit : undefined
        const request = this.msg.makeSourceFetchRequest(requestId,
            name, params, this.options.id, receiver, auth, metaStore, credit)
        const message = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(name, "source-fetch-request", receiver)

        /*  publish message to MQTT topic
            (no spool passed to run() — on failure, stream.destroy() triggers
            cleanup via the stream's "close"/"error" handlers above)  */
        run(`publish fetch request as MQTT message to topic "${topic}"`, () =>
            this.publishToTopic(topic, message, { qos: 2, ...options })
        ).catch((err: unknown) => {
            stream.destroy(ensureError(err))
        })

        /*  produce result  */
        const result = { stream, buffer, meta: metaP }
        makeMutuallyExclusiveFields(result, "stream", "buffer")
        return result
    }
}
