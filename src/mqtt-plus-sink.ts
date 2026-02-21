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
import { Readable }                                               from "node:stream"

/*  external requirements  */
import { IClientPublishOptions, IClientSubscribeOptions }         from "mqtt"
import { nanoid }                                                 from "nanoid"

/*  internal requirements  */
import { CreditGate, RefCountedSubscription,
    streamToBuffer, sendBufferAsChunks,
    sendStreamAsChunks, makeMutuallyExclusiveFields }             from "./mqtt-plus-util"
import { run, Spool }                                             from "./mqtt-plus-error"
import { SinkPushRequest, SinkPushResponse,
    SinkPushChunk, SinkPushCredit }                               from "./mqtt-plus-msg"
import { APISchema, SinkKeys, APIEndpointSink, Registration }     from "./mqtt-plus-api"
import type { WithInfo, InfoSink }                                from "./mqtt-plus-info"
import { SourceTrait }                                            from "./mqtt-plus-source"
import type { AuthOption }                                        from "./mqtt-plus-auth"

/*  Sink Push Trait  */
export class SinkTrait<T extends APISchema = APISchema> extends SourceTrait<T> {
    /*  sink state  */
    private sinks = new Map<string, {
        callback: WithInfo<APIEndpointSink, InfoSink>,
        auth?:    AuthOption
    }>()
    private pushStreams   = new Map<string, Readable>()
    private pushSpools    = new Map<string, Spool>()
    private pushTimers    = new Map<string, ReturnType<typeof setTimeout>>()
    private pushCallbacks = new Map<string, {
        name:       string,
        onResponse: (parsed: SinkPushResponse) => void,
        onCredit?:  (credit: number) => void
    }>()
    private pushCreditGates = new Map<string, CreditGate>()
    private pushCreditState = new Map<string, {
        chunkCredit:    number,
        chunksReceived: number,
        creditGranted:  number,
        sender:         string,
        name:           string
    }>()
    private pushSubscriptions = new RefCountedSubscription(
        (topic, options) => this._subscribeTopic(topic, options),
        (topic)          => this._unsubscribeTopic(topic)
    )

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
        this.sinks.set(name, { callback, auth })
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
                await spool.unroll()?.catch((err: Error) => {
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
                this.pushCallbacks.set(requestId, {
                    name,
                    onResponse: (response: SinkPushResponse) => {
                        const error = response.error
                        if (error)
                            reject(new Error(error))
                        else {
                            if (response.sender)
                                receiver = response.sender
                            initialCredit = response.credit
                            resolve()
                        }
                    },
                    onCredit: (_credit: number) => {
                        refreshTimeout()
                    }
                })
                spool.roll(() => { this.pushCallbacks.delete(requestId) })

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

            /*  override handlers for mid-stream (error) responses  */
            const handler = this.pushCallbacks.get(requestId)
            if (handler === undefined)
                throw new Error(`push: handler for request "${requestId}" unexpectedly disappeared`)
            handler.onResponse = (response: SinkPushResponse) => {
                const error = response.error
                if (error)
                    abortController.abort(new Error(error))
            }
            handler.onCredit = (_credit: number) => {
                refreshTimeout()
            }

            /*  create credit gate for flow control (if server granted credit)  */
            if (initialCredit !== undefined && initialCredit > 0)
                creditGate = new CreditGate(initialCredit)

            /*  subscribe to credit topic if flow control is active  */
            if (creditGate) {
                const creditTopic = this.options.topicMake(name, "sink-push-credit", this.options.id)
                await run(`subscribe to MQTT topic "${creditTopic}"`, spool, () =>
                    this.pushSubscriptions.subscribe(creditTopic, { qos: 2 }))
                spool.roll(() => this.pushSubscriptions.unsubscribe(creditTopic))
                this.pushCreditGates.set(requestId, creditGate)
                const gate = creditGate
                spool.roll(() => {
                    gate.abort()
                    this.pushCreditGates.delete(requestId)
                })
            }

            /*  generate corresponding MQTT topic for chunks  */
            const chunkTopic = this.options.topicMake(name, "sink-push-chunk", receiver)

            /*  callback for creating and sending a chunk message  */
            const sendChunk = async (chunk: Uint8Array | undefined, error: string | undefined, final: boolean): Promise<void> => {
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
    protected async _dispatchMessage (topic: string, parsed: any) {
        /*  forward dispatching to other traits  */
        await super._dispatchMessage(topic, parsed)

        /*  match the MQTT topic  */
        const topicMatch = this.options.topicMatch(topic)

        /*  handle sink push request (on server-side)  */
        if (topicMatch !== null
            && topicMatch.operation === "sink-push-request"
            && parsed instanceof SinkPushRequest) {
            const name = parsed.name
            if (topicMatch.name !== name)
                throw new Error(`sink name mismatch between topic "${topicMatch.name}" and payload "${name}"`)
            const handler = this.sinks.get(name)
            if (handler === undefined)
                throw new Error(`handler for sink "${name}" not found`)
            else {
                /*  determine information  */
                const requestId = parsed.id
                const params    = parsed.params ?? []
                const sender    = parsed.sender
                if (sender === undefined || sender === "")
                    throw new Error("invalid request: missing sender")
                const receiver  = parsed.receiver
                const info: InfoSink = { sender }
                if (receiver)
                    info.receiver = receiver
                if (parsed.meta)
                    info.meta = parsed.meta
                if (handler.auth)
                    info.authenticated = await this.authenticated(parsed.sender, parsed.auth, handler.auth)

                /*  generate corresponding MQTT topic for response  */
                const responseTopic = this.options.topicMake(name, "sink-push-response", sender)

                /*  callback for sending the ack/nak response  */
                const chunkCredit = this.options.chunkCredit
                const sendResponse = async (error?: string) => {
                    const auth = this.authenticate()
                    const metaStore = this.metaStore(info.meta)
                    const credit = chunkCredit > 0 ? chunkCredit : undefined
                    const response = this.msg.makeSinkPushResponse(requestId,
                        name, error, this.options.id, sender, auth, metaStore, credit)
                    const message = this.codec.encode(response)
                    await this._publishToTopic(responseTopic, message, { qos: 2 })
                }

                /*  create a resource spool for stream cleanup  */
                const spool = new Spool()
                this.pushSpools.set(requestId, spool)
                spool.roll(() => { this.pushSpools.delete(requestId) })

                /*  check authentication and prepare stream  */
                Promise.resolve().then(async () => {
                    if (info.authenticated !== undefined && !info.authenticated)
                        throw new Error(`sink "${name}" failed authentication`)

                    /*  initialize credit-based flow control state  */
                    if (chunkCredit > 0) {
                        this.pushCreditState.set(requestId, {
                            chunkCredit,
                            chunksReceived: 0,
                            creditGranted:  chunkCredit,
                            sender,
                            name
                        })
                        spool.roll(() => { this.pushCreditState.delete(requestId) })
                    }

                    /*  utility functions for timeout management  */
                    const refreshPushTimeout = () => this._refreshPushTimer(requestId)
                    const clearPushTimeout   = () => this._clearPushTimer(requestId)

                    /*  create a readable for buffering received chunks  */
                    const readable = new Readable({
                        highWaterMark: chunkCredit > 0 ? chunkCredit * this.options.chunkSize : 16 * 1024,
                        read: (_size) => {
                            const state = this.pushCreditState.get(requestId)
                            if (!state || !this.pushSpools.has(requestId))
                                return
                            const creditToGrant = Math.max(0,
                                state.chunksReceived + state.chunkCredit - state.creditGranted)
                            if (creditToGrant > 0) {
                                state.creditGranted += creditToGrant
                                const creditMsg = this.msg.makeSinkPushCredit(requestId,
                                    state.name, creditToGrant, this.options.id, state.sender)
                                const encoded = this.codec.encode(creditMsg)
                                const creditTopic = this.options.topicMake(
                                    state.name, "sink-push-credit", state.sender)
                                this._publishToTopic(creditTopic, encoded, { qos: 2 }).catch((err: Error) => {
                                    this.error(err, `sending credit for push "${state.name}" failed`)
                                })
                                refreshPushTimeout()
                            }
                        }
                    })
                    this.pushStreams.set(requestId, readable)
                    spool.roll(() => { this.pushStreams.delete(requestId) })
                    readable.once("close", () => spool.unroll())
                    readable.once("error", () => spool.unroll())

                    /*  start timeout for push stream cleanup  */
                    refreshPushTimeout()
                    spool.roll(() => { clearPushTimeout() })

                    /*  prepare info object  */
                    const promise = streamToBuffer(readable)
                    info.stream = readable
                    info.buffer = promise
                    makeMutuallyExclusiveFields(info, "stream", "buffer")

                    /*  send ack response  */
                    await sendResponse()

                    /*  call handler  */
                    return handler.callback(...params, info)
                }).catch(async (err: Error) => {
                    /*  cleanup resources  */
                    const stream = this.pushStreams.get(requestId)
                    if (stream !== undefined)
                        stream.destroy()
                    spool.unroll()

                    /*  send error (nak response)  */
                    this.error(err)
                    await sendResponse(err.message).catch(() => {})
                })
            }
        }

        /*  handle sink push response (on client-side)  */
        else if (topicMatch !== null
            && topicMatch.operation === "sink-push-response"
            && parsed instanceof SinkPushResponse) {
            const requestId = parsed.id
            if (topicMatch.name !== parsed.name)
                throw new Error(`sink name mismatch between topic "${topicMatch.name}" and payload "${parsed.name}"`)
            const handler = this.pushCallbacks.get(requestId)
            if (handler !== undefined)
                handler.onResponse(parsed)
        }

        /*  handle sink push chunk (on server-side)  */
        else if (topicMatch !== null
            && topicMatch.operation === "sink-push-chunk"
            && parsed instanceof SinkPushChunk) {
            /*  determine information  */
            const requestId = parsed.id
            if (topicMatch.name !== parsed.name)
                throw new Error(`sink name mismatch between topic "${topicMatch.name}" and payload "${parsed.name}"`)
            const error = parsed.error
            const final = parsed.final
            const chunk = parsed.chunk

            /*  handle chunk on push  */
            const readable = this.pushStreams.get(requestId)
            if (readable !== undefined) {
                if (error !== undefined) {
                    /*  destroy stream on error and cleanup all resources  */
                    readable.destroy(new Error(error))
                    const spool = this.pushSpools.get(requestId)
                    spool?.unroll()
                }
                else {
                    /*  refresh timeout  */
                    this._refreshPushTimer(requestId)

                    /*  push chunk data  */
                    if (chunk !== undefined) {
                        const creditState = this.pushCreditState.get(requestId)
                        if (creditState)
                            creditState.chunksReceived++
                        readable.push(chunk)
                    }

                    /*  signal end-of-stream on final chunk and cleanup all resources  */
                    if (final) {
                        readable.push(null)
                        const spool = this.pushSpools.get(requestId)
                        spool?.unroll()
                    }
                }
            }
        }

        /*  handle sink push credit (on client-side for push, replenish producer credit)  */
        else if (topicMatch !== null
            && topicMatch.operation === "sink-push-credit"
            && parsed instanceof SinkPushCredit) {
            const requestId = parsed.id
            const gate = this.pushCreditGates.get(requestId)
            if (gate !== undefined)
                gate.replenish(parsed.credit)

            /*  inform about received credit  */
            const handler = this.pushCallbacks.get(requestId)
            if (handler?.onCredit)
                handler.onCredit(parsed.credit)
        }
    }
}
