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
import crypto                                 from "node:crypto"
import stream                                 from "node:stream"
import { Buffer }                             from "node:buffer"

/*  external dependencies (test suite)  */
import { describe, it }                       from "mocha"
import * as chai                              from "chai"
import sinon                                  from "sinon"
import sinonChai                              from "sinon-chai"

/*  external dependencies (application)  */
import MQTT                                   from "mqtt"

/*  internal dependencies  */
import Mosquitto                              from "./mqtt-plus-mosquitto"
import MQTTp                                  from "mqtt-plus"
import type { Event, Service, Source, Sink }  from "mqtt-plus"

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

/*  test suite  */
describe("MQTT+ Library", function () {
    let mosquitto: Mosquitto
    let mqttC:     MQTT.MqttClient
    let mqttS:     MQTT.MqttClient
    let apiC:      MQTTp<API>
    let apiS:      MQTTp<API>
    const logs:    string[] = []

    /*  actions before all test cases  */
    before(async function () {
        /*  start Mosquitto  */
        this.timeout(8000)
        mosquitto = new Mosquitto()
        await mosquitto.start()

        /*  connect with MQTT as client  */
        mqttC = MQTT.connect("mqtt://127.0.0.1:1883",
            { clientId: "client" })
        apiC = new MQTTp<API>(mqttC, { id: "client", timeout: 1000 })
        await new Promise<void>((resolve, reject) => {
            mqttC.once("connect", ()           => { resolve() })
            mqttC.once("error",   (err: Error) => { reject(err) })
        })
        apiC.on("log", async (entry) => {
            await entry.resolve()
            logs.push(`client: ${entry}`)
        })

        /*  connect with MQTT as server  */
        mqttS = MQTT.connect("mqtt://127.0.0.1:1883",
            { clientId: "server", username: "example", password: "example" })
        apiS = new MQTTp<API>(mqttS, { id: "server", timeout: 1000 })
        await new Promise<void>((resolve, reject) => {
            mqttS.once("connect", ()           => { resolve() })
            mqttS.once("error",   (err: Error) => { reject(err) })
        })
        apiS.on("log", async (entry) => {
            await entry.resolve()
            logs.push(`server: ${entry}`)
        })
    })

    /*  test case: TypeScript API  */
    it("MQTT+ TypeScript API", async function () {
        expect(MQTTp).to.be.a("function")
        expect(MQTTp.prototype).to.be.an("object")
        expect(MQTTp.prototype.constructor).to.equal(MQTTp)

        expect(apiC).to.respondTo("event")
        expect(apiC).to.respondTo("emit")

        expect(apiC).to.respondTo("service")
        expect(apiC).to.respondTo("call")

        expect(apiC).to.respondTo("source")
        expect(apiC).to.respondTo("fetch")

        expect(apiC).to.respondTo("sink")
        expect(apiC).to.respondTo("push")
    })

    /*  test case: Encoding Utilities  */
    it("MQTT+ Encoding Utilities", async function () {
        /*  str2buf / buf2str  */
        const str = "hello world \u00e4\u00f6\u00fc"
        const buf = apiC.str2buf(str)
        expect(buf).to.be.instanceOf(Uint8Array)
        expect(apiC.buf2str(buf)).to.be.equal(str)

        /*  arr2buf / buf2arr  */
        const u8 = new Uint8Array([ 4, 5, 6 ])
        expect(apiC.arr2buf(u8)).to.be.equal(u8)
        const u8src = new Uint8Array([ 7, 8, 9 ])
        const u8Result = apiC.buf2arr(u8src, Uint8Array)
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
        expect(apiC.meta("foo")).to.be.equal(undefined)

        /*  set and retrieve  */
        apiC.meta("foo", "bar")
        expect(apiC.meta("foo")).to.be.equal("bar")
        apiC.meta("baz", 42)
        expect(apiC.meta("baz")).to.be.equal(42)

        /*  overwrite  */
        apiC.meta("foo", "quux")
        expect(apiC.meta("foo")).to.be.equal("quux")

        /*  delete  */
        apiC.meta("foo", null)
        expect(apiC.meta("foo")).to.be.equal(undefined)
        expect(apiC.meta("baz")).to.be.equal(42)
    })

    /*  test case: Event Emission  */
    it("MQTT+ Event Emission", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  register to event  */
        const registration = await apiS.event("example/server/sample", (str: string, num: number, info) => {
            spy("event")
            expect(info).to.be.an("object")
            expect(info.sender).to.be.a("string")
        })

        /*  emit event  */
        apiC.emit("example/server/sample", "world", 42)
        await new Promise((resolve) => { setTimeout(resolve, 10) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "event" ])

        /*  destroy registration  */
        await registration.destroy()
    })

    /*  test case: Event Emission (Object API)  */
    it("MQTT+ Event Emission (Object API)", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  register event  */
        const registration = await apiS.event({
            name: "example/server/sample",
            callback: (str: string, num: number, info) => {
                spy("event")
                expect(info).to.be.an("object")
                expect(info.sender).to.be.a("string")
            }
        })

        /*  emit event  */
        apiC.emit({
            event:  "example/server/sample",
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
        this.timeout(1000)
        const spy = sinon.spy()

        /*  register event  */
        const registration = await apiS.event({
            name: "example/server/sample",
            callback: (str: string, num: number, info) => {
                spy("event")
                expect(info.meta).to.be.an("object")
                expect(info.meta!.tag).to.be.equal("test-meta")
            }
        })

        /*  emit event with metadata  */
        apiC.emit({
            event:  "example/server/sample",
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
        /*  setup  */
        this.timeout(1000)

        /*  register event  */
        const reg = await apiS.event("example/server/sample", () => {})

        /*  attempt duplicate registration  */
        try {
            await apiS.event("example/server/sample", () => {})
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/already registered/)
        }

        /*  cleanup  */
        await reg.destroy()

        /*  verify re-registration after destroy works  */
        const reg2 = await apiS.event("example/server/sample", () => {})
        await reg2.destroy()
    })

    /*  test case: Service Call  */
    it("MQTT+ Service Call", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide service  */
        const registration = await apiS.service("example/server/hello", (str: string, num: number) => {
            spy("service")
            if (str !== "world")
                throw new Error("invalid service call")
            expect(str).to.be.equal("world")
            expect(num).to.be.equal(42)
            return `${str}:${num}`
        })

        /*  call service (successfully)  */
        await apiC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call-success")
            expect(result).to.be.equal("world:42")
        }).catch((err: Error) => {
            spy("call-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "service", "call-success" ])
        spy.resetHistory()

        /*  call service (with error)  */
        await apiC.call("example/server/hello", "bad-arg", 42).then(async (result) => {
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
        const registration = await apiS.service({
            name: "example/server/hello",
            callback: (str: string, num: number) => {
                spy("service")
                return `${str}:${num}`
            }
        })

        /*  call service  */
        const result = await apiC.call({
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
        const registration = await apiS.service({
            name: "example/server/hello",
            callback: (str: string, num: number, info) => {
                spy("service")
                expect(info.meta).to.be.an("object")
                expect(info.meta!.request_tag).to.be.equal("my-tag")
                return `${str}:${num}`
            }
        })

        /*  call service with metadata  */
        const result = await apiC.call({
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
        await apiC.call("example/server/hello", "world", 42).then(async (result) => {
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
        const registration = await apiS.service("example/server/hello", (str: string, num: number, info) => {
            spy("service")
            expect(info.receiver).to.be.equal("server")
            return `${str}:${num}`
        })

        /*  call service targeting specific receiver  */
        const result = await apiC.call({
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
        const registration = await apiS.service("example/server/login", async (password: string) => {
            spy("service")
            await new Promise((resolve) => { setTimeout(resolve, 50) })
            if (password !== "secret")
                throw new Error("invalid password")
            return "token-abc"
        })

        /*  call service successfully  */
        const token = await apiC.call("example/server/login", "secret")
        spy("call-success")
        expect(token).to.be.equal("token-abc")

        /*  call service with error  */
        await apiC.call("example/server/login", "wrong").then(() => {
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

    /*  test case: Sink Push (Buffer)  */
    it("MQTT+ Sink Push (Buffer)", async function () {
        this.timeout(2000)
        const spy = sinon.spy()

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(8 * 1024))

        /*  establish sink consuming via buffer  */
        const sinking = await apiS.sink("example/server/upload", (name: string, info) => {
            spy("sink")
            expect(name).to.be.equal("foo")
            expect(info).to.be.an("object")

            /*  consume via buffer (instead of stream)  */
            info.buffer!.then((buf: Uint8Array) => {
                spy("buffer")
                expect(Buffer.from(buf)).to.deep.equal(data)
            })
        })

        /*  push a buffer (instead of a stream)  */
        await apiC.push("example/server/upload", new Uint8Array(data), "foo").then(() => {
            spy("push-success")
        }).catch((err: Error) => {
            spy("push-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "push-success", "buffer" ])

        /*  destroy sink  */
        await sinking.destroy()
    })

    /*  test case: Sink Push (Stream)  */
    it("MQTT+ Sink Push (Stream)", async function () {
        /*  setup  */
        this.timeout(2000)
        const spy = sinon.spy()

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(16 * 1024))

        /*  establish sink  */
        const sinking = await apiS.sink("example/server/upload", (name: string, info) => {
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
        await apiC.push("example/server/upload", readable, "foo").then(() => {
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

    /*  test case: Sink Push (Meta Information)  */
    it("MQTT+ Sink Push (Meta Information)", async function () {
        this.timeout(2000)
        const spy = sinon.spy()

        /*  set instance-level meta on client  */
        apiC.meta("client-version", "2.0")

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(8 * 1024))

        /*  establish sink that checks metadata  */
        const sinking = await apiS.sink("example/server/upload", (name: string, info) => {
            spy("sink")
            expect(name).to.be.equal("foo")
            expect(info.meta).to.be.an("object")
            expect(info.meta!.push_tag).to.be.equal("my-push-tag")
            expect(info.meta!["client-version"]).to.be.equal("2.0")

            /*  consume via buffer  */
            info.buffer!.then((buf: Uint8Array) => {
                spy("buffer")
                expect(Buffer.from(buf)).to.deep.equal(data)
            })
        })

        /*  push with metadata  */
        await apiC.push({
            name:   "example/server/upload",
            data:   new Uint8Array(data),
            params: [ "foo" ],
            meta:   { push_tag: "my-push-tag" }
        }).then(() => {
            spy("push-success")
        }).catch((err: Error) => {
            spy("push-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "push-success", "buffer" ])

        /*  cleanup  */
        apiC.meta("client-version", null)
        await sinking.destroy()
    })

    /*  test case: Source Fetch (Buffer)  */
    it("MQTT+ Source Fetch (Buffer)", async function () {
        this.timeout(3000)

        /*  establish source  */
        const sourcing = await apiS.source("example/server/download", async (filename, info) => {
            if (filename === "foo")
                info.buffer = Promise.resolve(Buffer.from(`the ${filename} content`))
            else
                throw new Error("invalid source")
        })

        /*  fetch existing source (valid source argument)  */
        const result = await apiC.fetch("example/server/download", "foo")
        const buffer = await result.buffer
        const str = new TextDecoder().decode(buffer)
        expect(str).to.be.equal("the foo content")

        /*  fetch non-existing source (invalid source argument)  */
        const result2 = await apiC.fetch("example/server/download", "bar")
        const error2 = await result2.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error2).to.be.equal("invalid source")

        /*  fetch non-existing source (invalid source name)  */
        const result3 = await apiC.fetch("example/server/download-invalid", "foo").catch((err) => err.message)
        const error3 = await result3.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error3).to.be.equal("communication timeout")

        await sourcing.destroy()
    })

    /*  test case: Source Fetch (Stream)  */
    it("MQTT+ Source Fetch (Stream)", async function () {
        this.timeout(3000)

        /*  establish source providing data via stream  */
        const sourcing = await apiS.source("example/server/download", async (filename, info) => {
            if (filename === "streamed") {
                const readable = new stream.Readable({ read () {} })
                readable.push(Buffer.from("chunk1-"))
                readable.push(Buffer.from("chunk2"))
                readable.push(null)
                info.stream = readable
            }
            else
                throw new Error("invalid source")
        })

        /*  fetch source and consume via stream  */
        const result = await apiC.fetch("example/server/download", "streamed")
        const chunks: Buffer[] = []
        result.stream.on("data", (chunk: Buffer) => { chunks.push(chunk) })
        await new Promise<void>((resolve) => { result.stream.on("end", resolve) })
        const combined = Buffer.concat(chunks).toString()
        expect(combined).to.be.equal("chunk1-chunk2")

        await sourcing.destroy()
    })

    /*  test case: Source Fetch (Meta Information)  */
    it("MQTT+ Source Fetch (Meta Information)", async function () {
        this.timeout(1000)

        /*  set instance-level meta on server  */
        apiS.meta("server-version", "1.0")

        /*  establish source  */
        const sourcing = await apiS.source("example/server/download", async (filename, info) => {
            info.buffer = Promise.resolve(Buffer.from("data"))
        })

        /*  fetch and check meta  */
        const result = await apiC.fetch("example/server/download", "foo")
        const meta = await result.meta
        expect(meta).to.be.an("object")
        expect(meta!["server-version"]).to.be.equal("1.0")

        /*  cleanup  */
        apiS.meta("server-version", undefined)
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
            mqttServer.once("connect", ()           => { resolve() })
            mqttServer.once("error",   (err: Error) => { reject(err) })
        })
        const apiServer = new MQTTp<API>(mqttServer, { timeout: 1000 })

        /*  observe connection events  */
        const spy = sinon.spy()
        apiServer.event("example/server/connection", (state) => {
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
        const apiClient = new MQTTp<API>(mqttClient, { timeout: 1000 })

        /*  send connection open event  */
        await apiClient.emit("example/server/connection", "open")
        await new Promise((resolve) => { setTimeout(resolve, 100) })

        /*  perform unexpected destruction of client  */
        apiClient.destroy()
        mqttClient.end(true)
        await new Promise((resolve) => { setTimeout(resolve, 1000) })

        /*  perform regular destruction of client  */
        apiServer.destroy()
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
        apiS.credential(serverCred)
        let userToken = ""
        const registration = await apiS.service("example/server/login", async (password: string, info) => {
            spy("login")
            if (password !== userCred)
                throw new Error("invalid password")
            expect(password).to.be.equal(userCred)
            const token = await apiS.issue({
                id: info.sender,
                roles: [ "user" ]
            })
            userToken = token
            return token
        })

        /*  server-side: provide hello service  */
        const registration2 = await apiS.service({
            name: "example/server/hello",
            auth: { mode: "require", roles: [ "user" ] },
            callback: (str: string, num: number) => {
                spy("hello")
                return `${str}:${num}`
            }
        })

        /*  call service (without token)  */
        await apiC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call1-success")
        }).catch((err: Error) => {
            spy("call1-error")
        })
        expect(spy.getCalls()
            .map((call) => call.firstArg))
            .to.be.deep.equal([ "call1-error" ])
        spy.resetHistory()

        /*  retrieve token  */
        await apiC.call("example/server/login", userCred).then(async (token) => {
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
        await apiC.authenticate("wrong")
        await apiC.call("example/server/hello", "world", 42).then(async (result) => {
            spy("call2-success")
        }).catch((err: Error) => {
            spy("call2-error")
        })
        expect(spy.getCalls()
            .map((call) => call.firstArg))
            .to.be.deep.equal([ "call2-error" ])
        spy.resetHistory()

        /*  call service (with correct token)  */
        await apiC.authenticate(userToken)
        await apiC.call("example/server/hello", "world", 42).then(async (result) => {
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
        /*  destroy API instances  */
        apiC.destroy()
        apiS.destroy()

        /*  disconnect from MQTT  */
        await mqttC.endAsync()
        await mqttS.endAsync()

        /*  stop Mosquitto  */
        this.timeout(4000)
        await mosquitto.stop()

        /*  in case of any failed tests, show the Mosquitto logs  */
        if (testsFailed > 0) {
            logs.forEach((entry) => console.log(entry))
            console.log(mosquitto.logs())
        }
    })
})

