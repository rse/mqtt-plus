
ChangeLog
=========

1.4.18 (2026-04-12)
-------------------

- IMPROVEMENT: detect concurrent deliveries of the same request id in service trait
- IMPROVEMENT: improve error handling and reject pending calls on destroy
- UPDATE: upgrade NPM dependencies
- CLEANUP: use a better name for an internal symbol

1.4.17 (2026-04-11)
-------------------

- IMPROVEMENT: add "signal" field to info of service and event callbacks for signalling abortion
- IMPROVEMENT: add more utility functions related to timers
- IMPROVEMENT: support cancelling push operations with a credit of zero
- IMPROVEMENT: let Spool.unroll() always execute the cleanup callback
- IMPROVEMENT: perform a minimum version check in the protocol
- IMPROVEMENT: log invalid requests with missing senders
- IMPROVEMENT: add upper bound for the nanoid iteration
- IMPROVEMENT: perform topic receiver matching and validate service response names
- IMPROVEMENT: move the destroyed flag to the base class and protect other methods
- IMPROVEMENT: send errors to peer and provide AggregateError to not lose errors
- IMPROVEMENT: bump minimum Node version to 20 for ES2022
- BUGFIX: Spool.unroll() silently skipped remaining cleanups on first async failure
- BUGFIX: improve semantics of info.authenticated field for event/service/sink/source in case of optional authentication
- BUGFIX: in the ReadableTee class, do not run read() twice: once ourself and once via the base class
- BUGFIX: correctly propagate description in run() also to finally callback
- BUGFIX: fix resource handling in source trait
- BUGFIX: avoid race conditions and unhandled promise rejections in async processing
- BUGFIX: fix cleanup and error handling across sink/source traits
- BUGFIX: fix Mosqitto ACL
- UPDATE: upgrade NPM dependencies
- CLEANUP: various code cleanups (callback handling, settle code, destroy handling, termination, subscriptions)
- CLEANUP: align with ensureError code and fix typos

1.4.16 (2026-03-27)
-------------------

- IMPROVEMENT: allow source/sink operations to be aborted via a signal
- IMPROVEMENT: support `info.buffer` to be a plain `Uint8Array` for sources
- IMPROVEMENT: provide callback indicating which field is consumed
- IMPROVEMENT: improve credit-based flow control enforcement
- IMPROVEMENT: validate and deduplicate request IDs
- IMPROVEMENT: lock responder for communication
- IMPROVEMENT: improve backpressure and stream handling
- IMPROVEMENT: improve meta handling
- IMPROVEMENT: improve typing
- IMPROVEMENT: use cross-env for better script portability
- IMPROVEMENT: switch "npm start test" procedure to individual tasks for portability
- BUGFIX: in sink and source traits: do not miss stream data in case the stream is consumed as a buffer
- BUGFIX: fix error handling and prevent unhandled exceptions in sink and source traits
- BUGFIX: fix message name mismatch and cancellation handling
- BUGFIX: guard for already destroyed streams
- BUGFIX: use .cjs for file extension of CJS variant
- CLEANUP: align and track spool handling in source trait
- CLEANUP: align and guard timer handling
- CLEANUP: merge handlers into one

1.4.15 (2026-03-14)
-------------------

- IMPROVEMENT: add code coverage during test suite execution
- IMPROVEMENT: add development build support
- IMPROVEMENT: improve version injection and source map support
- IMPROVEMENT: add more test cases for JSON codec and handler errors
- BUGFIX: prevent hang in test suite
- BUGFIX: fix TypeScript DOM library configuration
- UPDATE: upgrade NPM dependencies: Vite 8
- CLEANUP: minor code cleanups

1.4.14 (2026-03-11)
-------------------

- IMPROVEMENT: improve error handling in source trait
- CLEANUP: align resource handling in source trait with sink trait

1.4.13 (2026-03-10)
-------------------

- IMPROVEMENT: improve error handling in sink pattern
- IMPROVEMENT: add test cases for large buffer/stream and interrupted data transfer via sink/source
- IMPROVEMENT: use a single response topic for each of event/service/sink/source
- BUGFIX: fix error handling in sink pattern
- BUGFIX: prevent unhandled promise rejections
- BUGFIX: fix await unrolling in message handling
- BUGFIX: fix acknowledgement handling
- UPDATE: upgrade NPM dependencies
- CLEANUP: various minor code cleanups (naming, alignment, formatting, comments, variable reuse)

1.4.12 (2026-03-05)
-------------------

- IMPROVEMENT: make all subscriptions ref-counted and spooled
- UPDATE: update documentation
- UPDATE: upgrade NPM dependencies
- CLEANUP: cleanup code

