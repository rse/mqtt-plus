
MQTT+ Internals
===============

Overview
--------

**MQTT+** implements a message-oriented protocol on top of standard MQTT.
Each MQTT+ instance is identified by a unique **peer ID** (a NanoID).
All messages are encoded as structured objects and transported as MQTT
payloads on well-defined MQTT topics. The protocol supports four
communication patterns: **Event Emission**, **Service Call**, **Sink
Push**, and **Source Fetch**.

Message Encoding
----------------

Messages are encoded using one of two codecs, selected at instance creation:

- **CBOR** (default): Binary encoding via the `cbor2` library.
  `Uint8Array` and `Buffer` values are encoded natively.
  MQTT payloads are `Uint8Array`.

- **JSON**: Text encoding via a custom `JSONX` serializer.
  `Uint8Array` values are encoded as `{ "__Uint8Array": "<base64>" }`.
  MQTT payloads are UTF-8 strings.

Message Base Structure
----------------------

Every MQTT+ message shares a common base structure:

| Field      | Type              | Description                                    |
|------------|-------------------|------------------------------------------------|
| `version`  | `string`          | Protocol version identifier, format `MQTT+/X.X` (e.g. `MQTT+/1.4`). Must match between peers. |
| `type`     | `string`          | One of the 11 message types (see below).       |
| `id`       | `string`          | NanoID correlating requests with their responses. |
| `sender`   | `string?`         | NanoID of the sending peer.                    |
| `receiver` | `string?`         | NanoID of the intended receiving peer.         |

The `version` field is checked on every incoming message. A mismatch
causes the message to be rejected.

Message Types
-------------

The protocol defines 11 message types, grouped by communication pattern:

### Event Emission (1 message type)

| Type               | Direction | Purpose                       |
|--------------------|-----------|-------------------------------|
| `event-emission`   | one-way   | Fire-and-forget event notification |

### Service Call (2 message types)

| Type                     | Direction   | Purpose                  |
|--------------------------|-------------|--------------------------|
| `service-call-request`   | caller -> callee | RPC request with parameters |
| `service-call-response`  | callee -> caller | RPC result or error      |

### Sink Push (4 message types)

| Type                 | Direction        | Purpose                       |
|----------------------|------------------|-------------------------------|
| `sink-push-request`  | pusher -> sink   | Initiate data push            |
| `sink-push-response` | sink -> pusher   | Acknowledge (ack) or reject (nak) |
| `sink-push-chunk`    | pusher -> sink   | Transfer a data chunk         |
| `sink-push-credit`   | sink -> pusher   | Replenish flow control credit |

### Source Fetch (4 message types)

| Type                    | Direction          | Purpose                       |
|-------------------------|--------------------|-------------------------------|
| `source-fetch-request`  | fetcher -> source  | Initiate data fetch           |
| `source-fetch-response` | source -> fetcher  | Acknowledge (ack) or reject (nak) |
| `source-fetch-chunk`    | source -> fetcher  | Transfer a data chunk         |
| `source-fetch-credit`   | fetcher -> source  | Replenish flow control credit |

Message Fields by Type
----------------------

### `event-emission`

| Field    | Type                   | Required | Description                   |
|----------|------------------------|----------|-------------------------------|
| `name`   | `string`               | yes      | Endpoint name                 |
| `params` | `any[]`                | no       | Event parameters (max 64)     |
| `auth`   | `string[]`             | no       | JWT tokens (max 8, each max 8192 chars) |
| `meta`   | `Record<string, any>`  | no       | Arbitrary metadata (non-array object) |

### `service-call-request`

| Field    | Type                   | Required | Description                   |
|----------|------------------------|----------|-------------------------------|
| `name`   | `string`               | yes      | Service endpoint name         |
| `params` | `any[]`                | no       | Call parameters (max 64)      |
| `auth`   | `string[]`             | no       | JWT tokens (max 8)            |
| `meta`   | `Record<string, any>`  | no       | Arbitrary metadata            |

### `service-call-response`

| Field    | Type      | Required | Description                          |
|----------|-----------|----------|--------------------------------------|
| `result` | `any`     | no       | Return value on success              |
| `error`  | `string`  | no       | Error message on failure             |

Exactly one of `result` or `error` is present.

### `sink-push-request`

| Field    | Type                   | Required | Description                   |
|----------|------------------------|----------|-------------------------------|
| `name`   | `string`               | yes      | Sink endpoint name            |
| `params` | `any[]`                | no       | Push parameters (max 64)      |
| `auth`   | `string[]`             | no       | JWT tokens (max 8)            |
| `meta`   | `Record<string, any>`  | no       | Arbitrary metadata            |

### `sink-push-response`

