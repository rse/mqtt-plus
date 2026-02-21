
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
    "name":    "example/hello",
    "params":  [ "world", 42 ],
    "sender":  "2IBMSk0NPnrz1AeTERoea"
}
```

Beforehand, this `example/hello` service should have been established with...

```ts
mqttp.service("example/hello", (a1, a2) => {
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
    "sender":   "7kPQm3xRtYnJw8FvUqE5b",
    "receiver": "2IBMSk0NPnrz1AeTERoea"
}
```

The `sender` field is the NanoID of the MQTT+ sender instance and
`id` is the NanoID of the particular service request. The `sender` is
used for sending back the response message to the requestor only. The
`id` is used for correlating the response to the request only.
