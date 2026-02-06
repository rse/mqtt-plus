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
import { EventEmitter }  from "node:events"

/*  internal requirements  */
import { APISchema }     from "./mqtt-plus-api"
import { MsgTrait }      from "./mqtt-plus-msg"
import { JSONX }         from "./mqtt-plus-codec"

/*  type of log events  */
class LogEvent {
    constructor (
        public timestamp: number,
        public level:     string,
        public msg:       string | Promise<string>,
        public data?:     Record<string, any> | Record<string, Promise<any>>
    ) {}
    async resolve () {
        if (this.msg instanceof Promise)
            this.msg = await this.msg.catch(() => "<resolve-failed>")
        if (this.data)
            for (const field of Object.keys(this.data))
                if (this.data[field] instanceof Promise)
                    this.data[field] = await this.data[field].catch(() => "<resolve-failed>")
    }
    toString () {
        /*  render time  */
        const timestamp = new Date(this.timestamp)
        const year    = timestamp.getFullYear()
        const month   = (timestamp.getMonth() + 1).toString().padStart(2, "0")
        const day     = timestamp.getDate().toString().padStart(2, "0")
        const hours   = timestamp.getHours().toString().padStart(2, "0")
        const minutes = timestamp.getMinutes().toString().padStart(2, "0")
        const seconds = timestamp.getSeconds().toString().padStart(2, "0")
        const ms      = timestamp.getMilliseconds().toString().padStart(3, "0")
        const time = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`

        /*  render message  */
        const msg = (this.msg instanceof Promise ? "<unresolved>" : this.msg)

        /*  render optional data  */
        let extra = ""
        if (this.data !== undefined) {
            const kv = Object.keys(this.data).map((key) => {
                const value = this.data![key] instanceof Promise ? "<unresolved>" : this.data![key]
                return `${key}: ${JSONX.stringify(value)}`
            }).join(", ")
            extra = ` (${kv})`
        }

        /*  render log entry  */
        return `[${time}] ${this.level}: ${msg}${extra}`
    }
}

/*  Trace trait with event emitter and logging functionality  */
export class TraceTrait<T extends APISchema = APISchema> extends MsgTrait<T> {
    /*  internal state  */
    private _events: EventEmitter = new EventEmitter()

    /*  inline base event EventEmitter functionality
        (NOTICE: we cannot inherit from EventEmitter as its
        "emit" method is in conflict with our one)  */
    on (event: "error", callback: (error: Error)  => void): void
    on (event: "log",   callback: (log: LogEvent) => void): void
    on (...args: Parameters<typeof this._events.on>): ReturnType<typeof this._events.on> {
        return this._events.on(...args)
    }
    off (event: "error", callback: (error: Error)  => void): void
    off (event: "log",   callback: (log: LogEvent) => void): void
    off (...args: Parameters<typeof this._events.off>): ReturnType<typeof this._events.off> {
        return this._events.off(...args)
    }
    protected emitEvent (event: "error", error: Error):  void
    protected emitEvent (event: "log",   log: LogEvent): void
    protected emitEvent (...args: Parameters<typeof this._events.emit>): ReturnType<typeof this._events.emit> {
        try {
            return this._events.emit(...args)
        }
        catch (_err) {
            /*  ignore error (caused by emitting "error" without listeners)  */
            return false
        }
    }

    /*  log an event  */
    log (level: string, msg: string | Promise<string>, data?: Record<string, Promise<any> | any>): void {
        const event = new LogEvent(Date.now(), level, msg, data)
        this.emitEvent("log", event)
    }

    /*  raise an error event  */
    error (error: Error, msg?: string) {
        let err = error
        if (msg !== undefined)
            err = new Error(`${msg}: ${error.message}`, { cause: error })
        this.emitEvent("error", err)
        this.log("error", err.message)
    }
}

