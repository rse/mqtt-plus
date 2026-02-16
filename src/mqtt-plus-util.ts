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
import { Buffer }                  from "node:buffer"
import { Readable }                from "node:stream"

/*  external requirements  */
import PLazy                       from "p-lazy"
import { IClientSubscribeOptions } from "mqtt"

/*  reference-counted subscription helper  */
export class RefCountedSubscription {
    private counts  = new Map<string, number>()
    private pending = new Map<string, Promise<void>>()
    private lingers = new Map<string, ReturnType<typeof setTimeout>>()
    constructor (
        private subscribeFn:   (topic: string, options: IClientSubscribeOptions) => Promise<void>,
        private unsubscribeFn: (topic: string) => Promise<void>,
        private lingerMs:      number = 30 * 1000
    ) {}
    async subscribe (topic: string, options: IClientSubscribeOptions = { qos: 2 }): Promise<void> {
        /*  increment count first to reserve our interest  */
        const count = this.counts.get(topic) ?? 0
        this.counts.set(topic, count + 1)

        /*  optionally just cancel a pending linger unsubscription
            (subscription is still kept active on the broker)  */
        const linger = this.lingers.get(topic)
        if (linger) {
            clearTimeout(linger)
            this.lingers.delete(topic)
            return
        }

        /*  if we are the first, we must perform the actual subscription  */
        if (count === 0) {
            const promise = this.subscribeFn(topic, options).finally(() => {
                this.pending.delete(topic)
            }).catch((err: Error) => {
                const count = this.counts.get(topic)
                if (count) {
                    if (count <= 1)
                        this.counts.delete(topic)
                    else
                        this.counts.set(topic, count - 1)
                }
                throw err
            })
            this.pending.set(topic, promise)
            return promise
        }
        else {
            /*  perhaps still need to wait for a pending subscription  */
            const pending = this.pending.get(topic)
            if (pending)
                return pending
        }
    }
    async unsubscribe (topic: string): Promise<void> {
        const count = this.counts.get(topic)
        if (count) {
            if (count <= 1) {
                this.counts.delete(topic)
                if (this.lingerMs > 0) {
                    /*  defer the actual broker unsubscription  */
                    const timer = setTimeout(() => {
                        this.lingers.delete(topic)
                        this.unsubscribeFn(topic).catch(() => {})
                    }, this.lingerMs)
                    this.lingers.set(topic, timer)
                }
                else
                    await this.unsubscribeFn(topic).catch(() => {})
            }
            else
                this.counts.set(topic, count - 1)
        }
    }
    async flush (): Promise<void> {
        /*  flush all pending linger timers and unsubscribe immediately  */
        const topics = [ ...this.lingers.keys() ]
        for (const topic of topics) {
            clearTimeout(this.lingers.get(topic))
            this.lingers.delete(topic)
            await this.unsubscribeFn(topic).catch(() => {})
        }
    }
}

/*  credit-based flow control gate for chunk producers  */
export class CreditGate {
    private remaining: number
    private waiters: Array<(aborted: boolean) => void> = []
    private aborted = false

    constructor (initialCredit: number) {
        this.remaining = initialCredit
    }

    /*  acquire one unit of credit (wait if exhausted)  */
    async acquire (abortSignal?: AbortSignal): Promise<void> {
        if (this.aborted)
            throw new Error("credit gate aborted")
        if (abortSignal?.aborted)
            throw abortSignal.reason ?? new Error("aborted")
        if (this.remaining > 0)
            /*  directly take a remaining credit  */
            this.remaining--
        else
            /*  wait for credit to be replenished  */
            await new Promise<void>((resolve, reject) => {
                const onAbort = () => {
                    this.waiters.splice(this.waiters.indexOf(waiter), 1)
                    reject(abortSignal?.reason ?? new Error("aborted"))
                }
                if (abortSignal)
                    abortSignal.addEventListener("abort", onAbort, { once: true })
                const waiter = (aborted: boolean) => {
                    if (abortSignal)
                        abortSignal.removeEventListener("abort", onAbort)
                    if (aborted) {
                        reject(new Error("credit gate aborted"))
                        return
                    }
                    this.remaining--
                    resolve()
                }
                this.waiters.push(waiter)
            })
    }

