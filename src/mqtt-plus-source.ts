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
import { SourceFetchRequest, SourceFetchResponse,
    SourceFetchChunk, SourceFetchCredit }                 from "./mqtt-plus-msg"
import type { APISchema, SourceKeys, Registration }       from "./mqtt-plus-api"
import type { WithInfo, InfoSource }                      from "./mqtt-plus-info"
import { ServiceTrait }                                   from "./mqtt-plus-service"
import type { AuthOption }                                from "./mqtt-plus-auth"

/*  Source Fetch Trait  */
export class SourceTrait<T extends APISchema = APISchema> extends ServiceTrait<T> {
    /*  source state  */
    private sourceCreditGates = new Map<string, CreditGate>()

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
        let share:    string = "default"
        let auth:     AuthOption | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name     = nameOrConfig.name
            callback = nameOrConfig.callback
            options  = nameOrConfig.options ?? {}
            share    = nameOrConfig.share   ?? "default"
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
            throw new Error(`source: source "${name}" already established`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS       = `$share/${share}/${name}`
        const topicReqB    = this.options.topicMake(topicS, "source-fetch-request")
        const topicReqD    = this.options.topicMake(name,   "source-fetch-request", this.options.id)
        const topicCreditD = this.options.topicMake(name,   "source-fetch-credit",  this.options.id)

        /*  remember the registration  */
        this.onRequest.set(`source-fetch-request:${name}`, (request: SourceFetchRequest, topicName: string) => {
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

            /*  generate corresponding MQTT topics  */
            const responseTopic = this.options.topicMake(name, "source-fetch-response", sender)
            const chunkTopic    = this.options.topicMake(name, "source-fetch-chunk", sender)

            /*  callback for sending the ack/nak response  */
            const sendResponse = async (error?: string) => {
                const authToken = this.authenticate()
                const metaStore = this.metaStore(info.meta)
                const response = this.msg.makeSourceFetchResponse(requestId,
                    name, error, this.options.id, sender, authToken, metaStore)
                const message = this.codec.encode(response)
                await this._publishToTopic(responseTopic, message, { qos: 2 })
            }

            /*  utility functions for timeout management  */
            const refreshSourceTimeout = () => this.timerRefresh(requestId, () => {
                const gate = this.sourceCreditGates.get(requestId)
                if (gate !== undefined)
                    gate.abort()
            })
            const clearSourceTimeout   = () => this.timerClear(requestId)
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
                await this._publishToTopic(chunkTopic, message, { qos: 2 })
            }

            /*  handle credit-based flow control (if credit provided in request)  */
            const initialCredit = request.credit
            const creditGate = (initialCredit !== undefined && initialCredit > 0)
                ? new CreditGate(initialCredit) : undefined
            if (creditGate) {
                this.sourceCreditGates.set(requestId, creditGate)
                this.onResponse.set(`source-fetch-credit:${requestId}`, (creditParsed: SourceFetchCredit) => {
                    creditGate.replenish(creditParsed.credit)
                    refreshSourceTimeout()
                })
            }

            /*  call the handler callback  */
            let ackSent = false
            Promise.resolve().then(async () => {
                if (topicName !== request.name)
                    throw new Error(`source name mismatch between topic "${topicName}" and payload "${request.name}"`)
                if (auth)
                    info.authenticated = await this.authenticated(request.sender, request.auth, auth)
                if (info.authenticated !== undefined && !info.authenticated)
                    throw new Error(`source "${name}" failed authentication`)
                return callback(...params, info)
            }).then(async () => {
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
                    await sendStreamAsChunks(info.stream, this.options.chunkSize, sendChunk, creditGate)
                else if (info.buffer instanceof Promise)
                    /*  handle Buffer result  */
                    await sendBufferAsChunks(await info.buffer, this.options.chunkSize, sendChunk, creditGate)
            }).catch((err: unknown) => {
                /*  send error as nak response or as error chunk  */
                const error = ensureError(err)
                this.error(error, `handler for source "${name}" failed`)
                if (ackSent)
                    return sendChunk(undefined, error.message, true).catch(() => {})
                else
                    return sendResponse(error.message).catch(() => {})
            }).finally(() => {
                /*  cleanup resources  */
                clearSourceTimeout()
                if (creditGate) {
                    creditGate.abort()
                    this.sourceCreditGates.delete(requestId)
                }
                this.onResponse.delete(`source-fetch-credit:${requestId}`)
            })
        })
        spool.roll(() => { this.onRequest.delete(`source-fetch-request:${name}`) })

