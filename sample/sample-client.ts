
import MQTT         from "mqtt"
import MQTTp        from "mqtt-plus"
import type { API } from "./sample-common"

const mqtt = MQTT.connect("ws://127.0.0.1:8443", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

const mqttp = new MQTTp<API>(mqtt, { codec: "json" })

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
    mqttp.fetch("example/data", "foo").then(async ({ buffer, meta }) => {
        const data = await buffer
        const info = await meta
        console.log("example/data success: ", data.toString(), info)
    }).catch((err) => {
        console.log("example/data error: ", err)
    })
})

