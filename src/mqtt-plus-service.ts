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

/*  external requirements  */
import { IClientPublishOptions,
    IClientSubscribeOptions }         from "mqtt"
import { nanoid }                     from "nanoid"

/*  internal requirements  */
import { RefCountedSubscription }     from "./mqtt-plus-util"
import { run, Spool, ensureError }    from "./mqtt-plus-error"
import { ServiceCallRequest,
    ServiceCallResponse }             from "./mqtt-plus-msg"
import { APISchema, APIEndpointService,
    ServiceKeys, Registration }       from "./mqtt-plus-api"
import type { WithInfo, InfoService } from "./mqtt-plus-info"
import { EventTrait }                 from "./mqtt-plus-event"
import type { AuthOption }            from "./mqtt-plus-auth"

/*  Service Call Trait  */
export class ServiceTrait<T extends APISchema = APISchema> extends EventTrait<T> {
    /*  internal state  */
    private services = new Map<string, {
        callback: WithInfo<APIEndpointService, InfoService>,
        auth?:    AuthOption
    }>()
    private callCallbacks = new Map<string, {
        name:     string,
        callback: (err: any, result: any) => void
    }>()
    private callSubscriptions = new RefCountedSubscription(
        (topic, options) => this._subscribeTopic(topic, options),
        (topic)          => this._unsubscribeTopic(topic)
    )

    /*  register a service call handler  */
    async service<K extends ServiceKeys<T> & string> (
        name:     K,
        callback: WithInfo<T[K], InfoService>
    ): Promise<Registration>
    async service<K extends ServiceKeys<T> & string> (
        config: {
            name:      K,
            callback:  WithInfo<T[K], InfoService>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        }
    ): Promise<Registration>
    async service<K extends ServiceKeys<T> & string> (
        nameOrConfig: K | {
            name:      K,
            callback:  WithInfo<T[K], InfoService>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        },
        ...args:       any[]
    ): Promise<Registration> {
        /*  determine actual parameters  */
        let name:     K
        let callback: WithInfo<T[K], InfoService>
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
            name     = nameOrConfig as K
            callback = args[0]
        }

        /*  create a resource spool  */
        const spool = new Spool()

        /*  sanity check situation  */
        if (this.services.has(name))
            throw new Error(`register: service "${name}" already registered`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS = `$share/${share}/${name}`
        const topicB = this.options.topicMake(topicS, "service-call-request")
        const topicD = this.options.topicMake(name, "service-call-request", this.options.id)

        /*  remember the registration  */
        this.services.set(name, { callback, auth })
        spool.roll(() => { this.services.delete(name) })

        /*  subscribe to MQTT topics  */
        await run(`subscribe to MQTT topic "${topicB}"`, spool, () =>
            this._subscribeTopic(topicB, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicB).catch(() => {}))
        await run(`subscribe to MQTT topic "${topicD}"`, spool, () =>
            this._subscribeTopic(topicD, { qos: 2, ...options }))
        spool.roll(() => this._unsubscribeTopic(topicD).catch(() => {}))

        /*  provide a registration for subsequent destruction  */
        return {
            destroy: async (): Promise<void> => {
                if (!this.services.has(name))
                    throw new Error(`destroy: service "${name}" no longer registered`)
                await spool.unroll()?.catch((err: Error) => {
                    this.error(err, `destroy: failed to cleanup: ${err.message}`)
                })
            }
        }
    }

    /*  call service ("request and response")  */
    async call<K extends ServiceKeys<T> & string> (
        name:          K,
        ...params:     Parameters<T[K]>
    ): Promise<ReturnType<T[K]>>
    async call<K extends ServiceKeys<T> & string> (
        config: {
            name:      K,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>
        }
    ): Promise<ReturnType<T[K]>>
    async call<K extends ServiceKeys<T> & string> (
        nameOrConfig: K | {
            name:      K,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>
        },
        ...args:       any[]
    ): Promise<ReturnType<T[K]>> {
        /*  determine actual parameters  */
        let name:      K
        let params:    Parameters<T[K]>
        let receiver:  string | undefined
        let options:   IClientPublishOptions = {}
        let meta:      Record<string, any> = {}
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name     = nameOrConfig.name
            params   = nameOrConfig.params
            receiver = nameOrConfig.receiver
            options  = nameOrConfig.options ?? {}
            meta     = nameOrConfig.meta ?? {}
        }
        else {
            /*  positional API  */
            name     = nameOrConfig as K
            params   = args as Parameters<T[K]>
        }

