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

/*  type of a single resource cleanup handler  */
type SpoolCleanup<T = unknown> =
    (resource: T) => void | Promise<void>

/*  type of a single resource  */
type SpoolResource<T = unknown> = {
    resource: T,
    cleanup:  SpoolCleanup<T>
}

/*  resource spooling class  */
export class Spool {
    /*  internal state  */
    private resources: SpoolResource<unknown>[] = []
    private pending:   Promise<void> | null = null

    /*  roll cleanup procedure onto spool  */
    roll (cleanup: SpoolCleanup): void
    roll <T>(resource: T, cleanup: SpoolCleanup<T>): void
    roll (...args: any[]): void {
        /*  determine parameters  */
        let resource: unknown
        let cleanup:  SpoolCleanup<unknown>
        if      (args.length === 1) { resource = undefined; cleanup  = args[0] }
        else if (args.length === 2) { resource = args[0];   cleanup  = args[1] }
        else
            throw new Error("invalid number of arguments")

        /*  store information  */
        this.resources.push({ resource, cleanup })
    }

    /*  roll a sub-spool onto spool  */
    sub (): Spool {
        /*  create new spool  */
        const spool = new Spool()

        /*  roll sub-spool onto spool  */
        this.roll(spool, (s) => s.unroll())

        /*  return new spool  */
        return spool
    }

    /*  unroll all cleanup procedures from spool  */
    unroll (suppress = true): Promise<void> | void {
        /*  guard against concurrent unroll: if an unroll is already
            in progress, return the existing promise so all callers
            wait for the same completion  */
        if (this.pending !== null) {
            if (suppress)
                return this.pending.catch(() => {})
            return this.pending
        }

        /*  atomically take ownership of the currently rolled
            resources so re-entrant unroll() calls from within
            a synchronous cleanup observe an empty spool  */
        const resources = this.resources
        this.resources  = []

        /*  NOTICE: we operate synchronously until the first
            cleanup procedure returns a Promise. Then we continue
            asynchronously, regardless of whether the following
            cleanup procedures return a Promise or not!  */
        const errors: unknown[] = []
        let promise: Promise<void> | undefined
        while (resources.length > 0) {
            const entry    = resources.pop()!
            const resource = entry.resource
            const cleanup  = entry.cleanup
            if (promise) {
                /*  async continuation: isolate each cleanup so one rejection
                    does not prevent remaining cleanups from executing  */
                promise = promise.then(() => cleanup(resource))
                    .catch((err: unknown) => { errors.push(err) })
            }
            else {
                /*  sync start: wrap individually so a throw
                    does not exit the while loop  */
                try {
                    const result = cleanup(resource)
                    if (result instanceof Promise)
                        promise = result.catch((err: unknown) => { errors.push(err) })
                }
                catch (err: unknown) {
                    errors.push(err)
                }
            }
        }
        if (promise) {
            /*  store the pending promise for concurrent-caller guard  */
            this.pending = promise.then(() => {
                if (errors.length === 1)
                    throw errors[0]
                else if (errors.length > 1)
                    throw new AggregateError(errors, "multiple cleanup failures")
            }).finally(() => {
                this.pending = null
            })
            if (suppress)
                return this.pending.catch(() => {})
            return this.pending
        }
        else {
            if (!suppress && errors.length === 1)
                throw errors[0]
            else if (!suppress && errors.length > 1)
                throw new AggregateError(errors, "multiple cleanup failures")
            return
        }
    }
}

/*  helper function for retrieving an Error object  */
export function ensureError (error: unknown, prefix?: string, debug = false): Error {
    if (error instanceof Error && prefix === undefined && debug === false)
        return error
    let msg = error instanceof Error
        ? error.message
        : String(error)
    if (prefix)
        msg = `${prefix}: ${msg}`
    if (debug && error instanceof Error)
        msg = `${msg}\n${error.stack}`
    if (error instanceof Error) {
        const err = new Error(msg, { cause: error })
        err.stack = error.stack
        return err
    }
    else
        return new Error(msg)
}

/*  helper function for running the finally code of "run"  */
function runFinally (isAsync: false,   onfinally?: () => void,                  description?: string): void
function runFinally (isAsync: true,    onfinally?: () => Promise<void> | void,  description?: string): Promise<void>
function runFinally (isAsync: boolean, onfinally?: () => Promise<void> | void,  description?: string): Promise<void> | void {
    if (!onfinally) {
        if (isAsync)
            return Promise.resolve()
        else
            return
    }
    let result: Promise<void> | void
    try {
        result = onfinally()
    }
    catch (error: unknown) {
        if (isAsync)
            return Promise.reject(ensureError(error, description))
        else
            throw ensureError(error, description)
    }
    if (!isAsync && result instanceof Promise)
        throw new Error("onfinally callback returned Promise in non-async context")
    if (isAsync && !(result instanceof Promise))
        result = Promise.resolve(result)
    if (isAsync && result instanceof Promise)
        return result.catch((error: unknown) => { throw ensureError(error, description) })
    return result
}

/*  helper function for unrolling a spool  */
function runUnroll (isAsync: false,   spool?: Spool): void
function runUnroll (isAsync: true,    spool?: Spool): Promise<void>
function runUnroll (isAsync: boolean, spool?: Spool): Promise<void> | void {
    if (!spool) {
        if (isAsync) return Promise.resolve()
        else         return
    }
    let result = spool.unroll()
    if (!isAsync && result instanceof Promise)
        throw new Error("spool unroll returned Promise in non-async context")
    if (isAsync && !(result instanceof Promise))
        result = Promise.resolve(result)
    return result
}

