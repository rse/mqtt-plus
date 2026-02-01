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
import { streamToBuffer, sendBufferAsChunks, sendStreamAsChunks } from "./mqtt-plus-util"
import { SinkPushResponse }                                       from "./mqtt-plus-msg"
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
    private pushStreams = new Map<string, Readable>()
    private pushTimers  = new Map<string, ReturnType<typeof setTimeout>>()

    /*  establish a sink (for receiving pushed data)  */
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
        ...args:  any[]
    ): Promise<Registration> {
        /*  determine actual parameters  */
        let name:     K
        let callback: WithInfo<T[K], InfoSink>
        let options:  Partial<IClientSubscribeOptions> = {}
        let share     = "default"
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
        const topic     = `$share/${share}/${name}`
        const topicResB = this.options.topicMake(topic, "sink-push-response")
        const topicResD = this.options.topicMake(topic, "sink-push-response", this.options.id)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicResB, { qos: 2, ...options }),
            this._subscribeTopic(topicResD, { qos: 2, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicResB).catch(() => {})
            this._unsubscribeTopic(topicResD).catch(() => {})
            throw err
        })

        /*  remember the sinking  */
        this.sinks.set(name, {
            callback: callback as WithInfo<APIEndpointSink, InfoSink>,
            auth
        })

        /*  provide a sinking object for subsequent destroying  */
        const self = this
        const registration: Registration = {
            async destroy (): Promise<void> {
                if (!self.sinks.has(name))
                    throw new Error(`destroy: sink "${name}" not established`)
                self.sinks.delete(name)
                return Promise.all([
                    self._unsubscribeTopic(topicResB),
                    self._unsubscribeTopic(topicResD)
                ]).then(() => {})
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
    push<K extends SinkKeys<T> & string> (
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
        let streamOrBuffer: Readable | Uint8Array
        let params:         Parameters<T[K]>
        let receiver:       string | undefined
        let options:        IClientPublishOptions = {}
        let meta:           Record<string, any> | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name           = nameOrConfig.name
            streamOrBuffer = nameOrConfig.data
            params         = nameOrConfig.params
            receiver       = nameOrConfig.receiver
            options        = nameOrConfig.options ?? {}
            meta           = nameOrConfig.meta
        }
        else {
            /*  positional API  */
            name           = nameOrConfig as K
            streamOrBuffer = args[0] as Readable | Uint8Array
            params         = args.slice(1) as Parameters<T[K]>
        }

        /*  generate unique request id  */
        const rid = nanoid()

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(name, "sink-push-response", receiver)

        /*  track whether first chunk has been sent (for meta)  */
        let firstChunk = true

        /*  callback for creating and sending a chunk message  */
        const sendChunk = (chunk: Uint8Array | undefined, error: string | undefined, final: boolean) => {
            const auth = this.authenticate()
            const metaStore = firstChunk ? this.metaStore(meta) : undefined
            firstChunk = false
            const request = this.msg.makeSinkPushResponse(rid, name,
                params, chunk, error, final, this.options.id, receiver, auth, metaStore)
            const message = this.codec.encode(request)
            this._publishToTopic(topic, message, { qos: 2, ...options }).catch(() => {})
        }

        /*  iterate over all chunks of the buffer  */
        return new Promise((resolve, reject) => {
            if (streamOrBuffer instanceof Readable) {
                /*  attach to the readable  */
                sendStreamAsChunks(
                    streamOrBuffer, this.options.chunkSize, sendChunk,
                    () => resolve(),
                    (err) => reject(err)
                )
            }
            else if (streamOrBuffer instanceof Uint8Array) {
                /*  split buffer into chunks and send them  */
                sendBufferAsChunks(streamOrBuffer, this.options.chunkSize, sendChunk)
                resolve()
            }
        })
    }

    /*  dispatch message (Sink Push pattern handling)  */
    protected async _dispatchMessage (topic: string, parsed: any) {
        super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)

        /*  handle sink push response (on server-side for push)  */
        if (topicMatch !== null
            && topicMatch.operation === "sink-push-response"
            && parsed instanceof SinkPushResponse) {
            /*  determine information  */
            const requestId = parsed.id
            const error = parsed.error
            const meta  = parsed.meta
            const final = parsed.final
            const chunk = (parsed.chunk !== undefined && !(parsed.chunk instanceof Uint8Array))
                ? Uint8Array.from(parsed.chunk) : parsed.chunk

            /*  handle response on push  */
            if (parsed.name !== undefined) {
                const name = parsed.name
                const handler = this.sinks.get(name)
                if (handler !== undefined) {
                    let readable = this.pushStreams.get(requestId)
                    if (readable === undefined) {
                        readable = new Readable({ read (_size) {} })
                        this.pushStreams.set(requestId, readable)

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
                        const params = parsed.params ?? []
                        const info: InfoSink = { sender: parsed.sender ?? "" }
                        if (parsed.receiver)
                            info.receiver = parsed.receiver
                        if (parsed.meta)
                            info.meta = meta
                        if (handler?.auth)
                            info.authenticated = await this.authenticated(parsed.sender, parsed.auth, handler.auth)
                        info.stream = readable
                        info.buffer = promise

                        /*  call handler  */
                        const stream = readable
                        Promise.resolve().then(() => {
                            if (info.authenticated !== undefined && !info.authenticated)
                                throw new Error(`sink "${name}" failed authentication`)
                            return handler.callback(...params, info)
                        }).catch((err: Error) => {
                            this.error(err)
                            stream.destroy(err)
                        })
                    }

                    /*  utility to cleanup timer  */
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
}
