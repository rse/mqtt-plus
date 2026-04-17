/*
**  MQTT+ -- MQTT Communication Patterns
**  Copyright (c) 2018-2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**
**  Permission is hereby granted, free of charge, to any person obtaining
**  a copy of this software and associated documentation files (the
**  "Software"), to deal in the Software without restriction, including
**  without limitation the rights to use, copy, modify, merge, publish,
**  distribute, sublicense, and/or sell copies of the Software, and to
**  permit persons to whom the Software is furnished to do so, subject to
**  the following conditions:
**
**  The above copyright notice and this permission notice shall be included
**  in all copies or substantial portions of the Software.
**
**  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
**  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
**  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
**  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
**  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
**  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
**  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

/*  external requirements  */
import * as v                              from "valibot"

/*  internal requirements  */
import type { APISchema }                  from "./mqtt-plus-api"
import { EncodeTrait }                     from "./mqtt-plus-encode"
import { version, VERSION,
    minVersion, MIN_VERSION,
    versionToNum }                         from "./mqtt-plus-version"

/*  message types  */
type MessageType =
    | "event-emission"
    | "service-call-request"
    | "service-call-response"
    | "sink-push-request"
    | "sink-push-response"
    | "sink-push-chunk"
    | "sink-push-credit"
    | "source-fetch-request"
    | "source-fetch-response"
    | "source-fetch-chunk"
    | "source-fetch-credit"

/*  meta validation schema (non-array plain object)  */
const MetaSchema = v.pipe(
    v.record(v.string(), v.unknown()),
    v.check((data) => !Array.isArray(data)))

/*  reusable auth validation schema (max 8 tokens, max 8192 chars each)  */
const AuthSchema = v.pipe(
    v.array(v.pipe(v.string(), v.maxLength(8192))),
    v.maxLength(8))

/*  base class  */
class Base {
    public version = `MQTT+/${VERSION}`
    constructor (
        public type:      MessageType,
        public id:        string,
        public sender?:   string,
        public receiver?: string
    ) {}
}
const BaseSchema = {
    version:              v.pipe(v.string(), v.regex(/^MQTT\+\/\d+\.\d+$/)),
    type:                 v.string(),
    id:                   v.string(),
    sender:               v.optional(v.string()),
    receiver:             v.optional(v.string())
}

/*  event emission  */
export class EventEmission extends Base {
    constructor (
        id:             string,
        public name:    string,
        public params?: any[],
        sender?:        string,
        receiver?:      string,
        public auth?:   string[],
        public meta?:   Record<string, any>
    ) { super("event-emission", id, sender, receiver) }
}
const EventEmissionSchema = v.strictObject({
    ...BaseSchema,
    type:               v.literal("event-emission"),
    name:               v.string(),
    params:             v.optional(v.pipe(v.array(v.unknown()), v.maxLength(64))),
    auth:               v.optional(AuthSchema),
    meta:               v.optional(MetaSchema)
})

/*  service request  */
export class ServiceCallRequest extends Base {
    constructor (
        id:             string,
        public name:    string,
        public params?: any[],
        sender?:        string,
        receiver?:      string,
        public auth?:   string[],
        public meta?:   Record<string, any>,
        public qos?:    0 | 1 | 2
    ) { super("service-call-request", id, sender, receiver) }
}
const ServiceCallRequestSchema = v.strictObject({
    ...BaseSchema,
    type:               v.literal("service-call-request"),
    name:               v.string(),
    params:             v.optional(v.pipe(v.array(v.unknown()), v.maxLength(64))),
    auth:               v.optional(AuthSchema),
    meta:               v.optional(MetaSchema),
    qos:                v.optional(v.picklist([ 0, 1, 2 ]))
})

/*  service response  */
export class ServiceCallResponse extends Base {
    constructor (
        id:             string,
        public name:    string,
        public result?: any,
        public error?:  string,
        sender?:        string,
        receiver?:      string
    ) { super("service-call-response", id, sender, receiver) }
}
const ServiceCallResponseSchema = v.strictObject({
    ...BaseSchema,
    type:               v.literal("service-call-response"),
    name:               v.string(),
    result:             v.optional(v.unknown()),
    error:              v.optional(v.string())
})