        /*  subscribe to MQTT topics  */
        await run(`subscribe to MQTT topic "${topicReqB}"`, spool, () =>
            this._subscribeTopic(topicReqB, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicReqB).catch(() => {}))
        await run(`subscribe to MQTT topic "${topicReqD}"`, spool, () =>
            this._subscribeTopic(topicReqD, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicReqD).catch(() => {}))
        await run(`subscribe to MQTT topic "${topicCreditD}"`, spool, () =>
            this._subscribeTopic(topicCreditD, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicCreditD).catch(() => {}))

        /*  provide a registration for subsequent destruction  */
        return {
            destroy: async (): Promise<void> => {
                if (!this.onRequest.has(`source-fetch-request:${name}`))
                    throw new Error(`destroy: source "${name}" not established`)
                await spool.unroll(false)?.catch((err: Error) => {
                    this.error(err, `destroy: failed to cleanup: ${err.message}`)
                })
            }
        }
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
        const requestId = nanoid()

        /*  subscribe to response topic (for ack/nak) and chunk topic (for data)  */
        const responseTopic = this.options.topicMake(name, "source-fetch-response", this.options.id)
        const chunkTopic    = this.options.topicMake(name, "source-fetch-chunk",    this.options.id)
        await run(`subscribe to MQTT topic "${responseTopic}"`, spool, () =>
            this.subscriptions.subscribe(responseTopic, { qos: options.qos ?? 2 }))
        spool.roll(() => this.subscriptions.unsubscribe(responseTopic))
        await run(`subscribe to MQTT topic "${chunkTopic}"`, spool, () =>
            this.subscriptions.subscribe(chunkTopic, { qos: options.qos ?? 2 }))
        spool.roll(() => this.subscriptions.unsubscribe(chunkTopic))

        /*  credit-based flow control state  */
        const chunkCredit  = this.options.chunkCredit
        let chunksReceived = 0
        let creditGranted  = chunkCredit
        let serverId:        string | undefined

        /*  establish a readable for buffering received chunks  */
        const stream = new Readable({
            highWaterMark: chunkCredit > 0 ? chunkCredit * this.options.chunkSize : 16 * 1024,
            read: (_size) => {
                if (chunkCredit <= 0 || !this.onResponse.has(`source-fetch-chunk:${requestId}`))
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
                    const creditTopic = this.options.topicMake(name, "source-fetch-credit", targetId)
                    this._publishToTopic(creditTopic, encoded, { qos: 2 }).catch((err: Error) => {
                        this.error(err, `sending credit for fetch "${name}" failed`)
                    })
                }
            }
        })

        /*  create promise for collecting stream chunks  */
        const buffer = streamToBuffer(stream)

        /*  create promise for meta (resolved on first chunk)  */
        let metaResolve: (value: Record<string, any> | undefined) => void
        const metaP = new Promise<Record<string, any> | undefined>((resolve) => {
            metaResolve = resolve
        })
        spool.roll(() => { metaResolve?.(undefined) })

        /*  define timer  */
        let timer: ReturnType<typeof setTimeout> | null = null
        spool.roll(() => {
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
        })

        /*  utility function for timeout refresh  */
        const refreshTimeout = () => {
            if (timer !== null)
                clearTimeout(timer)
            timer = setTimeout(() => {
                stream.destroy(new Error("communication timeout"))
                spool.unroll()
            }, this.options.timeout)
        }

        /*  start timeout handler  */
        refreshTimeout()

        /*  ensure resources are released if consumer aborts stream early  */
        stream.once("close", () => spool.unroll())
        stream.once("error", () => spool.unroll())

        /*  register response dispatch callback  */
        this.onResponse.set(`source-fetch-response:${requestId}`, (response: SourceFetchResponse) => {
            if (response.sender)
                serverId = response.sender
            metaResolve?.(response.meta)
            if (response.error) {
                stream.destroy(new Error(response.error))
                spool.unroll()
            }
            else
                refreshTimeout()
        })

        /*  register chunk dispatch callback  */
        this.onResponse.set(`source-fetch-chunk:${requestId}`, (response: SourceFetchChunk) => {
            if (response.sender)
                serverId = response.sender
            if (response.error) {
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

        /*  publish message to MQTT topic  */
        run(`publish fetch request as MQTT message to topic "${topic}"`, spool, () =>
            this._publishToTopic(topic, message, { qos: 2, ...options })).catch((err: unknown) => {
            stream.destroy(ensureError(err))
            spool.unroll()
        })

        /*  produce result  */
        const result = { stream, buffer, meta: metaP }
        makeMutuallyExclusiveFields(result, "stream", "buffer")
        return result
    }

}
