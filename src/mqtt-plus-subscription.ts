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
import type { IClientSubscribeOptions } from "mqtt"

/*  internal requirements  */
import type { APISchema }               from "./mqtt-plus-api"
import { BaseTrait }                    from "./mqtt-plus-base"
import { run, Spool }                   from "./mqtt-plus-error"

/*  reference-counted subscription helper  */
class RefCountedSubscription {
    /*  internal state  */
    private counts    = new Map<string, number>()
    private pending   = new Map<string, Promise<void>>()
    private lingers   = new Map<string, ReturnType<typeof setTimeout>>()
    private unsubbing = new Map<string, Promise<void>>()

    /*  initial construction with configuration  */
    constructor (
        private subscribeFn:   (topic: string, options: IClientSubscribeOptions) => Promise<void>,
        private unsubscribeFn: (topic: string) => Promise<void>,
        private lingerMs:      number = 30 * 1000
    ) {}

    /*  increment reference count for a topic  */
    private incrementCount (topic: string) {
        const count = this.counts.get(topic) ?? 0
        this.counts.set(topic, count + 1)
        return count
    }

    /*  decrement reference count for a topic  */
    private decrementCount (topic: string): number | undefined {
        const count = this.counts.get(topic)
        if (count !== undefined) {
            if (count <= 1) {
                this.counts.delete(topic)
                return 0
            }
            else {
                this.counts.set(topic, count - 1)
                return count - 1
            }
        }
        return undefined
    }

    /*  subscribe to a topic (reference-counted)  */
    async subscribe (topic: string, options: IClientSubscribeOptions = { qos: 2 }): Promise<void> {
        /*  increment count first to reserve our interest  */
        const count = this.incrementCount(topic)

        /*  optionally just cancel a pending linger unsubscription
            (subscription is still kept active on the broker)  */
        const linger = this.lingers.get(topic)
        if (linger) {
            clearTimeout(linger)
            this.lingers.delete(topic)
            return
        }

        /*  if we are the first, we must perform the actual subscription  */
        if (count === 0) {
            /*  create a deferred promise and store it in pending immediately,
                so concurrent subscribers arriving during the await below
                will find and await it instead of returning prematurely  */
            let resolve: () => void
            let reject:  (err: Error) => void
            const deferred = new Promise<void>((res, rej) => {
                resolve = res
                reject  = rej
            })
            deferred.catch(() => {}) /*  avoid unhandled promise rejection  */
            this.pending.set(topic, deferred)

            /*  await any in-flight linger unsubscription to avoid a race
                where the broker processes UNSUBSCRIBE after our SUBSCRIBE  */
            const inflight = this.unsubbing.get(topic)
            if (inflight)
                await inflight

            /*  perform the actual subscription  */
            const promise = this.subscribeFn(topic, options).then(() => {
                this.pending.delete(topic)
                resolve()
            }).catch((err: Error) => {
                this.pending.delete(topic)
                this.decrementCount(topic)
                reject(err)
                throw err
            })
            return promise
        }
        else {
            /*  perhaps still need to wait for a pending subscription  */
            const pending = this.pending.get(topic)
            if (pending)
                return pending.catch((err: Error) => {
                    this.decrementCount(topic)
                    throw err
                })
        }
    }

    /*  unsubscribe from a topic (reference-counted)  */
    async unsubscribe (topic: string): Promise<void> {
        const count = this.decrementCount(topic)
        if (count === 0) {
            if (this.lingerMs > 0) {
                /*  defer the actual broker unsubscription  */
                const timer = setTimeout(() => {
                    this.lingers.delete(topic)
                    const promise = this.unsubscribeFn(topic).catch(() => {}).finally(() => {
                        this.unsubbing.delete(topic)
                    })
                    this.unsubbing.set(topic, promise)
                }, this.lingerMs)
                this.lingers.set(topic, timer)
            }
            else {
                /*  perform the unsubscription immediately, but still store the
                    promise in unsubbing so a concurrent subscribe can await it  */
                const promise = this.unsubscribeFn(topic).catch(() => {}).finally(() => {
                    this.unsubbing.delete(topic)
                })
                this.unsubbing.set(topic, promise)
                await promise
            }
        }
    }

    /*  flush all pending linger timers and unsubscribe  */
    async flush (): Promise<void> {
        /*  determine all topics with potentially active subscriptions  */
        const topics = new Set<string>([
            ...this.counts.keys(),
            ...this.lingers.keys(),
            ...this.pending.keys(),
            ...this.unsubbing.keys()
        ])

        /*  cancel all pending linger timers first (synchronously)  */
        for (const timer of this.lingers.values())
            clearTimeout(timer)
        this.lingers.clear()
        this.counts.clear()

        /*  wait for any in-flight subscribe/unsubscribe operations to settle first  */
        await Promise.allSettled([ ...this.pending.values(), ...this.unsubbing.values() ])

        /*  then unsubscribe from all potentially active topics  */
        await Promise.allSettled([ ...topics ].map((topic) =>
            this.unsubscribeFn(topic).catch(() => {})))

        /*  clear remaining internal state  */
        this.pending.clear()
        this.unsubbing.clear()
    }
}

/*  Subscription trait with shared MQTT subscription management  */
export class SubscriptionTrait<T extends APISchema = APISchema> extends BaseTrait<T> {
    protected subscriptions = new RefCountedSubscription(
        (topic, options) => this.subscribeTopic(topic, options),
        (topic)          => this.unsubscribeTopic(topic)
    )

    /*  subscribe to an MQTT topic (reference-counted) and spool the unsubscription  */
    protected async subscribeTopicAndSpool (
        spool:   Spool,
        topic:   string,
        options: Partial<IClientSubscribeOptions> = {}
    ) {
        await run(`subscribe to MQTT topic "${topic}"`, spool, () =>
            this.subscriptions.subscribe(topic, { qos: 2, ...options }))
        spool.roll(() => this.subscriptions.unsubscribe(topic))
    }

    /*  destroy subscription trait  */
    override async destroy () {
        await this.subscriptions.flush()
        await super.destroy()
    }
}
