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
import * as CBOR                     from "cbor2"

/*  internal requirements  */
import { APISchema }                 from "./mqtt-plus-api"
import { APIOptions, OptionsTrait }  from "./mqtt-plus-options"

/*  JSON encode/decode with Uint8Array support  */
class JSONX {
    private static uint8ArrayToBase64 (arr: Uint8Array): string {
        return btoa(String.fromCharCode(...arr))
    }
    private static base64ToUint8Array (base64: string): Uint8Array {
        const binary = atob(base64)
        const arr = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++)
            arr[i] = binary.charCodeAt(i)
        return arr
    }
    static stringify (obj: any): string {
        return JSON.stringify(obj, (_, value) =>
            value instanceof Uint8Array
                ? { __Uint8Array: this.uint8ArrayToBase64(value) }
                : value
        )
    }
    static parse (json: string): any {
        return JSON.parse(json, (_, value) =>
            typeof value?.__Uint8Array === "string"
                ? this.base64ToUint8Array(value.__Uint8Array)
                : value
        )
    }
}

/*  the encoder/decoder abstraction  */
export default class Codec {
    private types = new CBOR.TypeEncoderMap()
    private tags: CBOR.TagDecoderMap = new Map<CBOR.TagNumber, CBOR.TagDecoder>()
    constructor (
        private type: "cbor" | "json"
    ) {
        /*  support direct encoding/decoding of Buffer  */
        const TAG_BUFFER = 64000
        this.types.registerEncoder(Buffer, (buffer: Buffer) => {
            return [ TAG_BUFFER, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) ]
        })
        this.tags.set(TAG_BUFFER, (tag: CBOR.ITag) => {
            return Buffer.from(tag.contents as Uint8Array)
        })
    }
    encode (data: unknown): Uint8Array | string {
        let result: Uint8Array | string
        if (this.type === "cbor") {
            try { result = CBOR.encode(data, { types: this.types }) }
            catch (_ex) { throw new Error("failed to encode CBOR format") }
        }
        else if (this.type === "json") {
            try { result = JSONX.stringify(data) }
            catch (_ex) { throw new Error("failed to encode JSON format") }
        }
        else
            throw new Error("invalid format")
        return result
    }
    decode (data: Uint8Array | string): unknown {
        let result: unknown
        if (this.type === "cbor" && data instanceof Uint8Array) {
            try { result = CBOR.decode(data, { tags: this.tags }) }
            catch (_ex) { throw new Error("failed to decode CBOR format") }
        }
        else if (this.type === "json" && typeof data === "string") {
            try { result = JSONX.parse(data) }
            catch (_ex) { throw new Error("failed to decode JSON format") }
        }
        else
            throw new Error("invalid format or wrong data type")
        return result
    }
}

/*  Codec trait  */
export class CodecTrait<T extends APISchema = APISchema> extends OptionsTrait<T> {
    protected codec: Codec

    /*  construct API class  */
    constructor (
        options: Partial<APIOptions> = {}
    ) {
        super(options)

        /*  establish a codec  */
        this.codec = new Codec(this.options.codec)
    }
}