    /*  replenish credit (called when credit message received)  */
    replenish (amount: number): void {
        this.remaining += amount
        while (this.waiters.length > 0 && this.remaining > 0)
            this.waiters.shift()!(false)
    }

    /*  release any waiting producer (for cleanup on error/abort)  */
    abort (): void {
        this.aborted = true
        while (this.waiters.length > 0)
            this.waiters.shift()!(true)
    }
}

/*  concatenate elements of an Uint8Array array  */
function uint8ArrayConcat (arrays: Uint8Array[]) {
    const totalLength = arrays.reduce((acc, value) => acc + value.byteLength, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const array of arrays) {
        result.set(array, offset)
        offset += array.byteLength
    }
    return result
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
        throw new Error("invalid chunk type: expected Buffer, Uint8Array, or string")
    return buffer
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

/*  callback type for sending chunks  */
type SendChunkCallback = (
    chunk: Uint8Array | undefined,
    error: string | undefined,
    final: boolean
) => Promise<void>

/*  utility function for sending a buffer as chunks  */
export async function sendBufferAsChunks (
    buffer:       Uint8Array,
    chunkSize:    number,
    sendChunk:    SendChunkCallback,
    creditGate?:  CreditGate,
    abortSignal?: AbortSignal
): Promise<void> {
    if (buffer.byteLength === 0)
        await sendChunk(undefined, undefined, true)
    else {
        for (let i = 0; i < buffer.byteLength; i += chunkSize) {
            if (abortSignal?.aborted)
                throw abortSignal.reason ?? new Error("aborted")
            const size  = Math.min(buffer.byteLength - i, chunkSize)
            const chunk = buffer.subarray(i, i + size)
            const final = (i + size >= buffer.byteLength)
            if (creditGate)
                await creditGate.acquire(abortSignal)
            await sendChunk(chunk, undefined, final)
        }
    }
}

/*  utility function for sending a Readable stream as chunks  */
export async function sendStreamAsChunks (
    readable:     Readable,
    chunkSize:    number,
    sendChunk:    SendChunkCallback,
    creditGate?:  CreditGate,
    abortSignal?: AbortSignal
): Promise<void> {
    for await (const raw of readable) {
        if (abortSignal?.aborted)
            throw abortSignal.reason ?? new Error("aborted")
        const buffer = chunkToBuffer(raw)
        if (buffer.byteLength === 0)
            continue
        for (let i = 0; i < buffer.byteLength; i += chunkSize) {
            if (abortSignal?.aborted)
                throw abortSignal.reason ?? new Error("aborted")
            const size  = Math.min(buffer.byteLength - i, chunkSize)
            const chunk = buffer.subarray(i, i + size)
            if (creditGate)
                await creditGate.acquire(abortSignal)
            await sendChunk(chunk, undefined, false)
        }
    }
    if (abortSignal?.aborted)
        throw abortSignal.reason ?? new Error("aborted")
    await sendChunk(undefined, undefined, true)
}

/*  utility function for making two object fields mutually exclusive  */
export function makeMutuallyExclusiveFields (
    obj:     any,
    f1Name:  string,
    f2Name:  string
): void {
    if (!(typeof obj === "object" && obj !== null))
        throw new Error("invalid object")
    let consumed: "f1" | "f2" | undefined
    const f1Value = obj[f1Name]
    const f2Value = obj[f2Name]
    Object.defineProperty(obj, f1Name, {
        get: () => {
            if (consumed === "f2")
                throw new Error(`field "${f1Name}" is mutually exclusive with ` +
                    `field "${f2Name}" and "${f2Name}" was already consumed`)
            consumed = "f1"
            return f1Value
        },
        enumerable:   true,
        configurable: true
    })
    Object.defineProperty(obj, f2Name, {
        get: () => {
            if (consumed === "f1")
                throw new Error(`field "${f2Name}" is mutually exclusive with ` +
                    `field "${f1Name}" and "${f1Name}" was already consumed`)
            consumed = "f2"
            return f2Value
        },
        enumerable:   true,
        configurable: true
    })
}
