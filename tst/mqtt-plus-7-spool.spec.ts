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
import { describe, it }  from "mocha"
import * as chai         from "chai"

/*  internal dependencies  */
import { Spool }         from "../src/mqtt-plus-error"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
const { expect } = chai

/*  test suite  */
describe("MQTT+ Spool", function () {
    /*  test case: Spool: unroll runs multiple async cleanups in reverse order  */
    it("MQTT+ Spool: unroll chains multiple async cleanups in reverse order", async function () {
        const order: number[] = []
        const spool = new Spool()
        spool.roll(() => { order.push(1) })
        spool.roll(() => { order.push(2) })
        spool.roll(() => Promise.resolve().then(() => { order.push(3) }))
        await spool.unroll()
        expect(order).to.deep.equal([ 3, 2, 1 ])
    })

    /*  test case: Spool: unroll with suppress swallows rejected promise  */
    it("MQTT+ Spool: unroll with suppress swallows rejected promise", async function () {
        const spool = new Spool()
        spool.roll(() => Promise.reject(new Error("boom")))
        await spool.unroll()
    })

    /*  test case: Spool: unroll with suppress propagates rejected promise  */
    it("MQTT+ Spool: unroll propagates rejected promise", async function () {
        const spool = new Spool()
        spool.roll(() => Promise.reject(new Error("boom")))
        try {
            await spool.unroll(false)
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.equal("boom")
        }
    })

    /*  test case: Spool: unroll with suppress swallows synchronous throw  */
    it("MQTT+ Spool: unroll with suppress swallows synchronous throw", function () {
        const spool = new Spool()
        spool.roll(() => { throw new Error("sync boom") })
        spool.unroll()
    })

    /*  test case: Spool: unroll re-throws synchronous error  */
    it("MQTT+ Spool: unroll re-throws synchronous error", function () {
        const spool = new Spool()
        spool.roll(() => { throw new Error("sync boom") })
        try {
            spool.unroll(false)
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.equal("sync boom")
        }
    })

    /*  test case: Spool: async rejection does not skip remaining cleanups  */
    it("MQTT+ Spool: async rejection does not skip remaining cleanups", async function () {
        const order: number[] = []
        const spool = new Spool()
        spool.roll(() => { order.push(1) })
        spool.roll(() => Promise.reject(new Error("boom")))
        spool.roll(() => { order.push(3) })
        spool.roll(() => Promise.resolve().then(() => { order.push(4) }))
        await spool.unroll()
        expect(order).to.deep.equal([ 4, 3, 1 ])
    })

    /*  test case: Spool: async rejection re-throws all errors with suppress=false  */
    it("MQTT+ Spool: async rejection re-throws all errors with suppress=false", async function () {
        const order: number[] = []
        const spool = new Spool()
        spool.roll(() => { order.push(1) })
        spool.roll(() => Promise.reject(new Error("first")))
        spool.roll(() => Promise.reject(new Error("second")))
        spool.roll(() => Promise.resolve().then(() => { order.push(4) }))
        try {
            await spool.unroll(false)
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err).to.be.an.instanceOf(AggregateError)
            expect(err.errors).to.have.lengthOf(2)
            expect(err.errors[0].message).to.equal("second")
            expect(err.errors[1].message).to.equal("first")
        }
        expect(order).to.deep.equal([ 4, 1 ])
    })

    /*  test case: Spool: sync throw does not skip remaining cleanups  */
    it("MQTT+ Spool: sync throw does not skip remaining cleanups", function () {
        const order: number[] = []
        const spool = new Spool()
        spool.roll(() => { order.push(1) })
        spool.roll(() => { throw new Error("boom") })
        spool.roll(() => { order.push(3) })
        spool.unroll()
        expect(order).to.deep.equal([ 3, 1 ])
    })

    /*  test case: Spool: sync throw re-throws all errors with suppress=false  */
    it("MQTT+ Spool: sync throw re-throws all errors with suppress=false", function () {
        const order: number[] = []
        const spool = new Spool()
        spool.roll(() => { order.push(1) })
        spool.roll(() => { throw new Error("first") })
        spool.roll(() => { throw new Error("second") })
        spool.roll(() => { order.push(4) })
        try {
            spool.unroll(false)
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err).to.be.an.instanceOf(AggregateError)
            expect(err.errors).to.have.lengthOf(2)
            expect(err.errors[0].message).to.equal("second")
            expect(err.errors[1].message).to.equal("first")
        }
        expect(order).to.deep.equal([ 4, 1 ])
    })

    /*  test case: Spool: sub-spool is unrolled recursively  */
    it("MQTT+ Spool: sub-spool is unrolled recursively", async function () {
        const order: string[] = []
        const spool = new Spool()
        spool.roll(() => { order.push("outer-1") })
        const sub = spool.sub()
        sub.roll(() => { order.push("inner-1") })
        sub.roll(() => Promise.resolve().then(() => { order.push("inner-2") }))
        spool.roll(() => { order.push("outer-2") })
        await spool.unroll()
        expect(order).to.deep.equal([ "outer-2", "inner-2", "inner-1", "outer-1" ])
    })
})
