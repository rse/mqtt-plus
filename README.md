
<img src="https://raw.githubusercontent.com/rse/mqtt-plus/master/etc/logo.svg" width="400" align="right" alt=""/>

MQTT+
=====

[MQTT](http://mqtt.org/) [Communication Patterns](doc/mqtt-plus-comm.md)

<p/>
<img src="https://nodei.co/npm/mqtt-plus.png?downloads=true&stars=true" alt=""/>

[![github (author stars)](https://img.shields.io/github/stars/rse?logo=github&label=author%20stars&color=%233377aa)](https://github.com/rse)
[![github (author followers)](https://img.shields.io/github/followers/rse?label=author%20followers&logo=github&color=%234477aa)](https://github.com/rse)

About
-----

**MQTT+** is a companion add-on API for the TypeScript/JavaScript
API [MQTT.js](https://www.npmjs.com/package/mqtt), designed to
extend [MQTT](http://mqtt.org/) with higher-level
[communication patterns](doc/mqtt-plus-comm.md) while preserving full type-safety.
It provides four core communication patterns: fire-and-forget *Event
Emission*, RPC-style *Service Call*, stream-based *Sink Push*, and
stream-based *Source Fetch*.
These patterns enable structured,
bi-directional client/server and server/server communication
on top of [MQTT](http://mqtt.org/)’s inherently uni-directional publish/subscribe model.

The result is a more expressive and maintainable messaging layer
without sacrificing [MQTT](http://mqtt.org/)’s excellent robustness and
scalability.
**MQTT+** is particularly well suited for systems built around a
[*Hub & Spoke*](https://en.wikipedia.org/wiki/Spoke%E2%80%93hub_distribution_paradigm)
communication architecture, where typed API contracts and controlled interaction flows are
critical for reliability and long-term maintainability.

Installation
------------

```shell
$ npm install mqtt mqtt-plus
```

Usage
-----

### API:

The API type defines the available endpoints. Use the marker types
`Event<T>`, `Service<T>`, `Source<T>`, and `Sink<T>` to declare the
communication pattern of each endpoint:

```ts
import type { Event, Service, Source, Sink } from "mqtt-plus"

export type API = {
    "example/sample":   Event<(a1: string, a2: number) => void>
    "example/hello":    Service<(a1: string, a2: number) => string>
    "example/download": Source<(filename: string) => void>
    "example/upload":   Sink<(filename: string) => void>
}
```

The marker types ensure that `event()` and `emit()` only accept
`Event<T>` endpoints, `service()` and `call()` only accept
`Service<T>` endpoints, `source()` and `fetch()` only
accept `Source<T>` endpoints, and `sink()` and `push()` only
accept `Sink<T>` endpoints.

### Server:

```ts
import MQTT         from "mqtt"
import MQTTp        from "mqtt-plus"
import type { API } from [...]

const mqtt  = MQTT.connect("wss://127.0.0.1:8883", { [...] })
const mqttp = new MQTTp<API>(mqtt)

mqtt.on("connect", async () => {
    await mqttp.event("example/sample", (a1, a2, info) => {
        console.log("example/sample: SERVER:", a1, a2, info.sender)
    })
    await mqttp.service("example/hello", (a1, a2, info) => {
        console.log("example/hello: SERVER:", a1, a2, info.sender)
        return `${a1}:${a2}`
    })
    await mqttp.source("example/download", async (filename, info) => {
        console.log("example/download: SERVER:", filename, info.sender)
        info.buffer = Promise.resolve(mqttp.str2buf(`the ${filename} content`))
    })
    await mqttp.sink("example/upload", async (filename, info) => {
        console.log("example/upload: SERVER:", filename, info.sender)
        const data = await info.buffer
        console.log("received", data.length, "bytes")
    })
})
```

### Client:

```ts
import MQTT         from "mqtt"
import MQTTp        from "mqtt-plus"
import type { API } from [...]

const mqtt = MQTT.connect("wss://127.0.0.1:8883", { [...] })
const mqttp = new MQTTp<API>(mqtt)

mqtt.on("connect", async () => {
    mqttp.emit("example/sample", "world", 42)

    const callOutput = await mqttp.call("example/hello", "world", 42)
    console.log("example/hello: CLIENT:", callOutput)

    const fetchOutput = await mqttp.fetch("example/download", "foo")
    const data = mqttp.buf2str(await fetchOutput.buffer)
    console.log("example/download: CLIENT:", data)

    const pushInput = mqttp.str2buf("uploaded content")
    await mqttp.push("example/upload", pushInput, "myfile.txt")

    mqttp.destroy()
    mqtt.end()
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
> **MQTT+** and its peer dependency **MQTT** provide a powerful
> functionality, but are not small in size. **MQTT+** is 3.500 LoC
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

