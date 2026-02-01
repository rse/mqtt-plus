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
import crypto           from "node:crypto"
import stream           from "node:stream"
import { Buffer }       from "node:buffer"

/*  external dependencies (test suite)  */
import { describe, it } from "mocha"
import * as chai        from "chai"
import sinon            from "sinon"
import sinonChai        from "sinon-chai"
import textframe        from "textframe"

/*  external dependencies (application)  */
import Mosquitto        from "mosquitto"
import MQTT             from "mqtt"

/*  internal dependencies  */
import MQTTp            from "mqtt-plus"
import type { Event,
    Service, Source, Sink,
    InfoSource, InfoSink } from "mqtt-plus"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
chai.use(sinonChai)
const { expect } = chai

/*  example API  */
type API = {
    "example/server/connection":       Event<(state: "open" | "close") => void>
    "example/server/sample":           Event<(a1: string, a2: number) => void>
    "example/server/hello":            Service<(a1: string, a2: number) => string>
    "example/server/upload":           Sink<(name: string) => void>
    "example/server/download":         Source<(filename: string) => void>
    "example/server/download-invalid": Source<(filename: string) => void>
    "example/server/login":            Service<(password: string) => Promise<string>>
}

/*  Mosquitto ACL
    NOTICE: schema is <app>/<tier>/<topic>/<operation>/<receiver>  */
const ACL = textframe(`
    #   ==== shared/anonymous ACL ====

    #   common
    topic   read      $SYS/#
    pattern write     $SYS/broker/connection/%c/state

    #   ---- event emission ----

    topic   write     example/server/+/event-emission/+

    topic   read      example/client/+/event-emission/any
    pattern read      example/client/+/event-emission/%c

    #   ---- service call ----

    topic   write     example/server/+/service-call-request/+
    pattern read      example/server/+/service-call-response/%c

    topic   read      example/client/+/service-call-request/any
    pattern read      example/client/+/service-call-request/%c
    pattern write     example/client/+/service-call-response/%c

    #   ---- source fetch ----

    topic   write     example/server/+/source-fetch-request/+
    pattern read      example/server/+/source-fetch-response/%c
    pattern read      example/server/+/source-fetch-chunk/%c

    topic   read      example/client/+/source-fetch-request/any
    pattern read      example/client/+/source-fetch-request/%c
    topic   write     example/client/+/source-fetch-response/+
    topic   write     example/client/+/source-fetch-chunk/+

    #   ---- sink push ----

    topic   write     example/server/+/sink-push-request/+
    pattern read      example/server/+/sink-push-response/%c
    topic   write     example/server/+/sink-push-chunk/+

    topic   read      example/client/+/sink-push-request/any
    pattern read      example/client/+/sink-push-request/%c
    pattern write     example/client/+/sink-push-response/%c
    pattern read      example/client/+/sink-push-chunk/%c

    #   ==== server/autenticated ACL ====

    user    example

    #   ---- event emission ----

    topic   write     example/client/+/event-emission/+

    topic   read      example/server/+/event-emission/any
    topic   read      $share/server/example/server/+/event-emission/any
    pattern read      example/server/+/event-emission/%c
    pattern read      $share/server/example/server/+/event-emission/%c

    #   ---- service call ----

    topic   read      example/server/+/service-call-request/any
    topic   read      $share/server/example/server/+/service-call-request/any
    pattern read      example/server/+/service-call-request/%c
    pattern read      $share/server/example/server/+/service-call-request/%c
    pattern write     example/server/+/service-call-response/+

    topic   write     example/client/+/service-call-request/+
    pattern read      example/client/+/service-call-response/%c

    #   ---- source fetch ----

    topic   read      example/server/+/source-fetch-request/any
    topic   read      $share/server/example/server/+/source-fetch-request/any
    pattern read      example/server/+/source-fetch-request/%c
    pattern read      $share/server/example/server/+/source-fetch-request/%c
    topic   write     example/server/+/source-fetch-response/+
    topic   write     example/server/+/source-fetch-chunk/+

    topic   write     example/client/+/source-fetch-request/+
    pattern read      example/client/+/source-fetch-response/%c
    pattern read      example/client/+/source-fetch-chunk/%c

    #   ---- sink push ----

    topic   read      example/server/+/sink-push-request/any
    topic   read      $share/default/example/server/+/sink-push-request/any
    pattern read      example/server/+/sink-push-request/%c
    pattern read      $share/default/example/server/+/sink-push-request/%c
    topic   write     example/server/+/sink-push-response/+
    pattern read      example/server/+/sink-push-chunk/%c
    pattern read      $share/default/example/server/+/sink-push-chunk/%c

    topic   write     example/client/+/sink-push-request/+
    pattern read      example/client/+/sink-push-response/%c
    topic   write     example/client/+/sink-push-chunk/+
`)

