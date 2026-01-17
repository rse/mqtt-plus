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
import { APISchema }      from "./mqtt-plus-api"
import { ReceiverTrait }  from "./mqtt-plus-receiver"

/*  type of a wrapped meta object (for method overloading)  */
export type Meta = { __meta: Record<string, any> }

/*  Meta trait  */
export class MetaTrait<T extends APISchema = APISchema> extends ReceiverTrait<T> {
    /*  wrap meta object into wrapper (required for type-safe overloading)  */
    meta (data: Record<string, any>) {
        return { __meta: data }
    }

    /*  return meta object from wrapper object  */
    protected _getMeta (obj: Meta) {
        return obj.__meta
    }

    /*  detect meta wrapper object  */
    protected _isMeta (obj: any): obj is Meta {
        return (typeof obj === "object"
            && obj !== null
            && "__meta" in obj
            && typeof obj.__meta === "object"
            && obj.__meta !== null
        )
    }
}

