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
import { CreditGate, ReadableTee,
    sendBufferAsChunks, sendStreamAsChunks,
    makeMutuallyExclusiveFields }                         from "./mqtt-plus-util"
import { run, Spool, ensureError }                        from "./mqtt-plus-error"
import type { SinkPushRequest, SinkPushResponse,
    SinkPushChunk, SinkPushCredit }                       from "./mqtt-plus-msg"
import type { APISchema, SinkKeys, Registration }         from "./mqtt-plus-api"
import type { WithInfo, InfoSink }                        from "./mqtt-plus-info"
import { SourceTrait }                                    from "./mqtt-plus-source"
import type { AuthOption }                                from "./mqtt-plus-auth"

/*  Sink Push Trait  */
export class SinkTrait<T extends APISchema = APISchema> extends SourceTrait<T> {
    /*  sink state (receiver side)  */
    private pushStreams          = new Map<string, Readable>()
    private pushSpools           = new Map<string, Spool>()
    private pushRecvControllers  = new Map<string, AbortController>()

    /*  sink state (lifecycle)  */
    private destroying = false

    /*  sink state (sender side)  */
    private pushControllers  = new Map<string, AbortController>()
    private pushCreditGates  = new Map<string, CreditGate>()
    private pushSenderSpools = new Map<string, Spool>()

