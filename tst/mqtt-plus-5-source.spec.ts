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

/*  built-in dependencies  */
import crypto               from "node:crypto"
import stream               from "node:stream"
import { Buffer }           from "node:buffer"

/*  external dependencies (test suite)  */
import { describe, it }     from "mocha"
import * as chai            from "chai"

/*  internal dependencies  */
import { ctx }              from "./mqtt-plus-0-fixture"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
const { expect } = chai

/*  test suite  */
describe("MQTT+ Source Fetch", function () {
    /*  test case: Source Fetch (Buffer)  */
    it("MQTT+ Source Fetch (Buffer)", async function () {
        /*  setup  */
        this.slow(2000)
        this.timeout(2000)

        /*  establish source  */
        const sourcing = await ctx.apiS.source("example/server/download", async (filename, info) => {
            if (filename === "foo")
                info.buffer = Promise.resolve(Buffer.from(`the ${filename} content`))
            else
                throw new Error("invalid source")
        })

        /*  fetch existing source (valid source argument)  */
        const result = await ctx.apiC.fetch("example/server/download", "foo")
        const buffer = await result.buffer
        const str = new TextDecoder().decode(buffer)
        expect(str).to.be.equal("the foo content")

        /*  fetch non-existing source (invalid source argument)  */
        const result2 = await ctx.apiC.fetch("example/server/download", "bar")
        const error2 = await result2.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error2).to.be.equal("handler for source \"example/server/download\" failed: invalid source")

        /*  fetch non-existing source (invalid source name)  */
        const result3 = await ctx.apiC.fetch("example/server/download-invalid", "foo")
        const error3 = await result3.buffer.catch((err: Error) => {
            return err.message
        })
        expect(error3).to.be.equal("communication timeout")

        await sourcing.destroy()
    })

    /*  test case: Source Fetch (Stream)  */
    it("MQTT+ Source Fetch (Stream)", async function () {
        /*  setup  */
        this.slow(1000)
        this.timeout(1000)

        /*  establish source providing data via stream  */
        const sourcing = await ctx.apiS.source("example/server/download", async (filename, info) => {
            if (filename === "streamed") {
                const readable = new stream.Readable({ read () {} })
                readable.push(Buffer.from("chunk1-"))
                readable.push(Buffer.from("chunk2"))
                readable.push(null)
                info.stream = readable
            }
            else
                throw new Error("handler for source \"example/server/download\" failed: invalid source")
        })

        /*  fetch source and consume via stream  */
        const result = await ctx.apiC.fetch("example/server/download", "streamed")
        const chunks: Buffer[] = []
        result.stream.on("data", (chunk: Buffer) => { chunks.push(chunk) })
        await new Promise<void>((resolve) => { result.stream.on("end", resolve) })
        const combined = Buffer.concat(chunks).toString()
        expect(combined).to.be.equal("chunk1-chunk2")

        await sourcing.destroy()
    })

    /*  test case: Source Fetch (Meta Information)  */
    it("MQTT+ Source Fetch (Meta Information)", async function () {
        /*  setup  */
        this.slow(1000)
        this.timeout(1000)

        /*  set instance-level meta on server  */
        ctx.apiS.meta("server-version", "1.0")

        /*  establish source  */
        const sourcing = await ctx.apiS.source("example/server/download", async (_filename, info) => {
            info.buffer = Promise.resolve(Buffer.from("data"))
        })

        /*  fetch and check meta  */
        const result = await ctx.apiC.fetch("example/server/download", "foo")
        const meta = await result.meta
        expect(meta).to.be.an("object")
        expect(meta!["server-version"]).to.be.equal("1.0")

        /*  cleanup  */
        ctx.apiS.meta("server-version", null)
        await sourcing.destroy()
    })

    /*  test case: Source Fetch (Large Buffer)  */
    it("MQTT+ Source Fetch (Large Buffer)", async function () {
        /*  setup  */
        this.slow(10000)
        this.timeout(10000)

        /*  generate 2 MB of random data (128 chunks at 16 KB chunk size)  */
        const data = Buffer.from(crypto.randomBytes(2 * 1024 * 1024))

        /*  establish source providing data via buffer  */
        const sourcing = await ctx.apiS.source("example/server/download", async (filename, info) => {
            if (filename === "large-buf")
                info.buffer = Promise.resolve(new Uint8Array(data))
            else
                throw new Error("invalid source")
        })

        /*  fetch and consume via buffer  */
        const result = await ctx.apiC.fetch("example/server/download", "large-buf")
        const buffer = await result.buffer
        expect(buffer.byteLength).to.be.equal(data.byteLength)
        expect(Buffer.from(buffer)).to.deep.equal(data)

        /*  cleanup  */
        await sourcing.destroy()
    })

    /*  test case: Source Fetch (Large Stream)  */
    it("MQTT+ Source Fetch (Large Stream)", async function () {
        /*  setup  */
        this.slow(10000)
        this.timeout(10000)

        /*  generate 2 MB of random data  */
        const data = Buffer.from(crypto.randomBytes(2 * 1024 * 1024))

        /*  establish source providing data via stream  */
        const sourcing = await ctx.apiS.source("example/server/download", async (filename, info) => {
            if (filename === "large-stream") {
                /*  feed data in 64 KB pieces via a readable stream  */
                let offset = 0
                const pieceSize = 64 * 1024
                info.stream = new stream.Readable({
                    read () {
                        if (offset >= data.byteLength) {
                            this.push(null)
                            return
                        }
                        const end = Math.min(offset + pieceSize, data.byteLength)
                        this.push(data.subarray(offset, end))
                        offset = end
                    }
                })
            }
            else
                throw new Error("invalid source")
        })

        /*  fetch and consume via stream  */
        const result = await ctx.apiC.fetch("example/server/download", "large-stream")
        const chunks: Buffer[] = []
        result.stream.on("data", (chunk: Buffer) => { chunks.push(chunk) })
        await new Promise<void>((resolve, reject) => {
            result.stream.on("end",   ()           => { resolve() })
            result.stream.on("error", (err: Error) => { reject(err) })
        })
        const received = Buffer.concat(chunks)
        expect(received.byteLength).to.be.equal(data.byteLength)
        expect(received).to.deep.equal(data)

        /*  cleanup  */
        await sourcing.destroy()
    })

    /*  test case: Source Fetch (Interrupted Mid-Transfer)  */
    it("MQTT+ Source Fetch (Interrupted)", async function () {
        /*  setup  */
        this.slow(4000)
        this.timeout(4000)

        /*  generate large random data (128 KB, requires many chunks at 16 KB chunk size)  */
        const data = Buffer.from(crypto.randomBytes(128 * 1024))

        /*  establish source providing data via a slow stream  */
        const sourcing = await ctx.apiS.source("example/server/download", async (filename, info) => {
            if (filename === "large") {
                /*  create a stream that emits data slowly in 16 KiB pieces  */
                let offset = 0
                const chunkSize = 16 * 1024
                info.stream = new stream.Readable({
                    read () {
                        if (offset >= data.byteLength) {
                            this.push(null)
                            return
                        }
                        const end = Math.min(offset + chunkSize, data.byteLength)
                        const chunk = data.subarray(offset, end)
                        offset = end

                        /*  delay each chunk to simulate slow transfer  */
                        setTimeout(() => { this.push(chunk) }, 100)
                    }
                })
            }
            else
                throw new Error("invalid source")
        })

        /*  start fetching the large source  */
        const result = await ctx.apiC.fetch("example/server/download", "large")

        /*  collect received chunks  */
        const chunks: Buffer[] = []
        result.stream.on("data", (chunk: Buffer) => { chunks.push(chunk) })

        /*  wait for at least one chunk to arrive, then destroy the client-side stream  */
        await new Promise<void>((resolve) => {
            result.stream.once("data", () => { resolve() })
        })
        result.stream.destroy(new Error("client aborted"))

        /*  wait for cleanup to settle  */
        await new Promise((resolve) => { setTimeout(resolve, 200) })

        /*  the received data should be incomplete (less than the full 128 KiB)  */
        const received = Buffer.concat(chunks)
        expect(received.byteLength).to.be.lessThan(data.byteLength)

        /*  cleanup  */
        await sourcing.destroy()
    })
})

