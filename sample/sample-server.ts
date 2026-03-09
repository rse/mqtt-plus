
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

    /*  register to an event (fire and forget)  */
    mqttp.event("example/sample", (a1, a2, info) => {
        console.log("example/sample: event: ", a1, a2, info)
    })

    /*  provide a service (request and response)  */
    mqttp.service("example/hello", (a1, a2, info) => {
        console.log("example/hello: request: ", a1, a2, info)
        return `${a1}:${a2}`
    })

    /*  establish a source for fetch (chunked content)  */
    mqttp.source("example/download", (a1, info) => {
        console.log("example/download: request: ", a1, info)
        info.buffer = Promise.resolve(new TextEncoder().encode(`data-for-${a1}`))
        info.meta = { type: "text/plain" }
    })

    /*  establish a sink for push (chunked content)  */
    mqttp.sink("example/upload", async (a1, info) => {
        console.log("example/upload: request: ", a1, info)
        const data = await info.buffer
        console.log("example/upload: received: ", new TextDecoder().decode(data))
    })
})