/*  sink push request  */
export class SinkPushRequest extends Base {
    constructor (
        id:              string,
        public name:     string,
        public params?:  any[],
        sender?:         string,
        receiver?:       string,
        public auth?:    string[],
        public meta?:    Record<string, any>,
        public qos?:     0 | 1 | 2
    ) { super("sink-push-request", id, sender, receiver) }
}
const SinkPushRequestSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("sink-push-request"),
    name:                v.string(),
    params:              v.optional(v.pipe(v.array(v.unknown()), v.maxLength(64))),
    auth:                v.optional(AuthSchema),
    meta:                v.optional(MetaSchema),
    qos:                 v.optional(v.picklist([ 0, 1, 2 ]))
})

/*  sink push response (ack/nak)  */
export class SinkPushResponse extends Base {
    constructor (
        id:              string,
        public name:     string,
        public error?:   string,
        sender?:         string,
        receiver?:       string,
        public credit?:  number
    ) { super("sink-push-response", id, sender, receiver) }
}
const SinkPushResponseSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("sink-push-response"),
    name:                v.string(),
    error:               v.optional(v.string()),
    credit:              v.optional(v.pipe(v.number(), v.integer(), v.minValue(1)))
})

/*  sink push chunk (actual data transfer)  */
export class SinkPushChunk extends Base {
    constructor (
        id:              string,
        public name:     string,
        public chunk?:   Uint8Array,
        public error?:   string,
        public final?:   boolean,
        sender?:         string,
        receiver?:       string
    ) { super("sink-push-chunk", id, sender, receiver) }
}
const SinkPushChunkSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("sink-push-chunk"),
    name:                v.string(),
    chunk:               v.optional(v.instance(Uint8Array)),
    error:               v.optional(v.string()),
    final:               v.optional(v.boolean())
})

/*  sink push credit (credit replenishment for push flow control)  */
export class SinkPushCredit extends Base {
    constructor (
        id:              string,
        public name:     string,
        public credit:   number,
        sender?:         string,
        receiver?:       string
    ) { super("sink-push-credit", id, sender, receiver) }
}
const SinkPushCreditSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("sink-push-credit"),
    name:                v.string(),
    credit:              v.pipe(v.number(), v.integer(), v.minValue(0))
})

/*  source fetch request  */
export class SourceFetchRequest extends Base {
    constructor (
        id:              string,
        public name:     string,
        public params?:  any[],
        sender?:         string,
        receiver?:       string,
        public auth?:    string[],
        public meta?:    Record<string, any>,
        public credit?:  number,
        public qos?:     0 | 1 | 2
    ) { super("source-fetch-request", id, sender, receiver) }
}
const SourceFetchRequestSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("source-fetch-request"),
    name:                v.string(),
    params:              v.optional(v.pipe(v.array(v.unknown()), v.maxLength(64))),
    auth:                v.optional(AuthSchema),
    meta:                v.optional(MetaSchema),
    credit:              v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    qos:                 v.optional(v.picklist([ 0, 1, 2 ]))
})

/*  source fetch response (ack/nak)  */
export class SourceFetchResponse extends Base {
    constructor (
        id:              string,
        public name:     string,
        public error?:   string,
        sender?:         string,
        receiver?:       string,
        public meta?:    Record<string, any>
    ) { super("source-fetch-response", id, sender, receiver) }
}
const SourceFetchResponseSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("source-fetch-response"),
    name:                v.string(),
    error:               v.optional(v.string()),
    meta:                v.optional(MetaSchema)
})

/*  source fetch chunk (actual data transfer)  */
export class SourceFetchChunk extends Base {
    constructor (
        id:              string,
        public name:     string,
        public chunk?:   Uint8Array,
        public error?:   string,
        public final?:   boolean,
        sender?:         string,
        receiver?:       string
    ) { super("source-fetch-chunk", id, sender, receiver) }
}
const SourceFetchChunkSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("source-fetch-chunk"),
    name:                v.string(),
    chunk:               v.optional(v.instance(Uint8Array)),
    error:               v.optional(v.string()),
    final:               v.optional(v.boolean())
})

/*  source fetch credit (credit replenishment for fetch flow control)  */
export class SourceFetchCredit extends Base {
    constructor (
        id:              string,
        public name:     string,
        public credit:   number,
        sender?:         string,
        receiver?:       string
    ) { super("source-fetch-credit", id, sender, receiver) }
}
const SourceFetchCreditSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("source-fetch-credit"),
    name:                v.string(),
    credit:              v.pipe(v.number(), v.integer(), v.minValue(0))
})

