
<img src="https://raw.githubusercontent.com/rse/mqtt-plus/master/etc/logo.svg" width="400" align="right" alt=""/>

MQTT+
=====

[MQTT](http://mqtt.org/) [Communication Patterns](doc/mqtt-plus-comm.md)

[![NPM](https://nodei.co/npm/mqtt-plus.svg?downloads=true&stars=true)](https://nodei.co/npm/mqtt-plus/)

[![github (author stars)](https://img.shields.io/github/stars/rse?logo=github&label=author%20stars&color=%233377aa)](https://github.com/rse)
[![github (author followers)](https://img.shields.io/github/followers/rse?label=author%20followers&logo=github&color=%234477aa)](https://github.com/rse)

About
-----

**MQTT+** is a companion add-on API for the TypeScript/JavaScript
API [MQTT.js](https://www.npmjs.com/package/mqtt), designed to
extend [MQTT](http://mqtt.org/) with higher-level
[communication patterns](doc/mqtt-plus-comm.md) while preserving full type safety.
It provides four core communication patterns: fire-and-forget *Event
Emission*, RPC-style *Service Call*, stream-based *Sink Push*, and
stream-based *Source Fetch*.
These patterns enable structured,
bi-directional client/server and server/server communication
on top of [MQTT](http://mqtt.org/)’s inherently uni-directional publish/subscribe model.
Internally, the communication is based on the exchange of typed [CBOR](https://www.rfc-editor.org/rfc/rfc8949.html)
or [JSON](https://ecma-international.org/publications-and-standards/standards/ecma-404/) messages.

The result is a more expressive and maintainable messaging layer
without sacrificing [MQTT](http://mqtt.org/)’s excellent robustness and
scalability.
**MQTT+** is particularly well-suited for systems built around a
[*Hub & Spoke*](https://en.wikipedia.org/wiki/Spoke%E2%80%93hub_distribution_paradigm)
communication architecture, where typed API contracts and controlled interaction flows are
critical for reliability and long-term maintainability.

Installation
------------

**MQTT+** is published as a Node Package Manager (NPM) package named
[`mqtt-plus`](https://npmjs.com/mqtt-plus).
Install it, together with its peer dependency MQTT.js, with
the help of the NPM Command-Line Interface (CLI):

```shell
$ npm install mqtt mqtt-plus
```

Usage
-----

The following is a simple but self-contained example usage of
**MQTT+** based on a common API, a server part, a client part,
and an MQTT infrastructure. It can be found in the file
[sample.ts](sample/sample.ts) and can be executed from the **MQTT+**
source tree via `npm start sample` (assuming the prerequisite *Docker* is
available for the underlying *Mosquitto* broker based infrastructure):

```ts
import { Readable }                          from "node:stream"
import chalk                                 from "chalk"
import Mosquitto                             from "mosquitto"
import MQTT                                  from "mqtt"
import MQTTp                                 from "mqtt-plus"
import type { Event, Service, Source, Sink } from "mqtt-plus"
```

```ts
/*  ==== SAMPLE COMMON API ====  */
type API = {
    "example/sample":   Event<(a1: string, a2: number) => void>
    "example/hello":    Service<(a1: string, a2: number) => string>
    "example/download": Source<(filename: string) => void>
    "example/upload":   Sink<(filename: string) => void>
}
```

```ts
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
        info.stream = readable
    })
    await api.sink("example/upload", async (filename, info) => {
        log("example/upload: SERVER:", filename)
        const chunks: Uint8Array[] = []
        info.stream.on("data", (chunk: Uint8Array) => { chunks.push(chunk) })
        await new Promise<void>((resolve) => { info.stream.once("end", resolve) })
        const total = chunks.reduce((n, c) => n + c.length, 0)
        log("received", total, "bytes")
    })
}
```

```ts
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
```

```ts
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
```

Documentation
-------------

Main documentation:

- [**Communication Patterns**](doc/mqtt-plus-comm.md)
- [**Application Programming Interface (API)**](doc/mqtt-plus-api.md)

Additional auxilliary documentation:

- [Extra: Architecture Overview](doc/mqtt-plus-architecture.md)
- [Extra: Internal Protocol](doc/mqtt-plus-internals.md)
- [Extra: Broker Setup](doc/mqtt-plus-broker-setup.md)

Notice
------

> [!Note]
> **MQTT+** and its peer dependency **MQTT.js** provide a powerful
> functionality, but are not small in size. **MQTT+** is 3.900 LoC
> and 75 KB in size (ESM and CJS format). When bundled with all its
> dependencies, it is 220 KB in size (UMD format). Its peer dependency
> **MQTT.js** is 370 KB (ESM and CJS format) and 860 KB (UMD format) in
> size. For a Node.js application, this usually doesn't matter. For a
> HTML5 SPA it matters more, but usually is still acceptable.

> [!Note]
> **MQTT+** is still somewhat similar to and originally derived from the weaker
> [MQTT-JSON-RPC](https://github.com/rse/mqtt-json-rpc) library of the same
> author. But instead of just JSON, MQTT+ encodes packets as JSON
> or CBOR (default), uses an own packet format (allowing sender and
> receiver information), uses shorter NanoIDs instead of longer UUIDs
> for identification of sender, receiver and requests, and additionally
> provides source/sink transfer support (with fetch and push capabilities),
> has an authentication mechanism, supports meta-data passing, and many more.

License
-------

Copyright &copy; 2018-2026 Dr. Ralf S. Engelschall (http://engelschall.com/)

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included
in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

