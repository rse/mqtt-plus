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

/*  built-in requirements  */
import { Buffer }     from "node:buffer"

/*  internal requirements  */
import { APISchema }  from "./mqtt-plus-api"
import { CodecTrait } from "./mqtt-plus-codec"

/*  encoding trait  */
export class EncodeTrait<T extends APISchema = APISchema> extends CodecTrait<T> {
    /*  convert character string to buffer  */
    str2buf (data: string): Uint8Array {
        return new TextEncoder().encode(data)
    }

    /*  convert buffer to character string  */
    buf2str (data: Uint8Array): string {
        return new TextDecoder().decode(data)
    }

    /*  convert byte-based typed array to buffer  */
    arr2buf (data: Buffer | Uint8Array | Int8Array): Uint8Array {
        let buffer: Uint8Array
        if (data instanceof Uint8Array)
            buffer = data
        else
            buffer = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        return buffer
    }

    /*  convert buffer to byte-based typed array  */
    buf2arr (data: Uint8Array, type: new () => Buffer): Buffer
    buf2arr (data: Uint8Array, type: new () => Uint8Array): Uint8Array
    buf2arr (data: Uint8Array, type: new () => Int8Array): Int8Array
    buf2arr <T extends Buffer | Uint8Array | Int8Array>(data: Uint8Array, cons: new (...args: any[]) => T): T {
        let arr: T | undefined
        if (cons === (Buffer as unknown as new (...args: any[]) => T))
            arr = Buffer.from(data.buffer, data.byteOffset, data.byteLength) as T
        else if (cons === (Uint8Array as unknown as new (...args: any[]) => T))
            arr = data as T
        else if (cons === (Int8Array as unknown as new (...args: any[]) => T))
            arr = new Int8Array(data.buffer, data.byteOffset, data.byteLength) as T
        else
            throw new Error("invalid data type")
        return arr
    }
}

