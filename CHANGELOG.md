
ChangeLog
=========

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