| Field    | Type                   | Required | Description                   |
|----------|------------------------|----------|-------------------------------|
| `name`   | `string`               | yes      | Sink endpoint name            |
| `error`  | `string`               | no       | Error message (nak) or absent (ack) |
| `auth`   | `string[]`             | no       | JWT tokens (max 8)            |
| `meta`   | `Record<string, any>`  | no       | Arbitrary metadata            |
| `credit` | `integer`              | no       | Initial flow control credit (min 1) |

### `sink-push-chunk`

| Field   | Type         | Required | Description                        |
|---------|--------------|----------|------------------------------------|
| `name`  | `string`     | yes      | Sink endpoint name                 |
| `chunk` | `Uint8Array` | no       | Data chunk payload                 |
| `error` | `string`     | no       | Error message (aborts the stream)  |
| `final` | `boolean`    | no       | `true` on the last chunk           |

### `sink-push-credit`

| Field    | Type      | Required | Description                         |
|----------|-----------|----------|-------------------------------------|
| `name`   | `string`  | yes      | Sink endpoint name                  |
| `credit` | `integer` | yes      | Number of additional credits (min 1)|

### `source-fetch-request`

| Field    | Type                   | Required | Description                   |
|----------|------------------------|----------|-------------------------------|
| `name`   | `string`               | yes      | Source endpoint name          |
| `params` | `any[]`                | no       | Fetch parameters (max 64)     |
| `auth`   | `string[]`             | no       | JWT tokens (max 8)            |
| `meta`   | `Record<string, any>`  | no       | Arbitrary metadata            |
| `credit` | `integer`              | no       | Initial flow control credit (min 1) |

### `source-fetch-response`

| Field    | Type                   | Required | Description                   |
|----------|------------------------|----------|-------------------------------|
| `name`   | `string`               | yes      | Source endpoint name          |
| `error`  | `string`               | no       | Error message (nak) or absent (ack) |
| `auth`   | `string[]`             | no       | JWT tokens (max 8)            |
| `meta`   | `Record<string, any>`  | no       | Arbitrary metadata            |

### `source-fetch-chunk`

| Field   | Type         | Required | Description                        |
|---------|--------------|----------|------------------------------------|
| `name`  | `string`     | yes      | Source endpoint name               |
| `chunk` | `Uint8Array` | no       | Data chunk payload                 |
| `error` | `string`     | no       | Error message (aborts the stream)  |
| `final` | `boolean`    | no       | `true` on the last chunk           |

### `source-fetch-credit`

| Field    | Type      | Required | Description                         |
|----------|-----------|----------|-------------------------------------|
| `name`   | `string`  | yes      | Source endpoint name                |
| `credit` | `integer` | yes      | Number of additional credits (min 1)|

MQTT Topic Structure
--------------------

MQTT+ maps messages to MQTT topics using the pattern:

```
{name}/{operation}/{peerId}
```

- **`name`**: The endpoint name (e.g. `example/hello`).
- **`operation`**: The message type (e.g. `service-call-request`).
- **`peerId`**: Either the target peer's NanoID (for directed messages) or
  `any` (for broadcast messages).

### Broadcast Topics (Requests)

Request messages are published to broadcast topics when no specific
receiver is targeted:

| Pattern                    | Operation               | Purpose                |
|----------------------------|-------------------------|------------------------|
| `{name}/event-emission/any`                          | `event-emission`        | Broadcast event        |
| `{name}/event-emission/{peerId}`                     | `event-emission`        | Directed event         |
| `$share/{share}/{name}/service-call-request/any`     | `service-call-request`  | Shared service request |
| `$share/{share}/{name}/source-fetch-request/any`     | `source-fetch-request`  | Shared fetch request   |
| `$share/{share}/{name}/sink-push-request/any`        | `sink-push-request`     | Shared push request    |

Service, source, and sink requests use **MQTT shared subscriptions**
(`$share/{group}/...`) to distribute load across multiple handlers
(default group: `"default"`). Event emissions do *not* use shared
subscriptions by default (all registered handlers receive the event).

### Direct Topics (Responses and Chunks)

Response messages, chunks, and credits are sent to peer-specific topics:

| Pattern                                          | Operation                 |
|--------------------------------------------------|---------------------------|
| `{name}/service-call-response/{clientId}`        | `service-call-response`   |
| `{name}/sink-push-response/{clientId}`           | `sink-push-response`      |
| `{name}/sink-push-chunk/{sinkId}`                | `sink-push-chunk`         |
| `{name}/sink-push-credit/{pusherId}`             | `sink-push-credit`        |
| `{name}/source-fetch-response/{clientId}`        | `source-fetch-response`   |
| `{name}/source-fetch-chunk/{clientId}`           | `source-fetch-chunk`      |
| `{name}/source-fetch-credit/{sourceId}`          | `source-fetch-credit`     |

The `{clientId}` is the `sender` field from the corresponding request
message, ensuring responses are routed back to the originating peer only.

### Topic Customization

The topic structure is fully customizable through the `topicMake` and
`topicMatch` options at instance creation time.

MQTT QoS Levels
---------------