/*  test suite  */
describe("MQTT+ Library", function () {
    let mosquitto: Mosquitto
    let mqttC:     MQTT.MqttClient
    let mqttS:     MQTT.MqttClient
    let mqttpC:    MQTTp<API>
    let mqttpS:    MQTTp<API>
    const logs:    string[] = []

    /*  actions before all test cases  */
    before(async function () {
        /*  start Mosquitto  */
        this.timeout(8000)
        mosquitto = new Mosquitto({ acl: ACL })
        await mosquitto.start()

        /*  connect with MQTT as client  */
        mqttC = MQTT.connect("mqtt://127.0.0.1:1883",
            { clientId: "client" })
        mqttpC = new MQTTp<API>(mqttC, { id: "client", timeout: 1000 })
        await new Promise<void>((resolve, reject) => {
            mqttC.once("connect", ()         => { resolve() })
            mqttC.once("error",   (err: any) => { reject(err) })
        })

        /*  connect with MQTT as server  */
        mqttS = MQTT.connect("mqtt://127.0.0.1:1883",
            { clientId: "server", username: "example", password: "example" })
        mqttpS = new MQTTp<API>(mqttS, { id: "server", timeout: 1000 })
        await new Promise<void>((resolve, reject) => {
            mqttS.once("connect", ()         => { resolve() })
            mqttS.once("error",   (err: any) => { reject(err) })
        })

        /*  capture MQTT+ logs  */
        mqttpS.on("log", async (entry) => {
            await entry.resolve()
            logs.push(`server: ${entry}`)
        })
        mqttpC.on("log", async (entry) => {
            await entry.resolve()
            logs.push(`client: ${entry}`)
        })
    })

    /*  test case: TypeScript API  */
    it("MQTT+ TypeScript API sanity check", async function () {
        expect(MQTTp).to.be.a("function")
        expect(MQTTp.prototype).to.be.an("object")
        expect(MQTTp.prototype.constructor).to.equal(MQTTp)

        expect(mqttpC).to.respondTo("event")
        expect(mqttpC).to.respondTo("emit")

        expect(mqttpC).to.respondTo("service")
        expect(mqttpC).to.respondTo("call")

        expect(mqttpC).to.respondTo("source")
        expect(mqttpC).to.respondTo("fetch")

        expect(mqttpC).to.respondTo("sink")
        expect(mqttpC).to.respondTo("push")
    })

    /*  test case: Event Emission  */
    it("MQTT+ Event Emission", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  register to event  */
        const registration = await mqttpS.event("example/server/sample", (str: string, num: number) => {
            spy("event")
        })

        /*  emit event  */
        mqttpC.emit("example/server/sample", "world", 42)
        await new Promise((resolve) => { setTimeout(resolve, 10) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "event" ])

        /*  destroy registration  */
        await registration.destroy()
    })

    /*  test case: Service Call  */
    it("MQTT+ Service Call", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide service  */
        const registration = await mqttpS.service("example/server/hello", (str: string, num: number) => {
            spy("service")
            if (str !== "world")
                throw new Error("invalid service call")
            expect(str).to.be.equal("world")
            expect(num).to.be.equal(42)
            return `${str}:${num}`
        })

        /*  call service (successfully)  */
        await mqttpC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call-success")
            expect(result).to.be.equal("world:42")
        }).catch((err: Error) => {
            spy("call-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-success" ])
        spy.resetHistory()

        /*  call service (with error)  */
        await mqttpC.call("example/server/hello", "bad-arg", 42).then(async (result) => {
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

    /*  test case: Sink Push  */
    it("MQTT+ Sink Push", async function () {
        /*  setup  */
        this.timeout(2000)
        const spy = sinon.spy()

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(16 * 1024))

        /*  establish sink  */
        const sinking = await mqttpS.sink("example/server/upload", (name: string, info: InfoSink) => {
            spy("sink")
            if (name !== "foo")
                throw new Error("invalid sink push")
            expect(name).to.be.equal("foo")
            expect(info).to.be.of.an("object")
            expect(info.stream).to.be.instanceOf(stream.Readable)
            const chunks: Buffer[] = []
            info.stream!.on("data", (chunk: Buffer) => {
                chunks.push(chunk)
            })
            info.stream!.on("end", () => {
                spy("end")
                const result = Buffer.concat(chunks)
                expect(result).to.deep.equal(data)
            })
        })

        /*  transfer stream  */
        const readable = new stream.Readable({
            read () {}
        })
        readable.push(data)
        readable.push(null)
        await mqttpC.push("example/server/upload", readable, "foo").then(() => {
            spy("transfer-success")
        }).catch((err: Error) => {
            spy("transfer-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "transfer-success", "end" ])

        /*  destroy sink  */
        await sinking.destroy()
    })

    /*  test case: Source Fetch  */
    it("MQTT+ Source Fetch", async function () {
        this.timeout(3000)

        /*  establish source  */
        const sourcing = await mqttpS.source("example/server/download", async (filename, info) => {
            if (filename === "foo")
                info.buffer = Promise.resolve(Buffer.from(`the ${filename} content`))
            else
                throw new Error("invalid source")
        })

        /*  fetch existing source (valid source argument)  */
        const result = await mqttpC.fetch("example/server/download", "foo")
        const buffer = await result.buffer
        const str = new TextDecoder().decode(buffer)
        expect(str).to.be.equal("the foo content")

        /*  fetch non-existing source (invalid source argument)  */
        const result2 = await mqttpC.fetch("example/server/download", "bar")
        const error2 = await result2.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error2).to.be.equal("invalid source")

        /*  fetch non-existing source (invalid source name)  */
        const result3 = await mqttpC.fetch("example/server/download-invalid", "foo").catch((err) => err.message)
        const error3 = await result3.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error3).to.be.equal("communication timeout")

        await sourcing.destroy()
    })

    /*  test case: Dry-Run & Last-Will */
    it("MQTT+ Dry-Run & MQTT Last-Will", async function () {
        this.timeout(3000)

        /*  generate connection close event  */
        const mqttpDry = new MQTTp<API>(null, { id: "my-client" })
        const will = mqttpDry.emit({ dry: true, event: "example/server/connection", params: [ "close" ] })
        mqttpDry.destroy()

        /*  connect to broker as a server  */
        const mqttServer = MQTT.connect("mqtt://127.0.0.1:1883", {
            username: "example", password: "example"
        })
        await new Promise<void>((resolve, reject) => {
            mqttServer.once("connect", ()         => { resolve() })
            mqttServer.once("error",   (err: any) => { reject(err) })
        })
        const mqttpServer = new MQTTp<API>(mqttServer, { timeout: 1000 })

        /*  observe connection events  */
        const spy = sinon.spy()
        mqttpServer.event("example/server/connection", (state) => {
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
            mqttClient.once("connect", ()         => { resolve() })
            mqttClient.once("error",   (err: any) => { reject(err) })
        })
        const mqttpClient = new MQTTp<API>(mqttClient, { timeout: 1000 })

        /*  send connection open event  */
        await mqttpClient.emit("example/server/connection", "open")
        await new Promise((resolve) => { setTimeout(resolve, 100) })

        /*  perform unexpected destruction of client  */
        mqttpClient.destroy()
        mqttClient.end(true)
        await new Promise((resolve) => { setTimeout(resolve, 1000) })

        /*  perform regular destruction of client  */
        mqttpServer.destroy()
        mqttServer.end()

        /*  ensure connection open and close events were seen  */
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "open", "close" ])
    })

    /*  test case: Authentication  */
    it("MQTT+ Authentication", async function () {
        /*  setup  */
        this.timeout(3000)
        const spy = sinon.spy()

        /*  credentials  */
        const serverCred = "my-secret"
        const userCred   = "my-password"

        /*  server-side: provide login  */
        mqttpS.credential(serverCred)
        let userToken = ""
        const registration = await mqttpS.service("example/server/login", async (password: string, info) => {
            spy("login")
            if (password !== userCred)
                throw new Error("invalid password")
            expect(password).to.be.equal(userCred)
            const token = await mqttpS.issue({
                id: info.sender,
                roles: [ "user" ]
            })
            userToken = token
            return token
        })

        /*  server-side: provide hello service  */
        const registration2 = await mqttpS.service({
            name: "example/server/hello",
            auth: { mode: "require", roles: [ "user" ] },
            callback: (str: string, num: number) => {
                spy("hello")
                return `${str}:${num}`
            }
        })

        /*  call service (without token)  */
        await mqttpC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call1-success")
        }).catch((err: Error) => {
            spy("call1-error")
        })
        expect(spy.getCalls()
            .map((call) => call.firstArg))
            .to.be.deep.equal([ "call1-error" ])
        spy.resetHistory()

        /*  retrieve token  */
        await mqttpC.call("example/server/login", userCred).then(async (token) => {
            spy("login-success")
            expect(token).to.be.equal(userToken)
        }).catch((err: Error) => {
            spy("login-error")
        })
        expect(spy.getCalls()
            .map((call) => call.firstArg))
            .to.be.deep.equal([ "login", "login-success" ])
        spy.resetHistory()

        /*  call service (with wrong token)  */
        await mqttpC.authenticate("wrong")
        await mqttpC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call2-success")
        }).catch((err: Error) => {
            spy("call2-error")
        })
        expect(spy.getCalls()
            .map((call) => call.firstArg))
            .to.be.deep.equal([ "call2-error" ])
        spy.resetHistory()

        /*  call service (with correct token)  */
        await mqttpC.authenticate(userToken)
        await mqttpC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call3-success")
        }).catch((err: Error) => {
            spy("call3-error")
        })
        expect(spy.getCalls()
            .map((call) => call.firstArg))
            .to.be.deep.equal([ "hello", "call3-success" ])

        /*  destroy service  */
        await registration.destroy()
        await registration2.destroy()
    })

    /*  actions after each test cases  */
    let testsFailed = 0
    afterEach(function () {
        if (this.currentTest?.state === "failed")
            testsFailed++
    })

    /*  actions after all test cases  */
    after(async function () {
        /*  disconnect with MQTT  */
        mqttC.end()
        mqttS.end()

        /*  stop Mosquitto  */
        this.timeout(4000)
        await mosquitto.stop()
        await new Promise((resolve) => { setTimeout(resolve, 1000) })

        /*  in case of any failed tests, show the Mosquitto logs  */
        if (testsFailed > 0) {
            logs.forEach((entry) => console.log(entry))
            console.log(mosquitto.logs())
        }
    })
})

