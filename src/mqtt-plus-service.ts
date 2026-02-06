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
import { ServiceCallRequest,
    ServiceCallResponse }             from "./mqtt-plus-msg"
import { APISchema, APIEndpointService,
    ServiceKeys, Registration }       from "./mqtt-plus-api"
import type { WithInfo, InfoService } from "./mqtt-plus-info"
import { EventTrait }                 from "./mqtt-plus-event"
import type { AuthOption }            from "./mqtt-plus-auth"

/*  Service Communication Trait  */
export class ServiceTrait<T extends APISchema = APISchema> extends EventTrait<T> {
    /*  internal state  */
    private services = new Map<string, {
        callback: WithInfo<APIEndpointService, InfoService>
        auth?:    AuthOption
    }>()
    private callCallback      = new Map<string, { name: string, callback: (err: any, result: any) => void }>()
    private callSubscriptions = new Map<string, number>()

    /*  register an RPC service  */
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
            share    = nameOrConfig.share ?? "default"
            auth     = nameOrConfig.auth
        }
        else {
            /*  positional API  */
            name     = nameOrConfig as K
            callback = args[0] as WithInfo<T[K], InfoService>
        }

        /*  sanity check situation  */
        if (this.services.has(name))
            throw new Error(`register: service "${name}" already registered`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topic  = `$share/${share}/${name}`
        const topicB = this.options.topicMake(topic, "service-call-request")
        const topicD = this.options.topicMake(topic, "service-call-request", this.options.id)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicB, { qos: 2, ...options }),
            this._subscribeTopic(topicD, { qos: 2, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicB).catch(() => {})
            this._unsubscribeTopic(topicD).catch(() => {})
            throw err
        })

        /*  remember the registration  */
        this.services.set(name, {
            callback: callback as WithInfo<APIEndpointService, InfoService>,
            auth
        })

        /*  provide a registration for subsequent destruction  */
        const registration: Registration = {
            destroy: async (): Promise<void> => {
                if (!this.services.has(name))
                    throw new Error(`destroy: service "${name}" not registered`)
                this.services.delete(name)
                return Promise.all([
                    this._unsubscribeTopic(topicB),
                    this._unsubscribeTopic(topicD)
                ]).then(() => {}).catch((err: Error) => {
                    this.error(err, `destroy: failed to unsubscribe from topics for service "${name}"`)
                })
            }
        }
        return registration
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

        /*  generate unique request id  */
        const rid = nanoid()

        /*  subscribe to MQTT response topic  */
        await this.callSubscribe(name, { qos: options.qos ?? 2 })

        /*  create promise for MQTT response handling  */
        const promise: Promise<ReturnType<T[K]>> = new Promise((resolve, reject) => {
            let timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
                this.callCallback.delete(rid)
                this.callUnsubscribe(name)
                timer = null
                reject(new Error("communication timeout"))
            }, this.options.timeout)
            this.callCallback.set(rid, {
                name,
                callback: (err: any, result: Awaited<ReturnType<T[K]>>) => {
                    if (timer !== null) {
                        clearTimeout(timer)
                        timer = null
                    }
                    if (err) reject(err)
                    else     resolve(result)
                }
            })
        })

        /*  generate encoded message  */
        const auth      = this.authenticate()
        const metaStore = this.metaStore(meta)
        const request   = this.msg.makeServiceCallRequest(rid, name, params, this.options.id, receiver, auth, metaStore)
        const message   = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(name, "service-call-request", receiver)

        /*  publish message to MQTT topic  */
        this._publishToTopic(topic, message, { qos: 2, ...options }).catch((err: Error) => {
            /*  handle request failure (only if not already handled)  */
            const pendingRequest = this.callCallback.get(rid)
            if (pendingRequest !== undefined) {
                this.callCallback.delete(rid)
                this.callUnsubscribe(name)
                pendingRequest.callback(err, undefined)
            }
        })

        return promise
    }

    /*  subscribe to RPC response  */
    private async callSubscribe (service: string, options: IClientSubscribeOptions = { qos: 2 }): Promise<void> {
        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(service, "service-call-response", this.options.id)

        /*  subscribe to MQTT topic and remember subscription  */
        const count = this.callSubscriptions.get(topic) ?? 0
        this.callSubscriptions.set(topic, count + 1)
        if (count === 0) {
            await this._subscribeTopic(topic, options).catch((err: Error) => {
                const currentCount = this.callSubscriptions.get(topic) ?? 0
                if (currentCount > 1)
                    this.callSubscriptions.set(topic, currentCount - 1)
                else
                    this.callSubscriptions.delete(topic)
                this.error(err)
                throw err
            })
        }
    }

    /*  unsubscribe from RPC response  */
    private callUnsubscribe (service: string): void {
        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(service, "service-call-response", this.options.id)

        /*  short-circuit processing if (no longer) subscribed  */
        if (!this.callSubscriptions.has(topic))
            return

        /*  unsubscribe from MQTT topic and forget subscription  */
        const count = this.callSubscriptions.get(topic) ?? 0
        if (count > 1)
            this.callSubscriptions.set(topic, count - 1)
        else {
            this.callSubscriptions.delete(topic)
            this._unsubscribeTopic(topic).catch((err: Error) => {
                this.error(err)
            })
        }
    }

    /*  dispatch message (Service pattern handling)  */
    protected async _dispatchMessage (topic: string, parsed: any) {
        await super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)
        if (topicMatch !== null
            && topicMatch.operation === "service-call-request"
            && parsed instanceof ServiceCallRequest) {
            /*  deliver service request and send response  */
            const rid     = parsed.id
            const name    = parsed.name
            const handler = this.services.get(name)
            const params  = parsed.params ?? []
            const info: InfoService = { sender: parsed.sender ?? "" }
            if (parsed.receiver)
                info.receiver = parsed.receiver
            if (parsed.meta)
                info.meta = parsed.meta
            if (handler?.auth)
                info.authenticated = await this.authenticated(parsed.sender, parsed.auth, handler.auth)
            Promise.resolve().then(() => {
                if (handler === undefined)
                    throw new Error(`handler for service "${name}" not found`)
                if (info.authenticated !== undefined && !info.authenticated)
                    throw new Error(`service "${name}" failed authentication`)
                return handler.callback(...params, info)
            }).then((result: any) => {
                /*  create success response  */
                return this.msg.makeServiceCallResponse(rid, result,
                    undefined, this.options.id, parsed.sender)
            }, (result: any) => {
                /*  create error response  */
                let errorMessage: string
                if (result === undefined || result === null)
                    errorMessage = "undefined error"
                else if (typeof result === "string")
                    errorMessage = result
                else if (result instanceof Error)
                    errorMessage = result.message
                else
                    errorMessage = String(result)
                this.error(new Error(errorMessage), `handler for service "${name}" failed`)
                return this.msg.makeServiceCallResponse(rid, undefined,
                    errorMessage, this.options.id, parsed.sender)
            }).then((rpcResponse) => {
                /*  send response message  */
                const senderPeerId = parsed.sender
                if (senderPeerId === undefined)
                    throw new Error("invalid request: missing sender")
                const encoded = this.codec.encode(rpcResponse)
                const topic = this.options.topicMake(name, "service-call-response", senderPeerId)
                return this._publishToTopic(topic, encoded, { qos: 2 })
            }).catch((err: Error) => {
                this.error(err)
            })
        }
        else if (topicMatch !== null
            && topicMatch.operation === "service-call-response"
            && topicMatch.peerId === this.options.id
            && parsed instanceof ServiceCallResponse) {
            /*  handle service response  */
            const rid = parsed.id
            const request = this.callCallback.get(rid)
            if (request !== undefined) {
                /*  call callback function  */
                if (parsed.error !== undefined)
                    request.callback(new Error(parsed.error), undefined)
                else
                    request.callback(undefined, parsed.result)

                /*  unsubscribe from response  */
                this.callCallback.delete(rid)
                this.callUnsubscribe(request.name)
            }
        }
    }
}
