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

/*  reference-counted subscription helper  */
class RefCountedSubscription {
    private counts  = new Map<string, number>()
    private pending = new Map<string, Promise<void>>()
    private lingers = new Map<string, ReturnType<typeof setTimeout>>()
    constructor (
        private subscribeFn:   (topic: string, options: IClientSubscribeOptions) => Promise<void>,
        private unsubscribeFn: (topic: string) => Promise<void>,
        private lingerMs:      number = 30 * 1000
    ) {}
    async subscribe (topic: string, options: IClientSubscribeOptions = { qos: 2 }): Promise<void> {
        /*  increment count first to reserve our interest  */
        const count = this.counts.get(topic) ?? 0
        this.counts.set(topic, count + 1)

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
            const promise = this.subscribeFn(topic, options).finally(() => {
                this.pending.delete(topic)
            }).catch((err: Error) => {
                const count = this.counts.get(topic)
                if (count) {
                    if (count <= 1)
                        this.counts.delete(topic)
                    else
                        this.counts.set(topic, count - 1)
                }
                throw err
            })
            this.pending.set(topic, promise)
            return promise
        }
        else {
            /*  perhaps still need to wait for a pending subscription  */
            const pending = this.pending.get(topic)
            if (pending)
                return pending
        }
    }
    async unsubscribe (topic: string): Promise<void> {
        const count = this.counts.get(topic)
        if (count) {
            if (count <= 1) {
                this.counts.delete(topic)
                if (this.lingerMs > 0) {
                    /*  defer the actual broker unsubscription  */
                    const timer = setTimeout(() => {
                        this.lingers.delete(topic)
                        this.unsubscribeFn(topic).catch(() => {})
                    }, this.lingerMs)
                    this.lingers.set(topic, timer)
                }
                else
                    await this.unsubscribeFn(topic).catch(() => {})
            }
            else
                this.counts.set(topic, count - 1)
        }
    }
    async flush (): Promise<void> {
        /*  flush all pending linger timers and unsubscribe immediately  */
        const topics = [ ...this.lingers.keys() ]
        for (const topic of topics) {
            clearTimeout(this.lingers.get(topic))
            this.lingers.delete(topic)
            await this.unsubscribeFn(topic).catch(() => {})
        }
    }
}

/*  Subscription trait with shared MQTT subscription management  */
export class SubscriptionTrait<T extends APISchema = APISchema> extends BaseTrait<T> {
    protected subscriptions = new RefCountedSubscription(
        (topic, options) => this._subscribeTopic(topic, options),
        (topic)          => this._unsubscribeTopic(topic)
    )

    /*  destroy topic trait  */
    override destroy () {
        this.subscriptions.flush()
        super.destroy()
    }
}
