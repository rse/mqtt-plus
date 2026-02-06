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
import * as v           from "valibot"

/*  internal requirements  */
import { APISchema }    from "./mqtt-plus-api"
import { EncodeTrait }  from "./mqtt-plus-encode"

/*  message types  */
type MessageType =
    | "event-emission"
    | "service-call-request"
    | "service-call-response"
    | "sink-push-request"
    | "sink-push-response"
    | "sink-push-chunk"
    | "source-fetch-request"
    | "source-fetch-response"
    | "source-fetch-chunk"

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
    constructor (
        public type:      MessageType,
        public id:        string,
        public sender?:   string,
        public receiver?: string
    ) {}
}
const BaseSchema = {
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
    params:             v.optional(v.array(v.unknown())),
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
        public meta?:   Record<string, any>
    ) { super("service-call-request", id, sender, receiver) }
}
const ServiceCallRequestSchema = v.strictObject({
    ...BaseSchema,
    type:               v.literal("service-call-request"),
    name:               v.string(),
    params:             v.optional(v.array(v.unknown())),
    auth:               v.optional(AuthSchema),
    meta:               v.optional(MetaSchema)
})

/*  service response  */
export class ServiceCallResponse extends Base {
    constructor (
        id:             string,
        public result?: any,
        public error?:  string,
        sender?:        string,
        receiver?:      string
    ) { super("service-call-response", id, sender, receiver) }
}
const ServiceCallResponseSchema = v.strictObject({
    ...BaseSchema,
    type:               v.literal("service-call-response"),
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
        public meta?:    Record<string, any>
    ) { super("sink-push-request", id, sender, receiver) }
}
const SinkPushRequestSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("sink-push-request"),
    name:                v.string(),
    params:              v.optional(v.array(v.unknown())),
    auth:                v.optional(AuthSchema),
    meta:                v.optional(MetaSchema)
})

/*  sink push response (ack/nak)  */
export class SinkPushResponse extends Base {
    constructor (
        id:              string,
        public name:     string,
        public error?:   string,
        sender?:         string,
        receiver?:       string,
        public auth?:    string[],
        public meta?:    Record<string, any>
    ) { super("sink-push-response", id, sender, receiver) }
}
const SinkPushResponseSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("sink-push-response"),
    name:                v.string(),
    error:               v.optional(v.string()),
    auth:                v.optional(AuthSchema),
    meta:                v.optional(MetaSchema)
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

/*  source fetch request  */
export class SourceFetchRequest extends Base {
    constructor (
        id:              string,
        public name:     string,
        public params?:  any[],
        sender?:         string,
        receiver?:       string,
        public auth?:    string[],
        public meta?:    Record<string, any>
    ) { super("source-fetch-request", id, sender, receiver) }
}
const SourceFetchRequestSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("source-fetch-request"),
    name:                v.string(),
    params:              v.optional(v.array(v.unknown())),
    auth:                v.optional(AuthSchema),
    meta:                v.optional(MetaSchema)
})

