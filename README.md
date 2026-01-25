
<img src="https://raw.githubusercontent.com/rse/mqtt-plus/master/etc/logo.svg" width="400" align="right" alt=""/>

MQTT+
=====

[MQTT](http://mqtt.org/) Communication Patterns

<p/>
<img src="https://nodei.co/npm/mqtt-plus.png?downloads=true&stars=true" alt=""/>

[![github (author stars)](https://img.shields.io/github/stars/rse?logo=github&label=author%20stars&color=%233377aa)](https://github.com/rse)
[![github (author followers)](https://img.shields.io/github/followers/rse?label=author%20followers&logo=github&color=%234477aa)](https://github.com/rse)

Installation
------------

```shell
$ npm install mqtt mqtt-plus
```

About
-----

This is **MQTT+**, a companion addon API for the excellent
[MQTT](http://mqtt.org/) client TypeScript/JavaScript API
[MQTT.js](https://www.npmjs.com/package/mqtt), providing additional
communication patterns with type safety:

- **Event Emission**:

  Event Emission is a *uni-directional* communication pattern.
  An Event is the combination of an event name and optionally zero or more arguments.
  You *subscribe* to events.
  When an event is *emitted*, either a single particular subscriber (in case of
  a directed event emission) or all subscribers are called and receive the
  arguments as extra information.

  In contrast to the regular MQTT message publish/subscribe, this
  pattern allows to direct the event to particular subscribers and
  provides optional information about the sender and receiver to subscribers.

  ![Event Emission](doc/mqtt-plus-1-event-emission.svg)

- **Service Call**:

  Service Call is a *bi-directional* communication pattern.
  A Service is the combination of a service name and optionally zero or more arguments.
  You *register* for a service.
  When a service is *called*, a single particular registrant (in case
  of a directed service call) or one arbitrary registrant is called and
  receives the arguments as the request. The registrant then has to
  provide the service response.

  In contrast to the regular uni-directional MQTT message
  publish/subscribe communication, this allows a bi-directional [Remote
  Procedure Call](https://en.wikipedia.org/wiki/Remote_procedure_call)
  (RPC) style communication.

  ![Service Call](doc/mqtt-plus-2-service-call.svg)

- **Resource Transfer**:

  Resource Transfer is a *bi-directional* communication pattern.
  A Resource is the combination of a resource name and optionally zero or more arguments.
  You *provision* for a resource transfer.
  When a resource is *fetched*, a single particular provisioner (in case
  of a directed resource transfer) or one arbitrary provisioner is called and
  sends the resource and its arguments.
  When a resource is *pushed*, the provisioner receives the resource data
  as a stream with arguments.

  In contrast to the regular MQTT message publish/subscribe, this
  pattern allows to transfer arbitrary amounts of arbitrary data by
  chunking the data via a stream. Additionally, it supports optional
  metadata transfer alongside the resource data.

  ![Resource Transfer](doc/mqtt-plus-3-resource-transfer.svg)

Usage
-----

### API:

The API type defines the available endpoints. Use the marker types
`Event<T>`, `Service<T>`, and `Resource<T>` to declare the communication
pattern of each endpoint:

```ts
import type { Event, Service, Resource } from "mqtt-plus"

export type API = {
    "example/sample":   Event<(a1: string, a2: number) => void>
    "example/hello":    Service<(a1: string, a2: number) => string>
    "example/resource": Resource<(filename: string) => void>
}
```

The marker types ensure that `subscribe()` and `emit()` only accept
`Event<T>` endpoints, `register()` and `call()` only accept
`Service<T>` endpoints, and `provision()`, `fetch()` and `push()` only
accept `Resource<T>` endpoints.

### Server:

```ts
import MQTT         from "mqtt"
import MQTTp        from "mqtt-plus"
import type { API } from [...]

const mqtt  = MQTT.connect("wss://127.0.0.1:8883", { [...] })
const mqttp = new MQTTp<API>(mqtt)

mqtt.on("connect", async () => {
    await mqttp.subscribe("example/sample", (a1, a2, info) => {
        console.log("example/sample: SERVER:", a1, a2, info.sender)
    })
    await mqttp.register("example/hello", (a1, a2, info) => {
        console.log("example/hello: SERVER:", a1, a2, info.sender)
        return `${a1}:${a2}`
    })
    await mqttp.provision("example/resource", async (filename, info) => {
        console.log("example/resource: SERVER:", filename, info.sender)
        info.buffer = Promise.resolve(new TextEncoder().encode(`the ${filename} content`))
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

    const response = await mqttp.call("example/hello", "world", 42)
    console.log("example/hello CLIENT:", response)

    const result = await mqttp.fetch("example/resource", "foo")
    const data = new TextDecoder().decode(await result.buffer)
    console.log("example/resource CLIENT:", data)

    mqtt.end()
})
```

Application Programming Interface
---------------------------------

The **MQTT+** API provides the following methods:

- **Construction**:<br/>

      /*  (simplified TypeScript API method signature)  */
      constructor<API extends Record<string,
          Event<   (...args: any[]) => void | Promise<void>> |
          Service< (...args: any[]) => any  | Promise<any> > |
          Resource<(...args: any[]) => void | Promise<void>>
      >>(
          mqtt: MqttClient | null,
          options?: {
              id:         string
              codec:      "cbor" | "json"
              timeout:    number
              chunkSize:  number
              topicMake:  (name: string, operation: string, peerId?: string) => string
              topicMatch: (topic: string) => { name: string, operation: string, peerId?: string } | null
          }
      )

  The `API` is an optional TypeScript type,
  describing the available events, services and resources.
  The `mqtt` is the [MQTT.js](https://www.npmjs.com/package/mqtt) instance,
  which has to be established separately. A `null` MQTT instance can be
  used for performing dry-runs (see *Dry-Run Publishing for MQTT Last-Will* under
  **Event Emission** below).

  The optional `options` object supports the following fields:
  - `id`: Custom MQTT peer identifier (default: auto-generated NanoID).
  - `codec`: Encoding format, either `cbor` or `json` (default: `cbor`).
  - `timeout`: Communication timeout in milliseconds (default: `10000`).
  - `chunkSize`: Chunk size in bytes for resource transfers (default: `16384`).
  - `topicMake`: Custom topic generation function.
    The `operation` parameter is one of: `event-emission`, `service-call-request`, `service-call-response`, `resource-transfer-request`, `resource-transfer-response`.
    (default: `` (name, operation, peerId) => `${name}/${protocol}/${peerId ?? "any"}` ``)
  - `topicMatch`: Custom topic matching function.
    Returns `{ name, operation, peerId? }` or `null` if no match.
    The `peerId` is `undefined` for broadcast topics (ending with `/any`).
    (default: `` (topic) => { const m = topic.match(/^(.+)\/([^/]+)\/([^/]+)$/); return m ? { name: m[1], operation: m[2], peerId: m[3] === "any" ? undefined : m[3] } : null } ``)

- **Destruction**:<br/>

      destroy(): void

  Clean up the MQTT+ instance by removing all event listeners.
  Call this method when the instance is no longer needed.

- **Event Subscription**:<br/>

      /*  (simplified TypeScript API method signature)  */
      subscribe(
          event:    string,
          options?: MQTT::IClientSubscribeOptions
          callback: (
              ...params: any[],
              info: { sender: string, receiver?: string }
          ) => void | Promise<void>
      ): Promise<Subscription>

  Subscribe to an event.
  The `event` has to be a valid MQTT topic name.
  The optional `options` allows setting MQTT.js `subscribe()` options like `qos`.
  The `callback` is called with the `params` passed to a remote `emit()`.
  There is no return value of `callback`.

  Internally, on the MQTT broker, the topics generated by
  `topicMake(event, "event-emission")` (default: `${event}/event-emission/any` and
  `${event}/event-emission/${peerId}`) are subscribed. Returns a
  `Subscription` object with an `unsubscribe()` method.

- **Service Registration**:<br/>

      /*  (simplified TypeScript API method signature)  */
      register(
          service:  string,
          options?: MQTT::IClientSubscribeOptions
          callback: (
              ...params: any[],
              info: { sender: string, receiver?: string }
          ) => any | Promise<any>
      ): Promise<Registration>

  Register a service.
  The `service` has to be a valid MQTT topic name.
  The optional `options` allows setting MQTT.js `subscribe()` options like `qos`.
  The `callback` is called with the `params` passed to a remote `call()`.
  The return value of `callback` will resolve the `Promise` returned by the remote `call()`.

  Internally, on the MQTT broker, the topics generated by
  `topicMake(service, "service-call-request")` (default: `${service}/service-call-request/any` and
  `${service}/service-call-request/${peerId}`) are subscribed. Returns a
  `Registration` object with an `unregister()` method.

- **Resource Provisioning**:<br/>

      /*  (simplified TypeScript API method signature)  */
      provision(
          resource: string,
          options?: MQTT::IClientSubscribeOptions
          callback: (
              ...params: any[],
              info: {
                  sender: string,
                  receiver?: string,
                  meta?: Record<string, any>,
                  stream?: Readable,
                  buffer?: Promise<Buffer>
              }
          ) => void | Promise<void>
      ): Promise<Provisioning>

  Provision a resource for both fetch requests and pushed data.
  The `resource` has to be a valid MQTT topic name.
  The optional `options` allows setting MQTT.js `subscribe()` options like `qos`.

  For **fetch requests**: The `callback` is called with the `params` passed to a remote `fetch()`.
  The `callback` should set `info.stream` to a `Readable` or `info.buffer` to a `Promise<Buffer>` containing the resource data.
  Optionally, the `callback` can set `info.meta` to a `Record<string, any>` to send metadata back with the response.

  For **pushed data**: The `callback` is called with the `params` passed to a remote `push()`.
  The `info.stream` provides a Node.js `Readable` stream for consuming the pushed data.
  The `info.buffer` provides a lazy `Promise<Buffer>` that resolves to the complete data once the stream ends.
  The `info.meta` contains optional metadata sent by the pusher via `push()`.

  Internally, on the MQTT broker, the topics by
  `topicMake(resource, "resource-transfer-request")` and `topicMake(resource, "resource-transfer-response")`
  (default: `${resource}/resource-transfer-request/any`, `${resource}/resource-transfer-request/${peerId}`,
  `${resource}/resource-transfer-response/any`, and `${resource}/resource-transfer-response/${peerId}`)
  are subscribed. Returns a `Provisioning` object with an `unprovision()` method.

- **Event Emission**:<br/>

      /*  (simplified TypeScript API method signature)  */
      emit(
          event:     string,
          ...params: any[]
      ): void
      emit({
          event:     string,
          params:    any[],
          receiver?: string,
          options?:  MQTT::IClientSubscribeOptions
      }): void
      emit({
          event:     string,
          params:    any[],
          receiver?: string,
          options?:  MQTT::IClientSubscribeOptions,
          dry:       true
      }): { topic: string, payload: Buffer, options: IClientPublishOptions }

  Emit an event to all subscribers or a specific subscriber ("fire and forget").
  The optional `receiver` directs the event to a specific subscriber only.
  The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.
  The optional `dry` flag, when set to `true`, returns the publish information
  (`topic`, `payload`, `options`) instead of actually publishing to the MQTT broker.
  This is useful for generating MQTT "last will" messages (see example below).

  The remote `subscribe()` `callback` is called with `params` and its
  return value is silently ignored.

  Internally, publishes to the MQTT topic by `topicMake(event, "event-emission", peerId)`
  (default: `${event}/event-emission/any` or `${event}/event-emission/${peerId}`).

  *Dry-Run Publishing for MQTT Last-Will:*
  When you need to set up an MQTT "last will" message (automatically published
  by the broker when a client disconnects *unexpectedly*), you can use `dry: true`
  together with a `null` MQTT client:

      type API = {
          "example/connection": Event<(state: "open" | "close") => void>
          [...]
      }
      const mqttpDry = new MQTTp<API>(null, { id: "my-client" })
      const will = mqttpDry.emit({
          dry:    true,
          event:  "example/connection",
          params: [ "close" ],
          [...]
      })
      mqttpDry.destroy()
      const mqtt = MQTT.connect("[...]", {
          will: {
              topic:   will.topic,
              payload: will.payload,
              qos:     will.options.qos
          },
          [...]
      })

- **Service Call**:<br/>

      /*  (simplified TypeScript API method signature)  */
      call(
          service:   string,
          ...params: any[]
      ): Promise<any>
      call({
          service:   string,
          params:    any[],
          receiver?: string,
          options?:  MQTT::IClientPublishOptions
      }): Promise<any>

  Call a service on all registrants or on a specific registrant ("request and response").
  The optional `receiver` directs the call to a specific registrant only.
  The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.

  The remote `register()` `callback` is called with `params` and its
  return value resolves the returned `Promise`. If the remote `callback`
  throws an exception, this rejects the returned `Promise`.

  Internally, on the MQTT broker, the topic by `topicMake(service, "service-call-response", peerId)`
  (default: `${service}/service-call-response/${peerId}`) is temporarily subscribed
  for receiving the response.

- **Resource Fetch**:<br/>

      /*  (simplified TypeScript API method signature)  */
      fetch(
          resource:  string,
          ...params: any[]
      ): Promise<{
          stream:    Readable,
          buffer:    Promise<Buffer>,
          meta:      Promise<Record<string, any> | undefined>
      }>
      fetch({
          resource:  string,
          params:    any[],
          receiver?: string,
          options?:  MQTT::IClientSubscribeOptions
      }): Promise<{
          stream:    Readable,
          buffer:    Promise<Buffer>,
          meta:      Promise<Record<string, any> | undefined>
      }>

  Fetches a resource from any resource provisioner or from a specific provisioner.
  The optional `receiver` directs the call to a specific provisioner only.
  The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.

  Returns an object with a `stream` (`Readable`) for consuming the transferred data,
  a lazy `buffer` (`Promise<Buffer>`) that resolves to the complete data once the stream ends,
  and a `meta` (`Promise<Record<string, any> | undefined>`) that resolves to optional metadata
  sent by the provisioner when the first chunk arrives.

  The remote `provision()` `callback` is called with `params` and
  should set `info.stream` to a `Readable` or `info.buffer` to a `Promise<Buffer>` containing the resource data.
  Optionally, the `callback` can set `info.meta` to send metadata back with the response.
  If the remote `callback` throws an exception, this destroys the stream with the error.

  Internally, on the MQTT broker, the topic by
  `topicMake(resource, "resource-transfer-response", peerId)` (default:
  `${resource}/resource-transfer-response/${peerId}`) is temporarily subscribed
  for receiving the response.

- **Resource Push**:<br/>

      /*  (simplified TypeScript API method signature)  */
      push(
          resource:       string,
          streamOrBuffer: Readable | Buffer,
          ...params:      any[]
      ): Promise<void>
      push({
          resource:       string,
          streamOrBuffer: Readable | Buffer,
          params:         any[]
          meta?:          Record<string, any>,
          receiver?:      string,
          options?:       MQTT::IClientPublishOptions
      }): Promise<void>

  Pushes a resource to all provisioners or a specific provisioner.
  The `streamOrBuffer` is either a Node.js `Readable` stream or a `Buffer` providing the data to push.
  The optional `meta` sends metadata alongside the resource data,
  which becomes available on the provisioner side via `info.meta`.
  The optional `receiver` directs the push to a specific provisioner only.
  The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.

  The data is read from `streamOrBuffer` in chunks (default: 16KB,
  configurable via `chunkSize` option) and sent over MQTT until the
  stream is closed or the buffer is fully transferred.
  The returned `Promise` resolves when the entire data has been pushed.

  The remote `provision()` `callback` is called with `params` and an `info` object
  containing `stream` (`Readable`) for consuming the pushed data,
  `buffer` (lazy `Promise<Buffer>`) that resolves to the complete data once the stream ends,
  and `meta` (`Record<string, any> | undefined`) containing the metadata sent by the pusher.

  Internally, publishes to the MQTT topic by `topicMake(resource, "resource-transfer-response", peerId)`
  (default: `${resource}/resource-transfer-response/any` or `${resource}/resource-transfer-response/${peerId}`).

Internals
---------

In the following, we assume that an **MQTT+** instance is created with:

```ts
import MQTT  from "mqtt"
import MQTTp from "mqtt-plus"

export type API = {
    "example/sample": Event<(a1: string, a2: number) => void>
    ...
}
const mqtt  = MQTT.connect("...", { ... })
const mqttp = new MQTTp<API>(mqtt, { codec: "json" })
```

Internally, remote services are assigned to MQTT topics. When calling a
remote service named `example/hello` with parameters `"world"` and `42` via...

```ts
mqttp.call("example/hello", "world", 42).then((result) => {
    ...
})
```

...the following message is sent to the permanent MQTT topic
`example/hello/service-call-request/any` (the shown NanoIDs are just
pseudo ones):

```json
{
    "type":    "service-call-request",
    "id":      "vwLzfQDu2uEeOdOfIlT42",
    "service": "example/hello",
    "params":  [ "world", 42 ],
    "sender":  "2IBMSk0NPnrz1AeTERoea"
}
```

Beforehand, this `example/hello` service should have been registered with...

```ts
mqttp.register("example/hello", (a1, a2) => {
    return `${a1}:${a2}`
})
```

...and then its result, in the above `mqttp.call()` example `"world:42"`, is then
sent back as the following success response
message to the temporary (client-specific) MQTT topic
`example/hello/service-call-response/2IBMSk0NPnrz1AeTERoea`:

```json
{
    "type":     "service-call-response",
    "id":       "vwLzfQDu2uEeOdOfIlT42",
    "result":   "world:42",
    "sender":   "2IBMSk0NPnrz1AeTERoea",
    "receiver": "2IBMSk0NPnrz1AeTERoea"
}
```

The `sender` field is the NanoID of the MQTT+ sender instance and
`id` is the NanoID of the particular service request. The `sender` is
used for sending back the response message to the requestor only. The
`id` is used for correlating the response to the request only.

Example
-------

You can test-drive MQTT+, in a temporary MQTT broker environment,
with a complete [sample](sample/sample.ts) to see it in action and
tracing its communication:

```ts
import Mosquitto                         from "mosquitto"
import MQTT                              from "mqtt"
import MQTTp                             from "mqtt-plus"
import type { Event, Service, Resource } from "mqtt-plus"

const mosquitto = new Mosquitto()
await mosquitto.start()
await new Promise((resolve) => { setTimeout(resolve, 500) })

const mqtt = MQTT.connect("mqtt://127.0.0.1:1883", {
    username: "example",
    password: "example"
})

type API = {
    "example/sample":   Event<(a1: string, a2: number) => void>
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

    /*  event emission example  */
    const sub = await mqttp.subscribe("example/sample", (a1, a2, info) => {
        console.log("example/sample: received:", a1, a2, "from:", info.sender)
    })
    mqttp.emit("example/sample", "world", 42)
    await new Promise((resolve) => { setTimeout(resolve, 100) })
    await sub.unsubscribe()

    /*  service call example  */
    const reg = await mqttp.register("example/hello", (a1, a2, info) => {
        console.log("example/hello: request:", a1, a2, "from:", info.sender)
        return `${a1}:${a2}`
    })
    const result = await mqttp.call("example/hello", "world", 42)
    console.log("example/hello: success:", result)
    await reg.unregister()

    /*  resource fetch example  */
    const prov = await mqttp.provision("example/resource", async (filename, info) => {
        console.log("example/resource: request:", filename, "from:", info.sender)
        const data = `the ${filename} content`
        info.buffer = Promise.resolve(new TextEncoder().encode(data))
    })
    const res = await mqttp.fetch("example/resource", "foo")
    const data = new TextDecoder().decode(await res.buffer)
    console.log("example/resource: result:", data)
    await prov.unprovision()

    mqtt.end()
    await mosquitto.stop()
})
```

The output will be:

```
$ node sample.ts
CONNECT
RECEIVED example/sample/event-emission/any {"type":"event-emission","id":"...","sender":"...","event":"example/sample","params":["world",42]}
example/sample: received: world 42 from: ...
RECEIVED example/hello/service-call-request/any {"type":"service-call-request","id":"...","sender":"...","service":"example/hello","params":["world",42]}
example/hello: request: world 42 from: ...
RECEIVED example/hello/service-call-response/... {"type":"service-call-response","id":"...","sender":"...","receiver":"...","result":"world:42"}
example/hello: success: world:42
RECEIVED example/resource/resource-transfer-request/any {"type":"resource-transfer-request","id":"...","sender":"...","resource":"example/resource","params":["foo"]}
example/resource: request: foo from: ...
RECEIVED example/resource/resource-transfer-response/... {"type":"resource-transfer-response","id":"...","sender":"...","receiver":"...","chunk":...,"final":true}
example/resource: result: the foo content
CLOSE
```

Broker Setup
------------

For establishing your own permanent MQTT environment, install the
[Mosquitto](https://mosquitto.org/) MQTT broker yourself and a setup
a `mosquitto.conf` file like...

```
[...]

password_file        mosquitto-pwd.txt
acl_file             mosquitto-acl.txt

[...]

#   additional listener
listener             1883 127.0.0.1
max_connections      -1
protocol             mqtt

[...]
```

...and an access control list in `mosquitto-acl.txt` like...

```
#   shared ACL
topic   read      $SYS/#
pattern write     $SYS/broker/connection/%c/state
pattern readwrite %u/#

#   anonymous ACL
topic   read      event/+
pattern read      event/+/%c
topic   write     event/+/+
pattern read      service/+/%c
topic   write     service/+
topic   write     service/+/+

#   user ACL
user    example
topic   read      event/+
pattern read      event/+/%c
topic   write     event/+
topic   write     event/+/+
topic   read      service/+
pattern read      service/+/%c
topic   write     service/+
topic   write     service/+/+
```

...and an `example` user (with password `example`) in `mosquitto-pwd.txt` like:

```
example:$6$awYNe6oCAi+xlvo5$mWIUqyy4I0O3nJ99lP1mkRVqsDGymF8en5NChQQxf7KrVJLUp1SzrrVDe94wWWJa3JGIbOXD9wfFGZdi948e6A==
```

Notice
------

> [!Note]
> **MQTT+** is somewhat similar to and originally derived from
> [MQTT-JSON-RPC](https://github.com/rse/mqtt-json-rpc) of the same
> author, but instead of just JSON, MQTT+ encodes packets as JSON
> or CBOR (default), uses an own packet format (allowing sender and
> receiver information), uses shorter NanoIDs instead of longer UUIDs
> for identification of sender, receiver and requests, and additionally
> provides resource transfer support (with fetch and push capabilities).

License
-------

Copyright (c) 2018-2026 Dr. Ralf S. Engelschall (http://engelschall.com/)

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