/*  union type of all messages  */
export type Message =
    | EventEmission
    | ServiceCallRequest
    | ServiceCallResponse
    | SinkPushRequest
    | SinkPushResponse
    | SinkPushChunk
    | SinkPushCredit
    | SourceFetchRequest
    | SourceFetchResponse
    | SourceFetchChunk
    | SourceFetchCredit

/*  utility class  */
class Msg {
    /*  factories for creating objects  */
    makeEventEmission (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ) {
        return new EventEmission(id, name, params, sender, receiver, auth, meta)
    }
    makeServiceCallRequest (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>,
        qos?:           0 | 1 | 2
    ) {
        return new ServiceCallRequest(id, name, params, sender, receiver, auth, meta, qos)
    }
    makeServiceCallResponse (
        id:             string,
        name:           string,
        result?:        any,
        error?:         string,
        sender?:        string,
        receiver?:      string
    ) {
        return new ServiceCallResponse(id, name, result, error, sender, receiver)
    }
    makeSinkPushRequest (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>,
        qos?:           0 | 1 | 2
    ) {
        return new SinkPushRequest(id, name, params, sender, receiver, auth, meta, qos)
    }
    makeSinkPushResponse (
        id:             string,
        name:           string,
        error?:         string,
        sender?:        string,
        receiver?:      string,
        credit?:        number
    ) {
        return new SinkPushResponse(id, name, error, sender, receiver, credit)
    }
    makeSinkPushChunk (
        id:             string,
        name:           string,
        chunk?:         Uint8Array,
        error?:         string,
        final?:         boolean,
        sender?:        string,
        receiver?:      string
    ) {
        return new SinkPushChunk(id, name, chunk, error, final, sender, receiver)
    }
    makeSinkPushCredit (
        id:             string,
        name:           string,
        credit:         number,
        sender?:        string,
        receiver?:      string
    ) {
        return new SinkPushCredit(id, name, credit, sender, receiver)
    }
    makeSourceFetchRequest (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>,
        credit?:        number,
        qos?:           0 | 1 | 2
    ) {
        return new SourceFetchRequest(id, name, params, sender, receiver, auth, meta, credit, qos)
    }
    makeSourceFetchResponse (
        id:             string,
        name:           string,
        error?:         string,
        sender?:        string,
        receiver?:      string,
        meta?:          Record<string, any>
    ) {
        return new SourceFetchResponse(id, name, error, sender, receiver, meta)
    }
    makeSourceFetchChunk (
        id:             string,
        name:           string,
        chunk?:         Uint8Array,
        error?:         string,
        final?:         boolean,
        sender?:        string,
        receiver?:      string
    ) {
        return new SourceFetchChunk(id, name, chunk, error, final, sender, receiver)
    }
    makeSourceFetchCredit (
        id:             string,
        name:           string,
        credit:         number,
        sender?:        string,
        receiver?:      string
    ) {
        return new SourceFetchCredit(id, name, credit, sender, receiver)
    }