1.4.11 (2026-03-05)
-------------------

- IMPROVEMENT: improve error handling and use error ensure function consistently
- IMPROVEMENT: improve cleanup handling and correctly track resources
- IMPROVEMENT: improve typing and fix overloads
- IMPROVEMENT: avoid warning in Vite
- BUGFIX: fix building for Vite compatibility
- BUGFIX: avoid unhandled rejection error
- BUGFIX: fix test
- UPDATE: update documentation
- UPDATE: upgrade NPM dependencies
- CLEANUP: rename emit() parameter "event" to "name" for consistency
- CLEANUP: cleanup code

1.4.10 (2026-03-01)
-------------------

- IMPROVEMENT: improve performance
- IMPROVEMENT: improve typing and export more public API types
- IMPROVEMENT: improve description
- BUGFIX: fix error handling and destruction problems
- BUGFIX: fix name of module
- BUGFIX: do not make fields exclusive
- UPDATE: upgrade NPM dependencies
- CLEANUP: various code cleanups (simplification, formatting, comments, output polishing)
- CLEANUP: cleanups for error handling

1.4.9 (2026-02-22)
------------------

- BUGFIX: clear internal response handlers in destroy()
- BUGFIX: correctly decrement counter in subscription handling
- BUGFIX: let the registration's destroy() throw errors correctly
- BUGFIX: correctly handle synchronous response handler failures
- BUGFIX: fix internal chunkToBuffer() method for byte-length calculation
- BUGFIX: apply the same limits on sender size for authenticate() as on receiver side
- BUGFIX: check for name/topic mismatches also in source fetch()
- REFACTOR: factor out topic subscription and spooling topic unsubscription into helper function
- REFACTOR: make response handlers async functions to correctly catch their failures
- IMPROVEMENT: use a cached TextEncoder in utility functions
- IMPROVEMENT: ensure generated NanoIDs do not conflict with pending requests

1.4.8 (2026-02-22)
------------------

- PERFORMANCE: cache encoder/decoder in encoding functions
- BUGFIX: fix memory leak in destroy() for sink
- BUGFIX: namespace timers of sink() and source() to avoid conflicts
- BUGFIX: align event() share default with service/source/sink
- CLEANUP: refactor RefCountedSubscription class to be redundancy-free
- CLEANUP: various minor code cleanups (formatting, modernization)

1.4.7 (2026-02-22)
------------------

- IMPROVEMENT: provide a global "share" option
- IMPROVEMENT: use timer utility code for internal timing
- IMPROVEMENT: improve error handling
- IMPROVEMENT: make code more type-safe
- IMPROVEMENT: make "stream" and "buffer" fields mandatory in sink() "info" object
- IMPROVEMENT: make test suite more robust and support async/non-async handlers
- IMPROVEMENT: add Aedes MQTT broker support to not require Docker for the test suite
- BUGFIX: fix leak in subscription handling
- BUGFIX: workaround for ESM-only "plazy" module when used from CJS context
- BUGFIX: fix ACL handling
- CLEANUP: various code cleanups
- CLEANUP: remove unused fields from protocol messages
- CLEANUP: add protection and align code with implementation
- CLEANUP: improve console output and use Chalk for colored rendering
- CLEANUP: improve about description and text
- DOCUMENTATION: switch about information to Markdown and SVG format
- DOCUMENTATION: add hint to NPM
- DOCUMENTATION: fix name of peer dependency

1.4.6 (2026-02-22)
------------------

- IMPROVEMENT: improve rendering of about information and add chalk for sample code
- DOCUMENTATION: update sample code
- DOCUMENTATION: adjust about description

1.4.5 (2026-02-21)
------------------

- IMPROVEMENT: add a "npm start publish" target for convenient publishing
- IMPROVEMENT: allow QoS to be overridden and change default to level 2
- BUGFIX: properly destroy resources on cleanup
- CLEANUP: factor out registration code into base trait
- CLEANUP: use ensureError utility function for consistent error handling
- CLEANUP: rename and protect internal symbols and reduce unnecessary typing
- CLEANUP: avoid a race condition in topic unsubscription handling
- CLEANUP: improve about information

1.4.4 (2026-02-21)
------------------

- CLEANUP: cleanup documentation

1.4.3 (2026-02-21)
------------------

- IMPROVEMENT: allow JWT expirations
- DOCUMENTATION: document more internals

1.4.2 (2026-02-21)
------------------

- DOCUMENTATION: add architecture overview
- CLEANUP: cleanup documentation
- CLEANUP: simplify internal message handling
- CLEANUP: simplify internal MQTT topic subscription handling

