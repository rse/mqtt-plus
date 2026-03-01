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
import { ctx }              from "./mqtt-plus-0-fixture"
import type { API }         from "./mqtt-plus-0-fixture"

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

    /*  test case: Authentication  */
    it("MQTT+ Authentication", async function () {
        /*  setup  */
        this.slow(1000)
        this.timeout(1000)
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
})

