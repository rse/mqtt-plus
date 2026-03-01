
AGENTS
======

This file provides guidance to Agentic AI Coding Tools when working with code in this repository.

Project Overview
----------------

MQTT+ (`mqtt-plus`) is a TypeScript library implementing four MQTT communication patterns
with full type safety: Event Emission, Service Call (RPC), Source Fetch, and Sink Push.
It uses `mqtt` as a peer dependency and builds to ESM, CJS, and UMD formats.

Commands
--------

MQTT+ plus uses NPM:

```bash
npm install             # install dependencies
```

Build and development commands use STX (`@rse/stx`) as the task runner:

```bash
npm start lint          # standard: perform static code analysis
npm start build         # standard: build everything
npm start test          # standard: run unit test suite

npm start build-doc     # generate SVG diagrams from D2 sources only
npm start dev           # development watch mode (rebuild on change)
npm start sample        # run sample/sample.ts via `tsx`

npm start clean         # remove dst-stage1/ and dst-stage2/
npm start distclean     # remove node_modules/ and package-lock.json
npm start publish       # publish to npm (restricted to maintainer host)

```

Tests require an MQTT broker under run-time; the test suite starts/stops
one automatically. If Docker is available, a Mosquitto broker is used;
otherwise, the Aedes in-process broker serves as the fallback.

Build Pipeline
--------------

Two-stage build:

1. **Stage 1** — TypeScript → JavaScript + `.d.ts` declarations (output: `dst-stage1/`)
   configured via `etc/tsc.json` (target ES2022, module ESNext, strict mode).

2. **Stage 2** — Vite bundles stage-1 output into three formats (output: `dst-stage2/`):
   `mqtt-plus.esm.js`, `mqtt-plus.cjs.js`, `mqtt-plus.umd.js`.
   UMD build includes Node polyfills (events, stream, buffer).

Configuration lives in `etc/`: `tsc.json`, `vite.mts`, `eslint.mts`, `knip.jsonc`, `stx.conf`, `d2.mts`, `d2.theme.d2`, `logo.ai`, `logo.svg`.

Architecture
------------

### Trait-Based Mixin Tower

The library is composed as a vertical chain of trait classes (mixins),
each extending the previous. The final exported class `MQTTp` sits at
the bottom of this chain:

```
    OptionsTrait        — configuration (id, codec, timeout, chunkSize, chunkCredit, topicMake/topicMatch)
  ↓ CodecTrait          — CBOR/JSON codec handling
  ↓ EncodeTrait         — message encoding/validation (valibot schemas)
  ↓ MsgTrait            — message class definitions and parsing
  ↓ TraceTrait          — EventEmitter + structured logging
  ↓ BaseTrait           — MQTT client hookup, subscription management, message routing
  ↓ SubscriptionTrait   — ref-counted MQTT topic subscription management
  ↓ TimerTrait          — named timer management (refresh/clear)
  ↓ MetaTrait           — instance/per-request metadata
  ↓ AuthTrait           — JWT authentication (jose), role-based access
  ↓ EventTrait          — Event Emission pattern (event/emit)
  ↓ ServiceTrait        — Service Call / RPC pattern (service/call)
  ↓ SourceTrait         — Source Fetch pattern (source/fetch)
  ↓ SinkTrait           — Sink Push pattern (sink/push)
  ↓ MQTTp               — final exported class
```

Each trait lives in its own file: `src/mqtt-plus-<trait>.ts`.

### Key Source Files

