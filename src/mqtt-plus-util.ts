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
import { Readable } from "stream"

/*  external requirements  */
import PLazy        from "p-lazy"

/*  utility function for collecting stream chunks into a Buffer  */
export function streamToBuffer (stream: Readable): Promise<Buffer> {
    return new PLazy<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        stream.on("data", (data: Buffer) => {
            chunks.push(data)
        })
        stream.on("end", () => {
            resolve(Buffer.concat(chunks))
        })
        stream.on("error", (err: Error) => {
            reject(err)
        })
    })
}

/*  utility function for converting a chunk to a Buffer  */
export function chunkToBuffer (chunk: unknown): Buffer {
    let buffer: Buffer
    if (Buffer.isBuffer(chunk))
        buffer = chunk
    else if (typeof chunk === "string")
        buffer = Buffer.from(chunk)
    else if (chunk instanceof Uint8Array)
        buffer = Buffer.from(chunk)
    else
        buffer = Buffer.from(String(chunk))
    return buffer
}


