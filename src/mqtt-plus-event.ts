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
import { EventEmission }              from "./mqtt-plus-msg"
import { APISchema, APIEndpointEvent,
    EventKeys, Registration }         from "./mqtt-plus-api"
import type { WithInfo, InfoEvent }   from "./mqtt-plus-info"
import { AuthTrait, type AuthOption } from "./mqtt-plus-auth"

/*  Event Communication Trait  */
export class EventTrait<T extends APISchema = APISchema> extends AuthTrait<T> {
    /*  internal state  */
    private events = new Map<string, {
        callback: WithInfo<APIEndpointEvent, InfoEvent>,
        auth?:    AuthOption
    }>()

    /*  register to an RPC event  */
    async event<K extends EventKeys<T> & string> (
        name:     K,
        callback: WithInfo<T[K], InfoEvent>
    ): Promise<Registration>
    async event<K extends EventKeys<T> & string> (
        config: {
            name:      K,
            callback:  WithInfo<T[K], InfoEvent>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        }
    ): Promise<Registration>
    async event<K extends EventKeys<T> & string> (
        nameOrConfig: K | {
            name:      K,
            callback:  WithInfo<T[K], InfoEvent>,
            options?:  Partial<IClientSubscribeOptions>,
            share?:    string,
            auth?:     AuthOption
        },
        ...args:       any[]
    ): Promise<Registration> {
        /*  determine actual parameters  */
        let name:     K
        let callback: WithInfo<T[K], InfoEvent>
        let options:  Partial<IClientSubscribeOptions> = {}
        let share:    string | undefined
        let auth:     AuthOption | undefined
        if (typeof nameOrConfig === "object" && nameOrConfig !== null) {
            /*  object-based API  */
            name     = nameOrConfig.name
            callback = nameOrConfig.callback
            options  = nameOrConfig.options ?? {}
            share    = nameOrConfig.share
            auth     = nameOrConfig.auth
        }
        else {
            /*  positional API  */
            name     = nameOrConfig as K
            callback = args[0] as WithInfo<T[K], InfoEvent>
        }

        /*  sanity check situation  */
        if (this.events.has(name))
            throw new Error(`event: event "${name}" already registered`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topic = share ? `$share/${share}/${name}` : name
        const topicB = this.options.topicMake(topic, "event-emission")
        const topicD = this.options.topicMake(topic, "event-emission", this.options.id)

        /*  subscribe to MQTT topics  */
        await Promise.all([
            this._subscribeTopic(topicB, { qos: 0, ...options }),
            this._subscribeTopic(topicD, { qos: 0, ...options })
        ]).catch((err: Error) => {
            this._unsubscribeTopic(topicB).catch(() => {})
            this._unsubscribeTopic(topicD).catch(() => {})
            throw err
        })

        /*  remember the registration  */
        this.events.set(name, {
            callback: callback as WithInfo<APIEndpointEvent, InfoEvent>,
            auth
        })

        /*  provide a registration for subsequent destruction  */
        const self = this
        const registration: Registration = {
            async destroy (): Promise<void> {
                if (!self.events.has(name))
                    throw new Error(`destroy: event "${name}" not registered`)
                self.events.delete(name)
                return Promise.all([
                    self._unsubscribeTopic(topicB),
                    self._unsubscribeTopic(topicD)
                ]).then(() => {})
            }
        }
        return registration
    }

    /*  emit event ("fire and forget")  */
    emit<K extends EventKeys<T> & string> (
        event:         K,
        ...params:     Parameters<T[K]>
    ): void
    emit<K extends EventKeys<T> & string> (
        config: {
            event:     K,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>
        }
    ): void
    emit<K extends EventKeys<T> & string> (
        config: {
            event:     K,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>,
            dry:       true
        }
    ): { topic: string, payload: string | Uint8Array, options: IClientPublishOptions }
    emit<K extends EventKeys<T> & string> (
        eventOrConfig: K | {
            event:     K,
            params:    Parameters<T[K]>,
            receiver?: string,
            options?:  IClientPublishOptions,
            meta?:     Record<string, any>,
            dry?:      true
        },
        ...args:       any[]
    ): void | { topic: string, payload: string | Uint8Array, options: IClientPublishOptions } {
        /*  determine actual parameters  */
        let event:     K
        let params:    Parameters<T[K]>
        let receiver:  string | undefined
        let options:   IClientPublishOptions = {}
        let meta:      Record<string, any> = {}
        let dry:       boolean | undefined
        if (typeof eventOrConfig === "object" && eventOrConfig !== null) {
            /*  object-based API  */
            event    = eventOrConfig.event
            params   = eventOrConfig.params
            receiver = eventOrConfig.receiver
            options  = eventOrConfig.options ?? {}
            meta     = eventOrConfig.meta ?? {}
            dry      = eventOrConfig.dry
        }
        else {
            /*  positional API  */
            event    = eventOrConfig as K
            params   = args as Parameters<T[K]>
        }

        /*  generate unique request id  */
        const rid = nanoid()

        /*  generate encoded message  */
        const auth      = this.authenticate()
        const metaStore = this.metaStore(meta)
        const request   = this.msg.makeEventEmission(rid, event, params, this.options.id, receiver, auth, metaStore)
        const message   = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(event, "event-emission", receiver)

        /*  produce result  */
        if (dry)
            /*  return publish information  */
            return { topic, payload: message, options: { qos: 0, ...options } }
        else
            /*  publish message to MQTT topic  */
            this._publishToTopic(topic, message, { qos: 0, ...options }).catch(() => {})
    }

    /*  dispatch message (Event pattern handling)  */
    protected async _dispatchMessage (topic: string, parsed: any) {
        super._dispatchMessage(topic, parsed)
        const topicMatch = this.options.topicMatch(topic)
        if (topicMatch !== null
            && topicMatch.operation === "event-emission"
            && parsed instanceof EventEmission) {
            /*  just deliver event  */
            const name = parsed.name
            const handler = this.events.get(name)
            const params = parsed.params ?? []
            const info: InfoEvent = { sender: parsed.sender ?? "" }
            if (parsed.receiver)
                info.receiver = parsed.receiver
            if (parsed.meta)
                info.meta = parsed.meta
            if (handler?.auth)
                info.authenticated = await this.authenticated(parsed.sender, parsed.auth, handler.auth)
            if (info.authenticated !== undefined && !info.authenticated)
                this.error(new Error(`authentication on event "${name}" failed`))
            else
                Promise.resolve()
                    .then(() => handler?.callback?.(...params, info))
                    .catch((err: Error) => {
                        this.error(err)
                    })
        }
    }
}
