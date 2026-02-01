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
import { SourceFetchRequest, SourceFetchResponse,
    SourceFetchChunk }                                            from "./mqtt-plus-msg"
import { APISchema, SourceKeys, APIEndpointSource, Registration } from "./mqtt-plus-api"
import type { WithInfo, InfoSource }                              from "./mqtt-plus-info"
import { ServiceTrait }                                           from "./mqtt-plus-service"
import type { AuthOption }                                        from "./mqtt-plus-auth"

/*  Source Fetch Communication Trait  */
export class SourceTrait<T extends APISchema = APISchema> extends ServiceTrait<T> {
    /*  source state  */
    protected sources = new Map<string, {
        callback: WithInfo<APIEndpointSource, InfoSource>,
        auth?:    AuthOption
    }>()
    private callbacks = new Map<string, {
        name: string,
        callback: (
            error: Error               | undefined,
            chunk: Uint8Array          | undefined,
            meta:  Record<string, any> | undefined,
            final: boolean             | undefined
        ) => void
    }>()

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
        ...args:  any[]
    ): Promise<Registration> {
        /*  determine actual parameters  */
        let name:     K
        let callback: WithInfo<T[K], InfoSource>
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
            callback = args[0] as WithInfo<T[K], InfoSource>
        }

        /*  sanity check situation  */
        if (this.sources.has(name))
            throw new Error(`source: source "${name}" already established`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topic     = `$share/${share}/${name}`
        const topicReqB = this.options.topicMake(topic, "source-fetch-request")
        const topicReqD = this.options.topicMake(topic, "source-fetch-request", this.options.id)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicReqB, { qos: 2, ...options }),
            this._subscribeTopic(topicReqD, { qos: 2, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicReqB).catch(() => {})
            this._unsubscribeTopic(topicReqD).catch(() => {})
            throw err
        })

        /*  remember the registration  */
        this.sources.set(name, {
            callback: callback as WithInfo<APIEndpointSource, InfoSource>,
            auth
        })

        /*  provide a registration for subsequent destruction  */
        const self = this
        const registration: Registration = {
            async destroy (): Promise<void> {
                if (!self.sources.has(name))
                    throw new Error(`destroy: source "${name}" not established`)
                self.sources.delete(name)
                return Promise.all([
                    self._unsubscribeTopic(topicReqB),
                    self._unsubscribeTopic(topicReqD)
                ]).then(() => {})
            }
        }
        return registration
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
        let receiver:  string | undefined
        let options:   IClientPublishOptions = {}
        let meta:      Record<string, any> | undefined
        let params:    Parameters<T[K]>
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
            name   = nameOrConfig as K
            params = args as Parameters<T[K]>
        }

        /*  generate unique request id for the request  */
        const requestId = nanoid()

        /*  subscribe to response topic (for ack/nak) and chunk topic (for data)  */
        const responseTopic = this.options.topicMake(name, "source-fetch-response", this.options.id)
        const chunkTopic    = this.options.topicMake(name, "source-fetch-chunk",    this.options.id)
        await Promise.all([
            this._subscribeTopic(responseTopic, { qos: 2 }),
            this._subscribeTopic(chunkTopic,    { qos: 2 })
        ])

        /*  establish readable for buffering received chunks  */
        const stream = new Readable({ read (_size) {} })

        /*  create promise for collecting stream chunks  */
        const buffer = streamToBuffer(stream)

        /*  create promise for meta (resolved on first chunk)  */
        let metaResolve: (value: Record<string, any> | undefined) => void
        const metaP = new Promise<Record<string, any> | undefined>((resolve) => {
            metaResolve = resolve
        })

        /*  define timer  */
        let timer: ReturnType<typeof setTimeout> | null = null

        /*  utility function for cleanup  */
        const cleanup = (resolveMeta = false) => {
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
            this._unsubscribeTopic(responseTopic).catch(() => {})
            this._unsubscribeTopic(chunkTopic).catch(() => {})
            this.callbacks.delete(requestId)
            if (resolveMeta)
                metaResolve?.(undefined)
        }

        /*  start timeout handler  */
        timer = setTimeout(() => {
            cleanup(true)
            stream.destroy(new Error("communication timeout"))
        }, this.options.timeout)

        /*  register stream handler to collect chunks  */
        let firstChunk = true
        this.callbacks.set(requestId, {
            name,
            callback: (
                error: Error               | undefined,
                chunk: Uint8Array          | undefined,
                meta:  Record<string, any> | undefined,
                final: boolean             | undefined
            ) => {
                const wasFirstChunk = firstChunk
                if (firstChunk) {
                    firstChunk = false
                    metaResolve?.(meta)
                }
                if (error !== undefined) {
                    cleanup(!wasFirstChunk)
                    stream.destroy(error)
                }
                else {
                    if (chunk !== undefined)
                        stream.push(chunk)
                    if (final) {
                        cleanup()
                        stream.push(null)
                    }
                }
            }
        })

        /*  generate encoded message  */
        const auth = this.authenticate()
        const metaStore = this.metaStore(meta)
        const request = this.msg.makeSourceFetchRequest(requestId,
            name, params, this.options.id, receiver, auth, metaStore)
        const message = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(name, "source-fetch-request", receiver)

        /*  publish message to MQTT topic  */
        this._publishToTopic(topic, message, { qos: 2, ...options }).catch(() => {})

        /*  produce result  */
        return { stream, buffer, meta: metaP }
    }

    /*  dispatch message (Source Fetch pattern handling)  */
    protected async _dispatchMessage (topic: string, parsed: any) {
        super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)

        /*  handle source fetch request (on server-side for fetch)  */
        if (topicMatch !== null
            && topicMatch.operation === "source-fetch-request"
            && parsed instanceof SourceFetchRequest) {
            const name = parsed.name
            const handler = this.sources.get(name)
            if (handler !== undefined) {
                /*  determine information  */
                const requestId = parsed.id
                const source    = parsed.name
                const params    = parsed.params ?? []
                const sender    = parsed.sender ?? ""
                const receiver  = parsed.receiver
                const info: InfoSource = { sender }
                if (receiver)
                    info.receiver = receiver
                if (parsed.meta)
                    info.meta = parsed.meta
                if (handler?.auth)
                    info.authenticated = await this.authenticated(parsed.sender, parsed.auth, handler.auth)

                /*  generate corresponding MQTT topics  */
                const responseTopic = this.options.topicMake(source, "source-fetch-response", sender)
                const chunkTopic    = this.options.topicMake(source, "source-fetch-chunk", sender)

                /*  callback for sending the ack/nak response  */
                const sendResponse = (error?: string) => {
                    const auth = this.authenticate()
                    const metaStore = this.metaStore(info.meta)
                    const response = this.msg.makeSourceFetchResponse(requestId,
                        source, error, this.options.id, sender, auth, metaStore)
                    const message = this.codec.encode(response)
                    this._publishToTopic(responseTopic, message, { qos: 2 }).catch(() => {})
                }

                /*  callback for creating and sending a chunk message  */
                const sendChunk = (chunk: Uint8Array | undefined, error: string | undefined, final: boolean) => {
                    const chunkMsg = this.msg.makeSourceFetchChunk(requestId,
                        source, chunk, error, final, this.options.id, sender)
                    const message = this.codec.encode(chunkMsg)
                    this._publishToTopic(chunkTopic, message, { qos: 2 }).catch(() => {})
                }

                /*  call the handler callback  */
                Promise.resolve().then(() => {
                    if (info.authenticated !== undefined && !info.authenticated)
                        throw new Error(`source "${name}" failed authentication`)
                    return handler.callback(...params, info)
                }).then(async () => {
                    /*  send ack response  */
                    sendResponse()

                    /*  handle Readable stream result  */
                    if (info.stream instanceof Readable)
                        sendStreamAsChunks(info.stream, this.options.chunkSize, sendChunk,
                            () => {}, (err) => sendChunk(undefined, err.message, true))

                    /*  handle Buffer result  */
                    else if (info.buffer instanceof Promise)
                        sendBufferAsChunks(await info.buffer, this.options.chunkSize, sendChunk)

                    /*  fail  */
                    else
                        throw new Error("handler did not provide data via info.stream or info.buffer field")
                }).catch((err: Error) => {
                    /*  send error (nak response)  */
                    this.error(err)
                    sendResponse(err.message)
                })
            }
        }

        /*  handle source fetch response (ack/nak on client-side for fetch)  */
        else if (topicMatch !== null
            && topicMatch.operation === "source-fetch-response"
            && parsed instanceof SourceFetchResponse) {
            /*  determine information  */
            const requestId = parsed.id
            const error = parsed.error
            const meta  = parsed.meta

            /*  handle response on fetch (ack/nak)  */
            const handler = this.callbacks.get(requestId)
            if (handler !== undefined) {
                if (error)
                    handler.callback(new Error(error), undefined, meta, true)
                else
                    handler.callback(undefined, undefined, meta, false)
            }
        }

        /*  handle source fetch chunk (actual data on client-side for fetch)  */
        else if (topicMatch !== null
            && topicMatch.operation === "source-fetch-chunk"
            && parsed instanceof SourceFetchChunk) {
            /*  determine information  */
            const requestId = parsed.id
            const error = parsed.error
            const final = parsed.final
            const chunk = (parsed.chunk !== undefined && !(parsed.chunk instanceof Uint8Array))
                ? Uint8Array.from(parsed.chunk) : parsed.chunk

            /*  handle chunk on fetch  */
            const handler = this.callbacks.get(requestId)
            if (handler !== undefined)
                handler.callback(error ? new Error(error) : undefined, chunk, undefined, final)
        }
    }
}
