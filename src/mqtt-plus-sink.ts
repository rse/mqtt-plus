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
import type { SinkPushRequest, SinkPushResponse,
    SinkPushChunk, SinkPushCredit }                       from "./mqtt-plus-msg"
import type { APISchema, SinkKeys, Registration }         from "./mqtt-plus-api"
import type { WithInfo, InfoSink }                        from "./mqtt-plus-info"
import { SourceTrait }                                    from "./mqtt-plus-source"
import type { AuthOption }                                from "./mqtt-plus-auth"

/*  Sink Push Trait  */
export class SinkTrait<T extends APISchema = APISchema> extends SourceTrait<T> {
    /*  sink state  */
    private pushStreams = new Map<string, Readable>()
    private pushSpools  = new Map<string, Spool>()

    /*  destroy trait  */
    override async destroy () {
        for (const stream of this.pushStreams.values())
            stream.destroy(new Error("sink destroyed"))
        this.pushStreams.clear()
        for (const spool of this.pushSpools.values())
            await spool.unroll()
        this.pushSpools.clear()
        await super.destroy()
    }

    /*  register a sink  */
    async sink<K extends SinkKeys<T> & string> (
        name:          K,
        callback:      WithInfo<T[K], InfoSink>
    ): Promise<Registration>
    async sink<K extends SinkKeys<T> & string> (
        config: {
            name:      K,
            callback:  WithInfo<T[K], InfoSink>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        }
    ): Promise<Registration>
    async sink<K extends SinkKeys<T> & string> (
        nameOrConfig: K | {
            name:      K,
            callback:  WithInfo<T[K], InfoSink>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        },
        ...args:       any[]
    ): Promise<Registration> {
        /*  determine actual parameters  */
        let name:      K
        let callback:  WithInfo<T[K], InfoSink>
        let options:   Partial<IClientSubscribeOptions> = {}
        let share      = this.options.share
        let auth:      AuthOption | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name       = nameOrConfig.name
            callback   = nameOrConfig.callback
            options    = nameOrConfig.options ?? {}
            share      = nameOrConfig.share   ?? this.options.share
            auth       = nameOrConfig.auth
        }
        else {
            /*  positional API  */
            name       = nameOrConfig
            callback   = args[0]
        }

        /*  create a resource spool  */
        const spool = new Spool()