/*  helper type for ensuring T contains no Promise  */
type RunNoPromise<T> =
    [ T ] extends [ Promise<any> ] ? never : T

/*  run a synchronous or asynchronous action  */
export function run<T, X extends RunNoPromise<T> | never> (
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => void,
    oncleanup?:  (value: T)     => void
): X
export function run<T, X extends RunNoPromise<T> | never> (
    description: string,
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => void,
    oncleanup?:  (value: T)     => void
): X
export function run<T, X extends Promise<T> | never> (
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => Promise<void>,
    oncleanup?:  (value: T)     => Promise<void>
): X
export function run<T, X extends Promise<T> | never> (
    description: string,
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => Promise<void> | void,
    oncleanup?:  (value: T)     => Promise<void> | void
): X
export function run<T, X extends RunNoPromise<T> | never> (
    spool:       Spool | undefined,
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => void,
    oncleanup?:  (value: T)     => void
): X
export function run<T, X extends RunNoPromise<T> | never> (
    description: string,
    spool:       Spool | undefined,
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => void,
    oncleanup?:  (value: T)     => void
): X
export function run<T, X extends Promise<T> | never> (
    spool:       Spool | undefined,
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => Promise<void>,
    oncleanup?:  (value: T)     => Promise<void>
): X
export function run<T, X extends Promise<T> | never> (
    description: string,
    spool:       Spool | undefined,
    action:      ()             => X,
    oncatch?:    (error: Error) => X,
    onfinally?:  ()             => Promise<void>,
    oncleanup?:  (value: T)     => Promise<void>
): X
export function run<T, X extends RunNoPromise<T> | never> (
    config: {
        description?: string,
        spool?:       Spool | undefined,
        action:       ()             => X,
        oncatch?:     (error: Error) => X,
        onfinally?:   ()             => void,
        oncleanup?:   (value: T)     => void
    }
): X
export function run<T, X extends Promise<T>> (
    config: {
        description?: string,
        spool?:       Spool | undefined,
        action:       ()             => X,
        oncatch?:     (error: Error) => X,
        onfinally?:   ()             => Promise<void>,
        oncleanup?:   (value: T)     => Promise<void>
    }
): X
export function run<T> (
    ...args: any[]
): T | Promise<T> | never {
    /*  support overloaded signatures  */
    let description: string | undefined
    let spool:       Spool | undefined
    let action:      () => T | Promise<T> | never
    let oncatch:     ((error: Error) => T | Promise<T> | never) | undefined
    let onfinally:   (() => void) | undefined
    let oncleanup:   ((value: T) => void) | undefined
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
        description = args[0].description
        spool       = args[0].spool
        action      = args[0].action
        oncatch     = args[0].oncatch
        onfinally   = args[0].onfinally
        oncleanup   = args[0].oncleanup
    }
    else if (typeof args[0] === "string") {
        description = args[0]
        if (args[1] instanceof Spool || (args[1] === undefined && typeof args[2] === "function")) {
            spool       = args[1]
            action      = args[2]
            oncatch     = args[3]
            onfinally   = args[4]
            oncleanup   = args[5]
        }
        else {
            action      = args[1]
            oncatch     = args[2]
            onfinally   = args[3]
            oncleanup   = args[4]
        }
    }
    else {
        if (args[0] instanceof Spool || (args[0] === undefined && typeof args[1] === "function")) {
            spool       = args[0]
            action      = args[1]
            oncatch     = args[2]
            onfinally   = args[3]
            oncleanup   = args[4]
        }
        else {
            action      = args[0]
            oncatch     = args[1]
            onfinally   = args[2]
            oncleanup   = args[3]
        }
    }

    /*  sanity check spool/oncleanup scenario  */
    if (oncleanup && !spool)
        throw new Error("oncleanup requires a spool")

    /*  perform the action  */
    let result: T | Promise<T>
    try {
        result = action()
    }
    catch (arg: unknown) {
        /*  synchronous case (error branch)  */
        let error = ensureError(arg, description)
        if (oncatch) {
            try {
                result = oncatch(error)
            }
            catch (arg: unknown) {
                error = ensureError(arg, description)
                runFinally(false, onfinally, description)
                runUnroll(false, spool)
                throw error
            }
            runFinally(false, onfinally, description)
            if (spool && oncleanup)
                spool.roll(result, oncleanup as SpoolCleanup<unknown>)
            return result
        }
        runFinally(false, onfinally, description)
        runUnroll(false, spool)
        throw error
    }
    if (result instanceof Promise) {
        /*  asynchronous case (result or error branch)  */
        return result.then(async (result) => {
            await runFinally(true, onfinally, description)
            if (spool && oncleanup)
                spool.roll(result, oncleanup as SpoolCleanup<unknown>)
            return result
        }, async (arg: unknown) => {
            /*  asynchronous case (error branch)  */
            let error = ensureError(arg, description)
            if (oncatch) {
                let result: T
                try {
                    result = await oncatch(error)
                }
                catch (arg: unknown) {
                    error = ensureError(arg, description)
                    await runFinally(true, onfinally, description)
                    await runUnroll(true, spool)
                    throw error
                }
                await runFinally(true, onfinally, description)
                if (spool && oncleanup)
                    spool.roll(result, oncleanup as SpoolCleanup<unknown>)
                return result
            }
            await runFinally(true, onfinally, description)
            await runUnroll(true, spool)
            throw error
        })
    }
    else {
        /*  synchronous case (result branch)  */
        runFinally(false, onfinally, description)
        if (spool && oncleanup)
            spool.roll(result, oncleanup as SpoolCleanup<unknown>)
        return result
    }
}
