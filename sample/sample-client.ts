
import MQTT         from "mqtt"
import MQTTp        from "mqtt-plus"
import type { API } from "./sample-common"

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

    /*  emit an event (fire and forget)  */
    mqttp.emit("example/sample", "world", 42)

    /*  call a service (request and response)  */
    mqttp.call("example/hello", "world", 42).then((result) => {
        console.log("example/hello success: ", result)
    }).catch((err) => {
        console.log("example/hello error: ", err)
    })

    /*  fetch a resource (chunked content)  */
    mqttp.fetch("example/download", "foo").then(async ({ buffer, meta }) => {
        const data = await buffer
        const info = await meta
        console.log("example/download success: ", new TextDecoder().decode(data), info)
    }).catch((err) => {
        console.log("example/download error: ", err)
    })

    /*  push data to a sink (chunked content)  */
    const payload = new TextEncoder().encode("example upload data")
    mqttp.push("example/upload", payload, "test.txt").then(() => {
        console.log("example/upload success")
    }).catch((err) => {
        console.log("example/upload error: ", err)
    })
})