| Communication Pattern | QoS | Rationale                         |
|-----------------------|-----|-----------------------------------|
| Event Emission        | 0   | Best-effort, fire-and-forget      |
| Service Call          | 2   | Exactly-once for reliable RPC     |
| Sink Push             | 2   | Exactly-once for reliable data transfer |
| Source Fetch          | 2   | Exactly-once for reliable data transfer |

Credit-Based Flow Control
-------------------------

Sink Push and Source Fetch patterns use a **credit-based flow control**
mechanism to prevent the data producer from overwhelming the consumer.

### How It Works

1. The **consumer** grants an initial number of credits (default: 4)
   to the **producer** (via the response message or request message).
2. Each chunk sent by the producer **consumes one credit**.
3. When credits are exhausted, the producer **blocks** (waits).
4. As the consumer processes chunks, it sends **credit messages** to
   replenish the producer's credit, unblocking it.
5. The chunk size is configurable (default: 16 KB).

### Configuration

| Option        | Default   | Description                              |
|---------------|-----------|------------------------------------------|
| `chunkSize`   | `16384`   | Maximum bytes per chunk (16 KB)          |
| `chunkCredit` | `4`       | Number of chunks allowed in-flight       |

Setting `chunkCredit` to `0` disables flow control entirely.

### Direction of Credit

| Pattern      | Credit Sender | Credit Receiver | Credit Message Type     |
|--------------|---------------|-----------------|-------------------------|
| Sink Push    | Sink          | Pusher          | `sink-push-credit`      |
| Source Fetch | Fetcher       | Source          | `source-fetch-credit`   |

Authentication
--------------

MQTT+ provides optional JWT-based authentication and role-based
authorization on any endpoint.

### Setup

1. The **server** sets a shared secret via `credential(secret)`.
   The secret is derived into a 256-bit key using PBKDF2-SHA256
   (600,000 iterations).

2. The server **issues JWT tokens** via `issue({ roles, id?, exp? })`,
   signed with HS256.

3. The **client** stores tokens via `authenticate(token)`.

### Token Transmission

When a client sends a request (`event-emission`, `service-call-request`,
`sink-push-request`, or `source-fetch-request`), all stored JWT tokens
are included in the `auth` field (max 8 tokens, each max 8192 characters).

### Validation

On the server side, the handler validates the tokens against
the configured credential and required roles:

- The token must be a valid HS256-signed JWT.
- If the token payload contains an `id` field, it must match the `sender`
  peer ID of the request.
- If the token payload contains an `exp` field, the token must not be
  expired.
- The token's `roles` array must contain at least one of the
  required roles.

### Authentication Modes

| Mode       | Behavior                                           |
|------------|----------------------------------------------------|
| `require`  | Request is rejected if no valid token is found.    |
| `optional` | Request passes even if no valid token is found.    |

Message Dispatching
-------------------

### Request Dispatching

Incoming request messages are dispatched based on the combination of
their `type` and `name` fields. The dispatch key is
`{operation}:{name}` (e.g. `service-call-request:example/hello`).

### Response Dispatching

Incoming response messages are dispatched based on the combination
of their `type` and `id` fields. The dispatch key is
`{operation}:{requestId}` (e.g. `service-call-response:vwLzfQDu2uEeOdOfIlT42`).
This ensures responses are correlated to their originating requests.

Timeouts
--------

All bi-directional patterns (Service Call, Sink Push, Source Fetch) are
guarded by a configurable timeout (default: 10 seconds). If no response
or progress is received within the timeout, the operation is aborted
with a timeout error. For streaming patterns, each chunk or credit
message resets the timeout.

Error Handling
--------------

Errors are communicated in two ways, depending on timing:

1. **Before data transfer starts**: The response message carries an
   `error` field (nak response).

2. **During data transfer**: A chunk message carries an `error` field
   and `final: true`, terminating the stream.

Example Message Exchange
------------------------

A service call to `example/hello` with parameters `"world"` and `42`:

**Request** (published to `example/hello/service-call-request/any`):

```json
{
    "version":  "MQTT+/1.4",
    "type":     "service-call-request",
    "id":       "vwLzfQDu2uEeOdOfIlT42",
    "name":     "example/hello",
    "params":   [ "world", 42 ],
    "sender":   "2IBMSk0NPnrz1AeTERoea"
}
```

**Response** (published to `example/hello/service-call-response/2IBMSk0NPnrz1AeTERoea`):

```json
{
    "version":  "MQTT+/1.4",
    "type":     "service-call-response",
    "id":       "vwLzfQDu2uEeOdOfIlT42",
    "result":   "world:42",
    "sender":   "7kPQm3xRtYnJw8FvUqE5b",
    "receiver": "2IBMSk0NPnrz1AeTERoea"
}
```

The `id` field correlates the response to the request. The `sender`
field in the request is used as the peer-specific suffix in the response
topic, ensuring only the caller receives the response.
