
ChangeLog
=========

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

