
import { Readable }                          from "node:stream"
import chalk                                 from "chalk"
import Mosquitto                             from "mosquitto"
import MQTT                                  from "mqtt"
import MQTTp                                 from "mqtt-plus"
import type { Event, Service, Source, Sink } from "mqtt-plus"

/*  ==== SAMPLE COMMON API ====  */
type API = {
    "example/sample":   Event<(a1: string, a2: number) => void>
    "example/hello":    Service<(a1: string, a2: number) => string>
    "example/download": Source<(filename: string) => void>
    "example/upload":   Sink<(filename: string) => void>
}

/*  ==== SAMPLE SERVER ====  */
const Server = async (api: MQTTp<API>, log: (msg: string, ...args: any[]) => void) => {
    await api.event("example/sample", (a1, a2) => {
        log("example/sample: SERVER:", a1, a2)
    })
    await api.service("example/hello", (a1, a2) => {
        log("example/hello: SERVER:", a1, a2)
        return `${a1}:${a2}`
    })
    await api.source("example/download", async (filename, info) => {
        log("example/download: SERVER:", filename)
        const input = new Readable()
        input.push(api.str2buf(`the ${filename} content`))
        input.push(null)
        info.stream = input
    })
    await api.sink("example/upload", async (filename, info) => {
        log("example/upload: SERVER:", filename)
        const chunks: Uint8Array[] = []
        info.stream!.on("data", (chunk: Uint8Array) => { chunks.push(chunk) })
        await new Promise<void>((resolve) => { info.stream!.once("end", resolve) })
        const total = chunks.reduce((n, c) => n + c.length, 0)
        log("received", total, "bytes")
    })
}

/*  ==== SAMPLE CLIENT ====  */
const Client = async (api: MQTTp<API>, log: (msg: string, ...args: any[]) => void) => {
    api.emit("example/sample", "world", 42)

    const callOutput = await api.call("example/hello", "world", 42)
    log("example/hello: CLIENT:", callOutput)

    const output = await api.fetch("example/download", "foo")
    const chunks: Uint8Array[] = []
    output.stream.on("data", (chunk: Uint8Array) => { chunks.push(chunk) })
    await new Promise<void>((resolve) => { output.stream.on("end", resolve) })
    const data = api.buf2str(Buffer.concat(chunks))
    log("example/download: CLIENT:", data)

    const input = new Readable()
    input.push(api.str2buf("uploaded content"))
    input.push(null)
    await api.push("example/upload", input, "myfile.txt")
}

/*  ==== SAMPLE INFRASTRUCTURE ====  */
process.on("uncaughtException", (err: Error): void => {
    console.error(chalk.red(`ERROR: ${err.stack ?? err.message}`))
    console.log(chalk.yellow(mosquitto.logs()))
    process.exit(1)
})
const mosquitto = new Mosquitto({
    listen: [ { protocol: "mqtt", address: "127.0.0.1", port: 1883 } ]
})
await mosquitto.start()
const mqtt = MQTT.connect("mqtt://127.0.0.1:1883", {
    username: "example", password: "example"
})
const api = new MQTTp<API>(mqtt)
api.on("log", async (entry) => {
    await entry.resolve()
    console.log(chalk.grey(`api: ${entry}`))
})
const log = (msg: string, ...args: any[]) => {
    console.log(chalk.bold.blue("app:"), chalk.blue(msg), chalk.red(JSON.stringify(args)))
}
mqtt.on("connect", async () => {
    await Server(api, log)
    await Client(api, log)
    await api.destroy()
    await mqtt.endAsync()
    await mosquitto.stop()
})

