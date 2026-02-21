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
    private sourceCreditGates  = new Map<string, CreditGate>()
    private sourceTimers       = new Map<string, ReturnType<typeof setTimeout>>()
    private fetchSubscriptions = new RefCountedSubscription(
        (topic, options) => this._subscribeTopic(topic, options),
        (topic)          => this._unsubscribeTopic(topic)
    )

    /*  refresh source timer for a specific request  */
    private _refreshSourceTimer (requestId: string) {
        const timer = this.sourceTimers.get(requestId)
        if (timer !== undefined)
            clearTimeout(timer)
        this.sourceTimers.set(requestId, setTimeout(() => {
            this.sourceTimers.delete(requestId)
            const gate = this.sourceCreditGates.get(requestId)
            if (gate !== undefined)
                gate.abort()
        }, this.options.timeout))
    }

    /*  clear source timer for a specific request  */
    private _clearSourceTimer (requestId: string) {
        const timer = this.sourceTimers.get(requestId)
        if (timer !== undefined) {
            clearTimeout(timer)
            this.sourceTimers.delete(requestId)
        }
    }

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
        if (this.sources.has(name))
            throw new Error(`source: source "${name}" already established`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS       = `$share/${share}/${name}`
        const topicReqB    = this.options.topicMake(topicS, "source-fetch-request")
        const topicReqD    = this.options.topicMake(name,   "source-fetch-request", this.options.id)
        const topicCreditD = this.options.topicMake(name,   "source-fetch-credit",  this.options.id)

        /*  remember the registration  */
        this.sources.set(name, { callback, auth })
        spool.roll(() => { this.sources.delete(name) })

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
                if (!this.sources.has(name))
                    throw new Error(`destroy: source "${name}" not established`)
                await spool.unroll()?.catch((err: Error) => {
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
            this.fetchSubscriptions.subscribe(responseTopic, { qos: options.qos ?? 2 }))
        spool.roll(() => this.fetchSubscriptions.unsubscribe(responseTopic))
        await run(`subscribe to MQTT topic "${chunkTopic}"`, spool, () =>
            this.fetchSubscriptions.subscribe(chunkTopic, { qos: options.qos ?? 2 }))
        spool.roll(() => this.fetchSubscriptions.unsubscribe(chunkTopic))

        /*  credit-based flow control state  */
        const chunkCredit  = this.options.chunkCredit
        let chunksReceived = 0
        let creditGranted  = chunkCredit
        const serverPeerId = receiver

        /*  establish a readable for buffering received chunks  */
        const stream = new Readable({
            highWaterMark: chunkCredit > 0 ? chunkCredit * this.options.chunkSize : 16 * 1024,
            read: (_size) => {
                if (chunkCredit <= 0 || !this.fetchCallbacks.has(requestId))
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
        stream.once("close", () => { spool.unroll() })
        stream.once("error", () => { spool.unroll() })

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
                if (firstChunk) {
                    firstChunk = false
                    metaResolve?.(meta)
                }
                if (error !== undefined) {
                    stream.destroy(error)
                    spool.unroll()
                }
                else {
                    refreshTimeout()
                    if (chunk !== undefined) {
                        chunksReceived++
                        stream.push(chunk)
                    }
                    if (final) {
                        stream.push(null)
                        spool.unroll()
                    }
                }
            }
        })
        spool.roll(() => { this.fetchCallbacks.delete(requestId) })

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
            const error = err instanceof Error ? err : new Error(String(err))
            stream.destroy(error)
            spool.unroll()
        })

        /*  produce result  */
        const result = { stream, buffer, meta: metaP }
        makeMutuallyExclusiveFields(result, "stream", "buffer")
        return result
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
                const sender    = parsed.sender
                if (sender === undefined || sender === "")
                    throw new Error("invalid request: missing sender")
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
                    refreshSourceTimeout()
                    const chunkMsg = this.msg.makeSourceFetchChunk(requestId,
                        name, chunk, error, final, this.options.id, sender)
                    const message = this.codec.encode(chunkMsg)
                    await this._publishToTopic(chunkTopic, message, { qos: 2 })
                }

                /*  utility functions for timeout management  */
                const refreshSourceTimeout = () => this._refreshSourceTimer(requestId)
                const clearSourceTimeout   = () => this._clearSourceTimer(requestId)
                refreshSourceTimeout()

                /*  handle credit-based flow control (if credit provided in request)  */
                const initialCredit = parsed.credit
                const creditGate = (initialCredit !== undefined && initialCredit > 0)
                    ? new CreditGate(initialCredit) : undefined
                if (creditGate)
                    this.sourceCreditGates.set(requestId, creditGate)

                /*  call the handler callback  */
                let ackSent = false
                Promise.resolve().then(() => {
                    if (info.authenticated !== undefined && !info.authenticated)
                        throw new Error(`source "${name}" failed authentication`)
                    return handler.callback(...params, info)
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
                    const error = err instanceof Error ? err : new Error(String(err))
                    this.error(error)
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
            if (handler !== undefined) {
                if (parsed.sender)
                    handler.serverId = parsed.sender
                handler.callback(error ? new Error(error) : undefined, chunk, undefined, final)
            }
        }

        /*  handle source fetch credit (on server-side for fetch, replenish producer credit)  */
        else if (topicMatch !== null
            && topicMatch.operation === "source-fetch-credit"
            && parsed instanceof SourceFetchCredit) {
            const requestId = parsed.id
            const gate = this.sourceCreditGates.get(requestId)
            if (gate !== undefined) {
                gate.replenish(parsed.credit)

                /*  refresh timeout  */
                this._refreshSourceTimer(requestId)
            }
        }
    }
}
