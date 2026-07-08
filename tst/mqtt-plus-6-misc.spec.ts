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

/*  built-in dependencies  */
import { Buffer }           from "node:buffer"

/*  external dependencies (test suite)  */
import { describe, it }     from "mocha"
import * as chai            from "chai"
import sinon                from "sinon"
import sinonChai            from "sinon-chai"

/*  external dependencies (application)  */
import MQTT                 from "mqtt"

/*  internal dependencies  */
import MQTTp                from "mqtt-plus"
import type { Event }       from "mqtt-plus"
import { ctx }              from "./mqtt-plus-0-fixture"
import type { API }         from "./mqtt-plus-0-fixture"
import { makeMutuallyExclusiveFields } from "../src/mqtt-plus-util"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
chai.use(sinonChai)
const { expect } = chai

/*  test suite  */
describe("MQTT+ Miscellaneous", function () {
    /*  test case: Dry-Run & Last-Will  */
    it("MQTT+ Dry-Run & MQTT Last-Will", async function () {
        /*  setup  */
        this.slow(2000)
        this.timeout(2000)

        /*  generate connection close event  */
        const mqttpDry = new MQTTp<API>(null, { id: "my-client" })
        const will = mqttpDry.emit({ dry: true, name: "example/server/connection", params: [ "close" ] })
        mqttpDry.destroy()

        /*  connect to broker as a server  */
        const mqttServer = MQTT.connect("mqtt://127.0.0.1:1883", {
            username: "example", password: "example"
        })
        await new Promise<void>((resolve, reject) => {
            mqttServer.once("connect", ()           => { resolve() })
            mqttServer.once("error",   (err: Error) => { reject(err) })
        })
        const apiServer = new MQTTp<API>(mqttServer, { timeout: 100 })

        /*  observe connection events  */
        const spy = sinon.spy()
        const eventReg = await apiServer.event("example/server/connection", (state) => {
            expect(state).to.match(/^(?:open|close)$/)
            spy(state)
        })

        /*  connect to broker as a client with last-will  */
        const mqttClient = MQTT.connect("mqtt://127.0.0.1:1883", {
            will: {
                topic:   will.topic,
                payload: Buffer.from(will.payload),
                qos:     will.options.qos
            }
        })
        await new Promise<void>((resolve, reject) => {
            mqttClient.once("connect", ()           => { resolve() })
            mqttClient.once("error",   (err: Error) => { reject(err) })
        })
        const apiClient = new MQTTp<API>(mqttClient, { timeout: 100 })

        /*  send connection open event  */
        await apiClient.emit("example/server/connection", "open")
        await new Promise((resolve) => { setTimeout(resolve, 100) })

        /*  perform unexpected destruction of client  */
        apiClient.destroy()
        mqttClient.end(true)
        await new Promise((resolve) => { setTimeout(resolve, 100) })

        /*  perform regular destruction of client  */
        await eventReg.destroy()
        apiServer.destroy()
        await mqttServer.endAsync()

        /*  ensure connection open and close events were seen  */
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "open", "close" ])
    })

    /*  test case: JSON Codec  */
    it("MQTT+ JSON Codec", async function () {
        /*  setup  */
        this.slow(2000)
        this.timeout(2000)
        const spy  = sinon.spy()
        const spyB = sinon.spy()

        /*  create JSON codec API instances on existing MQTT connections  */
        type APIX = API & { "example/server/binary": Event<(data: Buffer) => void> }
        const apiJsonS = new MQTTp<APIX>(ctx.mqttS, { id: "json-server", codec: "json", timeout: 500 })
        const apiJsonC = new MQTTp<APIX>(ctx.mqttC, { id: "json-client", codec: "json", timeout: 500 })

        /*  register event handlers  */
        const registration = await apiJsonS.event("example/server/sample", (str: string, num: number) => {
            spy("event", str, num)
        })
        const registrationB = await apiJsonS.event("example/server/binary", (data: Buffer) => {
            spyB(data)
        })

        /*  emit events via JSON codec  */
        apiJsonC.emit("example/server/sample", "hello", 99)
        apiJsonC.emit("example/server/binary", Buffer.from([ 0x01, 0x02, 0x03, 0xff ]))
        await new Promise((resolve) => { setTimeout(resolve, 100) })

        /*  verify round-trip  */
        expect(spy.getCalls().length).to.equal(1)
        expect(spy.getCalls()[0].args).to.deep.equal([ "event", "hello", 99 ])

        /*  verify Buffer round-trip  */
        expect(spyB.getCalls().length).to.equal(1)
        const data: Buffer = spyB.getCalls()[0].args[0]
        expect(data).to.be.instanceOf(Buffer)
        expect(data.equals(Buffer.from([ 0x01, 0x02, 0x03, 0xff ]))).to.equal(true)

        /*  cleanup  */
        await registration.destroy()
        await registrationB.destroy()
        apiJsonS.destroy()
        apiJsonC.destroy()
    })

    /*  test case: Error Event on throwing topicMatch  */
    it("MQTT+ Error Event on Throwing topicMatch", async function () {
        /*  setup  */
        this.slow(2000)
        this.timeout(2000)
        const spy = sinon.spy()

        /*  create API instances with a throwing user-supplied topicMatch on the receiver side  */
        const apiThrowS = new MQTTp<API>(ctx.mqttS, { id: "throw-server", timeout: 500,
            topicMatch: () => { throw new Error("intentionally failing topicMatch") } })
        const apiThrowC = new MQTTp<API>(ctx.mqttC, { id: "throw-client", timeout: 500 })

        /*  observe MQTT+ error events  */
        apiThrowS.on("error", (err: Error) => { spy(err.message) })

        /*  register event handler to subscribe the topic  */
        const registration = await apiThrowS.event("example/server/sample", () => {})

        /*  emit event to trigger the inbound message processing  */
        apiThrowC.emit("example/server/sample", "hello", 42)
        await new Promise((resolve) => { setTimeout(resolve, 100) })

        /*  ensure the exception surfaced as MQTT+ "error" event  */
        expect(spy.getCalls().length).to.be.at.least(1)
        expect(spy.getCalls()[0].args[0]).to.match(/failed to match MQTT topic/)

        /*  cleanup  */
        await registration.destroy()
        apiThrowS.destroy()
        apiThrowC.destroy()
    })

    /*  test case: Authentication  */
    it("MQTT+ Authentication", async function () {
        /*  setup  */
        this.slow(4000)
        this.timeout(4000)
        const spy = sinon.spy()

        /*  credentials  */
        const serverCred = "my-secret"
        const userCred   = "my-password"

        /*  server-side: provide login  */
        ctx.apiS.credential(serverCred)
        let userToken = ""
        const registration = await ctx.apiS.service("example/server/login", async (password: string, info) => {
            spy("login")
            if (password !== userCred)
                throw new Error("invalid password")
            expect(password).to.be.equal(userCred)
            const token = await ctx.apiS.issue({
                id: info.sender,
                roles: [ "user" ]
            })
            userToken = token
            return token
        })

        /*  server-side: provide hello service  */
        const registration2 = await ctx.apiS.service({
            name: "example/server/hello",
            auth: { mode: "require", roles: [ "user" ] },
            callback: (str: string, num: number) => {
                spy("hello")
                return `${str}:${num}`
            }
        })

        /*  call service (without token)  */
        await ctx.apiC.call("example/server/hello", "world", 42).then(async (_result) => {
            spy("call1-success")
        }).catch((_err: Error) => {
            spy("call1-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "call1-error" ])
        spy.resetHistory()

        /*  retrieve token  */
        await ctx.apiC.call("example/server/login", userCred).then(async (token) => {
            spy("login-success")
            expect(token).to.be.equal(userToken)
        }).catch((_err: Error) => {
            spy("login-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "login", "login-success" ])
        spy.resetHistory()

        /*  call service (with wrong token)  */
        await ctx.apiC.authenticate("wrong")
        await ctx.apiC.call("example/server/hello", "world", 42).then(async (_result) => {
            spy("call2-success")
        }).catch((_err: Error) => {
            spy("call2-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "call2-error" ])
        spy.resetHistory()

        /*  call service (with correct token)  */
        await ctx.apiC.authenticate(userToken)
        await ctx.apiC.call("example/server/hello", "world", 42).then(async (_result) => {
            spy("call3-success")
        }).catch((_err: Error) => {
            spy("call3-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "hello", "call3-success" ])

        /*  destroy service  */
        await registration.destroy()
        await registration2.destroy()
    })

    /*  test case: Authentication with Empty Role  */
    it("MQTT+ Authentication with Empty Role", async function () {
        /*  setup  */
        this.slow(2000)
        this.timeout(2000)
        const spy = sinon.spy()

        /*  server-side: provide hello service with falsy-but-valid empty role  */
        const registration = await ctx.apiS.service({
            name: "example/server/hello",
            auth: "",
            callback: (str: string, num: number) => {
                spy("hello")
                return `${str}:${num}`
            }
        })

        /*  call service and expect fail-closed rejection  */
        await ctx.apiC.call("example/server/hello", "world", 42).then(async (_result) => {
            spy("call-success")
        }).catch((err: Error) => {
            spy("call-error")
            expect(err.message).to.match(/failed authentication/)
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "call-error" ])

        /*  cleanup  */
        await registration.destroy()
    })

    /*  test case: Unit: arr2buf/buf2arr  */
    it("MQTT+ Unit: arr2buf/buf2arr", function () {
        /*  create a dry-run MQTTp instance for accessing encode methods  */
        const mqttp = new MQTTp(null)

        /*  arr2buf with Int8Array  */
        const src = new Int8Array([ 1, -2, 3 ])
        const buf = mqttp.arr2buf(src)
        expect(buf).to.be.instanceOf(Uint8Array)
        expect(buf.byteLength).to.equal(3)

        /*  arr2buf with Buffer  */
        const src2 = Buffer.from([ 10, 20, 30 ])
        const buf2 = mqttp.arr2buf(src2)
        expect(buf2).to.be.instanceOf(Uint8Array)
        expect(buf2.byteLength).to.equal(3)

        /*  buf2arr with Int8Array  */
        const src3 = new Uint8Array([ 1, 2, 3 ])
        const arr = mqttp.buf2arr(src3, Int8Array)
        expect(arr).to.be.instanceOf(Int8Array)
        expect(arr.byteLength).to.equal(3)

        /*  buf2arr with Float32Array throws  */
        const src4 = new Uint8Array([ 1, 2, 3, 4 ])
        expect(() => mqttp.buf2arr(src4, Float32Array as any)).to.throw("invalid data type")

        /*  cleanup  */
        mqttp.destroy()
    })

    /*  test case: Unit: makeMutuallyExclusiveFields  */
    it("MQTT+ Unit: makeMutuallyExclusiveFields", function () {
        /*  accessing f1 after f2 consumed throws  */
        const obj1 = { a: 1, b: 2 }
        makeMutuallyExclusiveFields(obj1, "a", "b")
        void obj1.b
        expect(() => obj1.a).to.throw(/mutually exclusive/)

        /*  accessing f2 after f1 consumed throws  */
        const obj2 = { a: 1, b: 2 }
        makeMutuallyExclusiveFields(obj2, "a", "b")
        void obj2.a
        expect(() => obj2.b).to.throw(/mutually exclusive/)
    })
})

