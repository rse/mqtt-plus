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

/*  external dependencies  */
import { expect } from "chai"
import Mosquitto  from "mosquitto"
import MQTT       from "mqtt"

/*  internal dependencies  */
import MQTTp      from "../dst-stage2/mqtt-plus.esm.js"

/*  test suite  */
describe("MQTT+ Library", function () {
    let mosquitto: Mosquitto
    let mqtt:      MQTT

    before(async function () {
        /*  start Mosquitto  */
        this.timeout(8000)
        mosquitto = new Mosquitto()
        await mosquitto.start()
        await new Promise((resolve) => { setTimeout(resolve, 1000) })

        /*  connect with MQTT  */
        mqtt = MQTT.connect("mqtt://127.0.0.1:1883", {})
        await new Promise<void>((resolve, reject) => {
            mqtt.once("connect", ()         => { resolve() })
            mqtt.once("error",   (err: any) => { reject(err) })
        })
    })

    it("MQTT+ TypeScript API sanity check", async function () {
        const mqttp = new MQTTp(mqtt)

        expect(MQTTp).to.be.a("function")
        expect(MQTTp.prototype).to.be.an("object")
        expect(MQTTp.prototype.constructor).to.equal(MQTTp)

        expect(mqttp).to.respondTo("receiver")

        expect(mqttp).to.respondTo("subscribe")
        expect(mqttp).to.respondTo("attach")

        expect(mqttp).to.respondTo("register")
        expect(mqttp).to.respondTo("emit")

        expect(mqttp).to.respondTo("transfer")
        expect(mqttp).to.respondTo("call")
    })

    it("MQTT+ Event Emission", async function () {
        this.timeout(1000)
    })

    after(async function () {
        /*  disconnect with MQTT  */
        mqtt.end()

        /*  stop Mosquitto  */
        this.timeout(4000)
        await mosquitto.stop()
        await new Promise((resolve) => { setTimeout(resolve, 1000) })
        console.log(mosquitto.logs())
    })
})

