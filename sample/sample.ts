
import fs               from "node:fs"
import Mosquitto        from "mosquitto"
import MQTT             from "mqtt"
import MQTTp            from "mqtt-plus"
import type { Event,
    Service,
    Resource }          from "mqtt-plus"

const mosquitto = new Mosquitto({
    listen: [ { protocol: "wss", address: "127.0.0.1", port: 8443 } ]
})
await mosquitto.start()
await new Promise((resolve) => { setTimeout(resolve, 500) })

process.on("uncaughtException", (err: Error): void => {
    console.error("ERROR:", err.stack ?? err.message)
    console.log(mosquitto.logs())
    console.log("TERMINATING")
    process.exit(1)
})

const mqtt = MQTT.connect("wss://127.0.0.1:8443", {
    rejectUnauthorized: false,
    username: "example",
    password: "example"
})

type API = {
    "example/sample":   Event<(a1: string, a2: number) => void>
    "example/upload":   Resource<(name: string) => void>
    "example/hello":    Service<(a1: string, a2: number) => string>
    "example/resource": Resource<(filename: string) => void>
}

const mqttp = new MQTTp<API>(mqtt, { codec: "json" })

mqtt.on("error",     (err)            => { console.log("ERROR", err) })
mqtt.on("offline",   ()               => { console.log("OFFLINE") })
mqtt.on("close",     ()               => { console.log("CLOSE") })
mqtt.on("reconnect", ()               => { console.log("RECONNECT") })
mqtt.on("message",   (topic, message) => { console.log("RECEIVED", topic, message.toString()) })

mqtt.on("connect", async () => {
    console.log("CONNECT")

    /*  events  */
    const s = await mqttp.subscribe("example/sample", (a1, a2, info) => {
        console.log("example/sample: received:", a1, a2, "from:", info.sender)
    })
    mqttp.emit("example/sample", "world", 42)
    await new Promise((resolve) => { setTimeout(resolve, 100) })
    await s.unsubscribe()

    /*  streaming  */
    const a = await mqttp.provision("example/upload", (name, info) => {
        if (!info.stream || !info.buffer)
            throw new Error("only uploading supported")
        console.log("example/upload: received:", name, "from:", info.sender)
        const x = fs.createWriteStream("x.txt")
        info.stream.pipe(x)
    })
    const readable = fs.createReadStream("README.md")
    await mqttp.push("example/upload", readable, "filename")
    await new Promise((resolve) => { setTimeout(resolve, 100) })
    await a.unprovision()

    /*  service  */
    const r = await mqttp.register("example/hello", (a1, a2, info) => {
        console.log("example/hello: request:", a1, a2, "from:", info.sender)
        return `${a1}:${a2}`
    })
    await mqttp.call("example/hello", "world", 42).then(async (result) => {
        console.log("example/hello: success:", result)
    }).catch((err) => {
        console.log("example/hello: error:", err)
    })
    await r.unregister()

    /*  resource  */
    const p = await mqttp.provision("example/resource", async (filename, info) => {
        console.log("example/resource: request:", filename, "from:", info.sender)
        info.buffer = Promise.resolve(Buffer.from(`the ${filename} content`))
    })
    const res = await mqttp.fetch("example/resource", "foo")
    const data = await res.buffer
    console.log("example/resource: result:", data.toString())
    await p.unprovision()

    console.log("DISCONNECT")
    mqtt.end()
    await mosquitto.stop()
})

