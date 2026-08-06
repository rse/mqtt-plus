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

/*  external dependencies (test suite)  */
import { describe, it }   from "mocha"
import * as chai          from "chai"

/*  internal dependencies  */
import { Spool, run }     from "../src/mqtt-plus-error"

/*  setup test suite infrastructure  */
chai.config.includeStack = true
const { expect } = chai

/*  test suite  */
describe("MQTT+ Run", function () {
    /*  test case: MQTT+ Run: sync action throws and oncatch recovers  */
    it("MQTT+ Run: sync action throws and oncatch recovers", function () {
        const result = run(
            () => { throw new Error("fail") },
            (_err: Error) => "recovered"
        )
        expect(result).to.equal("recovered")
    })

    /*  test case: MQTT+ Run: sync action throws and oncatch also throws  */
    it("MQTT+ Run: sync action throws and oncatch also throws", function () {
        try {
            run(
                () => { throw new Error("fail") },
                (_err: Error) => { throw new Error("oncatch-fail") }
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/oncatch-fail/)
        }
    })

    /*  test case: MQTT+ Run: async action rejects and oncatch recovers  */
    it("MQTT+ Run: async action rejects and oncatch recovers", async function () {
        const result = await run(
            () => Promise.reject(new Error("async-fail")),
            (_err: Error) => Promise.resolve("async-recovered")
        )
        expect(result).to.equal("async-recovered")
    })

    /*  test case: MQTT+ Run: async action rejects and oncatch also throws  */
    it("MQTT+ Run: async action rejects and oncatch also throws", async function () {
        try {
            await run(
                () => Promise.reject(new Error("async-fail")),
                (_err: Error) => { throw new Error("oncatch-async-fail") }
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/oncatch-async-fail/)
        }
    })

    /*  test case: MQTT+ Run: async oncatch recovers but onfinally fails invokes onfinally once  */
    it("MQTT+ Run: async oncatch recovers but onfinally fails invokes onfinally once", async function () {
        let finallyCount = 0
        try {
            await run(
                () => Promise.reject(new Error("async-fail")),
                (_err: Error) => Promise.resolve("async-recovered"),
                async () => { finallyCount++; throw new Error("onfinally-fail") }
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/onfinally-fail/)
        }
        expect(finallyCount).to.equal(1)
    })

    /*  test case: MQTT+ Run: sync success with spool and oncleanup  */
    it("MQTT+ Run: sync success with spool and oncleanup", function () {
        const spool = new Spool()
        const cleanups: string[] = []
        run<string, string>(
            spool,
            () => "resource-val",
            undefined,
            undefined,
            (val: string) => { cleanups.push(val) }
        )
        spool.unroll()
        expect(cleanups).to.deep.equal([ "resource-val" ])
    })

    /*  test case: MQTT+ Run: sync oncatch recovery with spool and oncleanup  */
    it("MQTT+ Run: sync oncatch recovery with spool and oncleanup", function () {
        const spool = new Spool()
        const cleanups: string[] = []
        run<string, string>(
            spool,
            () => { throw new Error("fail") },
            (_err: Error) => "recovered-val",
            undefined,
            (val: string) => { cleanups.push(val) }
        )
        spool.unroll()
        expect(cleanups).to.deep.equal([ "recovered-val" ])
    })

    /*  test case: MQTT+ Run: async oncatch recovery with spool and oncleanup  */
    it("MQTT+ Run: async oncatch recovery with spool and oncleanup", async function () {
        const spool = new Spool()
        const cleanups: string[] = []
        await run<string, Promise<string>>(
            spool,
            () => Promise.reject(new Error("async-fail")),
            (_err: Error) => Promise.resolve("async-recovered-val"),
            undefined,
            async (val: string) => { cleanups.push(val) }
        )
        await spool.unroll()
        expect(cleanups).to.deep.equal([ "async-recovered-val" ])
    })

    /*  test case: MQTT+ Run: oncleanup without spool throws  */
    it("MQTT+ Run: oncleanup without spool throws", function () {
        try {
            run(
                () => "ok",
                undefined,
                undefined,
                (_val: string) => {}
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.equal("oncleanup requires a spool")
        }
    })

    /*  test case: MQTT+ Run: sync error with throwing onfinally still unrolls and preserves error  */
    it("MQTT+ Run: sync error with throwing onfinally still unrolls and preserves error", function () {
        const spool = new Spool()
        const cleanups: string[] = []
        spool.roll("res", (val: unknown) => { cleanups.push(val as string) })
        try {
            run<string, string>(
                spool,
                () => { throw new Error("action-fail") },
                undefined,
                () => { throw new Error("finally-fail") }
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/action-fail/)
        }
        expect(cleanups).to.deep.equal([ "res" ])
    })

    /*  test case: MQTT+ Run: async error with rejecting onfinally still unrolls and preserves error  */
    it("MQTT+ Run: async error with rejecting onfinally still unrolls and preserves error", async function () {
        const spool = new Spool()
        const cleanups: string[] = []
        spool.roll("res", (val: unknown) => { cleanups.push(val as string) })
        try {
            await run<string, Promise<string>>(
                spool,
                () => Promise.reject(new Error("async-action-fail")),
                undefined,
                () => Promise.reject(new Error("async-finally-fail"))
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/async-action-fail/)
        }
        expect(cleanups).to.deep.equal([ "res" ])
    })

    /*  test case: MQTT+ Run: async success with rejecting onfinally surfaces onfinally error but still cleans up  */
    it("MQTT+ Run: async success with rejecting onfinally surfaces onfinally error but still cleans up", async function () {
        const spool = new Spool()
        const cleanups: string[] = []
        try {
            await run<string, Promise<string>>(
                spool,
                () => Promise.resolve("resource-val"),
                undefined,
                () => Promise.reject(new Error("finally-fail")),
                async (val: string) => { cleanups.push(val) }
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/finally-fail/)
        }
        expect(cleanups).to.deep.equal([ "resource-val" ])
    })

    /*  test case: MQTT+ Run: sync-throwing action in async usage settles asynchronously  */
    it("MQTT+ Run: sync-throwing action in async usage settles asynchronously", async function () {
        const spool = new Spool()
        const cleanups: string[] = []
        spool.roll("res", async (val: unknown) => { cleanups.push(val as string) })
        let finallyCount = 0
        try {
            await run<string, Promise<string>>(
                spool,
                () => { throw new Error("sync-action-fail") },
                undefined,
                async () => { finallyCount++ }
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/sync-action-fail/)
        }
        expect(finallyCount).to.equal(1)
        expect(cleanups).to.deep.equal([ "res" ])
    })

    /*  test case: MQTT+ Run: sync-throwing action with recovering async oncatch  */
    it("MQTT+ Run: sync-throwing action with recovering async oncatch", async function () {
        const spool = new Spool()
        const cleanups: string[] = []
        const result = await run<string, Promise<string>>(
            spool,
            () => { throw new Error("sync-action-fail") },
            (_err: Error) => Promise.resolve("async-recovered-val"),
            undefined,
            async (val: string) => { cleanups.push(val) }
        )
        expect(result).to.equal("async-recovered-val")
        await spool.unroll()
        expect(cleanups).to.deep.equal([ "async-recovered-val" ])
    })

    /*  test case: MQTT+ Run: sync-throwing action with rejecting async oncatch  */
    it("MQTT+ Run: sync-throwing action with rejecting async oncatch", async function () {
        const spool = new Spool()
        const cleanups: string[] = []
        try {
            await run<string, Promise<string>>(
                spool,
                () => { throw new Error("sync-action-fail") },
                (_err: Error) => Promise.reject(new Error("async-oncatch-fail")),
                undefined,
                async (val: string) => { cleanups.push(val) }
            )
            expect.fail("should have thrown")
        }
        catch (err: any) {
            expect(err.message).to.match(/async-oncatch-fail/)
        }
        expect(cleanups).to.deep.equal([])
    })
})