        /*  create a resource spool  */
        const spool = new Spool()

        /*  generate unique request id  */
        const requestId = nanoid()

        /*  subscribe to MQTT response topic  */
        const responseTopic = this.options.topicMake(name, "service-call-response", this.options.id)
        await run(`subscribe to MQTT topic "${responseTopic}"`, spool, () =>
            this.callSubscriptions.subscribe(responseTopic, { qos: options.qos ?? 2 }))
        spool.roll(() => this.callSubscriptions.unsubscribe(responseTopic))

        /*  create promise for MQTT response handling  */
        const promise: Promise<ReturnType<T[K]>> = new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = setTimeout(async () => {
                timer = null
                await spool.unroll()
                reject(new Error("communication timeout"))
            }, this.options.timeout)
            spool.roll(() => {
                if (timer !== null) {
                    clearTimeout(timer)
                    timer = null
                }
            })
            this.callCallbacks.set(requestId, {
                name,
                callback: async (err: any, result: Awaited<ReturnType<T[K]>>) => {
                    await spool.unroll()
                    if (err)
                        reject(err)
                    else
                        resolve(result)
                }
            })
            spool.roll(() => { this.callCallbacks.delete(requestId) })
        })

        /*  generate encoded message  */
        const auth      = this.authenticate()
        const metaStore = this.metaStore(meta)
        const request   = this.msg.makeServiceCallRequest(requestId, name, params,
            this.options.id, receiver, auth, metaStore)
        const message   = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(name, "service-call-request", receiver)

        /*  publish message to MQTT topic  */
        await run(`publish service request as MQTT message to topic "${topic}"`, spool, () =>
            this._publishToTopic(topic, message, { qos: 2, ...options }))

        return promise
    }

    /*  dispatch message (Service pattern handling)  */
    protected async _dispatchMessage (topic: string, parsed: any) {
        await super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)

        /*  on server-side handle service call request  */
        if (topicMatch !== null
            && topicMatch.operation === "service-call-request"
            && parsed instanceof ServiceCallRequest) {
            /*  determine request information  */
            const requestId = parsed.id
            const senderId  = parsed.sender
            if (senderId === undefined || senderId === "")
                throw new Error("invalid request: missing sender")
            const name    = parsed.name
            const handler = this.services.get(name)
            const params  = parsed.params ?? []

            /*  create information object  */
            const info: InfoService = { sender: senderId }
            if (parsed.receiver)
                info.receiver = parsed.receiver
            if (parsed.meta)
                info.meta = parsed.meta
            if (handler?.auth)
                info.authenticated = await this.authenticated(senderId, parsed.auth, handler.auth)

            /*  asynchronously execute handler and send response  */
            Promise.resolve().then(() => {
                if (topicMatch.name !== name)
                    throw new Error(`service name mismatch (topic: "${topicMatch.name}", payload: "${name}")`)
                if (handler === undefined)
                    throw new Error(`handler for service "${name}" not found`)
                if (info.authenticated !== undefined && !info.authenticated)
                    throw new Error(`service "${name}" failed authentication`)
                return handler.callback(...params, info)
            }).then((result: any) => {
                /*  create success response message  */
                return this.msg.makeServiceCallResponse(requestId, result,
                    undefined, this.options.id, senderId)
            }, (result: unknown) => {
                /*  create error response message  */
                const error = ensureError(result)
                this.error(error, `handler for service "${name}" failed`)
                return this.msg.makeServiceCallResponse(requestId, undefined,
                    error.message, this.options.id, senderId)
            }).then((rpcResponse) => {
                /*  send response message  */
                const encoded = this.codec.encode(rpcResponse)
                const topic = this.options.topicMake(name, "service-call-response", senderId)
                return this._publishToTopic(topic, encoded, { qos: 2 })
            }).catch((err: Error) => {
                this.error(err, `handler for service "${name}" failed`)
            })
        }

        /*  on client-side handle service call response  */
        else if (topicMatch !== null
            && topicMatch.operation === "service-call-response"
            && topicMatch.peerId === this.options.id
            && parsed instanceof ServiceCallResponse) {
            /*  determine response information  */
            const requestId = parsed.id
            const request = this.callCallbacks.get(requestId)
            if (request !== undefined) {
                /*  call response callback function  */
                if (parsed.error !== undefined)
                    request.callback(new Error(parsed.error), undefined)
                else
                    request.callback(undefined, parsed.result)
            }
        }
    }
}