        /*  sanity check situation  */
        if (this.onRequest.has(`sink-push-request:${name}`))
            throw new Error(`sink: sink "${name}" already registered`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS    = share !== "" ? `$share/${share}/${name}` : name
        const topicReqB = this.options.topicMake(topicS, "sink-push-request")
        const topicReqD = this.options.topicMake(name,   "sink-push-request", this.options.id)

        /*  react on sink push request  */
        this.onRequest.set(`sink-push-request:${name}`, async (request: SinkPushRequest, topicName: string) => {
            /*  determine information  */
            const requestId = request.id
            const params    = request.params ?? []
            const sender    = request.sender
            if (sender === undefined || sender === "")
                throw new Error("invalid request: missing sender")
            const receiver  = request.receiver

            /*  generate corresponding MQTT topic for response  */
            const responseTopic = this.options.topicMake(name, "sink-push-response", sender)

            /*  callback for sending the ack/nak response  */
            const chunkCredit = this.options.chunkCredit
            const sendResponse = async (error?: string, withCredit: boolean = false) => {
                const credit = (error === undefined && withCredit && chunkCredit > 0) ? chunkCredit : undefined
                const response = this.msg.makeSinkPushResponse(requestId,
                    name, error, this.options.id, sender, credit)
                const message = this.codec.encode(response)
                await this.publishToTopic(responseTopic, message, { qos: options.qos ?? 2 })
            }

            /*  create a resource spool for stream cleanup  */
            const reqSpool = new Spool()
            this.pushSpools.set(requestId, reqSpool)
            reqSpool.roll(() => { this.pushSpools.delete(requestId) })

            /*  check authentication and prepare stream  */
            try {
                if (topicName !== request.name)
                    throw new Error(`sink name mismatch (topic: "${topicName}", payload: "${request.name}")`)
                let authenticated: boolean | undefined = undefined
                if (auth)
                    authenticated = await this.authenticated(sender, request.auth, auth)
                if (authenticated !== undefined && !authenticated)
                    throw new Error(`sink "${name}" failed authentication`)

                /*  initialize credit-based flow control state  */
                const creditState = chunkCredit > 0 ? {
                    chunksReceived: 0,
                    creditGranted:  chunkCredit
                } : undefined

                /*  utility functions for timeout management  */
                const pushTimerId = `sink-push-recv:${requestId}`
                const refreshPushTimeout = () => this.timerRefresh(pushTimerId, () => {
                    const stream = this.pushStreams.get(requestId)
                    if (stream !== undefined)
                        stream.destroy(new Error("push stream timeout"))
                    const spool = this.pushSpools.get(requestId)
                    spool?.unroll()
                })
                const clearPushTimeout   = () => this.timerClear(pushTimerId)

                /*  create a readable for buffering received chunks  */
                const readable = new Readable({
                    highWaterMark: chunkCredit > 0 ? chunkCredit * this.options.chunkSize : 16 * 1024,
                    read: (_size) => {
                        if (!creditState || !this.pushSpools.has(requestId))
                            return
                        const creditToGrant = Math.max(0,
                            creditState.chunksReceived + chunkCredit - creditState.creditGranted)
                        if (creditToGrant > 0) {
                            creditState.creditGranted += creditToGrant
                            const creditMsg = this.msg.makeSinkPushCredit(requestId,
                                name, creditToGrant, this.options.id, sender)
                            const encoded = this.codec.encode(creditMsg)
                            this.publishToTopic(responseTopic, encoded, { qos: options.qos ?? 2 }).catch((err: Error) => {
                                this.error(err, `sending credit for push "${name}" failed`)
                            })
                            refreshPushTimeout()
                        }
                    }
                })
                this.pushStreams.set(requestId, readable)
                reqSpool.roll(() => { this.pushStreams.delete(requestId) })
                readable.once("error", () => {}) /*  prevent unhandled error exception  */

                /*  register chunk dispatch callback  */
                let streamEnded = false
                this.onResponse.set(`sink-push-chunk:${requestId}`, async (chunkParsed: SinkPushChunk) => {
                    if (streamEnded)
                        return
                    if (chunkParsed.error !== undefined) {
                        streamEnded = true
                        readable.destroy(new Error(chunkParsed.error))
                        await reqSpool.unroll()
                    }
                    else {
                        refreshPushTimeout()
                        if (chunkParsed.chunk !== undefined) {
                            if (creditState)
                                creditState.chunksReceived++
                            readable.push(chunkParsed.chunk)
                        }
                        if (chunkParsed.final) {
                            streamEnded = true
                            readable.push(null)
                            await reqSpool.unroll()
                        }
                    }
                })
                reqSpool.roll(() => { this.onResponse.delete(`sink-push-chunk:${requestId}`) })

                /*  start timeout for push stream cleanup  */
                refreshPushTimeout()
                reqSpool.roll(() => { clearPushTimeout() })

                /*  prepare info object  */
                const promise = streamToBuffer(readable)
                promise.catch(() => {}) /*  avoid unhandled promise rejection  */
                const info: InfoSink = {
                    sender,
                    stream: readable,
                    buffer: promise
                }
                if (receiver)
                    info.receiver = receiver
                if (authenticated !== undefined)
                    info.authenticated = authenticated
                if (request.meta)
                    info.meta = request.meta
                makeMutuallyExclusiveFields(info, "stream", "buffer")

                /*  send ack response  */
                await sendResponse(undefined, true)

                /*  call handler  */
                await callback(...params, info)

                /*  await full stream consumption before confirming success  */
                await promise

                /*  send terminal success response  */
                await sendResponse()
            }
            catch (err: unknown) {
                const error = ensureError(err, `handler for sink "${name}" failed`)

                /*  send error as nak response or as mid-stream error response  */
                this.error(error)
                await sendResponse(error.message).catch(() => {})
            }
            finally {
                /*  cleanup resources  */
                const stream = this.pushStreams.get(requestId)
                if (stream !== undefined && !stream.destroyed)
                    stream.destroy()
                await reqSpool.unroll()
            }
        })
        spool.roll(() => { this.onRequest.delete(`sink-push-request:${name}`) })

        /*  subscribe to MQTT topics  */
        await this.subscribeTopicAndSpool(spool, topicReqB, options)
        await this.subscribeTopicAndSpool(spool, topicReqD, options)

        /*  provide a registration for subsequent destruction  */
        return this.makeRegistration(spool, "sink", name, `sink-push-request:${name}`)
    }

