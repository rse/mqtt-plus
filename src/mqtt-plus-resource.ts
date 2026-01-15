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
import { Readable }                    from "stream"

/*  external requirements  */
import { IClientPublishOptions,
    IClientSubscribeOptions }          from "mqtt"
import { nanoid }                      from "nanoid"
import PLazy                           from "p-lazy"

/*  internal requirements  */
import { ResourceTransferRequest,
    ResourceTransferResponse }         from "./mqtt-plus-msg"
import { APISchema, ResourceKeys,
    APIEndpointResource }              from "./mqtt-plus-api"
import type { WithInfo,
    InfoResource }                     from "./mqtt-plus-info"
import type { Receiver }               from "./mqtt-plus-receiver"
import { ServiceTrait }                from "./mqtt-plus-service"

/*  the provisioning result type  */
export interface Provisioning {
    unprovision (): Promise<void>
}

/*  Resource Communication Trait  */
export class ResourceTrait<T extends APISchema = APISchema> extends ServiceTrait<T> {
    /*  resource provisioning state  */
    private provisionings =
        new Map<string, WithInfo<APIEndpointResource, InfoResource>>()
    private callbacks =
        new Map<string, {
            resource: string,
            callback: (error: Error | undefined, chunk: Buffer | undefined, final: boolean | undefined) => void
        }>()
    private pushStreams = new Map<string, Readable>()

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

