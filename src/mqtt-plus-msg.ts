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
import { APISchema }  from "./mqtt-plus-api"
import { CodecTrait } from "./mqtt-plus-codec"

/*  base class  */
export class Base {
    constructor (
        public type:      string,
        public id:        string,
        public sender?:   string,
        public receiver?: string
    ) {}
}

/*  event emission  */
export class EventEmission extends Base {
    constructor (
        id:             string,
        public event:   string,
        public params?: any[],
        sender?:        string,
        receiver?:      string
    ) { super("event-emission", id, sender, receiver) }
}

/*  stream chunk  */
export class StreamTransfer extends Base {
    constructor (
        id:             string,
        public stream:  string,
        public chunk:   Buffer | null,
        public params?: any[],
        sender?:        string,
        receiver?:      string
    ) { super("stream-transfer", id, sender, receiver) }
}

/*  service request  */
export class ServiceCallRequest extends Base {
    constructor (
        id:             string,
        public service: string,
        public params?: any[],
        sender?:        string,
        receiver?:      string
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

/*  resource request  */
export class ResourceTransferRequest extends Base {
    constructor (
        id:              string,
        public resource: string,
        public params?:  any[],
        sender?:         string,
        receiver?:       string
    ) { super("resource-transfer-request", id, sender, receiver) }
}

/*  resource response  */
export class ResourceTransferResponse extends Base {
    constructor (
        id:              string,
        public chunk:    Buffer | null | undefined,
        public error:    string | undefined,
        sender?:         string,
        receiver?:       string
    ) { super("resource-transfer-response", id, sender, receiver) }
}

/*  utility class  */
export default class Msg {
    /*  factory for event emission  */
    makeEventEmission (
        id:             string,
        event:          string,
        params?:        any[],
        sender?:        string,
        receiver?:      string
    ): EventEmission {
        return new EventEmission(id, event, params, sender, receiver)
    }

    /*  factory for stream chunk  */
    makeStreamTransfer (
        id:             string,
        stream:         string,
        chunk:          Buffer | null,
        params?:        any[],
        sender?:        string,
        receiver?:      string
    ): StreamTransfer {
        return new StreamTransfer(id, stream, chunk, params, sender, receiver)
    }

    /*  factory for service request  */
    makeServiceCallRequest (
        id:             string,
        service:        string,
        params?:        any[],
        sender?:        string,
        receiver?:      string
    ): ServiceCallRequest {
        return new ServiceCallRequest(id, service, params, sender, receiver)
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

    /*  factory for resource request  */
    makeResourceTransferRequest (
        id:             string,
        resource:       string,
        params?:        any[],
        sender?:        string,
        receiver?:      string
    ): ResourceTransferRequest {
        return new ResourceTransferRequest(id, resource, params, sender, receiver)
    }

    /*  factory for resource response  */
    makeResourceTransferResponse (
        id:             string,
        chunk?:         Buffer | null,
        error?:         string,
        sender?:        string,
        receiver?:      string
    ): ResourceTransferResponse {
        return new ResourceTransferResponse(id, chunk, error, sender, receiver)
    }

    /*  parse any object into typed object  */
    parse (obj: any):
        EventEmission            |
        StreamTransfer           |
        ServiceCallRequest       |
        ServiceCallResponse      |
        ResourceTransferRequest  |
        ResourceTransferResponse {
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

        /*  dispatch according to type indication by field  */
        const anyFieldsExcept = (obj: object, allowed: string[]) =>
            Object.keys(obj).some((key) => !allowed.includes(key))
        const validParams = (obj: any) =>
            obj.params === undefined || (typeof obj.params === "object" && Array.isArray(obj.params))
        if (obj.type === "event-emission") {
            /*  detect and parse event emission  */
            if (typeof obj.event !== "string")
                throw new Error("invalid EventEmission object: \"event\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "event", "params", "sender", "receiver" ]))
                throw new Error("invalid EventEmission object: contains unknown fields")
            if (!validParams(obj))
                throw new Error("invalid EventEmission object: \"params\" field must be an array")
            return this.makeEventEmission(obj.id, obj.event, obj.params, obj.sender, obj.receiver)
        }
        else if (obj.type === "stream-transfer") {
            /*  detect and parse stream chunk  */
            if (typeof obj.stream !== "string")
                throw new Error("invalid StreamTransfer object: \"stream\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "stream", "chunk", "params", "sender", "receiver" ]))
                throw new Error("invalid StreamTransfer object: contains unknown fields")
            if (obj.chunk !== undefined && typeof obj.chunk !== "object")
                throw new Error("invalid StreamTransfer object: \"chunk\" field must be an object or null")
            if (!validParams(obj))
                throw new Error("invalid StreamTransfer object: \"params\" field must be an array")
            return this.makeStreamTransfer(obj.id, obj.stream, obj.chunk, obj.params, obj.sender, obj.receiver)
        }
        else if (obj.type === "service-call-request") {
            /*  detect and parse service request  */
            if (typeof obj.service !== "string")
                throw new Error("invalid ServiceCallRequest object: \"service\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "service", "params", "sender", "receiver" ]))
                throw new Error("invalid ServiceCallRequest object: contains unknown fields")
            if (!validParams(obj))
                throw new Error("invalid ServiceCallRequest object: \"params\" field must be an array")
            return this.makeServiceCallRequest(obj.id, obj.service, obj.params, obj.sender, obj.receiver)
        }
        else if (obj.type === "service-call-response") {
            /*  detect and parse service response success  */
            if (anyFieldsExcept(obj, [ "type", "id", "result", "error", "sender", "receiver" ]))
                throw new Error("invalid ServiceCallResponse object: contains unknown fields")
            return this.makeServiceCallResponse(obj.id, obj.result, obj.error, obj.sender, obj.receiver)
        }
        else if (obj.type === "resource-transfer-request") {
            /*  detect and parse resource request  */
            if (typeof obj.resource !== "string")
                throw new Error("invalid ResourceTransferRequest object: \"resource\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "resource", "params", "sender", "receiver" ]))
                throw new Error("invalid ResourceTransferRequest object: contains unknown fields")
            if (!validParams(obj))
                throw new Error("invalid ResourceTransferRequest object: \"params\" field must be an array")
            return this.makeResourceTransferRequest(obj.id, obj.resource, obj.params, obj.sender, obj.receiver)
        }
        else if (obj.type === "resource-transfer-response") {
            if (obj.chunk !== undefined && typeof obj.chunk !== "object")
                throw new Error("invalid ResourceTransferResponse object: \"chunk\" field must be an object or null")
            if (obj.error !== undefined && typeof obj.error !== "string")
                throw new Error("invalid ResourceTransferResponse object: \"error\" field must be a string")
            if (anyFieldsExcept(obj, [ "type", "id", "chunk", "error", "sender", "receiver" ]))
                throw new Error("invalid ResourceTransferResponse object: contains unknown fields")
            return this.makeResourceTransferResponse(obj.id, obj.chunk, obj.error, obj.sender, obj.receiver)
        }
        else
            throw new Error("invalid object: not of any known type")
    }
}

/*  Msg trait  */
export class MsgTrait<T extends APISchema = APISchema> extends CodecTrait<T> {
    protected msg = new Msg()
}

