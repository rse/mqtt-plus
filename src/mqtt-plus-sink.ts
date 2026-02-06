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
import { RefCountedSubscription,
    streamToBuffer, sendBufferAsChunks, sendStreamAsChunks }      from "./mqtt-plus-util"
import { SinkPushRequest, SinkPushResponse, SinkPushChunk }       from "./mqtt-plus-msg"
import { APISchema, SinkKeys, APIEndpointSink, Registration }     from "./mqtt-plus-api"
import type { WithInfo, InfoSink }                                from "./mqtt-plus-info"
import { SourceTrait }                                            from "./mqtt-plus-source"
import type { AuthOption }                                        from "./mqtt-plus-auth"

/*  Sink Push Communication Trait  */
export class SinkTrait<T extends APISchema = APISchema> extends SourceTrait<T> {
    /*  sink state  */
    private sinks = new Map<string, {
        callback: WithInfo<APIEndpointSink, InfoSink>,
        auth?:    AuthOption
    }>()
    private pushStreams   = new Map<string, Readable>()
    private pushTimers    = new Map<string, ReturnType<typeof setTimeout>>()
    private pushCallbacks = new Map<string, {
        name:     string,
        callback: (parsed: SinkPushResponse) => void
    }>()
    private pushSubscriptions = new RefCountedSubscription(
        (topic, options) => this._subscribeTopic(topic, options),
        (topic)          => this._unsubscribeTopic(topic),
        (err)            => this.error(err)
    )

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
            share    = nameOrConfig.share ?? "default"
            auth     = nameOrConfig.auth
        }
        else {
            /*  positional API  */
            name     = nameOrConfig as K
            callback = args[0] as WithInfo<T[K], InfoSink>
        }

        /*  sanity check situation  */
        if (this.sinks.has(name))
            throw new Error(`sink: sink "${name}" already established`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS      = `$share/${share}/${name}`
        const topicReqB   = this.options.topicMake(topicS, "sink-push-request")
        const topicReqD   = this.options.topicMake(name, "sink-push-request", this.options.id)
        const topicChunkD = this.options.topicMake(name, "sink-push-chunk",   this.options.id)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicReqB,   { qos: 2, ...options }),
            this._subscribeTopic(topicReqD,   { qos: 2, ...options }),
            this._subscribeTopic(topicChunkD, { qos: 2, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicReqB).catch(() => {})
            this._unsubscribeTopic(topicReqD).catch(() => {})
            this._unsubscribeTopic(topicChunkD).catch(() => {})
            throw err
        })

        /*  remember the registration  */
        this.sinks.set(name, {
            callback: callback as WithInfo<APIEndpointSink, InfoSink>,
            auth
        })

        /*  provide a registration for subsequent destruction  */
        const registration: Registration = {
            destroy: async (): Promise<void> => {
                if (!this.sinks.has(name))
                    throw new Error(`destroy: sink "${name}" not established`)
                this.sinks.delete(name)
                return Promise.all([
                    this._unsubscribeTopic(topicReqB),
                    this._unsubscribeTopic(topicReqD),
                    this._unsubscribeTopic(topicChunkD)
                ]).then(() => {}).catch((err: Error) => {
                    this.error(err, `destroy: failed to unsubscribe from topics for sink "${name}"`)
                })
            }
        }
        return registration
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
            name     = nameOrConfig as K
            data     = args[0] as Readable | Uint8Array
            params   = args.slice(1) as Parameters<T[K]>
        }

        /*  generate unique request id  */
        const requestId = nanoid()

        /*  subscribe to response topic (for ack/nak)  */
        const responseTopic = this.options.topicMake(name, "sink-push-response", this.options.id)
        await this.pushSubscriptions.subscribe(responseTopic, { qos: 2 })

        /*  define timer  */
        let timer: ReturnType<typeof setTimeout> | null = null

        /*  utility function for cleanup  */
        const cleanup = () => {
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
            this.pushSubscriptions.unsubscribe(responseTopic)
            this.pushCallbacks.delete(requestId)
        }

        /*  send request and wait for response before sending chunks  */
        await new Promise<void>((resolve, reject) => {
            /*  start timeout handler  */
            timer = setTimeout(() => {
                cleanup()
                reject(new Error("communication timeout"))
            }, this.options.timeout)

            /*  register callback for response  */
            this.pushCallbacks.set(requestId, {
                name,
                callback: (response: SinkPushResponse) => {
                    const error = response.error
                    if (error)
                        reject(new Error(error))
                    else {
                        if (response.sender)
                            receiver = response.sender
                        resolve()
                    }
                }
            })

            /*  generate and send request message  */
            const auth      = this.authenticate()
            const metaStore = this.metaStore(meta)
            const request   = this.msg.makeSinkPushRequest(requestId,
                name, params, this.options.id, receiver, auth, metaStore)
            const message   = this.codec.encode(request)
            const requestTopic = this.options.topicMake(name, "sink-push-request", receiver)
            this._publishToTopic(requestTopic, message, { qos: 2, ...options }).catch((err: Error) => {
                reject(err)
            })
        }).finally(() => {
            cleanup()
        })

        /*  generate corresponding MQTT topic for chunks  */
        const chunkTopic = this.options.topicMake(name, "sink-push-chunk", receiver)

        /*  callback for creating and sending a chunk message  */
        const sendChunk = async (chunk: Uint8Array | undefined, error: string | undefined, final: boolean): Promise<void> => {
            const chunkMsg = this.msg.makeSinkPushChunk(requestId,
                name, chunk, error, final, this.options.id, receiver)
            const message = this.codec.encode(chunkMsg)
            await this._publishToTopic(chunkTopic, message, { qos: 2, ...options })
        }

        /*  iterate over all chunks of the buffer  */
        if (data instanceof Readable)
            /*  attach to the readable  */
            await sendStreamAsChunks(data, this.options.chunkSize, sendChunk)
        else if (data instanceof Uint8Array)
            /*  split buffer into chunks and send them  */
            await sendBufferAsChunks(data, this.options.chunkSize, sendChunk)
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
                const sender    = parsed.sender ?? ""
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
                const sendResponse = async (error?: string) => {
                    const auth = this.authenticate()
                    const metaStore = this.metaStore(info.meta)
                    const response = this.msg.makeSinkPushResponse(requestId,
                        name, error, this.options.id, sender, auth, metaStore)
                    const message = this.codec.encode(response)
                    await this._publishToTopic(responseTopic, message, { qos: 2 })
                }

                /*  utility function for cleanup  */
                let streamCleanedUp = false
                const cleanupStream = () => {
                    if (streamCleanedUp)
                        return
                    streamCleanedUp = true
                    const timer = this.pushTimers.get(requestId)
                    if (timer !== undefined) {
                        clearTimeout(timer)
                        this.pushTimers.delete(requestId)
                    }
                    const stream = this.pushStreams.get(requestId)
                    if (stream !== undefined) {
                        stream.destroy()
                        this.pushStreams.delete(requestId)
                    }
                }

                /*  check authentication and prepare stream  */
                let responseSent = false
                Promise.resolve().then(async () => {
                    if (info.authenticated !== undefined && !info.authenticated)
                        throw new Error(`sink "${name}" failed authentication`)

                    /*  create readable for buffering received chunks  */
                    const readable = new Readable({ read (_size) {} })
                    this.pushStreams.set(requestId, readable)
                    readable.once("close", cleanupStream)
                    readable.once("error", cleanupStream)

                    /*  start timeout for push stream cleanup  */
                    const timer = setTimeout(() => {
                        const stream = this.pushStreams.get(requestId)
                        if (stream !== undefined) {
                            stream.destroy(new Error("push stream timeout"))
                            this.pushStreams.delete(requestId)
                            this.pushTimers.delete(requestId)
                        }
                    }, this.options.timeout)
                    this.pushTimers.set(requestId, timer)

                    /*  prepare info object  */
                    const promise = streamToBuffer(readable)
                    info.stream = readable
                    info.buffer = promise

                    /*  send ack response  */
                    await sendResponse()
                    responseSent = true

                    /*  call handler  */
                    return handler.callback(...params, info)
                }).catch(async (err: Error) => {
                    /*  cleanup resources  */
                    cleanupStream()

                    /*  send error (nak response)  */
                    this.error(err)
                    if (!responseSent)
                        await sendResponse(err.message)
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
            const handler   = this.pushCallbacks.get(requestId)
            if (handler !== undefined)
                handler.callback(parsed)
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
                const clearPushTimer = () => {
                    const timer = this.pushTimers.get(requestId)
                    if (timer !== undefined) {
                        clearTimeout(timer)
                        this.pushTimers.delete(requestId)
                    }
                }
                if (error !== undefined) {
                    clearPushTimer()
                    readable.destroy(new Error(error))
                    this.pushStreams.delete(requestId)
                }
                else {
                    const timer = this.pushTimers.get(requestId)
                    if (timer !== undefined) {
                        clearTimeout(timer)
                        this.pushTimers.set(requestId, setTimeout(() => {
                            const stream = this.pushStreams.get(requestId)
                            if (stream !== undefined) {
                                stream.destroy(new Error("push stream timeout"))
                                this.pushStreams.delete(requestId)
                                this.pushTimers.delete(requestId)
                            }
                        }, this.options.timeout))
                    }
                    if (chunk !== undefined)
                        readable.push(chunk)
                    if (final) {
                        clearPushTimer()
                        readable.push(null)
                        this.pushStreams.delete(requestId)
                    }
                }
            }
        }
    }
}
