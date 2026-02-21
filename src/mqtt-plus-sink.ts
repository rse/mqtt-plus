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
import { CreditGate, RefCountedSubscription,
    streamToBuffer, sendBufferAsChunks,
    sendStreamAsChunks, makeMutuallyExclusiveFields }     from "./mqtt-plus-util"
import { run, Spool }                                     from "./mqtt-plus-error"
import { SinkPushRequest, SinkPushResponse,
    SinkPushChunk, SinkPushCredit }                       from "./mqtt-plus-msg"
import type { APISchema, SinkKeys, Registration }         from "./mqtt-plus-api"
import type { WithInfo, InfoSink }                        from "./mqtt-plus-info"
import { SourceTrait }                                    from "./mqtt-plus-source"
import type { AuthOption }                                from "./mqtt-plus-auth"

/*  Sink Push Trait  */
export class SinkTrait<T extends APISchema = APISchema> extends SourceTrait<T> {
    /*  sink state  */
    private sinks                 = new Map<string, (request: SinkPushRequest, topicName: string) => void>()
    private pushStreams           = new Map<string, Readable>()
    private pushSpools            = new Map<string, Spool>()
    private pushTimers            = new Map<string, ReturnType<typeof setTimeout>>()
    private pushChunkCallbacks    = new Map<string, (response: SinkPushChunk, topicName: string) => void>()
    private pushResponseCallbacks = new Map<string, (response: SinkPushResponse) => void>()
    private pushCreditCallbacks   = new Map<string, (response: SinkPushCredit) => void>()
    private pushSubscriptions     = new RefCountedSubscription(
        (topic, options) => this._subscribeTopic(topic, options),
        (topic)          => this._unsubscribeTopic(topic)
    )

    /*  destroy sink trait  */
    override destroy () {
        super.destroy()
        this.pushSubscriptions.flush()
    }

    /*  refresh push timer for a specific request  */
    private _refreshPushTimer (requestId: string) {
        const timer = this.pushTimers.get(requestId)
        if (timer !== undefined)
            clearTimeout(timer)
        this.pushTimers.set(requestId, setTimeout(() => {
            this.pushTimers.delete(requestId)
            const stream = this.pushStreams.get(requestId)
            if (stream !== undefined)
                stream.destroy(new Error("push stream timeout"))
            const spool = this.pushSpools.get(requestId)
            spool?.unroll()
        }, this.options.timeout))
    }

    /*  clear push timer for a specific request  */
    private _clearPushTimer (requestId: string) {
        const timer = this.pushTimers.get(requestId)
        if (timer !== undefined) {
            clearTimeout(timer)
            this.pushTimers.delete(requestId)
        }
    }

