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

/*  internal requirements  */
import { APISchema }    from "./mqtt-plus-api"
import { EncodeTrait }  from "./mqtt-plus-encode"

/*  message types  */
type MessageType =
    | "event-emission"
    | "service-call-request"
    | "service-call-response"
    | "sink-push-response"
    | "source-fetch-request"
    | "source-fetch-response"
    | "source-fetch-chunk"

/*  base class  */
class Base {
    constructor (
        public type:      MessageType,
        public id:        string,
        public sender?:   string,
        public receiver?: string
    ) {}
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

/*  sink push response (chunks for push)  */
export class SinkPushResponse extends Base {
    constructor (
        id:            string,
        public name?:  string,
        public params?:   any[],
        public chunk?:    Uint8Array,
        public error?:    string,
        public final?:    boolean,
        sender?:          string,
        receiver?:        string,
        public auth?:     string[],
        public meta?:     Record<string, any>
    ) { super("sink-push-response", id, sender, receiver) }
}

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

/*  utility class  */
class Msg {
    /*  factory for event emission  */
    makeEventEmission (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ): EventEmission {
        return new EventEmission(id, name, params, sender, receiver, auth, meta)
    }

    /*  factory for service request  */
    makeServiceCallRequest (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ): ServiceCallRequest {
        return new ServiceCallRequest(id, name, params, sender, receiver, auth, meta)
    }

    /*  factory for service response success  */
    makeServiceCallResponse (
        id:             string,
        result?:        any,
        error?:         string,
        sender?:        string,
        receiver?:      string
    ): ServiceCallResponse {
        return new ServiceCallResponse(id, result, error, sender, receiver)
    }

    /*  factory for sink push response  */
    makeSinkPushResponse (
        id:             string,
        name?:          string,
        params?:        any[],
        chunk?:         Uint8Array,
        error?:         string,
        final?:         boolean,
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ): SinkPushResponse {
        return new SinkPushResponse(id, name, params, chunk, error, final, sender, receiver, auth, meta)
    }

    /*  factory for source fetch request  */
    makeSourceFetchRequest (
        id:             string,
        name:           string,
        params?:        any[],
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ): SourceFetchRequest {
        return new SourceFetchRequest(id, name, params, sender, receiver, auth, meta)
    }

    /*  factory for source fetch response  */
    makeSourceFetchResponse (
        id:             string,
        name:           string,
        error?:         string,
        sender?:        string,
        receiver?:      string,
        auth?:          string[],
        meta?:          Record<string, any>
    ): SourceFetchResponse {
        return new SourceFetchResponse(id, name, error, sender, receiver, auth, meta)
    }

    /*  factory for source fetch chunk  */
    makeSourceFetchChunk (
        id:             string,
        name:           string,
        chunk?:         Uint8Array,
        error?:         string,
        final?:         boolean,
        sender?:        string,
        receiver?:      string
    ): SourceFetchChunk {
        return new SourceFetchChunk(id, name, chunk, error, final, sender, receiver)
    }