    /*  push to sink ("chunked content")  */
    async push<K extends SinkKeys<T> & string> (
        name:          K,
        data:          Readable | Uint8Array,
        ...params:     Parameters<T[K]>
    ): Promise<void>
    async push<K extends SinkKeys<T> & string> (
        config: {
            name:      K,
            data:      Readable | Uint8Array,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>
        }
    ): Promise<void>
    async push<K extends SinkKeys<T> & string> (
        nameOrConfig: K | {
            name:      K,
            data:      Readable | Uint8Array,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>
        },
        ...args:       any[]
    ): Promise<void> {
        /*  determine actual parameters  */
        let name:      K
        let data:      Readable | Uint8Array
        let params:    Parameters<T[K]>
        let receiver:  string | undefined
        let options:   IClientPublishOptions = {}
        let meta:      Record<string, any> | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name       = nameOrConfig.name
            data       = nameOrConfig.data
            params     = nameOrConfig.params
            receiver   = nameOrConfig.receiver
            options    = nameOrConfig.options ?? {}
            meta       = nameOrConfig.meta
        }
        else {
            /*  positional API  */
            name       = nameOrConfig
            data       = args[0]
            params     = args.slice(1) as Parameters<T[K]>
        }

        /*  sanity check data type  */
        if (!(data instanceof Readable) && !(data instanceof Uint8Array))
            throw new Error("invalid data type: expected Readable or Uint8Array")

        /*  create a resource spool  */
        const spool = new Spool()

        /*  generate unique request id  */
        let requestId = nanoid()
        while (this.onResponse.has(`sink-push-response:${requestId}`)
            || this.onResponse.has(`sink-push-credit:${requestId}`))
            requestId = nanoid()

        /*  subscribe to response topic (for ack/nak)  */
        const responseTopic = this.options.topicMake(name, "sink-push-response", this.options.id)
        await this.subscribeTopicAndSpool(spool, responseTopic, { qos: options.qos ?? 2 })

        /*  define abort controller and signal  */
        const abortController = new AbortController()
        const abortSignal     = abortController.signal

        /*  ensure stream gets destroyed on abort  */
        if (data instanceof Readable) {
            const stream = data
            abortSignal.addEventListener("abort", () => {
                if (!stream.destroyed)
                    stream.destroy(ensureError(abortSignal.reason))
            }, { once: true })
        }

        /*  utility function for timeout refresh  */
        const pushTimerId = `sink-push-send:${requestId}`
        const refreshTimeout = () => this.timerRefresh(pushTimerId, () => {
            const error = new Error(`push to sink "${name}" timed out`)
            abortController.abort(error)
            spool.unroll()
        })
        spool.roll(() => { this.timerClear(pushTimerId) })

        /*  start timeout handler  */
        refreshTimeout()

