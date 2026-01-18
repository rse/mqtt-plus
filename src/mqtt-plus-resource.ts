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
import { Readable }                                               from "stream"

/*  external requirements  */
import { IClientPublishOptions, IClientSubscribeOptions }         from "mqtt"
import { nanoid }                                                 from "nanoid"

/*  internal requirements  */
import { streamToBuffer, sendBufferAsChunks, sendStreamAsChunks } from "./mqtt-plus-util"
import { ResourceTransferRequest, ResourceTransferResponse }      from "./mqtt-plus-msg"
import { APISchema, ResourceKeys, APIEndpointResource }           from "./mqtt-plus-api"
import type { WithInfo, InfoResource }                            from "./mqtt-plus-info"
import type { Receiver }                                          from "./mqtt-plus-receiver"
import type { Meta }                                              from "./mqtt-plus-meta"
import { ServiceTrait }                                           from "./mqtt-plus-service"

/*  the provisioning result type  */
export interface Provisioning {
    unprovision (): Promise<void>
}

/*  Resource Communication Trait  */
export class ResourceTrait<T extends APISchema = APISchema> extends ServiceTrait<T> {
    /*  resource provisioning state  */
    private provisionings =
        new Map<string, WithInfo<APIEndpointResource, InfoResource>>()
    private callbacks = new Map<string, {
        resource: string,
        callback: (
            error: Error               | undefined,
            chunk: Buffer              | undefined,
            meta:  Record<string, any> | undefined,
            final: boolean             | undefined
        ) => void
    }>()
    private pushStreams = new Map<string, Readable>()
    private pushTimers  = new Map<string, ReturnType<typeof setTimeout>>()

    /*  provision a resource (for both fetch requests and pushed data)  */
    async provision<K extends ResourceKeys<T> & string> (
        resource: K,
        callback: WithInfo<T[K], InfoResource>
    ): Promise<Provisioning>
    async provision<K extends ResourceKeys<T> & string> (
        resource: K,
        options:  Partial<IClientSubscribeOptions>,
        callback: WithInfo<T[K], InfoResource>
    ): Promise<Provisioning>
    async provision<K extends ResourceKeys<T> & string> (
        resource: K,
        ...args:  any[]
    ): Promise<Provisioning> {
        /*  determine parameters  */
        let options:  Partial<IClientSubscribeOptions> = {}
        let callback: WithInfo<T[K], InfoResource> = args[0]
        if (args.length === 2 && typeof args[0] === "object") {
            options  = args[0]
            callback = args[1]
        }

        /*  sanity check situation  */
        if (this.provisionings.has(resource))
            throw new Error(`provision: resource "${resource}" already provisioned`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicReqB = this.options.topicMake(resource, "resource-transfer-request")
        const topicReqD = this.options.topicMake(resource, "resource-transfer-request", this.options.id)
        const topicResB = this.options.topicMake(resource, "resource-transfer-response")
        const topicResD = this.options.topicMake(resource, "resource-transfer-response", this.options.id)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicReqB, { qos: 2, ...options }),
            this._subscribeTopic(topicReqD, { qos: 2, ...options }),
            this._subscribeTopic(topicResB, { qos: 2, ...options }),
            this._subscribeTopic(topicResD, { qos: 2, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicReqB).catch(() => {})
            this._unsubscribeTopic(topicReqD).catch(() => {})
            this._unsubscribeTopic(topicResB).catch(() => {})
            this._unsubscribeTopic(topicResD).catch(() => {})
            throw err
        })

        /*  remember the provisioning  */
        this.provisionings.set(resource, callback as WithInfo<APIEndpointResource, InfoResource>)

