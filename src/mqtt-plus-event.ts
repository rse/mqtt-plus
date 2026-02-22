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
import type { IClientPublishOptions,
    IClientSubscribeOptions }         from "mqtt"
import { nanoid }                     from "nanoid"

/*  internal requirements  */
import type { EventEmission }         from "./mqtt-plus-msg"
import type { APISchema, EventKeys,
    Registration }                    from "./mqtt-plus-api"
import type { WithInfo, InfoEvent }   from "./mqtt-plus-info"
import { AuthTrait, type AuthOption } from "./mqtt-plus-auth"
import { run, Spool, ensureError }    from "./mqtt-plus-error"

/*  Event Emission Trait  */
export class EventTrait<T extends APISchema = APISchema> extends AuthTrait<T> {
    /*  register an event handler  */
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
            name     = nameOrConfig
            callback = args[0]
        }

        /*  create resource spool  */
        const spool = new Spool()

        /*  sanity check situation  */
        if (this.onRequest.has(`event-emission:${name}`))
            throw new Error(`event: event "${name}" already registered`)

        /*  generate the corresponding MQTT topics for broadcast and direct use  */
        const topicS = share ? `$share/${share}/${name}` : name
        const topicB = this.options.topicMake(topicS, "event-emission")
        const topicD = this.options.topicMake(name, "event-emission", this.options.id)

        /*  remember the registration  */
        this.onRequest.set(`event-emission:${name}`, (request: EventEmission, topicName: string) => {
            /*  determine event information  */
            const senderId = request.sender
            const params   = request.params ?? []

            /*  create information object  */
            const info: InfoEvent = { sender: senderId ?? "" }
            if (request.receiver)
                info.receiver = request.receiver
            if (request.meta)
                info.meta = request.meta

            /*  asynchronously execute handler  */
            Promise.resolve().then(async () => {
                if (topicName !== request.name)
                    throw new Error(`event name mismatch (topic: "${topicName}", payload: "${request.name}")`)
                if (auth)
                    info.authenticated = await this.authenticated(request.sender, request.auth, auth)
                if (info.authenticated !== undefined && !info.authenticated)
                    throw new Error(`authentication on event "${name}" failed`)
                return callback(...params, info)
            }).catch((result: unknown) => {
                const error = ensureError(result)
                this.error(error, `handler for event "${name}" failed`)
            })
        })
        spool.roll(() => { this.onRequest.delete(`event-emission:${name}`) })

        /*  subscribe to MQTT topics  */
        await run(`subscribe to MQTT topic "${topicB}"`, spool, () =>
            this.subscribeTopic(topicB, { qos: 2, ...options }))
        spool.roll(() => this.unsubscribeTopic(topicB).catch(() => {}))
        await run(`subscribe to MQTT topic "${topicD}"`, spool, () =>
            this.subscribeTopic(topicD, { qos: 2, ...options }))
        spool.roll(() => this.unsubscribeTopic(topicD).catch(() => {}))

        /*  provide a registration for subsequent destruction  */
        return this.makeRegistration(spool, "event", name, `event-emission:${name}`)
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
        let meta:      Record<string, any> | undefined
        let dry:       boolean | undefined
        if (typeof eventOrConfig === "object" && eventOrConfig !== null) {
            /*  object-based API  */
            event    = eventOrConfig.event
            params   = eventOrConfig.params
            receiver = eventOrConfig.receiver
            options  = eventOrConfig.options ?? {}
            meta     = eventOrConfig.meta
            dry      = eventOrConfig.dry
        }
        else {
            /*  positional API  */
            event    = eventOrConfig
            params   = args as Parameters<T[K]>
        }

        /*  generate unique request id  */
        const requestId = nanoid()

        /*  generate encoded message  */
        const auth      = this.authenticate()
        const metaStore = this.metaStore(meta)
        const request   = this.msg.makeEventEmission(requestId, event, params,
            this.options.id, receiver, auth, metaStore)
        const message   = this.codec.encode(request)

        /*  generate corresponding MQTT topic  */
        const topic = this.options.topicMake(event, "event-emission", receiver)

        /*  produce result  */
        if (dry)
            /*  return publish information  */
            return { topic, payload: message, options: { qos: 2, ...options } }
        else
            /*  publish message to MQTT topic  */
            this.publishToTopic(topic, message, { qos: 2, ...options }).catch((err: Error) => {
                this.error(err, `emitting event "${event}" failed`)
            })
    }
}