        /*  send request and wait for response before sending chunks  */
        let initialCredit:        number | undefined
        let creditGate:           CreditGate | undefined
        let remoteError           = false
        let pushAcked             = false
        let pushFinalized         = false
        let pushFinalizeResolve!: () => void
        let pushFinalizeReject!:  (reason?: any) => void
        const pushFinalize        = new Promise<void>((resolve, reject) => {
            pushFinalizeResolve   = resolve
            pushFinalizeReject    = reject
        })
        pushFinalize.catch(() => {})  /*  avoid unhandled promise rejection  */
        try {
            await new Promise<void>((resolve, reject) => {
                /*  handle abort signal  */
                const onAbort = () => { reject(abortSignal.reason) }
                abortSignal.addEventListener("abort", onAbort, { once: true })
                spool.roll(() => { abortSignal.removeEventListener("abort", onAbort) })

                /*  register handlers for initial response  */
                this.onResponse.set(`sink-push-response:${requestId}`, (response: SinkPushResponse) => {
                    if (response.error)
                        reject(new Error(response.error))
                    else {
                        if (response.sender)
                            receiver = response.sender
                        initialCredit = response.credit
                        pushAcked = true
                        resolve()
                    }
                })
                spool.roll(() => { this.onResponse.delete(`sink-push-response:${requestId}`) })

                /*  generate and send request message  */
                const auth      = this.authenticate()
                const metaStore = this.metaStore(meta)
                const request   = this.msg.makeSinkPushRequest(requestId,
                    name, params, this.options.id, receiver, auth, metaStore)
                const message   = this.codec.encode(request)
                const requestTopic = this.options.topicMake(name, "sink-push-request", receiver)
                run(`publish push request as MQTT message to topic "${requestTopic}"`, spool, () =>
                    this.publishToTopic(requestTopic, message, { qos: 2, ...options })).catch((err: Error) => {
                    reject(err)
                })
            })

            /*  override handler for mid-stream (error) responses  */
            this.onResponse.set(`sink-push-response:${requestId}`, (response: SinkPushResponse) => {
                if (response.error) {
                    remoteError = true
                    pushFinalizeReject(new Error(response.error))
                    abortController.abort(new Error(response.error))
                }
                else if (pushAcked && !pushFinalized) {
                    pushFinalized = true
                    pushFinalizeResolve()
                }
            })

            /*  create credit gate for flow control (if server granted credit)  */
            if (initialCredit !== undefined && initialCredit > 0)
                creditGate = new CreditGate(initialCredit)

            /*  register credit callback for flow control (credit arrives on response topic)  */
            if (creditGate) {
                const gate = creditGate
                spool.roll(() => { gate.abort() })
                this.onResponse.set(`sink-push-credit:${requestId}`, (response: SinkPushCredit) => {
                    gate.replenish(response.credit)
                    refreshTimeout()
                })
                spool.roll(() => { this.onResponse.delete(`sink-push-credit:${requestId}`) })
            }

            /*  generate corresponding MQTT topic for chunks (use request topic)  */
            const chunkTopic = this.options.topicMake(name, "sink-push-request", receiver)

            /*  callback for creating and sending a chunk message  */
            const sendChunk = async (
                chunk: Uint8Array | undefined,
                error: string | undefined,
                final: boolean
            ): Promise<void> => {
                refreshTimeout()
                const chunkMsg = this.msg.makeSinkPushChunk(requestId,
                    name, chunk, error, final, this.options.id, receiver)
                const message = this.codec.encode(chunkMsg)
                await this.publishToTopic(chunkTopic, message, { qos: 2, ...options })
            }

            /*  iterate over all chunks of the buffer  */
            if (data instanceof Readable)
                /*  attach to the readable  */
                await sendStreamAsChunks(data, this.options.chunkSize, sendChunk, creditGate, abortSignal)
            else if (data instanceof Uint8Array)
                /*  split buffer into chunks and send them  */
                await sendBufferAsChunks(data, this.options.chunkSize, sendChunk, creditGate, abortSignal)

            /*  wait for terminal sink response  */
            if (!pushFinalized) {
                await new Promise<void>((resolve, reject) => {
                    const onAbort = () => { reject(abortSignal.reason) }
                    abortSignal.addEventListener("abort", onAbort, { once: true })
                    pushFinalize.then(resolve, reject).finally(() => {
                        abortSignal.removeEventListener("abort", onAbort)
                    })
                })
            }
        }
        catch (err: unknown) {
            const error = ensureError(err)
            abortController.abort(error)

            /*  send error chunk only if push was acked and error did not originate from receiver
                (before ack, the sink has no chunk handler yet and will time out on its own)  */
            if (pushAcked && receiver !== undefined && !remoteError) {
                const chunkTopic = this.options.topicMake(name, "sink-push-request", receiver)
                const chunkMsg = this.msg.makeSinkPushChunk(requestId,
                    name, undefined, error.message, true, this.options.id, receiver)
                const message = this.codec.encode(chunkMsg)
                await this.publishToTopic(chunkTopic, message, { qos: 2, ...options }).catch(() => {})
            }
            throw err
        }
        finally {
            await spool.unroll()
        }
    }
}
