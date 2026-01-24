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
import { Readable } from "node:stream"

/*  external requirements  */
import PLazy        from "p-lazy"

/*  concatenate elements of an Uint8Array array  */
function uint8ArrayConcat (arrays: Uint8Array[]) {
    const totalLength = arrays.reduce((acc, value) => acc + value.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const array of arrays) {
        result.set(array, offset)
        offset += array.length
    }
    return result
}

/*  utility function for collecting stream chunks into a buffer  */
export function streamToBuffer (stream: Readable): Promise<Uint8Array> {
    return new PLazy<Uint8Array>((resolve, reject) => {
        const chunks: Uint8Array[] = []
        stream.on("data", (data: Uint8Array) => {
            chunks.push(data)
        })
        stream.on("end", () => {
            resolve(uint8ArrayConcat(chunks))
        })
        stream.on("error", (err: Error) => {
            reject(err)
        })
    })
}

/*  utility function for converting a chunk to a buffer  */
function chunkToBuffer (chunk: unknown): Uint8Array {
    let buffer: Uint8Array
    if (chunk instanceof Uint8Array)
        buffer = chunk
    else if (typeof chunk === "string")
        buffer = new TextEncoder().encode(chunk)
    else
        buffer = new TextEncoder().encode(String(chunk))
    return buffer
}

/*  callback type for sending chunks  */
export type SendChunkCallback = (
    chunk: Uint8Array | undefined,
    error: string | undefined,
    final: boolean
) => void

/*  utility function for sending a buffer as chunks  */
export function sendBufferAsChunks (
    buffer:    Uint8Array,
    chunkSize: number,
    sendChunk: SendChunkCallback
): void {
    if (buffer.byteLength === 0) {
        /*  handle empty buffer by sending final chunk  */
        sendChunk(undefined, undefined, true)
    }
    else {
        for (let i = 0; i < buffer.byteLength; i += chunkSize) {
            const size  = Math.min(buffer.byteLength - i, chunkSize)
            const chunk = buffer.subarray(i, i + size)
            const final = (i + size >= buffer.byteLength)
            sendChunk(chunk, undefined, final)
        }
    }
}

/*  utility function for sending a Readable stream as chunks  */
export function sendStreamAsChunks (
    readable:  Readable,
    chunkSize: number,
    sendChunk: SendChunkCallback,
    onEnd:     () => void,
    onError:   (err: Error) => void
): void {
    readable.on("readable", () => {
        let chunk: unknown
        while ((chunk = readable.read(chunkSize)) !== null) {
            const buffer = chunkToBuffer(chunk)
            sendChunk(buffer, undefined, false)
        }
    })
    readable.on("end", () => {
        sendChunk(undefined, undefined, true)
        onEnd()
    })
    readable.on("error", (err: Error) => {
        sendChunk(undefined, err.message, true)
        onError(err)
    })
}