| File                            | Role |
|---------------------------------|------|
| `src/mqtt-plus.ts`              | Main entry point, re-exports public API types and the final MQTTp class |
| `src/mqtt-plus-api.ts`          | Branded endpoint type definitions (Event, Service, Source, Sink) and APISchema generic |
| `src/mqtt-plus-info.ts`         | Info/context object types passed to pattern callbacks (sender metadata, etc.) |
| `src/mqtt-plus-error.ts`        | Spool (resource cleanup) and run (error handling) utilities |
| `src/mqtt-plus-util.ts`         | Stream/buffer conversion, RefCountedSubscription, and CreditGate flow control |
| `src/mqtt-plus-version.ts`      | Version utility for converting version strings to numeric format |
| `src/mqtt-plus-options.ts`      | OptionsTrait — configuration (id, codec, timeout, chunkSize, chunkCredit, topicMake/topicMatch) |
| `src/mqtt-plus-codec.ts`        | CodecTrait — CBOR and JSON codec encoding/decoding |
| `src/mqtt-plus-encode.ts`       | EncodeTrait — message validation and encoding via valibot schemas |
| `src/mqtt-plus-msg.ts`          | MsgTrait — message class definitions and parsing logic |
| `src/mqtt-plus-trace.ts`        | TraceTrait — EventEmitter and structured logging |
| `src/mqtt-plus-base.ts`         | BaseTrait — MQTT client connection, subscription management, message routing |
| `src/mqtt-plus-subscription.ts` | SubscriptionTrait — ref-counted MQTT topic subscription management |
| `src/mqtt-plus-timer.ts`        | TimerTrait — named timer management (refresh/clear) |
| `src/mqtt-plus-meta.ts`         | MetaTrait — instance and per-request metadata management |
| `src/mqtt-plus-auth.ts`         | AuthTrait — JWT authentication (jose) and role-based access control |
| `src/mqtt-plus-event.ts`        | EventTrait — Event Emission communication pattern (event/emit) |
| `src/mqtt-plus-service.ts`      | ServiceTrait — Service Call / RPC communication pattern (service/call) |
| `src/mqtt-plus-source.ts`       | SourceTrait — Source Fetch communication pattern (source/fetch) |
| `src/mqtt-plus-sink.ts`         | SinkTrait — Sink Push communication pattern (sink/push) |

### Documentation

The `doc/` directory contains Markdown documentation, D2 diagram sources,
and generated SVG files:

- `doc/mqtt-plus-api.md` — public API reference
- `doc/mqtt-plus-architecture.{d2,svg,md}` — architecture overview (diagram + docs)
- `doc/mqtt-plus-broker-setup.md` — MQTT broker setup guide
- `doc/mqtt-plus-comm.md` — communication patterns overview
- `doc/mqtt-plus-comm-event-emission.{d2,svg}` — Event Emission pattern diagram
- `doc/mqtt-plus-comm-service-call.{d2,svg}` — Service Call pattern diagram
- `doc/mqtt-plus-comm-sink-push.{d2,svg}` — Sink Push pattern diagram
- `doc/mqtt-plus-comm-source-fetch.{d2,svg}` — Source Fetch pattern diagram
- `doc/mqtt-plus-internals.md` — internal implementation details

Regenerate diagrams with `npm start build-doc` (requires the `etc/d2.mts` helper script).

### Tests

Test files live in `tst/`:

| File                              | Role |
|-----------------------------------|------|
| `tst/mqtt-plus-0-fixture.ts`      | Shared test fixture setup (broker, MQTTp instances, etc.) |
| `tst/mqtt-plus-0-broker.ts`       | Broker dispatch: creates Aedes or Mosquitto broker based on env |
| `tst/mqtt-plus-0-broker-aedes.ts` | Helper for starting/stopping the Aedes MQTT broker |
| `tst/mqtt-plus-0-broker-mosquitto.ts` | Helper for starting/stopping the Mosquitto MQTT broker |
| `tst/mqtt-plus-1-api.spec.ts`     | API type and endpoint definition tests |
| `tst/mqtt-plus-2-event.spec.ts`   | Event Emission pattern tests |
| `tst/mqtt-plus-3-service.spec.ts` | Service Call / RPC pattern tests |
| `tst/mqtt-plus-4-sink.spec.ts`    | Sink Push pattern tests |
| `tst/mqtt-plus-5-source.spec.ts`  | Source Fetch pattern tests |
| `tst/mqtt-plus-6-misc.spec.ts`    | Miscellaneous / edge-case tests |
| `tst/tsc.json`                    | TypeScript configuration for the test directory |

### Type System

The API uses branded types (`Event<...>`, `Service<...>`, `Source<...>`,
`Sink<...>`) to define typed endpoint schemas. A generic `APISchema`
type parameter threads through the trait tower, enabling full type
inference for pattern names and parameter types.

Coding Style
------------

- 4-space indentation, double quotes, no semicolons
- Stroustrup brace style (`else`/`catch`/`finally` on new line after closing brace)
- Comments: `/*  ...  */` with two leading/trailing spaces; no `//` end-of-line comments
- Vertical alignment of similar operators on consecutive lines
- Private members prefixed with `_`

