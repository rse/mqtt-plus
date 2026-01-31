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

/*  internal requirements  */
import { APISchema }  from "./mqtt-plus-api"
import { TraceTrait } from "./mqtt-plus-trace"

/*  Meta trait with meta information management  */
export class MetaTrait<T extends APISchema = APISchema> extends TraceTrait<T> {
    /*  internal state  */
    private _meta: Map<string, any> = new Map()

    /*  set/delete/retrieve meta information  */
    meta (): Record<string, any>
    meta (key: string): void
    meta (key: string, value: any): void
    meta (key?: string, value?: any): Record<string, any> | void {
        if (key === undefined)
            return Object.fromEntries(this._meta)
        else if (value === undefined || value === null)
            this._meta.delete(key)
        else
            this._meta.set(key, value)
    }

    /*  determine meta store  */
    protected metaStore (extra?: Record<string, any>): Record<string, any> | undefined {
        if (this._meta.size === 0 && extra === undefined)
            return undefined
        else if (this._meta.size > 0 && extra === undefined)
            return Object.fromEntries(this._meta)
        else if (this._meta.size === 0 && extra !== undefined)
            return extra
        else
            return { ...Object.fromEntries(this._meta), ...extra }
    }
}
