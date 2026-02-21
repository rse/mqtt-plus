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

/*  external dependencies (test suite)  */
import { describe, it }   from "mocha"
import * as chai          from "chai"

/*  external dependencies (application)  */
import MQTT               from "mqtt"

/*  internal dependencies  */
import MQTTp              from "mqtt-plus"
import { ctx }            from "./mqtt-plus-0-fixture"
import type { API }       from "./mqtt-plus-0-fixture"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
const { expect } = chai

/*  test suite  */
describe("MQTT+ API", function () {
    /*  test case: TypeScript API  */
    it("MQTT+ TypeScript API", async function () {
        expect(MQTTp).to.be.a("function")
        expect(MQTTp.prototype).to.be.an("object")
        expect(MQTTp.prototype.constructor).to.equal(MQTTp)

        expect(ctx.apiC).to.respondTo("event")
        expect(ctx.apiC).to.respondTo("emit")

        expect(ctx.apiC).to.respondTo("service")
        expect(ctx.apiC).to.respondTo("call")

        expect(ctx.apiC).to.respondTo("source")
        expect(ctx.apiC).to.respondTo("fetch")

        expect(ctx.apiC).to.respondTo("sink")
        expect(ctx.apiC).to.respondTo("push")
    })

    /*  test case: Encoding Utilities  */
    it("MQTT+ Encoding Utilities", async function () {
        /*  str2buf / buf2str  */
        const str = "hello world \u00e4\u00f6\u00fc"
        const buf = ctx.apiC.str2buf(str)
        expect(buf).to.be.instanceOf(Uint8Array)
        expect(ctx.apiC.buf2str(buf)).to.be.equal(str)

        /*  arr2buf / buf2arr  */
        const u8 = new Uint8Array([ 4, 5, 6 ])
        expect(ctx.apiC.arr2buf(u8)).to.be.equal(u8)
        const u8src = new Uint8Array([ 7, 8, 9 ])
        const u8Result = ctx.apiC.buf2arr(u8src, Uint8Array)
        expect(u8Result).to.be.equal(u8src)
    })

    /*  test case: Log and Error Events  */
    it("MQTT+ Logging Events", async function () {
        this.timeout(1000)
        const logEntries: string[] = []
        const errors:     Error[]  = []

        /*  create a temporary instance  */
        const mqttTmp = MQTT.connect("mqtt://127.0.0.1:1883",
            { clientId: "log-test" })
        await new Promise<void>((resolve, reject) => {
            mqttTmp.once("connect", ()           => { resolve() })
            mqttTmp.once("error",   (err: Error) => { reject(err) })
        })
        const apiTmp = new MQTTp<API>(mqttTmp, { id: "log-test", timeout: 1000 })

        /*  register log listener  */
        const logCb = (entry: any) => { logEntries.push(entry.level) }
        apiTmp.on("log", logCb)

        /*  register error listener  */
        const errCb = (err: Error) => { errors.push(err) }
        apiTmp.on("error", errCb)

        /*  trigger some log activity by emitting an event  */
        apiTmp.emit("example/server/sample", "test", 1)
        await new Promise((resolve) => { setTimeout(resolve, 100) })

        /*  verify log entries were captured  */
        expect(logEntries.length).to.be.greaterThan(0)

        /*  remove listeners  */
        apiTmp.off("log",   logCb)
        apiTmp.off("error", errCb)

        /*  cleanup  */
        apiTmp.destroy()
        await mqttTmp.endAsync()
    })

    /*  test case: Meta Information  */
    it("MQTT+ Meta Information", async function () {
        /*  initially empty  */
        expect(ctx.apiC.meta("foo")).to.be.equal(undefined)

        /*  set and retrieve  */
        ctx.apiC.meta("foo", "bar")
        expect(ctx.apiC.meta("foo")).to.be.equal("bar")
        ctx.apiC.meta("baz", 42)
        expect(ctx.apiC.meta("baz")).to.be.equal(42)

        /*  overwrite  */
        ctx.apiC.meta("foo", "quux")
        expect(ctx.apiC.meta("foo")).to.be.equal("quux")

        /*  delete  */
        ctx.apiC.meta("foo", null)
        expect(ctx.apiC.meta("foo")).to.be.equal(undefined)
        expect(ctx.apiC.meta("baz")).to.be.equal(42)
    })
})

