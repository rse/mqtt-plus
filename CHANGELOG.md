
ChangeLog
=========

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

