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
import sinon              from "sinon"
import sinonChai          from "sinon-chai"

/*  internal dependencies  */
import { ctx }            from "./mqtt-plus-0-fixture"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
chai.use(sinonChai)
const { expect } = chai

/*  test suite  */
describe("MQTT+ Event Emission", function () {
    /*  test case: Event Emission  */
    it("MQTT+ Event Emission", async function () {
        /*  setup  */
        const spy = sinon.spy()

        /*  register to event  */
        const registration = await ctx.apiS.event("example/server/sample", (str: string, num: number, info) => {
            spy("event")
            expect(info).to.be.an("object")
            expect(info.sender).to.be.a("string")
        })

        /*  emit event  */
        ctx.apiC.emit("example/server/sample", "world", 42)
        await new Promise((resolve) => { setTimeout(resolve, 10) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "event" ])

        /*  destroy registration  */
        await registration.destroy()
    })

    /*  test case: Event Emission (Object API)  */
    it("MQTT+ Event Emission (Object API)", async function () {
        /*  setup  */
        const spy = sinon.spy()

        /*  register event  */
        const registration = await ctx.apiS.event({
            name: "example/server/sample",
            callback: (str: string, num: number, info) => {
                spy("event")
                expect(info).to.be.an("object")
                expect(info.sender).to.be.a("string")
            }
        })

        /*  emit event  */
        ctx.apiC.emit({
            name:   "example/server/sample",
            params: [ "world", 42 ]
        })
        await new Promise((resolve) => { setTimeout(resolve, 10) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "event" ])

        /*  destroy registration  */
        await registration.destroy()
    })

    /*  test case: Event Emission with Meta Information  */
    it("MQTT+ Event Emission (Meta Information)", async function () {
        /*  setup  */
        const spy = sinon.spy()

        /*  register event  */
        const registration = await ctx.apiS.event({
            name: "example/server/sample",
            callback: (str: string, num: number, info) => {
                spy("event")
                expect(info.meta).to.be.an("object")
                expect(info.meta!.tag).to.be.equal("test-meta")
            }
        })

        /*  emit event with metadata  */
        ctx.apiC.emit({
            name:   "example/server/sample",
            params: [ "world", 42 ],
            meta:   { tag: "test-meta" }
        })
        await new Promise((resolve) => { setTimeout(resolve, 10) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "event" ])

        /*  destroy registration  */
        await registration.destroy()
    })

    /*  test case: Event Emission (Duplicate Registration)  */
    it("MQTT+ Event Emission (Duplicate Registration)", async function () {
        /*  register event  */
        const reg = await ctx.apiS.event("example/server/sample", () => {})

        /*  attempt duplicate registration  */
        try {
            await ctx.apiS.event("example/server/sample", () => {})
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/already registered/)
        }

        /*  cleanup  */
        await reg.destroy()

        /*  verify re-registration after destroy works  */
        const reg2 = await ctx.apiS.event("example/server/sample", () => {})
        await reg2.destroy()
    })
})

