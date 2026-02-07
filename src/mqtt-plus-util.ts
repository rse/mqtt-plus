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
import { Buffer }   from "node:buffer"
import { Readable } from "node:stream"

/*  external requirements  */
import PLazy        from "p-lazy"

/*  internal requirements  */
import { IClientSubscribeOptions } from "mqtt"

/*  reference-counted subscription helper  */
export class RefCountedSubscription {
    private counts = new Map<string, number>()
    constructor (
        private subscribeFn:   (topic: string, options: IClientSubscribeOptions) => Promise<void>,
        private unsubscribeFn: (topic: string) => Promise<void>,
        private errorFn?:      (err: Error) => void
    ) {}
    async subscribe (topic: string, options: IClientSubscribeOptions = { qos: 2 }): Promise<void> {
        const count = this.counts.get(topic) ?? 0
        this.counts.set(topic, count + 1)
        if (count === 0) {
            await this.subscribeFn(topic, options).catch((err: Error) => {
                const currentCount = this.counts.get(topic) ?? 0
                if (currentCount > 1)
                    this.counts.set(topic, currentCount - 1)
                else
                    this.counts.delete(topic)
                if (this.errorFn)
                    this.errorFn(err)
                throw err
            })
        }
    }
    async unsubscribe (topic: string): Promise<void> {
        const count = this.counts.get(topic) ?? 0
        if (count <= 1) {
            this.counts.delete(topic)
            await this.unsubscribeFn(topic).catch(() => {})
        }
        else
            this.counts.set(topic, count - 1)
    }
}

/*  credit-based flow control gate for chunk producers  */
export class CreditGate {
    private remaining: number
    private waiter: ((aborted: boolean) => void) | null = null
    private aborted = false

    constructor (initialCredit: number) {
        this.remaining = initialCredit
    }

    /*  acquire one unit of credit (wait if exhausted)  */
    async acquire (): Promise<void> {
        if (this.aborted)
            throw new Error("credit gate aborted")
        if (this.remaining > 0)
            /*  directly take a remaining credit  */
            this.remaining--
        else
            /*  wait for credit to be replenished  */
            await new Promise<void>((resolve, reject) => {
                this.waiter = (aborted) => {
                    if (aborted) {
                        reject(new Error("credit gate aborted"))
                        return
                    }
                    this.remaining--
                    resolve()
                }
            })
    }

    /*  replenish credit (called when credit message received)  */
    replenish (amount: number): void {
        this.remaining += amount
        if (this.waiter !== null && this.remaining > 0) {
            const waiter = this.waiter
            this.waiter = null
            waiter(false)
        }
    }

    /*  release any waiting producer (for cleanup on error/abort)  */
    abort (): void {
        this.aborted = true
        if (this.waiter !== null) {
            const waiter = this.waiter
            this.waiter = null
            waiter(true)
        }
    }
}

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
        stream.on("data", (raw: unknown) => {
            const data = chunkToBuffer(raw)
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
    if (chunk instanceof Buffer)
        buffer = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length)
    else if (chunk instanceof Uint8Array)
        buffer = chunk
    else if (typeof chunk === "string")
        buffer = new TextEncoder().encode(chunk)
    else
        buffer = new TextEncoder().encode(String(chunk))
    return buffer
}

/*  callback type for sending chunks  */
type SendChunkCallback = (
    chunk: Uint8Array | undefined,
    error: string | undefined,
    final: boolean
) => Promise<void>

/*  utility function for sending a buffer as chunks  */
export async function sendBufferAsChunks (
    buffer:      Uint8Array,
    chunkSize:   number,
    sendChunk:   SendChunkCallback,
    creditGate?: CreditGate
): Promise<void> {
    if (buffer.byteLength === 0)
        await sendChunk(undefined, undefined, true)
    else {
        for (let i = 0; i < buffer.byteLength; i += chunkSize) {
            const size  = Math.min(buffer.byteLength - i, chunkSize)
            const chunk = buffer.subarray(i, i + size)
            const final = (i + size >= buffer.byteLength)
            if (creditGate)
                await creditGate.acquire()
            await sendChunk(chunk, undefined, final)
        }
    }
}

/*  utility function for sending a Readable stream as chunks  */
export async function sendStreamAsChunks (
    readable:    Readable,
    chunkSize:   number,
    sendChunk:   SendChunkCallback,
    creditGate?: CreditGate
): Promise<void> {
    try {
        for await (const chunkData of readable) {
            const buffer = chunkToBuffer(chunkData)
            if (buffer.byteLength === 0)
                continue
            for (let i = 0; i < buffer.byteLength; i += chunkSize) {
                const size  = Math.min(buffer.byteLength - i, chunkSize)
                const chunk = buffer.subarray(i, i + size)
                if (creditGate)
                    await creditGate.acquire()
                await sendChunk(chunk, undefined, false)
            }
        }
        await sendChunk(undefined, undefined, true)
    }
    catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err)
        await sendChunk(undefined, error, true).catch(() => {})
        throw err
    }
}
