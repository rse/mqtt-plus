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

/*  external dependencies (test suite)  */
import { describe, it } from "mocha"
import * as chai        from "chai"
import sinon            from "sinon"
import sinonChai        from "sinon-chai"

/*  external dependencies (application)  */
import stream           from "stream"
import Mosquitto        from "mosquitto"
import MQTT             from "mqtt"

/*  internal dependencies  */
import MQTTp            from "mqtt-plus"
import type { Event,
    Service, Resource,
    InfoResource }      from "mqtt-plus"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
chai.use(sinonChai)
const { expect } = chai

/*  example API  */
type API = {
    "example/sample":           Event<(a1: string, a2: number) => void>
    "example/hello":            Service<(a1: string, a2: number) => string>
    "example/upload":           Resource<(name: string) => void>
    "example/download":         Resource<(filename: string) => void>
    "example/download-invalid": Resource<(filename: string) => void>
}

/*  test suite  */
describe("MQTT+ Library", function () {
    let mosquitto: Mosquitto
    let mqtt:      MQTT.MqttClient

    /*  actions before all test cases  */
    before(async function () {
        /*  start Mosquitto  */
        this.timeout(8000)
        mosquitto = new Mosquitto()
        await mosquitto.start()
        await new Promise((resolve) => { setTimeout(resolve, 1000) })

        /*  connect with MQTT  */
        mqtt = MQTT.connect("mqtt://127.0.0.1:1883", {
            username: "example", password: "example"
        })
        await new Promise<void>((resolve, reject) => {
            mqtt.once("connect", ()         => { resolve() })
            mqtt.once("error",   (err: any) => { reject(err) })
        })
    })

    /*  test case: TypeScript API  */
    it("MQTT+ TypeScript API sanity check", async function () {
        const mqttp = new MQTTp(mqtt)

        expect(MQTTp).to.be.a("function")
        expect(MQTTp.prototype).to.be.an("object")
        expect(MQTTp.prototype.constructor).to.equal(MQTTp)

        expect(mqttp).to.respondTo("receiver")

        expect(mqttp).to.respondTo("subscribe")
        expect(mqttp).to.respondTo("emit")

        expect(mqttp).to.respondTo("register")
        expect(mqttp).to.respondTo("call")

        expect(mqttp).to.respondTo("provision")
        expect(mqttp).to.respondTo("fetch")
        expect(mqttp).to.respondTo("push")

        mqttp.destroy()
    })

    /*  test case: Event Emission  */
    it("MQTT+ Event Emission", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  subscribe to event  */
        const mqttp = new MQTTp<API>(mqtt)
        const subscription = await mqttp.subscribe("example/sample", (str: string, num: number) => {
            spy("subscribe")
        })

        /*  emit event  */
        mqttp.emit("example/sample", "world", 42)
        await new Promise((resolve) => { setTimeout(resolve, 10) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "subscribe" ])

        /*  destroy service  */
        await subscription.unsubscribe()
        mqttp.destroy()
    })

    /*  test case: Service Call  */
    it("MQTT+ Service Call", async function () {
        /*  setup  */
        this.timeout(1000)
        const spy = sinon.spy()

        /*  provide service  */
        const mqttp = new MQTTp<API>(mqtt, { timeout: 1000 })
        const registration = await mqttp.register("example/hello", (str: string, num: number) => {
            spy("register")
            if (str !== "world")
                throw new Error("invalid service call")
            expect(str).to.be.equal("world")
            expect(num).to.be.equal(42)
            return `${str}:${num}`
        })

        /*  call service (successfully)  */
        await mqttp.call("example/hello", "world", 42).then(async (result) => {
            spy("call-success")
            expect(result).to.be.equal("world:42")
        }).catch((err: Error) => {
            spy("call-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "register", "call-success" ])
        spy.resetHistory()

        /*  call service (with error)  */
        await mqttp.call("example/hello", "bad-arg", 42).then(async (result) => {
            spy("call-success")
        }).catch((err: Error) => {
            expect(err.message).to.be.equal("invalid service call")
            spy("call-error")
        })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.deep.equal([ "register", "call-error" ])

        /*  destroy service  */
        await registration.unregister()
        mqttp.destroy()
    })

    /*  test case: Resource Transfer (Push)  */
    it("MQTT+ Resource Transfer (Push)", async function () {
        /*  setup  */
        this.timeout(2000)
        const spy = sinon.spy()

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(16 * 1024))

        /*  attach to resource  */
        const mqttp = new MQTTp<API>(mqtt)
        const attachment = await mqttp.provision("example/upload", (name: string, info: InfoResource) => {
            spy("provision")
            if (name !== "foo")
                throw new Error("invalid resource transfer")
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
        await mqttp.push("example/upload", readable, "foo").then(() => {
            spy("transfer-success")
        }).catch((err: Error) => {
            spy("transfer-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "provision", "transfer-success", "end" ])

        /*  destroy service  */
        await attachment.unprovision()
        mqttp.destroy()
    })

    /*  test case: Resource Transfer  */
    it("MQTT+ Resource Transfer (Fetch)", async function () {
        this.timeout(3000)

        /*  provide resource  */
        const mqttp = new MQTTp<API>(mqtt, { timeout: 1000 })
        const provisioning = await mqttp.provision("example/download", async (filename, info) => {
            if (filename === "foo")
                info.resource = Buffer.from(`the ${filename} content`)
            else
                throw new Error("invalid resource")
        })

        /*  fetch existing resource (valid resource argument)  */
        const result = await mqttp.fetch("example/download", "foo")
        const buffer = await result.buffer
        const str = buffer.toString()
        expect(str).to.be.equal("the foo content")

        /*  fetch non-existing resource (invalid resource argument)  */
        const result2 = await mqttp.fetch("example/download", "bar")
        const error2 = await result2.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error2).to.be.equal("invalid resource")

        /*  fetch non-existing resource (invalid resource name)  */
        const result3 = await mqttp.fetch("example/download-invalid", "foo").catch((err) => err.message)
        const error3 = await result3.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error3).to.be.equal("communication timeout")

        await provisioning.unprovision()
        mqttp.destroy()
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
        mqtt.end()

        /*  stop Mosquitto  */
        this.timeout(4000)
        await mosquitto.stop()
        await new Promise((resolve) => { setTimeout(resolve, 1000) })

        /*  in case of any failed tests, show the Mosquitto logs  */
        if (testsFailed > 0)
            console.log(mosquitto.logs())
    })
})