    /*  parse any object into typed object  */
    parse (obj: any): Message {
        /*  sanity check input  */
        if (typeof obj !== "object" || obj === null)
            throw new Error("invalid argument: not an object")

        /*  sanity check version  */
        if (typeof obj.version !== "string")
            throw new Error("invalid object: missing or invalid \"version\" field")
        const match      = obj.version.match(/^MQTT\+\/(\d+\.\d+)$/)
        const versionNum = match !== null ? versionToNum(match[1]) : 0
        if (Math.floor(versionNum / 100) !== Math.floor(version / 100) || versionNum < minVersion)
            throw new Error(`protocol version mismatch (expected version ${MIN_VERSION}...${VERSION}, got version ${obj.version})`)

        /*  helper function for Valibot-based validation  */
        const parseObject = <R>(obj: unknown, name: string, schema: v.BaseSchema<any, any, any>): R => {
            const res = v.safeParse(schema, obj)
            if (!res.success) {
                const issues = res.issues.map((issue) => issue.message).join("; ")
                throw new Error(`invalid ${name} object: ${issues}`)
            }
            return res.output
        }

        /*  dispatch according to type indication by field  */
        if (typeof obj.type !== "string")
            throw new Error("invalid object: missing or invalid \"type\" field")
        if (obj.type === "event-emission") {
            const out = parseObject<EventEmission>(obj, "EventEmission", EventEmissionSchema)
            return this.makeEventEmission(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta)
        }
        else if (obj.type === "service-call-request") {
            const out = parseObject<ServiceCallRequest>(obj, "ServiceCallRequest", ServiceCallRequestSchema)
            return this.makeServiceCallRequest(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta, out.qos)
        }
        else if (obj.type === "service-call-response") {
            const out = parseObject<ServiceCallResponse>(obj, "ServiceCallResponse", ServiceCallResponseSchema)
            return this.makeServiceCallResponse(out.id, out.name, out.result, out.error, out.sender, out.receiver)
        }
        else if (obj.type === "sink-push-request") {
            const out = parseObject<SinkPushRequest>(obj, "SinkPushRequest", SinkPushRequestSchema)
            return this.makeSinkPushRequest(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta, out.qos)
        }
        else if (obj.type === "sink-push-response") {
            const out = parseObject<SinkPushResponse>(obj, "SinkPushResponse", SinkPushResponseSchema)
            return this.makeSinkPushResponse(out.id, out.name, out.error, out.sender, out.receiver,
                out.credit)
        }
        else if (obj.type === "sink-push-chunk") {
            const out = parseObject<SinkPushChunk>(obj, "SinkPushChunk", SinkPushChunkSchema)
            return this.makeSinkPushChunk(out.id, out.name, out.chunk, out.error,
                out.final, out.sender, out.receiver)
        }
        else if (obj.type === "sink-push-credit") {
            const out = parseObject<SinkPushCredit>(obj, "SinkPushCredit", SinkPushCreditSchema)
            return this.makeSinkPushCredit(out.id, out.name, out.credit, out.sender, out.receiver)
        }
        else if (obj.type === "source-fetch-request") {
            const out = parseObject<SourceFetchRequest>(obj, "SourceFetchRequest", SourceFetchRequestSchema)
            return this.makeSourceFetchRequest(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta, out.credit, out.qos)
        }
        else if (obj.type === "source-fetch-response") {
            const out = parseObject<SourceFetchResponse>(obj, "SourceFetchResponse", SourceFetchResponseSchema)
            return this.makeSourceFetchResponse(out.id, out.name, out.error, out.sender, out.receiver,
                out.meta)
        }
        else if (obj.type === "source-fetch-chunk") {
            const out = parseObject<SourceFetchChunk>(obj, "SourceFetchChunk", SourceFetchChunkSchema)
            return this.makeSourceFetchChunk(out.id, out.name, out.chunk, out.error,
                out.final, out.sender, out.receiver)
        }
        else if (obj.type === "source-fetch-credit") {
            const out = parseObject<SourceFetchCredit>(obj, "SourceFetchCredit", SourceFetchCreditSchema)
            return this.makeSourceFetchCredit(out.id, out.name, out.credit, out.sender, out.receiver)
        }
        else
            throw new Error("invalid object: not of any known type")
    }

    /*  guard for request messages  */
    isRequest (msg: any): msg is (
        EventEmission | ServiceCallRequest | SourceFetchRequest | SinkPushRequest
    ) {
        return (
            msg instanceof EventEmission
            || msg instanceof ServiceCallRequest
            || msg instanceof SourceFetchRequest
            || msg instanceof SinkPushRequest
        )
    }

    /*  guard for response messages  */
    isResponse (msg: any): msg is (
        ServiceCallResponse | SinkPushResponse | SinkPushChunk | SinkPushCredit |
        SourceFetchResponse | SourceFetchChunk | SourceFetchCredit
    ) {
        return (
            msg instanceof ServiceCallResponse
            || msg instanceof SinkPushResponse
            || msg instanceof SinkPushChunk
            || msg instanceof SinkPushCredit
            || msg instanceof SourceFetchResponse
            || msg instanceof SourceFetchChunk
            || msg instanceof SourceFetchCredit
        )
    }
}

/*  message trait  */
export class MsgTrait<T extends APISchema = APISchema> extends EncodeTrait<T> {
    protected msg = new Msg()
}