    /*  destroy trait  */
    override async destroy () {
        this.destroying = true

        /*  eagerly clear all push timers before any await points  */
        for (const id of this.pushSenderSpools.keys())
            this.timerClear(`sink-push-send:${id}`)
        for (const id of this.pushSpools.keys())
            this.timerClear(`sink-push-recv:${id}`)

        /*  cleanup sender-side state  */
        for (const controller of this.pushControllers.values())
            controller.abort(new Error("sink destroyed"))
        for (const gate of this.pushCreditGates.values())
            gate.abort()
        for (const spool of [ ...this.pushSenderSpools.values() ])
            await spool.unroll()
        this.pushSenderSpools.clear()
        this.pushControllers.clear()
        this.pushCreditGates.clear()

        /*  cleanup receiver-side state  */
        for (const controller of this.pushRecvControllers.values())
            controller.abort(new Error("sink destroyed"))
        this.pushRecvControllers.clear()
        for (const stream of this.pushStreams.values())
            stream.destroy(new Error("sink destroyed"))
        this.pushStreams.clear()
        for (const spool of [ ...this.pushSpools.values() ])
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
        /*  sanity check lifecycle  */
        if (this.destroyed)
            throw new Error("sink: instance already destroyed")

        /*  determine actual parameters  */
        let name:      K
        let callback:  WithInfo<T[K], InfoSink>
        let options:   Partial<IClientSubscribeOptions> = {}
        let share      = this.options.share
        let auth:      AuthOption | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null && "name" in nameOrConfig) {
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

        /*  sanity check callback  */
        if (typeof callback !== "function")
            throw new Error("sink: callback argument is required and must be a function")

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
            /*  check receiver  */
            if (request.receiver && request.receiver !== this.options.id)
                return

            /*  determine information  */
            const requestId = request.id
            const params    = request.params ?? []
            const sender    = request.sender
            const receiver  = request.receiver

            /*  create a resource spool for request cleanup  */
            const reqSpool = new Spool()

            /*  sanity check sender  */
            if (sender === undefined || sender === "") {
                this.error(new Error("invalid request: missing sender"))
                await reqSpool.unroll()
                return
            }

            /*  generate corresponding MQTT topic for response  */
            const responseTopic = this.options.topicMake(name, "sink-push-response", sender)
            const sinkNameMismatchError = (actualName: string) =>
                new Error(`sink name mismatch (expected "${name}", got "${actualName}")`)

            /*  callback for sending the ack/nak response  */
            const chunkCredit = this.options.chunkCredit
            const sendResponse = async (error?: string, withCredit: boolean = false) => {
                const credit = (error === undefined && withCredit && chunkCredit > 0) ? chunkCredit : undefined
                const response = this.msg.makeSinkPushResponse(requestId,
                    name, error, this.options.id, sender, credit)
                const message = this.codec.encode(response)
                await this.publishToTopic(responseTopic, message,
                    { qos: request.qos ?? options.qos ?? 2 })
            }

            /*  create abort controller  */
            const abortController = new AbortController()
            const abortSignal     = abortController.signal
            let abortReject!: (reason?: any) => void
            const abortPromise = new Promise<never>((_resolve, reject) => {
                abortReject = reject
            })
            abortPromise.catch(() => {})
            const onRecvAbort = () => { abortReject(ensureError(abortSignal.reason)) }
            if (abortSignal.aborted)
                onRecvAbort()
            else
                abortSignal.addEventListener("abort", onRecvAbort, { once: true })
            reqSpool.roll(() => { abortSignal.removeEventListener("abort", onRecvAbort) })
            if (this.pushRecvControllers.has(requestId)) {
                const error = new Error(`sink: duplicate request id "${requestId}"`)
                this.error(error)
                await sendResponse(error.message).catch(() => {})
                await reqSpool.unroll()
                return
            }
            this.pushRecvControllers.set(requestId, abortController)
            reqSpool.roll(() => { this.pushRecvControllers.delete(requestId) })
            this.pushSpools.set(requestId, reqSpool)
            reqSpool.roll(() => { this.pushSpools.delete(requestId) })

            /*  check authentication and prepare stream  */
            let dataCompleted     = false
            let ackSent           = false
            let errorResponseSent = false
            let readableRef: ReadableTee | undefined = undefined
            const noopError = () => {} /*  prevent unhandled error exception  */
            try {
                if (topicName !== request.name)
                    throw new Error(`sink name mismatch (topic: "${topicName}", payload: "${request.name}")`)
                let authenticated: boolean | undefined = undefined
                if (auth !== undefined)
                    authenticated = await this.authenticated(sender, request.auth, auth, `sink "${name}"`)

                /*  initialize credit-based flow control state  */
                const creditState = chunkCredit > 0 ? {
                    chunksReceived: 0,
                    creditGranted:  chunkCredit
                } : undefined
                const maxBufferedBytes = chunkCredit > 0 ? chunkCredit * this.options.chunkSize : 16 * 1024

                /*  track stream-ended state  */
                let streamEnded = false

                /*  utility functions for timeout management  */
                const pushTimerId = `sink-push-recv:${requestId}`
                const refreshPushTimeout = () => this.timerRefresh(pushTimerId, () => {
                    if (streamEnded || this.destroying)
                        return
                    const error = new Error("push stream timeout")
                    abortController.abort(error)

                    /*  destroy the push stream so that streamDone settles even when
                        the callback already completed before the timeout fired  */
                    streamEnded = true
                    const stream = this.pushStreams.get(requestId)
                    if (stream !== undefined && !stream.destroyed)
                        stream.destroy(error)

                    /*  eagerly notify sender so it stops publishing chunks
                        (suppress the spool-rollback cancel via errorResponseSent)  */
                    if (sender && !errorResponseSent) {
                        errorResponseSent = true
                        const cancelMsg = this.msg.makeSinkPushCredit(requestId,
                            name, 0, this.options.id, sender)
                        const encoded = this.codec.encode(cancelMsg)
                        this.publishToTopic(responseTopic, encoded,
                            { qos: request.qos ?? options.qos ?? 2 }).catch(() => {})
                    }
                })
                const clearPushTimeout   = () => this.timerClear(pushTimerId)

                /*  create a readable for buffering received chunks  */
                const readable = new ReadableTee({
                    highWaterMark: maxBufferedBytes,
                    read: (_size) => {
                        if (!creditState || !this.pushSpools.has(requestId))
                            return
                        const outstanding   = creditState.creditGranted - creditState.chunksReceived
                        const freeBytes     = Math.max(0, maxBufferedBytes - readable.readableLength)
                        const freeChunks    = Math.floor(freeBytes / this.options.chunkSize)
                        const creditToGrant = Math.max(0, freeChunks - outstanding)
                        if (creditToGrant > 0) {
                            creditState.creditGranted += creditToGrant
                            /*  Note: Readable._read() is synchronous by Node's contract;
                                the publish is intentionally fire-and-forget. Flow-control
                                correctness is preserved because creditGranted is incremented
                                synchronously before the publish, so any re-entrant _read()
                                computes outstanding against the already-granted value.
                                Publish failures destroy the readable via the .catch below.  */
                            const creditMsg = this.msg.makeSinkPushCredit(requestId,
                                name, creditToGrant, this.options.id, sender)
                            const encoded = this.codec.encode(creditMsg)
                            this.publishToTopic(responseTopic, encoded,
                                { qos: request.qos ?? options.qos ?? 2 })
                                .catch((err) => {
                                    const error = ensureError(err, "sending sink push credit failed")
                                    this.error(error)
                                    readable.destroy(error)
                                })
                            refreshPushTimeout()
                        }
                    }
                })
                readableRef = readable
                this.pushStreams.set(requestId, readable)
                reqSpool.roll(() => { this.pushStreams.delete(requestId) })
                readable.on("error", noopError)
                reqSpool.roll(() => {
                    if (!dataCompleted && !abortSignal.aborted && !this.destroying)
                        abortController.abort(new Error("push stream closed"))

                    /*  send cancel signal (credit=0) to push sender
                        (suppress when an explicit error response was already published,
                        to avoid emitting two terminal signals for the same outcome)  */
                    if (!dataCompleted && !this.destroying && !errorResponseSent && sender) {
                        const cancelMsg = this.msg.makeSinkPushCredit(requestId,
                            name, 0, this.options.id, sender)
                        const encoded = this.codec.encode(cancelMsg)
                        this.publishToTopic(responseTopic, encoded,
                            { qos: request.qos ?? options.qos ?? 2 })
                            .catch((err) => this.error(ensureError(err, "sending sink push cancel failed")))
                    }
                })

                /*  register chunk dispatch callback  */
                this.onResponse.set(`sink-push-chunk:${requestId}`, async (chunkParsed: SinkPushChunk) => {
                    if (streamEnded)
                        return
                    if (chunkParsed.name !== name) {
                        streamEnded = true
                        clearPushTimeout()
                        readable.destroy(sinkNameMismatchError(chunkParsed.name))
                        return
                    }
                    if (chunkParsed.sender === undefined || chunkParsed.sender === "") {
                        streamEnded = true
                        clearPushTimeout()
                        readable.destroy(new Error(`sink chunk for "${name}" missing sender`))
                        return
                    }
                    if (chunkParsed.sender !== sender)
                        return
                    if (chunkParsed.error !== undefined) {
                        streamEnded = true
                        clearPushTimeout()
                        readable.destroy(new Error(chunkParsed.error))
                    }
                    else {
                        refreshPushTimeout()
                        if (chunkParsed.chunk !== undefined) {
                            if (creditState) {
                                if (creditState.chunksReceived >= creditState.creditGranted) {
                                    streamEnded = true
                                    clearPushTimeout()
                                    readable.destroy(new Error("flow control violation"))
                                    return
                                }
                                creditState.chunksReceived++
                            }

                            /*  push chunk into readable (intentionally ignoring the backpressure
                                return value: credit-based flow control already bounds the buffer,
                                and when credits are disabled there is no way to pause the MQTT sender)  */
                            if (!readable.destroyed)
                                readable.push(chunkParsed.chunk)
                        }
                        if (chunkParsed.final) {
                            streamEnded = true
                            clearPushTimeout()
                            if (!readable.destroyed)
                                readable.push(null)
                        }
                    }
                })
                reqSpool.roll(() => { this.onResponse.delete(`sink-push-chunk:${requestId}`) })

                /*  start timeout for push stream cleanup  */
                refreshPushTimeout()
                reqSpool.roll(() => { clearPushTimeout() })

                /*  prepare info object  */
                const promise = readable.buffer
                let settled = false
                let resolve!: () => void
                let reject!:  (err: Error) => void
                const onEnd   = () => {
                    if (!settled) {
                        settled = true
                        resolve()
                    }
                }
                const onClose = () => {
                    if (!settled) {
                        settled = true
                        if (streamEnded || readable.readableEnded)
                            resolve()
                        else
                            reject(new Error("push stream closed before end"))
                    }
                }
                const onError = (err: Error) => {
                    if (!settled) {
                        settled = true
                        reject(err)
                    }
                }
                const streamDone = new Promise<void>((res, rej) => {
                    resolve = res
                    reject  = rej
                    readable.once("end",   onEnd)
                    readable.once("close", onClose)
                    readable.once("error", onError)
                })
                streamDone.finally(() => {
                    readable.removeListener("end",   onEnd)
                    readable.removeListener("close", onClose)
                    readable.removeListener("error", onError)
                }).catch(() => {}) /*  avoid unhandled promise rejection  */
                const info: InfoSink = {
                    sender,
                    signal: abortSignal,
                    stream: readable,
                    buffer: promise
                }
                if (receiver)
                    info.receiver = receiver
                if (authenticated !== undefined)
                    info.authenticated = authenticated
                if (request.meta)
                    info.meta = request.meta
                makeMutuallyExclusiveFields(info, "stream", "buffer", (field) => {
                    if (field === "stream")
                        readable.stopCollecting()
                    else if (field === "buffer")
                        readable.resume() /*  drain readable side  */
                })

                /*  send ack response  */
                await sendResponse(undefined, true)
                ackSent = true

                /*  call handler  */
                const callbackPromise = Promise.resolve(callback(...params, info))
                callbackPromise.catch(() => {}) /*  guard against unhandled rejection if abort wins the race  */
                await Promise.race([ callbackPromise, abortPromise ])

                /*  ensure stream is consumed or destroyed to prevent hang  */
                if (readable.readableFlowing !== true && !readable.destroyed)
                    readable.resume()

                /*  await full stream consumption before confirming success  */
                await streamDone.catch((err: unknown) => {
                    this.error(ensureError(err), `stream drain after sink "${name}" callback failed`)
                    throw err
                })

                /*  ensure collecting is stopped if callback ignored stream/buffer  */
                if (readable.collecting)
                    readable.stopCollecting()

                /*  send terminal success response  */
                if (!abortSignal.aborted) {
                    try {
                        dataCompleted = true
                        await sendResponse()
                    }
                    catch (err2: unknown) {
                        this.error(ensureError(err2), `sending terminal response for sink "${name}" failed`)
                    }
                }
            }
            catch (err: unknown) {
                const error = ensureError(err, `handler for sink "${name}" failed`)
                abortController.abort(error)

                /*  eagerly destroy the push stream if ack was already sent,
                    so the receiver is in a clean state before the error
                    response reaches the sender (reduces cross-talk window)  */
                if (ackSent && !this.destroying) {
                    const stream = this.pushStreams.get(requestId)
                    if (stream !== undefined && !stream.destroyed)
                        stream.destroy(error)
                }

                /*  send error as nak response or as mid-stream error response
                    (skip when a terminal signal was already emitted, e.g. the
                    pre-emptive credit=0 cancel published by the timeout handler)  */
                this.error(error)
                if (!errorResponseSent) {
                    errorResponseSent = true
                    await sendResponse(error.message).catch(() => {})
                }
            }
            finally {
                /*  cleanup resources  */
                const stream = this.pushStreams.get(requestId)
                if (stream !== undefined && !stream.destroyed && !dataCompleted && !errorResponseSent)
                    stream.destroy(abortSignal.aborted
                        ? ensureError(abortSignal.reason)
                        : new Error("sink push aborted without cause"))
                await reqSpool.unroll()
                if (readableRef !== undefined)
                    readableRef.removeListener("error", noopError)
            }
        })
        spool.roll(() => { this.onRequest.delete(`sink-push-request:${name}`) })

        /*  subscribe to MQTT topics  */
        await this.subscribeTopicAndSpool(spool, topicReqB, options)
        await this.subscribeTopicAndSpool(spool, topicReqD, options)

        /*  provide a registration for subsequent destruction  */
        return this.makeRegistration(spool, "sink", name)
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
        /*  sanity check lifecycle  */
        if (this.destroyed)
            throw new Error("push: instance already destroyed")

        /*  determine actual parameters  */
        let name:      K
        let data:      Readable | Uint8Array
        let params:    Parameters<T[K]>
        let receiver:  string | undefined
        let options:   IClientPublishOptions = {}
        let meta:      Record<string, any> | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null && "name" in nameOrConfig) {
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
        for (let i = 0; i < 10 && (this.onResponse.has(`sink-push-response:${requestId}`)
            || this.onResponse.has(`sink-push-credit:${requestId}`)); i++)
            requestId = nanoid()
        if (this.onResponse.has(`sink-push-response:${requestId}`)
            || this.onResponse.has(`sink-push-credit:${requestId}`))
            throw new Error("failed to generate unique request id")

        /*  register spool at instance level  */
        this.pushSenderSpools.set(requestId, spool)
        spool.roll(() => { this.pushSenderSpools.delete(requestId) })

        /*  subscribe to response topic (for ack/nak)  */
        const responseTopic = this.options.topicMake(name, "sink-push-response", this.options.id)
        await this.subscribeTopicAndSpool(spool, responseTopic, { qos: options.qos ?? 2 })

        /*  define abort controller and signal  */
        const abortController = new AbortController()
        const abortSignal     = abortController.signal

        /*  register abort controller at instance level  */
        this.pushControllers.set(requestId, abortController)
        spool.roll(() => { this.pushControllers.delete(requestId) })

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
        const refreshTimeout = () => {
            if (abortSignal.aborted)
                return
            this.timerRefresh(pushTimerId, () => {
                const error = new Error(`push to sink "${name}" timed out`)
                abortController.abort(error)
            })
        }
        spool.roll(() => { this.timerClear(pushTimerId) })

        /*  start timeout handler  */
        refreshTimeout()

        /*  send request and wait for response before sending chunks  */
        let initialCredit:        number | undefined
        let creditGate:           CreditGate | undefined
        let pendingCredit         = 0
        let remoteErrorObject:    Error | undefined
        let cancelledByReceiver   = false
        let pushAcked             = false
        let pushInitialSettled    = false
        let pushFinalized         = false
        let pushDataFinalSent     = false
        let pushDataComplete      = false
        let pushTerminalReceived  = false
        let responderId           = receiver
        let pushFinalizeResolve!: () => void
        let pushFinalizeReject!:  (reason?: any) => void
        const pushFinalize        = new Promise<void>((resolve, reject) => {
            pushFinalizeResolve   = resolve
            pushFinalizeReject    = reject
        })
        pushFinalize.catch(() => {})  /*  avoid unhandled promise rejection  */

        /*  lock the responder for this communication  */
        const lockResponder = (kind: string, sender?: string): boolean => {
            if (sender === undefined || sender === "") {
                const error = new Error(`received ${kind} without sender`)
                remoteErrorObject = error
                abortController.abort(error)
                if (!pushAcked) {
                    pushInitialSettled = true
                    pushInitialReject(error)
                }
                else if (!pushFinalized) {
                    pushFinalized = true
                    pushFinalizeReject(error)
                }
                return false
            }
            if (responderId === undefined)
                responderId = sender
            else if (sender !== responderId)
                return false
            return true
        }

        /*  register unified response handler (ack/nak + terminal)  */
        let pushInitialResolve!: () => void
        let pushInitialReject!:  (reason?: any) => void
        const pushInitial        = new Promise<void>((resolve, reject) => {
            pushInitialResolve   = resolve
            pushInitialReject    = reject
        })
        pushInitial.catch(() => {})  /*  avoid unhandled promise rejection  */
        this.onResponse.set(`sink-push-response:${requestId}`, (response: SinkPushResponse) => {
            if (response.name !== name) {
                const error = new Error(`sink response name mismatch (expected "${name}", got "${response.name}")`)
                remoteErrorObject = error
                abortController.abort(error)
                if (!pushAcked) {
                    pushInitialSettled = true
                    pushInitialReject(error)
                }
                else if (!pushFinalized) {
                    pushFinalized = true
                    pushFinalizeReject(error)
                }
                return
            }
            if (!lockResponder("sink response", response.sender))
                return
            if (response.error) {
                const error = new Error(response.error)
                remoteErrorObject = error
                abortController.abort(error)
                if (!pushAcked) {
                    pushInitialSettled = true
                    pushInitialReject(error)
                }
                else if (!pushFinalized) {
                    pushFinalized = true
                    pushFinalizeReject(error)
                }
            }
            else if (!pushAcked) {
                initialCredit = response.credit
                pushAcked = true
                pushInitialSettled = true
                pushInitialResolve()
            }
            else if (!pushFinalized) {
                if (pushDataComplete) {
                    pushFinalized = true
                    pushFinalizeResolve()
                }
                else
                    pushTerminalReceived = true
            }
        })
        spool.roll(() => { this.onResponse.delete(`sink-push-response:${requestId}`) })

        /*  register credit callback eagerly (before awaiting ack) so that
            credit-replenishment or early cancel messages arriving on the
            response topic right after ack are not silently dropped  */
        this.onResponse.set(`sink-push-credit:${requestId}`, (response: SinkPushCredit) => {
            if (response.name !== name) {
                const error = new Error(`sink credit name mismatch (expected "${name}", got "${response.name}")`)
                remoteErrorObject = error
                abortController.abort(error)
                if (!pushAcked) {
                    pushInitialSettled = true
                    pushInitialReject(error)
                }
                else if (!pushFinalized) {
                    pushFinalized = true
                    pushFinalizeReject(error)
                }
                return
            }
            if (!lockResponder("sink credit", response.sender))
                return
            if (response.credit === 0) {
                /*  cancel signal from receiver  */
                cancelledByReceiver = true
                const error = new Error(`push to sink "${name}" cancelled by receiver`)
                abortController.abort(error)
                if (!pushAcked) {
                    pushInitialSettled = true
                    pushInitialReject(error)
                }
                else if (!pushFinalized) {
                    pushFinalized = true
                    pushFinalizeReject(error)
                }
                return
            }
            if (creditGate !== undefined) {
                creditGate.replenish(response.credit)
                refreshTimeout()
            }
            else if (pushAcked && initialCredit === undefined) {
                /*  protocol violation: receiver sent credit despite
                    not granting initial credit during ack  */
                const error = new Error(`push to sink "${name}" received unsolicited credit (credit-flow disabled)`)
                remoteErrorObject = error
                abortController.abort(error)
                if (!pushFinalized) {
                    pushFinalized = true
                    pushFinalizeReject(error)
                }
            }
            else
                pendingCredit += response.credit
        })
        spool.roll(() => { this.onResponse.delete(`sink-push-credit:${requestId}`) })

        try {
            /*  handle abort signal  */
            const onAbort = () => {
                const error = ensureError(abortSignal.reason)
                if (!pushInitialSettled) {
                    pushInitialSettled = true
                    pushInitialReject(error)
                }
                if (!pushFinalized) {
                    pushFinalized = true
                    pushFinalizeReject(error)
                }
            }
            abortSignal.addEventListener("abort", onAbort, { once: true })
            spool.roll(() => { abortSignal.removeEventListener("abort", onAbort) })

            /*  generate and send request message  */
            const auth      = this.authenticate()
            const metaStore = this.metaStore(meta)
            const request   = this.msg.makeSinkPushRequest(requestId,
                name, params, this.options.id, receiver, auth, metaStore,
                options.qos)
            const message   = this.codec.encode(request)
            const requestTopic = this.options.topicMake(name, "sink-push-request", receiver)
            await run(`publish push request as MQTT message to topic "${requestTopic}"`, () =>
                this.publishToTopic(requestTopic, message, { qos: 2, ...options }))
            await pushInitial

            /*  create credit gate for flow control (if server granted credit),
                folding in any credits that arrived before the gate existed  */
            if (initialCredit !== undefined && initialCredit > 0) {
                creditGate = new CreditGate(initialCredit + pendingCredit)
                if (pendingCredit > 0)
                    refreshTimeout()
                pendingCredit = 0
            }
            else if (pendingCredit > 0)
                /*  protocol violation: receiver sent credit before ack despite not granting initial credit  */
                throw new Error(`push to sink "${name}" received unsolicited credit (credit-flow disabled)`)

            /*  register credit gate at instance level  */
            if (creditGate) {
                this.pushCreditGates.set(requestId, creditGate)
                spool.roll(() => { this.pushCreditGates.delete(requestId) })
            }

            /*  arrange credit-gate abort on cleanup  */
            if (creditGate) {
                const gate = creditGate
                spool.roll(() => { gate.abort() })
            }

            /*  generate corresponding MQTT topic for chunks (use request topic)  */
            const chunkTarget = responderId
            if (chunkTarget === undefined)
                throw new Error(`push to sink "${name}" missing responder`)
            const chunkTopic = this.options.topicMake(name, "sink-push-request", chunkTarget)

            /*  callback for creating and sending a chunk message  */
            const sendChunk = async (
                chunk: Uint8Array | undefined,
                error: string | undefined,
                final: boolean
            ): Promise<void> => {
                refreshTimeout()
                const chunkMsg = this.msg.makeSinkPushChunk(requestId,
                    name, chunk, error, final, this.options.id, chunkTarget)
                const message = this.codec.encode(chunkMsg)
                await this.publishToTopic(chunkTopic, message, { qos: 2, ...options })
                if (error === undefined && final)
                    pushDataFinalSent = true
            }

            /*  iterate over all chunks of the buffer  */
            if (data instanceof Readable)
                /*  attach to the readable  */
                await sendStreamAsChunks(data, this.options.chunkSize, sendChunk, creditGate, abortSignal)
            else if (data instanceof Uint8Array)
                /*  split buffer into chunks and send them  */
                await sendBufferAsChunks(data, this.options.chunkSize, sendChunk, creditGate, abortSignal)

            /*  mark data phase complete and resolve buffered terminal  */
            pushDataComplete = true
            if (pushTerminalReceived && !pushFinalized) {
                pushFinalized = true
                pushFinalizeResolve()
            }

            /*  wait for terminal sink response  */
            refreshTimeout()
            if (!pushFinalized)
                await pushFinalize
        }
        catch (err: unknown) {
            const error = ensureError(err)
            abortController.abort(error)

            /*  send error chunk only if push was acked and error did not originate from receiver
                (before ack, the sink has no chunk handler yet and will time out on its own;
                after final data chunk, no additional terminal chunk should be sent)  */
            if (pushAcked && !remoteErrorObject && !cancelledByReceiver && !pushDataFinalSent) {
                try {
                    const chunkTarget = responderId
                    if (chunkTarget !== undefined) {
                        const chunkTopic = this.options.topicMake(name, "sink-push-request", chunkTarget)
                        const chunkMsg = this.msg.makeSinkPushChunk(requestId,
                            name, undefined, error.message, true, this.options.id, chunkTarget)
                        const message = this.codec.encode(chunkMsg)
                        await this.publishToTopic(chunkTopic, message, { qos: 2, ...options }).catch(() => {})
                    }
                }
                catch {
                    /*  best-effort error notification — do not mask original error  */
                }
            }
            /*  yield one event-loop tick to allow a pending MQTT error
                response from the receiver to be processed, making the
                error outcome deterministic (only when race is possible)  */
            if (pushAcked && !remoteErrorObject)
                await new Promise<void>((resolve) => { setImmediate(resolve) })

            if (remoteErrorObject)
                throw remoteErrorObject
            throw err
        }
        finally {
            await spool.unroll()
        }
    }
}