/*  source fetch response (ack/nak)  */
export class SourceFetchResponse extends Base {
    constructor (
        id:              string,
        public name:     string,
        public error?:   string,
        sender?:         string,
        receiver?:       string,
        public auth?:    string[],
        public meta?:    Record<string, any>
    ) { super("source-fetch-response", id, sender, receiver) }
}
const SourceFetchResponseSchema = v.strictObject({
    ...BaseSchema,
    type:                v.literal("source-fetch-response"),
    name:                v.string(),
    error:               v.optional(v.string()),
    auth:                v.optional(AuthSchema),
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
        meta?:          Record<string, any>
    ) {
        return new ServiceCallRequest(id, name, params, sender, receiver, auth, meta)
    }
    makeServiceCallResponse (
        id:             string,
        result?:        any,
        error?:         string,
        sender?:        string,
        receiver?:      string
    ) {
        return new ServiceCallResponse(id, result, error, sender, receiver)
    }
    makeSinkPushRequest (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ) {
        return new SinkPushRequest(id, name, params, sender, receiver, auth, meta)
    }
    makeSinkPushResponse (
        id:             string,
        name:           string,
        error?:         string,
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ) {
        return new SinkPushResponse(id, name, error, sender, receiver, auth, meta)
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
    makeSourceFetchRequest (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ) {
        return new SourceFetchRequest(id, name, params, sender, receiver, auth, meta)
    }
    makeSourceFetchResponse (
        id:             string,
        name:           string,
        error?:         string,
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ) {
        return new SourceFetchResponse(id, name, error, sender, receiver, auth, meta)
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

    /*  parse any object into typed object  */
    parse (obj: any):
        EventEmission        |
        ServiceCallRequest   |
        ServiceCallResponse  |
        SinkPushRequest      |
        SinkPushResponse     |
        SinkPushChunk        |
        SourceFetchRequest   |
        SourceFetchResponse  |
        SourceFetchChunk {
        /*  sanity check input  */
        if (typeof obj !== "object" || obj === null)
            throw new Error("invalid argument: not an object")
        if (typeof obj.type !== "string")
            throw new Error("invalid object: missing or invalid \"type\" field")

        /*  helper function for Valibot-based validation  */
        const parseObject = <T>(obj: any, name: string, schema: v.BaseSchema<any, any, any>): T => {
            const res = v.safeParse(schema, obj)
            if (!res.success) {
                const issues = res.issues.map((issue) => issue.message).join("; ")
                throw new Error(`invalid ${name} object: ${issues}`)
            }
            return res.output
        }

        /*  dispatch according to type indication by field  */
        if (obj.type === "event-emission") {
            const out = parseObject<EventEmission>(obj, "EventEmission", EventEmissionSchema)
            return this.makeEventEmission(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta)
        }
        else if (obj.type === "service-call-request") {
            const out = parseObject<ServiceCallRequest>(obj, "ServiceCallRequest", ServiceCallRequestSchema)
            return this.makeServiceCallRequest(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta)
        }
        else if (obj.type === "service-call-response") {
            const out = parseObject<ServiceCallResponse>(obj, "ServiceCallResponse", ServiceCallResponseSchema)
            return this.makeServiceCallResponse(out.id, out.result, out.error, out.sender, out.receiver)
        }
        else if (obj.type === "sink-push-request") {
            const out = parseObject<SinkPushRequest>(obj, "SinkPushRequest", SinkPushRequestSchema)
            return this.makeSinkPushRequest(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta)
        }
        else if (obj.type === "sink-push-response") {
            const out = parseObject<SinkPushResponse>(obj, "SinkPushResponse", SinkPushResponseSchema)
            return this.makeSinkPushResponse(out.id, out.name, out.error, out.sender, out.receiver,
                out.auth, out.meta)
        }
        else if (obj.type === "sink-push-chunk") {
            const out = parseObject<SinkPushChunk>(obj, "SinkPushChunk", SinkPushChunkSchema)
            return this.makeSinkPushChunk(out.id, out.name, out.chunk, out.error,
                out.final, out.sender, out.receiver)
        }
        else if (obj.type === "source-fetch-request") {
            const out = parseObject<SourceFetchRequest>(obj, "SourceFetchRequest", SourceFetchRequestSchema)
            return this.makeSourceFetchRequest(out.id, out.name, out.params, out.sender, out.receiver,
                out.auth, out.meta)
        }
        else if (obj.type === "source-fetch-response") {
            const out = parseObject<SourceFetchResponse>(obj, "SourceFetchResponse", SourceFetchResponseSchema)
            return this.makeSourceFetchResponse(out.id, out.name, out.error, out.sender, out.receiver,
                out.auth, out.meta)
        }
        else if (obj.type === "source-fetch-chunk") {
            const out = parseObject<SourceFetchChunk>(obj, "SourceFetchChunk", SourceFetchChunkSchema)
            return this.makeSourceFetchChunk(out.id, out.name, out.chunk, out.error,
                out.final, out.sender, out.receiver)
        }
        else
            throw new Error("invalid object: not of any known type")
    }
}

/*  message trait  */
export class MsgTrait<T extends APISchema = APISchema> extends EncodeTrait<T> {
    protected msg = new Msg()
}
