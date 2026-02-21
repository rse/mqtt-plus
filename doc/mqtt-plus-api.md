
Application Programming Interface
---------------------------------

The **MQTT+** API provides the following functionalities:

- **Construction**:<br/>

      /*  (simplified TypeScript API method signature)  */
      constructor<API extends Record<string,
          Event<   (...args: any[]) => void | Promise<void>> |
          Service< (...args: any[]) => any  | Promise<any> > |
          Source<  (...args: any[]) => void | Promise<void>> |
          Sink<    (...args: any[]) => void | Promise<void>>
      >>(
          mqtt: MqttClient | null,
          options?: {
              id:          string
              codec:       "cbor" | "json"
              timeout:     number
              chunkSize:   number
              chunkCredit: number
              topicMake:   (name: string, operation: string, peerId?: string) => string
              topicMatch:  (topic: string) => { name: string, operation: string, peerId?: string } | null
          }
      )

  The `API` is a TypeScript type,
  describing the available events, services, sources, and sinks.

  - The `mqtt` is the [MQTT.js](https://www.npmjs.com/package/mqtt) instance,
    which has to be established separately. A `null` MQTT instance can be
    used for performing dry-runs (see *Dry-Run Publishing for MQTT Last-Will* under
    **Event Emission** below).

  - The optional `options` object supports the following fields:
    - `id`: Custom MQTT peer identifier (default: auto-generated NanoID).
    - `codec`: Encoding format, either `cbor` or `json` (default: `cbor`).
    - `timeout`: Communication timeout in milliseconds (default: `10000`).
    - `chunkSize`: Chunk size in bytes for source/sink transfers (default: `16384`).
    - `chunkCredit`: Number of credit units for flow control in source/sink
      chunked transfers (default: `4`). Controls how many chunks can be
      in-flight before the receiver must grant additional credit.
    - `topicMake`: Custom topic generation function.
      The `operation` parameter is one of: `event-emission`,
      `service-call-request`, `service-call-response`,
      `source-fetch-request`, `source-fetch-response`,
      `source-fetch-chunk`, `source-fetch-credit`,
      `sink-push-request`, `sink-push-response`,
      `sink-push-chunk`, `sink-push-credit`. (default: `` (name, operation, peerId) =>
      `${name}/${operation}/${peerId ?? "any"}` ``)
    - `topicMatch`: Custom topic matching function.
      Returns `{ name: string, operation: string, peerId?: string }` or `null` if no match.
      The `peerId` is `undefined` for broadcast topics (those ending with `/any`).
      (default: `` (topic) => { const m = topic.match(/^(.+)\/([^/]+)\/([^/]+)$/); return m ? { name: m[1], operation: m[2], peerId: m[3] === "any" ? undefined : m[3] } : null } ``)

- **Destruction**:<br/>

      destroy(): void

  Clean up the MQTT+ instance by removing all event listeners.
  Call this method when the instance is no longer needed.
  The companion MQTT.js instance has to be destroyed separately.

- **Event Handling**:<br/>

      /*  listen for error or log events  */
      on(event: "error", callback: (error: Error) => void): void
      on(event: "log",   callback: (log: LogEvent) => void): void

      /*  remove error or log event listener  */
      off(event: "error", callback: (error: Error) => void): void
      off(event: "log",   callback: (log: LogEvent) => void): void

  MQTT+ emits `error` and `log` events for monitoring and debugging.

  - The `on()` method registers an event listener.
    The `"error"` event is emitted when an error occurs during
    message processing, subscription, or publishing.
    The `"log"` event is emitted for informational and debug-level
    messages with a `LogEvent` object containing `timestamp`, `level`,
    `msg`, and optional `data` fields.

  - The `off()` method removes a previously registered event listener.

  - The `LogEvent` object provides `resolve()` for resolving lazy
    promise-based fields and `toString()` for rendering log entries
    as formatted strings.

  Example:

      mqttp.on("error", (err) => {
          console.error("MQTT+ error:", err.message)
      })
      mqttp.on("log", (log) => {
          console.log(log.toString())
      })

- **Authentication**:<br/>

      /*  store server-side secret credential  */
      credential(credential: string): void

      /*  issue client-side token on server-side  */
      issue(payload: { roles: string[], id?: string }): Promise<string>

      /*  add/remove client-side token (client-side)  */
      authenticate(token: string): void
      authenticate(token: string, remove: boolean): void

  MQTT+ provides JWT-based authentication for securing events, services,
  sources, and sinks. Authentication works by issuing tokens on the
  server-side and validating them when messages are received.

  - The `credential()` method sets the secret key used for signing and
    verifying JWT tokens. This must be called before `issue()` can be
    used.

  - The `issue()` method creates a new JWT token with the specified `roles` array.
    The optional `id` field can bind the token to a specific client identifier.

  - The `authenticate()` method manages client-side tokens:
    called with a token, adds the token to the set of active tokens;
    called with a token and `true`, removes the token from the set.

  - When a client has tokens set via `authenticate()`, they are automatically
    included in outgoing `emit()`, `call()`, `push()`, and `fetch()` requests.

  Example:

      /*  server: set credential and issue token  */
      mqttp.credential("my-secret-key")
      const token = await mqttp.issue({ roles: [ "admin", "user" ] })

      /*  client: add token for authentication  */
      mqttp.authenticate(token)

- **Meta Information**:<br/>

      /*  set meta information by key  */
      meta(key: string, value: any): void

      /*  retrieve meta information by key  */
      meta(key: string): any

      /*  delete meta information by key  */
      meta(key: string, value: null): void

  MQTT+ allows attaching persistent meta-data to an instance that is
  automatically included in all outgoing messages. This is useful for
  adding context information like client version, environment, or user
  identity to every request.

  - The `meta()` method manages instance-level meta-data:
    called with a key only, retrieves the meta-data entry for that key;
    called with a key and non-null value, sets the meta-data entry;
    called with a key and `null`, deletes the meta-data entry.

  - Instance-level meta-data set via `meta()` is merged with any per-request
    `meta` option passed to `emit()`, `call()`, `push()`, or `fetch()`.
    Per-request meta-data takes precedence over instance-level metadata.

  - On the receiving side, meta-data is available via the `info.meta`
    field in callbacks for `event()`, `service()`, `source()`, and `sink()`.
    For `fetch()`, the returned `meta` promise resolves to the meta-data
    sent by the source.

  Example:

      /*  client: set instance-level metadata  */
      mqttp.meta("clientVersion", "1.0.0")
      mqttp.meta("environment", "production")

      /*  client: retrieve a metadata entry  */
      const environment = mqttp.meta("environment")

      /*  client: delete a metadata entry  */
      mqttp.meta("environment", null)

      /*  client: per-request metadata (merged with instance-level)  */
      mqttp.call({ name: "example/hello", params: [ "world" ], meta: { requestId: "123" } })

      /*  server: access meta-data in callback  */
      await mqttp.service("example/hello", (arg, info) => {
          console.log(info.meta?.clientVersion)  /*  "1.0.0"  */
          console.log(info.meta?.requestId)      /*  "123"    */
          return `hello ${arg}`
      })

- **Event Registration**:<br/>

      /*  (simplified TypeScript API method signature)  */
      event(
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>
              }
          ) => void | Promise<void>
      ): Promise<Registration>
      event({
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>
              }
          ) => void | Promise<void>,
          options?: MQTT::IClientSubscribeOptions,
          share?:   string,
          auth?:    string | { mode: "require" | "optional", roles: string[] }
      }): Promise<Registration>

  Register for an event.

  - The `name` has to be a valid MQTT topic name.

  - The `callback` is called with the `params` passed to a remote `emit()`.
    There is no return value of `callback`.

  - The optional `options` allows setting MQTT.js `subscribe()` options like `qos`.

  - The optional `share` enables
    [MQTT Shared Subscriptions](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html#_Toc3901250)
    (MQTT 5.0) for load-balancing messages across multiple registrations
    by specifying a group name. This internally prefixes the event with
    `$share/<share>/`.

  - The optional `auth` enables authentication validation on incoming events.
    When set to a role name string (e.g., `"admin"`), authentication is required
    and the token must include that role. When set to an object `{ mode, roles }`,
    the mode can be `"require"` (reject unauthenticated) or `"optional"` (accept all
    but reflect validation result in `info.authenticated`), and roles specifies
    the required role names.

  - Internally, on the MQTT broker, the topics generated by
    `topicMake(name, "event-emission")` (default: `${name}/event-emission/any` and
    `${name}/event-emission/${peerId}`) are subscribed.

  - Returns a `Registration` object with a `destroy()` method.

- **Service Registration**:<br/>

      /*  (simplified TypeScript API method signature)  */
      service(
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>
              }
          ) => any | Promise<any>
      ): Promise<Registration>
      service({
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>
              }
          ) => any | Promise<any>,
          options?: MQTT::IClientSubscribeOptions,
          share?:   string,
          auth?:    string | { mode: "require" | "optional", roles: string[] }
      }): Promise<Registration>

  Register a service.

  - The `name` has to be a valid MQTT topic name.

  - The `callback` is called with the `params` passed to a remote `call()`.
    The return value of `callback` will resolve the `Promise` returned by the remote `call()`.

  - The optional `options` allows setting MQTT.js `subscribe()` options like `qos`.

  - The optional `share` enables
    [MQTT Shared Subscriptions](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html#_Toc3901250)
    (MQTT 5.0) for load-balancing service calls across multiple services
    by specifying a group name. This internally prefixes the service
    with `$share/<share>/`. By default a share named `default` is used.

  - The optional `auth` enables authentication validation on incoming service calls.
    When set to a role name string (e.g., `"admin"`), authentication is required
    and the token must include that role. When set to an object `{ mode, roles }`,
    the mode can be `"require"` (reject unauthenticated with error response) or
    `"optional"` (accept all but reflect validation result in `info.authenticated`),
    and roles specifies the required role names.

  - Internally, on the MQTT broker, the topics generated by
    `topicMake(name, "service-call-request")` (default: `${name}/service-call-request/any` and
    `${name}/service-call-request/${peerId}`) are subscribed.

  - Returns a `Registration` object with a `destroy()` method.

- **Source Registration**:<br/>

      /*  (simplified TypeScript API method signature)  */
      source(
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>,
                  stream?:        Readable,
                  buffer?:        Promise<Uint8Array>
              }
          ) => void | Promise<void>
      ): Promise<Registration>
      source({
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>,
                  stream?:        Readable,
                  buffer?:        Promise<Uint8Array>
              }
          ) => void | Promise<void>,
          options?: MQTT::IClientSubscribeOptions,
          share?:   string,
          auth?:    string | { mode: "require" | "optional", roles: string[] }
      }): Promise<Registration>

  Register a source for sending data.

  - The `name` has to be a valid MQTT topic name.

  - The `callback` is called with the `params` passed to a remote `fetch()`.
    The `callback` should set `info.stream` to a `Readable` or
    `info.buffer` to a `Promise<Uint8Array>` containing the data.
    Optionally, the `callback` can set `info.meta` to a `Record<string,
    any>` to send metadata back with the response.

  - The optional `options` allows setting MQTT.js `subscribe()` options like `qos`.

  - The optional `share` enables
    [MQTT Shared Subscriptions](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html#_Toc3901250)
    (MQTT 5.0) for load-balancing source requests across multiple
    sources by specifying a group name. This internally prefixes the
    source with `$share/<share>/`. By default a share named `default` is
    used.

  - The optional `auth` enables authentication validation on incoming source fetches.
    When set to a role name string (e.g., `"admin"`), authentication
    is required and the token must include that role. When set to an
    object `{ mode, roles }`, the mode can be `"require"` (reject
    unauthenticated) or `"optional"` (accept all but reflect validation
    result in `info.authenticated`), and roles specifies the required
    role names.

  - Internally, on the MQTT broker, the topics generated by
    `topicMake(name, "source-fetch-request")`
    (default: `${name}/source-fetch-request/any` and
    `${name}/source-fetch-request/${peerId}`) and
    `topicMake(name, "source-fetch-credit", peerId)`
    (default: `${name}/source-fetch-credit/${peerId}`) are subscribed.

  - Returns a `Registration` object with a `destroy()` method.

- **Sink Registration**:<br/>

      /*  (simplified TypeScript API method signature)  */
      sink(
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>,
                  stream?:        Readable,
                  buffer?:        Promise<Uint8Array>
              }
          ) => void | Promise<void>
      ): Promise<Registration>
      sink({
          name:     string,
          callback: (
              ...params: any[],
              info: {
                  sender:         string,
                  receiver?:      string,
                  authenticated?: boolean,
                  meta?:          Record<string, any>,
                  stream?:        Readable,
                  buffer?:        Promise<Uint8Array>
              }
          ) => void | Promise<void>,
          options?: MQTT::IClientSubscribeOptions,
          share?:   string,
          auth?:    string | { mode: "require" | "optional", roles: string[] }
      }): Promise<Registration>

  Register a sink for receiving data.

  - The `name` has to be a valid MQTT topic name.

  - The `callback` is called with the `params` passed to a remote `push()`.
    The `info.stream` provides a Node.js `Readable` stream for consuming the pushed data.
    The `info.buffer` provides a lazy `Promise<Uint8Array>` that resolves to the complete data once the stream ends.
    The `info.meta` contains optional metadata sent by the pusher via `push()`.

  - The optional `options` allows setting MQTT.js `subscribe()` options like `qos`.

  - The optional `share` enables
    [MQTT Shared Subscriptions](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html#_Toc3901250)
    (MQTT 5.0) for load-balancing sink pushes across multiple sink
    handlers by specifying a group name. This internally prefixes the
    sink with `$share/<share>/`. By default a share named `default` is
    used.

  - The optional `auth` enables authentication validation on incoming sink pushes.
    When set to a role name string (e.g., `"admin"`), authentication
    is required and the token must include that role. When set to an
    object `{ mode, roles }`, the mode can be `"require"` (reject
    unauthenticated) or `"optional"` (accept all but reflect validation
    result in `info.authenticated`), and roles specifies the required
    role names.

  - Internally, on the MQTT broker, the topics generated by
    `topicMake(name, "sink-push-request")`
    (default: `${name}/sink-push-request/any` and
    `${name}/sink-push-request/${peerId}`) and
    `topicMake(name, "sink-push-chunk", peerId)`
    (default: `${name}/sink-push-chunk/${peerId}`) are subscribed.

  - Returns a `Registration` object with a `destroy()` method.

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
          options?:  MQTT::IClientPublishOptions,
          meta?:     Record<string, any>
      }): void
      emit({
          event:     string,
          params:    any[],
          receiver?: string,
          options?:  MQTT::IClientPublishOptions,
          meta?:     Record<string, any>,
          dry:       true
      }): { topic: string, payload: string | Uint8Array, options: IClientPublishOptions }

  Emit an event to all subscribers or a specific subscriber ("fire and forget").

  - The optional `receiver` directs the event to a specific subscriber only.

  - The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.

  - The optional `meta` sends additional metadata alongside the event,
    which is merged with instance-level metadata set via `meta()`.

  - The optional `dry` flag, when set to `true`, returns the publish information
    (`topic`, `payload`, `options`) instead of actually publishing to the MQTT broker.
    This is useful for generating MQTT "last will" messages (see example below).

  - The remote `event()` `callback` is called with `params` and its
    return value is silently ignored.

  - Internally, publishes to the MQTT topic by `topicMake(event, "event-emission", peerId)`
    (default: `${event}/event-emission/any` or `${event}/event-emission/${peerId}`).

  - *Dry-Run Publishing for MQTT Last-Will:*
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
          name:      string,
          ...params: any[]
      ): Promise<any>
      call({
          name:      string,
          params:    any[],
          receiver?: string,
          options?:  MQTT::IClientPublishOptions,
          meta?:     Record<string, any>
      }): Promise<any>

  Call a service on all registrants or on a specific registrant ("request and response").

  - The optional `receiver` directs the call to a specific registrant only.

  - The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.

  - The optional `meta` sends additional metadata alongside the service call,
    which is merged with instance-level metadata set via `meta()`.

  - The remote `service()` `callback` is called with `params` and its
    return value resolves the returned `Promise`. If the remote `callback`
    throws an exception, this rejects the returned `Promise`.

  - Internally, on the MQTT broker, the topic by
    `topicMake(service, "service-call-response", peerId)` (default:
    `${service}/service-call-response/${peerId}`) is temporarily
    subscribed for receiving the response.