    /*  parse any object into typed object  */
    parse (obj: any):
        EventEmission        |
        ServiceCallRequest   |
        ServiceCallResponse  |
        SinkPushResponse     |
        SourceFetchRequest   |
        SourceFetchResponse  |
        SourceFetchChunk {
        if (typeof obj !== "object" || obj === null)
            throw new Error("invalid argument: not an object")

        /*  validate common fields  */
        if (!("type" in obj) || typeof obj.type !== "string")
            throw new Error("invalid object: missing or invalid \"type\" field")
        if (!("id" in obj) || typeof obj.id !== "string")
            throw new Error("invalid object: missing or invalid \"id\" field")
        if ("sender" in obj && obj.sender !== undefined && typeof obj.sender !== "string")
            throw new Error("invalid object: invalid \"sender\" field")
        if ("receiver" in obj && obj.receiver !== undefined && typeof obj.receiver !== "string")
            throw new Error("invalid object: invalid \"receiver\" field")

        /*  utility predicates for validation  */
        const anyFieldsExcept = (obj: object, allowed: string[]) =>
            Object.keys(obj).some((key) => !allowed.includes(key))
        const validParams = (obj: any) =>
            obj.params === undefined || (typeof obj.params === "object" && Array.isArray(obj.params))

        /*  dispatch according to type indication by field  */
        if (obj.type === "event-emission") {
            /*  detect and parse event emission  */
            if (typeof obj.name !== "string")
                throw new Error("invalid EventEmission object: \"name\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "name", "params", "sender", "receiver", "auth", "meta" ]))
                throw new Error("invalid EventEmission object: contains unknown fields")
            if (!validParams(obj))
                throw new Error("invalid EventEmission object: \"params\" field must be an array")
            return this.makeEventEmission(obj.id, obj.name, obj.params, obj.sender, obj.receiver, obj.auth, obj.meta)
        }
        else if (obj.type === "service-call-request") {
            /*  detect and parse service request  */
            if (typeof obj.name !== "string")
                throw new Error("invalid ServiceCallRequest object: \"name\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "name", "params", "sender", "receiver", "auth", "meta" ]))
                throw new Error("invalid ServiceCallRequest object: contains unknown fields")
            if (!validParams(obj))
                throw new Error("invalid ServiceCallRequest object: \"params\" field must be an array")
            return this.makeServiceCallRequest(obj.id, obj.name, obj.params, obj.sender, obj.receiver, obj.auth, obj.meta)
        }
        else if (obj.type === "service-call-response") {
            /*  detect and parse service response success  */
            if (anyFieldsExcept(obj, [ "type", "id", "result", "error", "sender", "receiver" ]))
                throw new Error("invalid ServiceCallResponse object: contains unknown fields")
            return this.makeServiceCallResponse(obj.id, obj.result, obj.error, obj.sender, obj.receiver)
        }
        else if (obj.type === "sink-push-response") {
            /*  detect and parse sink push response  */
            if (obj.name !== undefined && typeof obj.name !== "string")
                throw new Error("invalid SinkPushResponse object: \"name\" field must be a string")
            if (obj.chunk !== undefined && (obj.chunk === null || typeof obj.chunk !== "object"))
                throw new Error("invalid SinkPushResponse object: \"chunk\" field must be an object")
            if (obj.error !== undefined && typeof obj.error !== "string")
                throw new Error("invalid SinkPushResponse object: \"error\" field must be a string")
            if (obj.final !== undefined && typeof obj.final !== "boolean")
                throw new Error("invalid SinkPushResponse object: \"final\" field must be a boolean")
            if (!validParams(obj))
                throw new Error("invalid SinkPushResponse object: \"params\" field must be an array")
            if (anyFieldsExcept(obj, [ "type", "id", "name", "params",
                "chunk", "error", "final", "sender", "receiver", "auth", "meta" ]))
                throw new Error("invalid SinkPushResponse object: contains unknown fields")
            return this.makeSinkPushResponse(obj.id, obj.name, obj.params,
                obj.chunk, obj.error, obj.final, obj.sender, obj.receiver, obj.auth, obj.meta)
        }
        else if (obj.type === "source-fetch-request") {
            /*  detect and parse source fetch request  */
            if (typeof obj.name !== "string")
                throw new Error("invalid SourceFetchRequest object: \"name\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "name", "params", "sender", "receiver", "auth", "meta" ]))
                throw new Error("invalid SourceFetchRequest object: contains unknown fields")
            if (!validParams(obj))
                throw new Error("invalid SourceFetchRequest object: \"params\" field must be an array")
            return this.makeSourceFetchRequest(obj.id, obj.name, obj.params, obj.sender, obj.receiver, obj.auth, obj.meta)
        }
        else if (obj.type === "source-fetch-response") {
            /*  detect and parse source fetch response (ack/nak)  */
            if (typeof obj.name !== "string")
                throw new Error("invalid SourceFetchResponse object: \"name\" field must be a string")
            if (obj.error !== undefined && typeof obj.error !== "string")
                throw new Error("invalid SourceFetchResponse object: \"error\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "name", "error", "sender", "receiver", "auth", "meta" ]))
                throw new Error("invalid SourceFetchResponse object: contains unknown fields")
            return this.makeSourceFetchResponse(obj.id, obj.name, obj.error, obj.sender, obj.receiver, obj.auth, obj.meta)
        }
        else if (obj.type === "source-fetch-chunk") {
            /*  detect and parse source fetch chunk (actual data transfer)  */
            if (typeof obj.name !== "string")
                throw new Error("invalid SourceFetchChunk object: \"name\" field must be a string")
            if (obj.chunk !== undefined && (obj.chunk === null || typeof obj.chunk !== "object"))
                throw new Error("invalid SourceFetchChunk object: \"chunk\" field must be an object")
            if (obj.error !== undefined && typeof obj.error !== "string")
                throw new Error("invalid SourceFetchChunk object: \"error\" field must be a string")
            if (obj.final !== undefined && typeof obj.final !== "boolean")
                throw new Error("invalid SourceFetchChunk object: \"final\" field must be a boolean")
            if (anyFieldsExcept(obj, [ "type", "id", "name", "chunk", "error", "final", "sender", "receiver" ]))
                throw new Error("invalid SourceFetchChunk object: contains unknown fields")
            return this.makeSourceFetchChunk(obj.id, obj.name, obj.chunk, obj.error, obj.final, obj.sender, obj.receiver)
        }
        else
            throw new Error("invalid object: not of any known type")
    }
}

/*  message trait  */
export class MsgTrait<T extends APISchema = APISchema> extends EncodeTrait<T> {
    protected msg = new Msg()
}
