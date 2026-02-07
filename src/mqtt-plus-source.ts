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
    streamToBuffer, sendBufferAsChunks, sendStreamAsChunks }      from "./mqtt-plus-util"
import { SourceFetchRequest, SourceFetchResponse,
    SourceFetchChunk, SourceFetchCredit }                         from "./mqtt-plus-msg"
import { APISchema, SourceKeys, APIEndpointSource, Registration } from "./mqtt-plus-api"
import type { WithInfo, InfoSource }                              from "./mqtt-plus-info"
import { ServiceTrait }                                           from "./mqtt-plus-service"
import type { AuthOption }                                        from "./mqtt-plus-auth"

/*  Source Fetch Trait  */
export class SourceTrait<T extends APISchema = APISchema> extends ServiceTrait<T> {
    /*  source state  */
    private sources = new Map<string, {
        callback: WithInfo<APIEndpointSource, InfoSource>,
        auth?:    AuthOption
    }>()
    private fetchCallbacks = new Map<string, {
        name:      string,
        serverId?: string,
        callback:  (
            error: Error               | undefined,
            chunk: Uint8Array          | undefined,
            meta:  Record<string, any> | undefined,
            final: boolean             | undefined
        ) => void
    }>()
    private fetchCreditGates = new Map<string, CreditGate>()
    private fetchSubscriptions = new RefCountedSubscription(
        (topic, options) => this._subscribeTopic(topic, options),
        (topic)          => this._unsubscribeTopic(topic),
        (err)            => this.error(err)
    )

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
        const topicS       = `$share/${share}/${name}`
        const topicReqB    = this.options.topicMake(topicS, "source-fetch-request")
        const topicReqD    = this.options.topicMake(name, "source-fetch-request", this.options.id)
        const topicCreditD = this.options.topicMake(name, "source-fetch-credit",  this.options.id)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicReqB,    { qos: 2, ...options }),
            this._subscribeTopic(topicReqD,    { qos: 2, ...options }),
            this._subscribeTopic(topicCreditD, { qos: 2, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicReqB).catch(() => {})
            this._unsubscribeTopic(topicReqD).catch(() => {})
            this._unsubscribeTopic(topicCreditD).catch(() => {})
            throw err
        })

        /*  remember the registration  */
        this.sources.set(name, {
            callback: callback as WithInfo<APIEndpointSource, InfoSource>,
            auth
        })

        /*  provide a registration for subsequent destruction  */
        const registration: Registration = {
            destroy: async (): Promise<void> => {
                if (!this.sources.has(name))
                    throw new Error(`destroy: source "${name}" not established`)
                this.sources.delete(name)
                return Promise.all([
                    this._unsubscribeTopic(topicReqB),
                    this._unsubscribeTopic(topicReqD),
                    this._unsubscribeTopic(topicCreditD)
                ]).then(() => {}).catch((err: Error) => {
                    this.error(err, `destroy: failed to unsubscribe from topics for source "${name}"`)
                })
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
            name     = nameOrConfig as K
            params   = args as Parameters<T[K]>
        }

        /*  generate unique request id for the request  */
        const requestId = nanoid()

        /*  subscribe to response topic (for ack/nak) and chunk topic (for data)  */
        const responseTopic = this.options.topicMake(name, "source-fetch-response", this.options.id)
        const chunkTopic    = this.options.topicMake(name, "source-fetch-chunk",    this.options.id)
        await Promise.all([
            this.fetchSubscriptions.subscribe(responseTopic, { qos: 2 }),
            this.fetchSubscriptions.subscribe(chunkTopic,    { qos: 2 })
        ]).catch((err: Error) => {
            this.fetchSubscriptions.unsubscribe(responseTopic)
            this.fetchSubscriptions.unsubscribe(chunkTopic)
            throw err
        })

        /*  credit-based flow control state  */
        const chunkCredit  = this.options.chunkCredit
        let chunksReceived = 0
        let creditGranted  = chunkCredit
        const serverPeerId = receiver

        /*  establish readable for buffering received chunks  */
        const stream = new Readable({
            highWaterMark: chunkCredit > 0 ? chunkCredit * this.options.chunkSize : 16 * 1024,
            read: (_size) => {
                if (chunkCredit <= 0 || cleanedUp)
                    return
                const handler  = this.fetchCallbacks.get(requestId)
                const targetId = handler?.serverId ?? serverPeerId
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

        /*  define timer  */
        let timer: ReturnType<typeof setTimeout> | null = null

        /*  utility function for timeout refresh  */
        const refreshTimeout = () => {
            if (timer !== null)
                clearTimeout(timer)
            timer = setTimeout(() => {
                cleanup(true)
                stream.destroy(new Error("communication timeout"))
            }, this.options.timeout)
        }

        /*  utility function for cleanup  */
        let cleanedUp = false
        const cleanup = (resolveMeta = false) => {
            if (cleanedUp)
                return
            cleanedUp = true
            if (timer !== null) {
                clearTimeout(timer)
                timer = null
            }
            this.fetchSubscriptions.unsubscribe(responseTopic)
            this.fetchSubscriptions.unsubscribe(chunkTopic)
            this.fetchCallbacks.delete(requestId)
            if (resolveMeta)
                metaResolve?.(undefined)
        }

        /*  start timeout handler  */
        refreshTimeout()

        /*  ensure resources are released if consumer aborts stream early  */
        stream.once("close", () => {
            cleanup(true)
        })
        stream.once("error", () => {
            cleanup(true)
        })

        /*  register stream handler to collect chunks  */
        let firstChunk = true
        this.fetchCallbacks.set(requestId, {
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
                    refreshTimeout()
                    if (chunk !== undefined) {
                        chunksReceived++
                        stream.push(chunk)
                    }
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
        const credit = chunkCredit > 0 ? chunkCredit : undefined
        const request = this.msg.makeSourceFetchRequest(requestId,
            name, params, this.options.id, receiver, auth, metaStore, credit)
        const message = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(name, "source-fetch-request", receiver)

        /*  publish message to MQTT topic  */
        this._publishToTopic(topic, message, { qos: 2, ...options }).catch((err: unknown) => {
            const error = err instanceof Error ? err : new Error(String(err))
            cleanup(true)
            stream.destroy(error)
        })

        /*  produce result  */
        return { stream, buffer, meta: metaP }
    }

    /*  dispatch message (Source Fetch pattern handling)  */
    protected async _dispatchMessage (topic: string, parsed: any) {
        await super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)

        /*  handle source fetch request (on server-side for fetch)  */
        if (topicMatch !== null
            && topicMatch.operation === "source-fetch-request"
            && parsed instanceof SourceFetchRequest) {
            const name = parsed.name
            if (topicMatch.name !== name)
                throw new Error(`source name mismatch between topic "${topicMatch.name}" and payload "${name}"`)
            const handler = this.sources.get(name)
            if (handler === undefined)
                throw new Error(`handler for source "${name}" not found`)
            else {
                /*  determine information  */
                const requestId = parsed.id
                const params    = parsed.params ?? []
                const sender    = parsed.sender ?? ""
                const receiver  = parsed.receiver
                const info: InfoSource = { sender }
                if (receiver)
                    info.receiver = receiver
                if (parsed.meta)
                    info.meta = parsed.meta
                if (handler.auth)
                    info.authenticated = await this.authenticated(parsed.sender, parsed.auth, handler.auth)

                /*  generate corresponding MQTT topics  */
                const responseTopic = this.options.topicMake(name, "source-fetch-response", sender)
                const chunkTopic    = this.options.topicMake(name, "source-fetch-chunk", sender)

                /*  callback for sending the ack/nak response  */
                const sendResponse = async (error?: string) => {
                    const auth = this.authenticate()
                    const metaStore = this.metaStore(info.meta)
                    const response = this.msg.makeSourceFetchResponse(requestId,
                        name, error, this.options.id, sender, auth, metaStore)
                    const message = this.codec.encode(response)
                    await this._publishToTopic(responseTopic, message, { qos: 2 })
                }

                /*  callback for creating and sending a chunk message  */
                const sendChunk = async (chunk: Uint8Array | undefined, error: string | undefined, final: boolean): Promise<void> => {
                    const chunkMsg = this.msg.makeSourceFetchChunk(requestId,
                        name, chunk, error, final, this.options.id, sender)
                    const message = this.codec.encode(chunkMsg)
                    await this._publishToTopic(chunkTopic, message, { qos: 2 })
                }

                /*  handle credit-based flow control (if credit provided in request)  */
                const initialCredit = parsed.credit
                const creditGate = (initialCredit !== undefined && initialCredit > 0)
                    ? new CreditGate(initialCredit) : undefined
                if (creditGate)
                    this.fetchCreditGates.set(requestId, creditGate)

                /*  call the handler callback  */
                let ackSent = false
                await Promise.resolve().then(() => {
                    if (info.authenticated !== undefined && !info.authenticated)
                        throw new Error(`source "${name}" failed authentication`)
                    return handler.callback(...params, info)
                }).then(async () => {
                    /*  check for valid data source  */
                    if (!(info.stream instanceof Readable) && !(info.buffer instanceof Promise))
                        throw new Error("handler did not provide data via info.stream or info.buffer fields")

                    /*  send ack response  */
                    await sendResponse()
                    ackSent = true

                    /*  dispatch according to data type  */
                    if (info.stream instanceof Readable && info.buffer instanceof Promise)
                        throw new Error("handler has set both info.stream and info.buffer")
                    else if (info.stream instanceof Readable)
                        /*  handle Readable stream result  */
                        await sendStreamAsChunks(info.stream, this.options.chunkSize, sendChunk, creditGate)
                    else if (info.buffer instanceof Promise)
                        /*  handle Buffer result  */
                        await sendBufferAsChunks(await info.buffer, this.options.chunkSize, sendChunk, creditGate)
                }).catch((err: unknown) => {
                    /*  send error as nak response or as error chunk  */
                    const error = err instanceof Error ? err : new Error(String(err))
                    this.error(error)
                    if (ackSent)
                        return sendChunk(undefined, error.message, true)
                    else
                        return sendResponse(error.message)
                }).finally(() => {
                    /*  cleanup credit gate  */
                    if (creditGate) {
                        creditGate.abort()
                        this.fetchCreditGates.delete(requestId)
                    }
                })
            }
        }

        /*  handle source fetch response (ack/nak on client-side for fetch)  */
        else if (topicMatch !== null
            && topicMatch.operation === "source-fetch-response"
            && parsed instanceof SourceFetchResponse) {
            /*  determine information  */
            const requestId = parsed.id
            if (topicMatch.name !== parsed.name)
                throw new Error(`source name mismatch between topic "${topicMatch.name}" and payload "${parsed.name}"`)
            const error = parsed.error
            const meta  = parsed.meta

            /*  handle response on fetch (ack/nak)  */
            const handler = this.fetchCallbacks.get(requestId)
            if (handler !== undefined) {
                if (parsed.sender)
                    handler.serverId = parsed.sender
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
            if (topicMatch.name !== parsed.name)
                throw new Error(`source name mismatch between topic "${topicMatch.name}" and payload "${parsed.name}"`)
            const error = parsed.error
            const final = parsed.final
            const chunk = parsed.chunk

            /*  handle chunk on fetch  */
            const handler = this.fetchCallbacks.get(requestId)
            if (handler !== undefined)
                handler.callback(error ? new Error(error) : undefined, chunk, undefined, final)
        }

        /*  handle source fetch credit (on server-side for fetch, replenish producer credit)  */
        else if (topicMatch !== null
            && topicMatch.operation === "source-fetch-credit"
            && parsed instanceof SourceFetchCredit) {
            const requestId = parsed.id
            const gate = this.fetchCreditGates.get(requestId)
            if (gate !== undefined)
                gate.replenish(parsed.credit)
        }
    }
}
