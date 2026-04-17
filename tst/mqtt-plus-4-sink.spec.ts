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
import sinon                from "sinon"
import sinonChai            from "sinon-chai"

/*  internal dependencies  */
import { ctx }              from "./mqtt-plus-0-fixture"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
chai.use(sinonChai)
const { expect } = chai

/*  test suite  */
describe("MQTT+ Sink Push", function () {
    /*  test case: Sink Push (Buffer)  */
    it("MQTT+ Sink Push (Buffer)", async function () {
        /*  setup  */
        this.slow(1000)
        this.timeout(1000)
        const spy = sinon.spy()

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(8 * 1024))

        /*  establish sink consuming via buffer  */
        const sinking = await ctx.apiS.sink("example/server/upload", (name: string, info) => {
            spy("sink")
            expect(name).to.be.equal("foo")
            expect(info).to.be.an("object")

            /*  consume via buffer (instead of stream)  */
            info.buffer!.then((buf: Uint8Array) => {
                spy("buffer")
                expect(Buffer.from(buf)).to.deep.equal(data)
            }).catch(() => {})
        })

        /*  push a buffer (instead of a stream)  */
        await ctx.apiC.push("example/server/upload", new Uint8Array(data), "foo").then(() => {
            spy("push-success")
        }).catch((_err: Error) => {
            spy("push-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 100) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "push-success", "buffer" ])

        /*  destroy sink  */
        await sinking.destroy()
    })

    /*  test case: Sink Push (Stream)  */
    it("MQTT+ Sink Push (Stream)", async function () {
        /*  setup  */
        this.slow(1000)
        this.timeout(1000)
        const spy = sinon.spy()

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(16 * 1024))

        /*  establish sink  */
        const sinking = await ctx.apiS.sink("example/server/upload", (name: string, info) => {
            spy("sink")
            if (name !== "foo")
                throw new Error("invalid sink push")
            expect(name).to.be.equal("foo")
            expect(info).to.be.an("object")
            expect(info.stream).to.be.instanceOf(stream.Readable)
            const chunks: Buffer[] = []
            info.stream!.on("data", (chunk: Buffer) => {
                chunks.push(chunk)
            })
            info.stream!.on("end", () => {
                spy("end")
                const result = Buffer.concat(chunks)
                expect(result).to.deep.equal(data)
            })
        })

        /*  transfer stream  */
        const readable = new stream.Readable({
            read () {}
        })
        readable.push(data)
        readable.push(null)
        await ctx.apiC.push("example/server/upload", readable, "foo").then(() => {
            spy("transfer-success")
        }).catch((_err: Error) => {
            spy("transfer-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 100) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "transfer-success", "end" ])

        /*  destroy sink  */
        await sinking.destroy()
    })

    /*  test case: Sink Push (Meta Information)  */
    it("MQTT+ Sink Push (Meta Information)", async function () {
        /*  setup  */
        this.slow(1000)
        this.timeout(1000)
        const spy = sinon.spy()

        /*  set instance-level meta on client  */
        ctx.apiC.meta("client-version", "2.0")

        /*  generate random data  */
        const data = Buffer.from(crypto.randomBytes(8 * 1024))

        /*  establish sink that checks metadata  */
        const sinking = await ctx.apiS.sink("example/server/upload", (name: string, info) => {
            spy("sink")
            expect(name).to.be.equal("foo")
            expect(info.meta).to.be.an("object")
            expect(info.meta!.push_tag).to.be.equal("my-push-tag")
            expect(info.meta!["client-version"]).to.be.equal("2.0")

            /*  consume via buffer  */
            info.buffer!.then((buf: Uint8Array) => {
                spy("buffer")
                expect(Buffer.from(buf)).to.deep.equal(data)
            }).catch(() => {})
        })

        /*  push with metadata  */
        await ctx.apiC.push({
            name:   "example/server/upload",
            data:   new Uint8Array(data),
            params: [ "foo" ],
            meta:   { push_tag: "my-push-tag" }
        }).then(() => {
            spy("push-success")
        }).catch((_err: Error) => {
            spy("push-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 100) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "push-success", "buffer" ])

        /*  cleanup  */
        ctx.apiC.meta("client-version", null)
        await sinking.destroy()
    })

    /*  test case: Sink Push (Large Buffer)  */
    it("MQTT+ Sink Push (Large Buffer)", async function () {
        /*  setup  */
        this.slow(10000)
        this.timeout(10000)
        const spy = sinon.spy()

        /*  generate 2 MB of random data  */
        const data = Buffer.from(crypto.randomBytes(2 * 1024 * 1024))

        /*  establish sink consuming via buffer  */
        const sinking = await ctx.apiS.sink("example/server/upload", (name: string, info) => {
            spy("sink")
            expect(name).to.be.equal("foo")
            info.buffer.then((buf: Uint8Array) => {
                spy("buffer")
                expect(buf.byteLength).to.be.equal(data.byteLength)
                expect(Buffer.from(buf)).to.deep.equal(data)
            }).catch(() => {})
        })

        /*  push the large buffer  */
        await ctx.apiC.push("example/server/upload", new Uint8Array(data), "foo").then(() => {
            spy("push-success")
        }).catch(() => {
            spy("push-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 200) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "push-success", "buffer" ])

        /*  cleanup  */
        await sinking.destroy()
    })

    /*  test case: Sink Push (Large Stream)  */
    it("MQTT+ Sink Push (Large Stream)", async function () {
        /*  setup  */
        this.slow(10000)
        this.timeout(10000)
        const spy = sinon.spy()

        /*  generate 2 MB of random data  */
        const data = Buffer.from(crypto.randomBytes(2 * 1024 * 1024))

        /*  establish sink consuming via stream  */
        const sinking = await ctx.apiS.sink("example/server/upload", (name: string, info) => {
            spy("sink")
            expect(name).to.be.equal("foo")
            const chunks: Buffer[] = []
            info.stream.on("data", (chunk: Buffer) => { chunks.push(chunk) })
            info.stream.on("end", () => {
                spy("end")
                const received = Buffer.concat(chunks)
                expect(received.byteLength).to.be.equal(data.byteLength)
                expect(received).to.deep.equal(data)
            })
        })

        /*  feed data in 64 KB pieces via a readable stream  */
        let offset = 0
        const pieceSize = 64 * 1024
        const readable = new stream.Readable({
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
        await ctx.apiC.push("example/server/upload", readable, "foo").then(() => {
            spy("transfer-success")
        }).catch(() => {
            spy("transfer-error")
        })
        await new Promise((resolve) => { setTimeout(resolve, 200) })
        expect(spy.getCalls().map((call) => call.firstArg))
            .to.be.same.deep.members([ "sink", "transfer-success", "end" ])

        /*  cleanup  */
        await sinking.destroy()
    })

    /*  test case: Sink Push (Interrupted)  */
    it("MQTT+ Sink Push (Interrupted)", async function () {
        /*  setup  */
        this.slow(4000)
        this.timeout(4000)

        /*  generate large random data (128 KB, requires many chunks at 16 KB chunk size)  */
        const data = Buffer.from(crypto.randomBytes(128 * 1024))

        /*  track received data on the server side  */
        const receivedChunks: Buffer[] = []

        /*  establish sink consuming via stream  */
        const sinking = await ctx.apiS.sink("example/server/upload", (name: string, info) => {
            expect(name).to.be.equal("foo")
            info.stream.on("data", (chunk: Buffer) => { receivedChunks.push(chunk) })
        })

        /*  create a slow readable stream that emits data in pieces  */
        let offset = 0
        const chunkSize = 16 * 1024
        const readable = new stream.Readable({
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

        /*  start the push (will be interrupted by destroying the source readable)  */
        const pushPromise = ctx.apiC.push("example/server/upload", readable, "foo")

        /*  wait for at least one chunk to be sent, then destroy the client-side readable  */
        await new Promise<void>((resolve) => { setTimeout(resolve, 200) })
        readable.destroy(new Error("client aborted"))

        /*  the push should fail  */
        const error = await pushPromise.catch((err: Error) => err.message)
        expect(error).to.be.a("string")

        /*  wait for cleanup to settle  */
        await new Promise((resolve) => { setTimeout(resolve, 200) })

        /*  the received data should be incomplete (less than the full 128 KiB)  */
        const received = Buffer.concat(receivedChunks)
        expect(received.byteLength).to.be.lessThan(data.byteLength)

        /*  cleanup  */
        await sinking.destroy()
    })
})