1.4.1 (2026-02-21)
------------------

- BUGFIX: fix file references and TypeScript configuration in test directory
- CLEANUP: cleanup code and tests

1.4.0 (2026-02-21)
------------------

- BUGFIX: do not suppress errors in order to catch them
- BUGFIX: do not have lingering resources on destroy
- BUGFIX: fix cleanup of resources
- BUGFIX: avoid hangs in processing
- IMPROVEMENT: add spooling and runner for error handling
- IMPROVEMENT: add lingering unsubscribe to reduce contention on broker
- IMPROVEMENT: move code from _dispatchMessage into domain methods
- IMPROVEMENT: factor out similar code for reusability
- IMPROVEMENT: split test suite and add more tests
- CLEANUP: cleanup signatures of on/off methods
- CLEANUP: simplify typing and remove unused code
- CLEANUP: rename variables and align code formatting
- CLEANUP: various code cleanups
- CLEANUP: splitted documentation from README.md into doc/*.md
- UPDATE: upgrade NPM dependencies

1.3.0 (2026-02-07)
------------------

- IMPROVEMENT: add credit-based flow control to sink/source facility
- IMPROVEMENT: make "buffer" and "stream" fields always mutual-exlusive
- IMPROVEMENT: provide version field in protocol messages

1.2.1 (2026-02-07)
------------------

- REFACTOR: use a reference counting subscription class
- CLEANUP: improve internal validation logic
- CLEANUP: various code cleanups

1.2.0 (2026-02-06)
------------------

- IMPROVEMENT: use Valibot for more robust object validation
- IMPROVEMENT: support concurrent operations
- IMPROVEMENT: improve chunk sending
- IMPROVEMENT: improve buffer handling and decoding
- IMPROVEMENT: use derived keys to have enough entropy
- IMPROVEMENT: report failures and log errors on dispatching messages
- IMPROVEMENT: await subscribes and super calls in dispatching messages
- IMPROVEMENT: log failing destroy operations
- BUGFIX: fix share option handling in event()
- BUGFIX: fix error handling
- BUGFIX: fix return values of promises
- CLEANUP: improve type safety (use unknown type, remove Awaited type)
- CLEANUP: simplify code by using closures and conversions
- CLEANUP: various code cleanups (rename variables, reduce whitespaces)
- UPDATE: upgrade NPM dependencies

1.1.4 (2026-02-02)
------------------

- CLEANUP: various cleanups

1.1.3 (2026-02-02)
------------------

- UPDATE: upgrade NPM dependencies

1.1.2 (2026-02-02)
------------------

- CLEANUP: split test suite

1.1.1 (2026-02-02)
------------------

- CLEANUP: various code cleanups

1.1.0 (2026-02-02)
------------------

- REFACTORING: split Resource Transfer into Sink Push and Source Fetch
- IMPROVEMENT: allow "meta" information for emit()/call()/push()/fetch()
- IMPROVEMENT: provide JWT-based authentication facility
- IMPROVEMENT: provide utility functions for string/buffer conversions
- IMPROVEMENT: MQTTp API is now an event emitter for emitting errors and logs
- IMPROVEMENT: use client/server scenario in test suite
- BUGFIX: avoid race condition in service facility
- UPDATE: upgrade NPM dependencies

1.0.0 (2026-01-25)
------------------

- CLEANUP: various code cleanups

0.9.18 (2026-01-25)
-------------------

- IMPROVEMENT: support config parameter API variant also in subscribe/register/provision
- IMPROVEMENT: support MQTT 5 shared subscriptions also in subscribe/register/provision

0.9.17 (2026-01-25)
-------------------

- IMPROVEMENT: add Dry-Run mode will null MQTT client
- IMPROVEMENT: add Dry-Run mode for emit() to generate last-will message

0.9.16 (2026-01-24)
-------------------

- CLEANUP: cleanup subscription handling
- UPDATE: upgrade NPM dependencies

0.9.15 (2026-01-24)
-------------------

- IMPROVEMENT: provide unpkg.com sample
- IMPROVEMENT: provide esm/cjs/umd import sub-paths

0.9.14 (2026-01-24)
-------------------

- REFACTORING: change external API from Buffer to Uint8Array to better support browsers
- IMPROVEMENT: add "dev" STX target for convenient development

0.9.14 (2026-01-24)
-------------------

- IMPROVEMENT: use Base64 for encoding buffers in JSON encoding
- IMPROVEMENT: switch from "cbor" to "cbor2" for CBOR encoding

[...]

0.9.0 (2026-01-05)
------------------

(first rough cut of library)