    /*  register a sink  */
    async sink<K extends SinkKeys<T> & string> (
        name:     K,
        callback: WithInfo<T[K], InfoSink>
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
        let name:     K
        let callback: WithInfo<T[K], InfoSink>
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
        if (this.sinks.has(name))
            throw new Error(`sink: sink "${name}" already established`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS      = `$share/${share}/${name}`
        const topicReqB   = this.options.topicMake(topicS, "sink-push-request")
        const topicReqD   = this.options.topicMake(name,   "sink-push-request", this.options.id)
        const topicChunkD = this.options.topicMake(name,   "sink-push-chunk",   this.options.id)

        /*  remember the registration  */
        this.sinks.set(name, (request: SinkPushRequest, topicName: string) => {
            /*  determine information  */
            const requestId = request.id
            const params    = request.params ?? []
            const sender    = request.sender
            if (sender === undefined || sender === "")
                throw new Error("invalid request: missing sender")
            const receiver  = request.receiver
            const info: InfoSink = { sender }
            if (receiver)
                info.receiver = receiver
            if (request.meta)
                info.meta = request.meta

            /*  generate corresponding MQTT topic for response  */
            const responseTopic = this.options.topicMake(name, "sink-push-response", sender)

            /*  callback for sending the ack/nak response  */
            const chunkCredit = this.options.chunkCredit
            const sendResponse = async (error?: string) => {
                const authToken = this.authenticate()
                const metaStore = this.metaStore(info.meta)
                const credit = chunkCredit > 0 ? chunkCredit : undefined
                const response = this.msg.makeSinkPushResponse(requestId,
                    name, error, this.options.id, sender, authToken, metaStore, credit)
                const message = this.codec.encode(response)
                await this._publishToTopic(responseTopic, message, { qos: 2 })
            }

            /*  create a resource spool for stream cleanup  */
            const reqSpool = new Spool()
            this.pushSpools.set(requestId, reqSpool)
            reqSpool.roll(() => { this.pushSpools.delete(requestId) })

            /*  check authentication and prepare stream  */
            Promise.resolve().then(async () => {
                if (topicName !== request.name)
                    throw new Error(`sink name mismatch between topic "${topicName}" and payload "${request.name}"`)
                if (auth)
                    info.authenticated = await this.authenticated(request.sender, request.auth, auth)
                if (info.authenticated !== undefined && !info.authenticated)
                    throw new Error(`sink "${name}" failed authentication`)

                /*  initialize credit-based flow control state  */
                const creditState = chunkCredit > 0 ? {
                    chunksReceived: 0,
                    creditGranted:  chunkCredit
                } : undefined

                /*  utility functions for timeout management  */
                const refreshPushTimeout = () => this._refreshPushTimer(requestId)
                const clearPushTimeout   = () => this._clearPushTimer(requestId)

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
                            const creditTopic = this.options.topicMake(
                                name, "sink-push-credit", sender)
                            this._publishToTopic(creditTopic, encoded, { qos: 2 }).catch((err: Error) => {
                                this.error(err, `sending credit for push "${name}" failed`)
                            })
                            refreshPushTimeout()
                        }
                    }
                })
                this.pushStreams.set(requestId, readable)
                reqSpool.roll(() => { this.pushStreams.delete(requestId) })
                readable.once("close", () => reqSpool.unroll())
                readable.once("error", () => reqSpool.unroll())

                /*  register chunk dispatch callback  */
                this.pushChunkCallbacks.set(requestId, (chunkParsed: SinkPushChunk, chunkTopicName: string) => {
                    if (chunkTopicName !== chunkParsed.name)
                        throw new Error(`sink name mismatch between topic "${chunkTopicName}" ` +
                            `and payload "${chunkParsed.name}"`)
                    if (chunkParsed.error !== undefined) {
                        readable.destroy(new Error(chunkParsed.error))
                        reqSpool.unroll()
                    }
                    else {
                        refreshPushTimeout()
                        if (chunkParsed.chunk !== undefined) {
                            if (creditState)
                                creditState.chunksReceived++
                            readable.push(chunkParsed.chunk)
                        }
                        if (chunkParsed.final) {
                            readable.push(null)
                            reqSpool.unroll()
                        }
                    }
                })
                reqSpool.roll(() => { this.pushChunkCallbacks.delete(requestId) })

                /*  start timeout for push stream cleanup  */
                refreshPushTimeout()
                reqSpool.roll(() => { clearPushTimeout() })

                /*  prepare info object  */
                const promise = streamToBuffer(readable)
                info.stream = readable
                info.buffer = promise
                makeMutuallyExclusiveFields(info, "stream", "buffer")

                /*  send ack response  */
                await sendResponse()

                /*  call handler  */
                return callback(...params, info)
            }).catch(async (err: Error) => {
                /*  cleanup resources  */
                const stream = this.pushStreams.get(requestId)
                if (stream !== undefined)
                    stream.destroy()
                reqSpool.unroll()

                /*  send error (nak response)  */
                this.error(err)
                await sendResponse(err.message).catch(() => {})
            })
        })
        spool.roll(() => { this.sinks.delete(name) })

        /*  subscribe to MQTT topics  */
        await run(`subscribe to MQTT topic "${topicReqB}"`, spool, () =>
            this._subscribeTopic(topicReqB, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicReqB).catch(() => {}))
        await run(`subscribe to MQTT topic "${topicReqD}"`, spool, () =>
            this._subscribeTopic(topicReqD, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicReqD).catch(() => {}))
        await run(`subscribe to MQTT topic "${topicChunkD}"`, spool, () =>
            this._subscribeTopic(topicChunkD, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicChunkD).catch(() => {}))

        /*  provide a registration for subsequent destruction  */
        return {
            destroy: async (): Promise<void> => {
                if (!this.sinks.has(name))
                    throw new Error(`destroy: sink "${name}" not established`)
                await spool.unroll(false)?.catch((err: Error) => {
                    this.error(err, `destroy: failed to cleanup: ${err.message}`)
                })
            }
        }
    }

    /*  push to sink ("chunked content")  */
    push<K extends SinkKeys<T> & string> (
        name:          K,
        data:          Readable | Uint8Array,
        ...params:     Parameters<T[K]>
    ): Promise<void>
    push<K extends SinkKeys<T> & string> (
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
        let name:           K
        let data:           Readable | Uint8Array
        let params:         Parameters<T[K]>
        let receiver:       string | undefined
        let options:        IClientPublishOptions = {}
        let meta:           Record<string, any> | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name     = nameOrConfig.name
            data     = nameOrConfig.data
            params   = nameOrConfig.params
            receiver = nameOrConfig.receiver
            options  = nameOrConfig.options ?? {}
            meta     = nameOrConfig.meta
        }
        else {
            /*  positional API  */
            name     = nameOrConfig
            data     = args[0]
            params   = args.slice(1) as Parameters<T[K]>
        }

        /*  create a resource spool  */
        const spool = new Spool()

        /*  generate unique request id  */
        const requestId = nanoid()

        /*  subscribe to response topic (for ack/nak)  */
        const responseTopic = this.options.topicMake(name, "sink-push-response", this.options.id)
        await run(`subscribe to MQTT topic "${responseTopic}"`, spool, () =>
            this.pushSubscriptions.subscribe(responseTopic, { qos: options.qos ?? 2 }))
        spool.roll(() => this.pushSubscriptions.unsubscribe(responseTopic))

        /*  define abort controller and signal  */
        const abortController = new AbortController()
        const abortSignal     = abortController.signal

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
                abortController.abort(new Error(`push to sink "${name}" timed out`))
                spool.unroll()
            }, this.options.timeout)
        }

        /*  start timeout handler  */
        refreshTimeout()

        /*  send request and wait for response before sending chunks  */
        let initialCredit: number | undefined
        let creditGate: CreditGate | undefined
        try {
            await new Promise<void>((resolve, reject) => {
                /*  handle abort signal  */
                const onAbort = () => { reject(abortSignal.reason) }
                abortSignal.addEventListener("abort", onAbort, { once: true })
                spool.roll(() => { abortSignal.removeEventListener("abort", onAbort) })

                /*  register handlers for initial response  */
                this.pushResponseCallbacks.set(requestId, (response: SinkPushResponse) => {
                    if (response.error)
                        reject(new Error(response.error))
                    else {
                        if (response.sender)
                            receiver = response.sender
                        initialCredit = response.credit
                        resolve()
                    }
                })
                spool.roll(() => { this.pushResponseCallbacks.delete(requestId) })
                this.pushCreditCallbacks.set(requestId, (_response: SinkPushCredit) => {
                    refreshTimeout()
                })
                spool.roll(() => { this.pushCreditCallbacks.delete(requestId) })

                /*  generate and send request message  */
                const auth      = this.authenticate()
                const metaStore = this.metaStore(meta)
                const request   = this.msg.makeSinkPushRequest(requestId,
                    name, params, this.options.id, receiver, auth, metaStore)
                const message   = this.codec.encode(request)
                const requestTopic = this.options.topicMake(name, "sink-push-request", receiver)
                run(`publish push request as MQTT message to topic "${requestTopic}"`, spool, () =>
                    this._publishToTopic(requestTopic, message, { qos: 2, ...options })).catch((err: Error) => {
                    reject(err)
                })
            })

            /*  override handler for mid-stream (error) responses  */
            this.pushResponseCallbacks.set(requestId, (response: SinkPushResponse) => {
                if (response.error)
                    abortController.abort(new Error(response.error))
            })

            /*  create credit gate for flow control (if server granted credit)  */
            if (initialCredit !== undefined && initialCredit > 0)
                creditGate = new CreditGate(initialCredit)

            /*  subscribe to credit topic if flow control is active  */
            if (creditGate) {
                const creditTopic = this.options.topicMake(name, "sink-push-credit", this.options.id)
                await run(`subscribe to MQTT topic "${creditTopic}"`, spool, () =>
                    this.pushSubscriptions.subscribe(creditTopic, { qos: 2 }))
                spool.roll(() => this.pushSubscriptions.unsubscribe(creditTopic))
                const gate = creditGate
                spool.roll(() => { gate.abort() })

                /*  update credit callback to include gate replenish  */
                this.pushCreditCallbacks.set(requestId, (response: SinkPushCredit) => {
                    gate.replenish(response.credit)
                    refreshTimeout()
                })
            }

            /*  generate corresponding MQTT topic for chunks  */
            const chunkTopic = this.options.topicMake(name, "sink-push-chunk", receiver)

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
                await this._publishToTopic(chunkTopic, message, { qos: 2, ...options })
            }

            /*  iterate over all chunks of the buffer  */
            if (data instanceof Readable)
                /*  attach to the readable  */
                await sendStreamAsChunks(data, this.options.chunkSize, sendChunk, creditGate, abortSignal)
            else if (data instanceof Uint8Array)
                /*  split buffer into chunks and send them  */
                await sendBufferAsChunks(data, this.options.chunkSize, sendChunk, creditGate, abortSignal)
        }
        catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err)
            const chunkTopic = this.options.topicMake(name, "sink-push-chunk", receiver)
            const chunkMsg = this.msg.makeSinkPushChunk(requestId,
                name, undefined, error, true, this.options.id, receiver)
            const message = this.codec.encode(chunkMsg)
            await this._publishToTopic(chunkTopic, message, { qos: 2, ...options }).catch(() => {})
            throw err
        }
        finally {
            await spool.unroll()
        }
    }

    /*  dispatch incoming MQTT message  */
    protected override async _dispatchMessage (topic: string, message: any) {
        /*  forward dispatching to other traits  */
        await super._dispatchMessage(topic, message)

        /*  match the MQTT topic  */
        const topicMatch = this.options.topicMatch(topic)

        /*  handle sink push request (on server-side)  */
        if (topicMatch !== null
            && topicMatch.operation === "sink-push-request"
            && message instanceof SinkPushRequest) {
            const handler = this.sinks.get(message.name)
            if (handler !== undefined)
                handler(message, topicMatch.name)
        }

        /*  handle sink push response (on client-side)  */
        else if (topicMatch !== null
            && topicMatch.operation === "sink-push-response"
            && message instanceof SinkPushResponse) {
            const handler = this.pushResponseCallbacks.get(message.id)
            if (handler !== undefined)
                handler(message)
        }

        /*  handle sink push chunk (on server-side)  */
        else if (topicMatch !== null
            && topicMatch.operation === "sink-push-chunk"
            && message instanceof SinkPushChunk) {
            const handler = this.pushChunkCallbacks.get(message.id)
            if (handler !== undefined)
                handler(message, topicMatch.name)
        }

        /*  handle sink push credit (on client-side)  */
        else if (topicMatch !== null
            && topicMatch.operation === "sink-push-credit"
            && message instanceof SinkPushCredit) {
            const handler = this.pushCreditCallbacks.get(message.id)
            if (handler !== undefined)
                handler(message)
        }
    }
}
