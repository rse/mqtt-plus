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

/*  utility type for branding  */
type Brand<T, K extends string> = T & { readonly __brand: K }

/*  endpoint types  */
export type APIEndpoint        = APIEndpointEvent | APIEndpointService | APIEndpointSource | APIEndpointSink
export type APIEndpointEvent   = (...args: any[]) => void | Promise<void>
export type APIEndpointService = (...args: any[]) => any  | Promise<any>
export type APIEndpointSource  = (...args: any[]) => void | Promise<void>
export type APIEndpointSink    = (...args: any[]) => void | Promise<void>

/*  API marker types  */
export type Event<T   extends APIEndpointEvent>   = Brand<T, "event">
export type Service<T extends APIEndpointService> = Brand<T, "service">
export type Source<T  extends APIEndpointSource>  = Brand<T, "source">
export type Sink<T    extends APIEndpointSink>    = Brand<T, "sink">

/*  type utilities for generic API  */
export type APISchema = Record<string, APIEndpoint>

/*  extract event keys where type is branded as Event  */
export type EventKeys<T> = string extends keyof T ? string : {
    [ K in keyof T ]: T[K] extends Event<infer _F> ? K : never
}[ keyof T ]

/*  extract service keys where type is branded as Service  */
export type ServiceKeys<T> = string extends keyof T ? string : {
    [ K in keyof T ]: T[K] extends Service<infer _F> ? K : never
}[ keyof T ]

/*  extract source keys where type is branded as Source  */
export type SourceKeys<T> = string extends keyof T ? string : {
    [ K in keyof T ]: T[K] extends Source<infer _F> ? K : never
}[ keyof T ]

/*  extract sink keys where type is branded as Sink  */
export type SinkKeys<T> = string extends keyof T ? string : {
    [ K in keyof T ]: T[K] extends Sink<infer _F> ? K : never
}[ keyof T ]

/*  registration result type  */
export interface Registration {
    destroy(): Promise<void>
}