- **Source Fetch**:<br/>

      /*  (simplified TypeScript API method signature)  */
      fetch(
          name:      string,
          ...params: any[]
      ): Promise<{
          stream:    Readable,
          buffer:    Promise<Uint8Array>,
          meta:      Promise<Record<string, any> | undefined>
      }>
      fetch({
          name:      string,
          params:    any[],
          receiver?: string,
          options?:  MQTT::IClientPublishOptions,
          meta?:     Record<string, any>
      }): Promise<{
          stream:    Readable,
          buffer:    Promise<Uint8Array>,
          meta:      Promise<Record<string, any> | undefined>
      }>

  Fetches data from any source or from a specific source.

  - The optional `receiver` directs the call to a specific source only.

  - The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.

  - The optional `meta` sends additional metadata alongside the fetch request,
    which is merged with instance-level metadata set via `meta()`.

  - Returns an object with a `stream` (`Readable`) for consuming the transferred data,
    a lazy `buffer` (`Promise<Uint8Array>`) that resolves
    to the complete data once the stream ends, and a `meta`
    (`Promise<Record<string, any> | undefined>`) that resolves to
    optional metadata sent by the source when the first chunk arrives.

  - The remote `source()` `callback` is called with `params` and
    should set `info.stream` to a `Readable` or `info.buffer` to
    a `Promise<Uint8Array>` containing the data. Optionally, the
    `callback` can set `info.meta` to send metadata back with the
    response. If the remote `callback` throws an exception, this
    destroys the stream with the error.

  - Internally, on the MQTT broker, the topics by
    `topicMake(name, "source-fetch-response", peerId)`
    and `topicMake(name, "source-fetch-chunk", peerId)`
    (default: `${name}/source-fetch-response/${peerId}` and
    `${name}/source-fetch-chunk/${peerId}`) are temporarily subscribed
    for receiving the response and data chunks.