    /*  utility function for collecting stream chunks into a Buffer  */
    private _collectStreamToBuffer (stream: Readable): Promise<Buffer> {
        return new PLazy<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = []
            stream.on("data", (data: Buffer) => {
                chunks.push(data)
            })
            stream.on("end", () => {
                resolve(Buffer.concat(chunks))
            })
            stream.on("error", (err: Error) => {
                reject(err)
            })
        })
    }

    /*  utility function for converting a chunk to a Buffer  */
    private _chunkToBuffer (chunk: unknown): Buffer {
        let buffer: Buffer
        if (Buffer.isBuffer(chunk))
            buffer = chunk
        else if (typeof chunk === "string")
            buffer = Buffer.from(chunk)
        else if (chunk instanceof Uint8Array)
            buffer = Buffer.from(chunk)
        else
            buffer = Buffer.from(String(chunk))
        return buffer
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
        resource:       K,
        streamOrBuffer: Readable | Buffer,
        ...args:        any[]
    ): Promise<void> {
        /*  determine actual parameters  */
        const { receiver, options, params } = this._parseCallArgs(args)

        /*  generate unique request id  */
        const rid = nanoid()

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(resource, "resource-transfer-response", receiver)

        /*  iterate over all chunks of the buffer  */
        return new Promise((resolve, reject) => {
            const chunkSize = this.options.chunkSize
            if (streamOrBuffer instanceof Readable) {
                /*  attach to the readable  */
                const readable = streamOrBuffer
                readable.on("readable", () => {
                    let chunk: unknown
                    while ((chunk = readable.read(chunkSize)) !== null) {
                        /*  ensure data is a Buffer  */
                        const buffer = this._chunkToBuffer(chunk)

                        /*  generate encoded message  */
                        const request = this.msg.makeResourceTransferResponse(rid, resource, params, buffer, undefined, false, this.options.id, receiver)
                        const message = this.codec.encode(request)

                        /*  publish message to MQTT topic  */
                        this.mqtt.publish(topic, message, { qos: 2, ...options })
                    }
                })
                readable.on("end", () => {
                    /*  send final chunk to signal end of stream  */
                    const request = this.msg.makeResourceTransferResponse(rid, resource, params, undefined, undefined, true, this.options.id, receiver)
                    const message = this.codec.encode(request)
                    this.mqtt.publish(topic, message, { qos: 2, ...options })
                    resolve()
                })
                readable.on("error", (err: Error) => {
                    const request = this.msg.makeResourceTransferResponse(rid, resource, params, undefined, err.message, true, this.options.id, receiver)
                    const message = this.codec.encode(request)
                    this.mqtt.publish(topic, message, { qos: 2, ...options })
                    reject(err)
                })
            }
            else if (streamOrBuffer instanceof Buffer) {
                /*  split buffer into chunks and send them  */
                const buffer = streamOrBuffer
                if (buffer.byteLength === 0) {
                    /*  handle empty buffer by sending final chunk  */
                    const request = this.msg.makeResourceTransferResponse(rid, resource, params, undefined, undefined, true, this.options.id, receiver)
                    const message = this.codec.encode(request)
                    this.mqtt.publish(topic, message, { qos: 2, ...options })
                }
                else {
                    for (let i = 0; i < buffer.byteLength; i += chunkSize) {
                        const size  = Math.min(buffer.byteLength - i, chunkSize)
                        const chunk = buffer.subarray(i, i + size)
                        const final = (i + size >= buffer.byteLength)

                        /*  generate encoded message  */
                        const request = this.msg.makeResourceTransferResponse(rid, resource, params, chunk, undefined, final, this.options.id, receiver)
                        const message = this.codec.encode(request)

                        /*  publish message to MQTT topic  */
                        this.mqtt.publish(topic, message, { qos: 2, ...options })
                    }
                }
                resolve()
            }
        })
    }

    /*  fetch resource  */
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        ...params: Parameters<T[K]>
    ): Promise<{ stream: Readable, buffer: Promise<Buffer> }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        receiver:  Receiver,
        ...params: Parameters<T[K]>
    ): Promise<{ stream: Readable, buffer: Promise<Buffer> }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<{ stream: Readable, buffer: Promise<Buffer> }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        receiver:  Receiver,
        options:   IClientPublishOptions,
        ...params: Parameters<T[K]>
    ): Promise<{ stream: Readable, buffer: Promise<Buffer> }>
    async fetch<K extends ResourceKeys<T> & string> (
        resource:  K,
        ...args:   any[]
    ): Promise<{ stream: Readable, buffer: Promise<Buffer> }> {
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
        const buffer = this._collectStreamToBuffer(stream)

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
            stream.destroy(new Error("communication timeout"))
        }, this.options.timeout)

        /*  register stream handler to collect chunks  */
        this.callbacks.set(requestId, {
            resource,
            callback: (error: Error | undefined, chunk: Buffer | undefined, final: boolean | undefined) => {
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
        const request = this.msg.makeResourceTransferRequest(requestId, resource, params, this.options.id, receiver)
        const message = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(resource, "resource-transfer-request", receiver)

        /*  publish message to MQTT topic  */
        this.mqtt.publish(topic, message, { qos: 2, ...options })

        /*  produce result  */
        return { stream, buffer }
    }

    /*  dispatch message (Resource pattern handling)  */
    protected _dispatchMessage (topic: string, parsed: any) {
        super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)

        /*  ==== handle resource request (on server-side for fetch) ====  */
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
                const topic = this.options.topicMake(resource, "resource-transfer-response", sender)
                const chunkSize = this.options.chunkSize

                /*  call the handler callback  */
                Promise.resolve()
                    .then(() => handler(...params, info))
                    .then(() => {
                        /*  ensure the resource field is filled  */
                        if (info.resource === null)
                            throw new Error("received no data in info \"resource\" field")

                        /*  handle Readable stream result  */
                        if (info.resource instanceof Readable) {
                            const readable = info.resource
                            readable.on("readable", () => {
                                let chunk: unknown
                                while ((chunk = readable.read(chunkSize)) !== null) {
                                    const buffer = this._chunkToBuffer(chunk)
                                    const request = this.msg.makeResourceTransferResponse(requestId, resource, undefined, buffer, undefined, false, this.options.id, sender)
                                    const message = this.codec.encode(request)
                                    this.mqtt.publish(topic, message, { qos: 2 })
                                }
                            })
                            readable.on("end", () => {
                                const request = this.msg.makeResourceTransferResponse(requestId, resource, undefined, undefined, undefined, true, this.options.id, sender)
                                const message = this.codec.encode(request)
                                this.mqtt.publish(topic, message, { qos: 2 })
                            })
                            readable.on("error", (err: Error) => {
                                const request = this.msg.makeResourceTransferResponse(requestId, resource, undefined, undefined, err.message, true, this.options.id, sender)
                                const message = this.codec.encode(request)
                                this.mqtt.publish(topic, message, { qos: 2 })
                            })
                        }

                        /*  handle Buffer result  */
                        else if (info.resource instanceof Buffer) {
                            const buffer = info.resource

                            /*  split Buffer into chunks and send them back  */
                            if (buffer.byteLength === 0) {
                                /*  handle empty buffer by sending final chunk  */
                                const request = this.msg.makeResourceTransferResponse(requestId, resource, undefined, undefined, undefined, true, this.options.id, sender)
                                const message = this.codec.encode(request)
                                this.mqtt.publish(topic, message, { qos: 2 })
                            }
                            else {
                                for (let i = 0; i < buffer.byteLength; i += chunkSize) {
                                    const size  = Math.min(buffer.byteLength - i, chunkSize)
                                    const chunk = buffer.subarray(i, i + size)
                                    const final = (i + size >= buffer.byteLength)
                                    const request = this.msg.makeResourceTransferResponse(requestId, resource, undefined, chunk, undefined, final, this.options.id, sender)
                                    const message = this.codec.encode(request)
                                    this.mqtt.publish(topic, message, { qos: 2 })
                                }
                            }
                        }
                    })
                    .catch((err: Error) => {
                        /*  send error  */
                        const request = this.msg.makeResourceTransferResponse(requestId, resource, undefined, undefined, err.message, true, this.options.id, sender)
                        const message = this.codec.encode(request)
                        this.mqtt.publish(topic, message, { qos: 2 })
                    })
            }
        }

        /*  ==== handle resource response (on server-side for push) ====  */
        else if (topicMatch !== null
            && topicMatch.operation === "resource-transfer-response"
            && parsed instanceof ResourceTransferResponse) {
            /*  determine information  */
            const requestId = parsed.id
            const error     = parsed.error
            const final     = parsed.final
            let chunk       = parsed.chunk
            if (chunk !== undefined && !Buffer.isBuffer(chunk))
                chunk = Buffer.from(chunk)

            /*  case 1: response on fetch  */
            const handler = this.callbacks.get(requestId)
            if (handler !== undefined)
                handler.callback(error ? new Error(error) : undefined, chunk, final)

            /*  case 2: response on push  */
            else if (parsed.resource !== undefined) {
                const name = parsed.resource
                const handler = this.provisionings.get(name)
                if (handler !== undefined) {
                    let readable = this.pushStreams.get(requestId)
                    if (readable === undefined) {
                        readable = new Readable({ read (_size) {} })
                        this.pushStreams.set(requestId, readable)
                        const promise = this._collectStreamToBuffer(readable)
                        const params = parsed.params ?? []
                        const info: InfoResource = {
                            sender:   parsed.sender ?? "",
                            receiver: parsed.receiver,
                            resource: null,
                            stream:   readable,
                            buffer:   promise
                        }
                        handler(...params, info)
                    }
                    if (error !== undefined) {
                        readable.destroy(new Error(error))
                        this.pushStreams.delete(requestId)
                    }
                    else {
                        if (chunk !== undefined)
                            readable.push(chunk)
                        if (final) {
                            readable.push(null)
                            this.pushStreams.delete(requestId)
                        }
                    }
                }
            }
        }
    }
}
