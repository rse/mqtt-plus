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

/*  internal requirements  */
import type { APISchema }     from "./mqtt-plus-api"
import { SubscriptionTrait }  from "./mqtt-plus-subscription"
import { ensureError }        from "./mqtt-plus-error"

/*  Timer trait with reusable timer management  */
export class TimerTrait<T extends APISchema = APISchema> extends SubscriptionTrait<T> {
    /*  internal state  */
    private timers = new Map<string, ReturnType<typeof setTimeout>>()

    /*  destroy timer trait  */
    override async destroy () {
        for (const timer of this.timers.values())
            clearTimeout(timer)
        this.timers.clear()
        await super.destroy()
    }

    /*  refresh (or start) a named timer  */
    protected timerRefresh (id: string, onTimeout: () => void | Promise<void>): void {
        const timer = this.timers.get(id)
        if (timer !== undefined)
            clearTimeout(timer)
        this.timers.set(id, setTimeout(async () => {
            this.timers.delete(id)
            try {
                await onTimeout()
            }
            catch (err: unknown) {
                this.error(ensureError(err), `timer "${id}" failed`)
            }
        }, this.options.timeout))
    }

    /*  clear a named timer  */
    protected timerClear (id: string): void {
        const timer = this.timers.get(id)
        if (timer !== undefined) {
            clearTimeout(timer)
            this.timers.delete(id)
        }
    }
}