- **Sink Push**:<br/>

      /*  (simplified TypeScript API method signature)  */
      push(
          name:           string,
          data:           Readable | Uint8Array,
          ...params:      any[]
      ): Promise<void>
      push({
          name:           string,
          data:           Readable | Uint8Array,
          params:         any[]
          meta?:          Record<string, any>,
          receiver?:      string,
          options?:       MQTT::IClientPublishOptions
      }): Promise<void>

  Pushes data to all established sinks or a specific sink handler.

  - The `data` is either a Node.js `Readable` stream or a `Uint8Array` providing the data to push.

  - The optional `meta` sends metadata alongside the data,
    which becomes available on the sink handler side via `info.meta`.

  - The optional `receiver` directs the push to a specific sink handler only.

  - The optional `options` allows setting MQTT.js `publish()` options like `qos` or `retain`.

  - The data is read from `data` in chunks (default: 16KB,
    configurable via `chunkSize` option) and sent over MQTT until the
    stream is closed or the buffer is fully transferred.
    The returned `Promise` resolves when the entire data has been pushed.

  - The remote `sink()` `callback` is called with `params` and an `info` object
    containing `stream` (`Readable`) for consuming the pushed data,
    `buffer` (lazy `Promise<Uint8Array>`) that resolves to the complete
    data once the stream ends, and `meta` (`Record<string, any> |
    undefined`) containing the metadata sent by the pusher.

  - Internally, on the MQTT broker, the topic by
    `topicMake(name, "sink-push-response", peerId)` (default:
    `${name}/sink-push-response/${peerId}`) is temporarily
    subscribed for receiving the ack/nak response,
    then publishes to the MQTT topic by `topicMake(name, "sink-push-request", peerId)`
    (default: `${name}/sink-push-request/any` or `${name}/sink-push-request/${peerId}`)
    for the initial request, `topicMake(name, "sink-push-chunk", peerId)`
    (default: `${name}/sink-push-chunk/${peerId}`) for the data chunks,
    and optionally `topicMake(name, "sink-push-credit", peerId)`
    (default: `${name}/sink-push-credit/${peerId}`) for credit-based flow control.

- **Data Type Conversion Utilities**:<br/>

      /*  convert character string to buffer  */
      str2buf(data: string): Uint8Array

      /*  convert buffer to character string  */
      buf2str(data: Uint8Array): string

      /*  convert byte-based typed array to buffer  */
      arr2buf(data: Buffer | Uint8Array | Int8Array): Uint8Array

      /*  convert buffer to byte-based typed array  */
      buf2arr(data: Uint8Array, type: typeof Buffer): Buffer
      buf2arr(data: Uint8Array, type: typeof Uint8Array): Uint8Array
      buf2arr(data: Uint8Array, type: typeof Int8Array): Int8Array

  MQTT+ provides utility methods for converting between strings,
  buffers, and typed arrays. These are useful when working with binary
  data in source/sink transfers or when interfacing with API methods that
  expect specific data types.

  Example:

      /*  string to buffer conversion  */
      const buffer = mqttp.str2buf("Hello, World!")
      const text   = mqttp.buf2str(buffer)

      /*  typed array conversions  */
      const ui8a   = mqttp.arr2buf(buffer)
      const buffer = mqttp.buf2arr(ui8a, Buffer)
      const i8a    = mqttp.buf2arr(ui8a, Int8Array)
