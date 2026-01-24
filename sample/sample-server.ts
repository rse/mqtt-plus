
import { Buffer }   from "node:buffer"

import Mosquitto    from "mosquitto"
import MQTT         from "mqtt"
import MQTTp        from "mqtt-plus"

import type { API } from "./sample-common"

const mosquitto = new Mosquitto({
    listen: [ { protocol: "ws", address: "127.0.0.1", port: 8443 } ]
})
await mosquitto.start()
await new Promise((resolve) => { setTimeout(resolve, 500) })

const mqtt = MQTT.connect("ws://127.0.0.1:8443", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

const mqttp = new MQTTp<API>(mqtt, { codec: "cbor" })

mqtt.on("error",     (err)            => { console.log("ERROR", err) })
mqtt.on("offline",   ()               => { console.log("OFFLINE") })
mqtt.on("close",     ()               => { console.log("CLOSE") })
mqtt.on("reconnect", ()               => { console.log("RECONNECT") })
mqtt.on("message",   (topic, message) => { console.log("RECEIVED", topic, message.toString()) })

mqtt.on("connect", () => {
    console.log("CONNECT")

    /*  subscribe to an event (fire and forget)  */
    mqttp.subscribe("example/sample", (a1, a2, info) => {
        console.log("example/sample: event: ", a1, a2, info)
    })

    /*  register a service (request and response)  */
    mqttp.register("example/hello", (a1, a2, info) => {
        console.log("example/hello: request: ", a1, a2, info)
        return `${a1}:${a2}`
    })

    /*  provision a resource (chunked content)  */
    mqttp.provision("example/data", (a1, info) => {
        console.log("example/data: request: ", a1, info)
        info.buffer = Promise.resolve(new TextEncoder().encode(`data-for-${a1}`))
        info.meta = { type: "text/plain" }
    })
})

