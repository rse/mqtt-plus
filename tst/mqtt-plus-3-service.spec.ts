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
describe("MQTT+ Service Call", function () {
    /*  test case: Service Call  */
    it("MQTT+ Service Call", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide service  */
        const registration = await ctx.apiS.service("example/server/hello", (str: string, num: number) => {
            spy("service")
            if (str !== "world")
                throw new Error("invalid service call")
            expect(str).to.be.equal("world")
            expect(num).to.be.equal(42)
            return `${str}:${num}`
        })

        /*  call service (successfully)  */
        await ctx.apiC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call-success")
            expect(result).to.be.equal("world:42")
        }).catch((err: Error) => {
            spy("call-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-success" ])
        spy.resetHistory()

        /*  call service (with error)  */
        await ctx.apiC.call("example/server/hello", "bad-arg", 42).then(async (result) => {
            spy("call-success")
        }).catch((err: Error) => {
            expect(err.message).to.be.equal("invalid service call")
            spy("call-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-error" ])

        /*  destroy service  */
        await registration.destroy()
    })

    /*  test case: Service Call (Object API)  */
    it("MQTT+ Service Call (Object API)", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide service  */
        const registration = await ctx.apiS.service({
            name: "example/server/hello",
            callback: (str: string, num: number) => {
                spy("service")
                return `${str}:${num}`
            }
        })

        /*  call service  */
        const result = await ctx.apiC.call({
            name:   "example/server/hello",
            params: [ "world", 42 ]
        })
        spy("call-success")
        expect(result).to.be.equal("world:42")
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-success" ])

        /*  destroy service  */
        await registration.destroy()
    })

    /*  test case: Service Call (Meta Information)  */
    it("MQTT+ Service Call (Meta Information)", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide service that checks metadata  */
        const registration = await ctx.apiS.service({
            name: "example/server/hello",
            callback: (str: string, num: number, info) => {
                spy("service")
                expect(info.meta).to.be.an("object")
                expect(info.meta!.request_tag).to.be.equal("my-tag")
                return `${str}:${num}`
            }
        })

        /*  call service with metadata  */
        const result = await ctx.apiC.call({
            name:   "example/server/hello",
            params: [ "world", 42 ],
            meta:   { request_tag: "my-tag" }
        })
        spy("call-success")
        expect(result).to.be.equal("world:42")
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-success" ])

        /*  destroy service  */
        await registration.destroy()
    })

    /*  test case: Service Call (Timeout)  */
    it("MQTT+ Service Call (Timeout)", async function () {
        /*  setup (higher timeout for this test)  */
        this.timeout(2000)
        const spy = sinon.spy()

        /*  call non-existing service (should timeout)  */
        await ctx.apiC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call-success")
        }).catch((err: Error) => {
            spy("call-timeout")
            expect(err.message).to.be.equal("communication timeout")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "call-timeout" ])
    })

    /*  test case: Service Call (Direct Receiver)  */
    it("MQTT+ Service Call (Direct Receiver)", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide service on server  */
        const registration = await ctx.apiS.service("example/server/hello", (str: string, num: number, info) => {
            spy("service")
            expect(info.receiver).to.be.equal("server")
            return `${str}:${num}`
        })

        /*  call service targeting specific receiver  */
        const result = await ctx.apiC.call({
            name:     "example/server/hello",
            params:   [ "world", 42 ],
            receiver: "server"
        })
        spy("call-success")
        expect(result).to.be.equal("world:42")
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-success" ])

        /*  destroy service  */
        await registration.destroy()
    })

    /*  test case: Service Call (Async Handler)  */
    it("MQTT+ Service Call (Async Handler)", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide async service  */
        const registration = await ctx.apiS.service("example/server/login", async (password: string) => {
            spy("service")
            await new Promise((resolve) => { setTimeout(resolve, 50) })
            if (password !== "secret")
                throw new Error("invalid password")
            return "token-abc"
        })

        /*  call service successfully  */
        const token = await ctx.apiC.call("example/server/login", "secret")
        spy("call-success")
        expect(token).to.be.equal("token-abc")

        /*  call service with error  */
        await ctx.apiC.call("example/server/login", "wrong").then(() => {
            spy("call2-success")
        }).catch((err: Error) => {
            spy("call2-error")
            expect(err.message).to.be.equal("invalid password")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-success", "service", "call2-error" ])

        /*  destroy service  */
        await registration.destroy()
    })
})

