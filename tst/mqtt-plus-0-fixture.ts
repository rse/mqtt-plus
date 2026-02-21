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

/*  external dependencies (application)  */
import MQTT                                   from "mqtt"

/*  internal dependencies  */
import Mosquitto                              from "./mqtt-plus-0-mosquitto"
import MQTTp                                  from "mqtt-plus"
import type { Event, Service, Source, Sink }  from "mqtt-plus"

/*  example API  */
export type API = {
    "example/server/connection":       Event<(state: "open" | "close") => void>
    "example/server/sample":           Event<(a1: string, a2: number) => void>
    "example/server/hello":            Service<(a1: string, a2: number) => string>
    "example/server/upload":           Sink<(name: string) => void>
    "example/server/download":         Source<(filename: string) => void>
    "example/server/download-invalid": Source<(filename: string) => void>
    "example/server/login":            Service<(password: string) => Promise<string>>
}

/*  shared test context  */
export const ctx = {} as {
    mqttC: MQTT.MqttClient
    mqttS: MQTT.MqttClient
    apiC:  MQTTp<API>
    apiS:  MQTTp<API>
}

/*  shared log buffer  */
export const logs: string[] = []

/*  Mosquitto instance (module-private)  */
let mosquitto: Mosquitto
let testsFailed = 0

/*  Mocha root hooks  */
export const mochaHooks = {
    /*  actions before all test cases  */
    async beforeAll (this: Mocha.Context) {
        /*  start Mosquitto  */
        this.timeout(8000)
        mosquitto = new Mosquitto()
        await mosquitto.start()

        /*  connect with MQTT as client  */
        ctx.mqttC = MQTT.connect("mqtt://127.0.0.1:1883",
            { clientId: "client" })
        ctx.apiC = new MQTTp<API>(ctx.mqttC, { id: "client", timeout: 500 })
        await new Promise<void>((resolve, reject) => {
            ctx.mqttC.once("connect", ()           => { resolve() })
            ctx.mqttC.once("error",   (err: Error) => { reject(err) })
        })
        ctx.apiC.on("log", async (entry) => {
            await entry.resolve()
            logs.push(`client: ${entry}`)
        })

        /*  connect with MQTT as server  */
        ctx.mqttS = MQTT.connect("mqtt://127.0.0.1:1883",
            { clientId: "server", username: "example", password: "example" })
        ctx.apiS = new MQTTp<API>(ctx.mqttS, { id: "server", timeout: 500 })
        await new Promise<void>((resolve, reject) => {
            ctx.mqttS.once("connect", ()           => { resolve() })
            ctx.mqttS.once("error",   (err: Error) => { reject(err) })
        })
        ctx.apiS.on("log", async (entry) => {
            await entry.resolve()
            logs.push(`server: ${entry}`)
        })
    },

    /*  actions after each test case  */
    afterEach (this: Mocha.Context) {
        if (this.currentTest?.state === "failed")
            testsFailed++
    },

    /*  actions after all test cases  */
    async afterAll (this: Mocha.Context) {
        /*  destroy API instances  */
        ctx.apiC.destroy()
        ctx.apiS.destroy()

        /*  disconnect from MQTT  */
        await ctx.mqttC.endAsync()
        await ctx.mqttS.endAsync()

        /*  stop Mosquitto  */
        this.timeout(4000)
        await mosquitto.stop()

        /*  in case of any failed tests, show the Mosquitto logs  */
        if (testsFailed > 0) {
            logs.forEach((entry) => console.log(entry))
            console.log(mosquitto.logs())
        }
    }
}