        /*  provide a provisioning object for subsequent unprovisioning  */
        const self = this
        const provisioning: Provisioning = {
            async unprovision (): Promise<void> {
                if (!self.provisionings.has(resource))
                    throw new Error(`unprovision: resource "${resource}" not provisioned`)
                self.provisionings.delete(resource)
                return Promise.all([
                    self._unsubscribeTopic(topicReqB),
                    self._unsubscribeTopic(topicReqD),
                    self._unsubscribeTopic(topicResB),
                    self._unsubscribeTopic(topicResD)
                ]).then(() => {})
            }
        }
        return provisioning
    }

    /*  push resource ("chunked content")  */
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        receiver:  Receiver,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        receiver:  Receiver,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        receiver:  Receiver,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        receiver:  Receiver,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        meta:      Meta,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        meta:      Meta,
        receiver:  Receiver,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        meta:      Meta,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        buffer:    Buffer,
        meta:      Meta,
        receiver:  Receiver,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        meta:      Meta,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        meta:      Meta,
        receiver:  Receiver,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        meta:      Meta,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:  K,
        stream:    Readable,
        meta:      Meta,
        receiver:  Receiver,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<void>
    push<K extends ResourceKeys<T> & string> (
        resource:       K,
        streamOrBuffer: Readable | Buffer,
        ...args:        any[]
    ): Promise<void> {
        /*  determine actual parameters  */
        const { meta, receiver, options, params } = this._parseCallArgs(args)

        /*  generate unique request id  */
        const rid = nanoid()

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(resource, "resource-transfer-response", receiver)

        /*  track whether first chunk has been sent (for meta)  */
        let firstChunk = true

        /*  callback for creating and sending a chunk message  */
        const sendChunk = (chunk: Buffer | undefined, error: string | undefined, final: boolean) => {
            const chunkMeta = firstChunk ? meta : undefined
            firstChunk = false
            const request = this.msg.makeResourceTransferResponse(rid, resource,
                params, chunk, chunkMeta, error, final, this.options.id, receiver)
            const message = this.codec.encode(request)
            this.mqtt.publish(topic, message, { qos: 2, ...options })
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
            else if (streamOrBuffer instanceof Buffer) {
                /*  split buffer into chunks and send them  */
                sendBufferAsChunks(streamOrBuffer, this.options.chunkSize, sendChunk)
                resolve()
            }
        })
    }

    /*  fetch resource  */
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        ...params: Parameters<T[K]>
    ): Promise<{
        stream: Readable,
        buffer: Promise<Buffer>,
        meta:   Promise<Record<string, any> | undefined>
    }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        receiver:  Receiver,
        ...params: Parameters<T[K]>
    ): Promise<{
        stream: Readable,
        buffer: Promise<Buffer>,
        meta:   Promise<Record<string, any> | undefined>
    }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<{
        stream: Readable,
        buffer: Promise<Buffer>,
        meta:   Promise<Record<string, any> | undefined>
    }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        receiver:  Receiver,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<{
        stream: Readable,
        buffer: Promise<Buffer>,
        meta:   Promise<Record<string, any> | undefined>
    }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        ...args:   any[]
    ): Promise<{
        stream: Readable,
        buffer: Promise<Buffer>,
        meta:   Promise<Record<string, any> | undefined>
    }> {
        /*  determine actual parameters  */
        const { receiver, options, params } = this._parseCallArgs(args)

        /*  generate unique request id for the request  */
        const requestId = nanoid()

        /*  subscribe to stream response topic  */
        const responseTopic = this.options.topicMake(resource, "resource-transfer-response", this.options.id)
        await this._subscribeTopic(responseTopic, { qos: 2 })

        /*  establish readable for buffering received chunks  */
        const stream = new Readable({ read (_size) {} })

        /*  create promise for collecting stream chunks  */
        const buffer = streamToBuffer(stream)

        /*  create promise for meta (resolved on first chunk)  */
        let metaResolve: (value: Record<string, any> | undefined) => void
        const meta = new Promise<Record<string, any> | undefined>((resolve) => {
            metaResolve = resolve
        })

        /*  define timer  */
        let timer: ReturnType<typeof setTimeout> | null = null

        /*  utility function for cleanup  */
        const cleanup = () => {
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
            this._unsubscribeTopic(responseTopic).catch(() => {})
            this.callbacks.delete(requestId)
        }

        /*  start timeout handler  */
        timer = setTimeout(() => {
            cleanup()
            metaResolve?.(undefined)
            stream.destroy(new Error("communication timeout"))
        }, this.options.timeout)

        /*  register stream handler to collect chunks  */
        let firstChunk = true
        this.callbacks.set(requestId, {
            resource,
            callback: (
                error: Error               | undefined,
                chunk: Buffer              | undefined,
                meta:  Record<string, any> | undefined,
                final: boolean             | undefined
            ) => {
                if (firstChunk) {
                    firstChunk = false
                    metaResolve?.(meta)
                }
                if (error !== undefined) {
                    cleanup()
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
        const request = this.msg.makeResourceTransferRequest(requestId,
            resource, params, this.options.id, receiver)
        const message = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(resource, "resource-transfer-request", receiver)

        /*  publish message to MQTT topic  */
        this.mqtt.publish(topic, message, { qos: 2, ...options })

        /*  produce result  */
        return { stream, buffer, meta }
    }

    /*  dispatch message (Resource pattern handling)  */
    protected _dispatchMessage (topic: string, parsed: any) {
        super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)

        /*  handle resource request (on server-side for fetch)  */
        if (topicMatch !== null
            && topicMatch.operation === "resource-transfer-request"
            && parsed instanceof ResourceTransferRequest) {
            const name = parsed.resource
            const handler = this.provisionings.get(name)
            if (handler !== undefined) {
                /*  determine information  */
                const requestId = parsed.id
                const resource  = parsed.resource
                const params    = parsed.params ?? []
                const sender    = parsed.sender ?? ""
                const receiver  = parsed.receiver
                const info: InfoResource = { sender, receiver, resource: null }

                /*  generate corresponding MQTT topic  */
                const responseTopic = this.options.topicMake(resource, "resource-transfer-response", sender)

                /*  callback for creating and sending a chunk message  */
                let firstChunk = true
                const sendChunk = (chunk: Buffer | undefined, error: string | undefined, final: boolean) => {
                    const chunkMeta = firstChunk ? info.meta : undefined
                    firstChunk = false
                    const request = this.msg.makeResourceTransferResponse(requestId,
                        resource, undefined, chunk, chunkMeta, error, final, this.options.id, sender)
                    const message = this.codec.encode(request)
                    this.mqtt.publish(responseTopic, message, { qos: 2 })
                }

                /*  call the handler callback  */
                Promise.resolve()
                    .then(() => handler(...params, info))
                    .then(() => {
                        /*  ensure the resource field is filled  */
                        if (info.resource === null)
                            throw new Error("handler did not provide data via info.resource field")

                        /*  handle Readable stream result  */
                        if (info.resource instanceof Readable)
                            sendStreamAsChunks(info.resource, this.options.chunkSize, sendChunk,
                                () => {}, (err) => sendChunk(undefined, err.message, true))

                        /*  handle Buffer result  */
                        else if (info.resource instanceof Buffer)
                            sendBufferAsChunks(info.resource, this.options.chunkSize, sendChunk)
                    })
                    .catch((err: Error) => {
                        /*  send error  */
                        sendChunk(undefined, err.message, true)
                    })
            }
        }

        /*  handle resource response (on server-side for push)  */
        else if (topicMatch !== null
            && topicMatch.operation === "resource-transfer-response"
            && parsed instanceof ResourceTransferResponse) {
            /*  determine information  */
            const requestId = parsed.id
            const error     = parsed.error
            const meta      = parsed.meta
            const final     = parsed.final
            const chunk     = (parsed.chunk !== undefined && !Buffer.isBuffer(parsed.chunk))
                ? Buffer.from(parsed.chunk) : parsed.chunk

            /*  case 1: response on fetch  */
            const handler = this.callbacks.get(requestId)
            if (handler !== undefined)
                handler.callback(error ? new Error(error) : undefined, chunk, meta, final)

            /*  case 2: response on push  */
            else if (parsed.resource !== undefined) {
                const name = parsed.resource
                const handler = this.provisionings.get(name)
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

                        const promise = streamToBuffer(readable)
                        const params = parsed.params ?? []
                        const info: InfoResource = {
                            sender:   parsed.sender ?? "",
                            receiver: parsed.receiver,
                            resource: null,
                            meta:     meta,
                            stream:   readable,
                            buffer:   promise
                        }
                        Promise.resolve()
                            .then(() => handler(...params, info))
                            .catch((_err: Error) => {})
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
