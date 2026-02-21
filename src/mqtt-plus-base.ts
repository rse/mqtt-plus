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

/*  external requirements  */
import PLazy                            from "p-lazy"
import { MqttClient,
    type OnMessageCallback,
    type IClientSubscribeOptions,
    type IClientPublishOptions,
    type IPublishPacket }               from "mqtt"

/*  internal requirements  */
import type { APISchema, Registration } from "./mqtt-plus-api"
import type { APIOptions }              from "./mqtt-plus-options"
import { TraceTrait }                   from "./mqtt-plus-trace"
import type { Spool }                   from "./mqtt-plus-error"
import { ensureError }                  from "./mqtt-plus-error"

/*  MQTTp Base class with shared infrastructure  */
export class BaseTrait<T extends APISchema = APISchema> extends TraceTrait<T> {
    private mqtt: MqttClient
    private messageHandler: OnMessageCallback

    /*  central message callback registries  */
    protected onRequest  = new Map<string, (message: any, topicName: string) => void>()
    protected onResponse = new Map<string, (message: any, topicName: string) => void>()

    /*  construct API class  */
    constructor (
        mqtt: MqttClient | null,
        options: Partial<APIOptions> = {}
    ) {
        super(options)

        /*  optionally provide a fake proxy for the MQTT client
            (mainly for using emit({ ..., dry: true }) to just make MQTT "last will")  */
        if (mqtt === null) {
            this.log("info", "establishing proxy MQTT client")
            mqtt = new Proxy<MqttClient>({} as MqttClient, {
                get (_target, prop, _receiver): any {
                    if (prop === "isFakeProxy")
                        return true
                    else if (typeof prop === "string" && [ "on", "off", "once" ].includes(prop))
                        return () => {}
                    else
                        return () => {
                            throw new Error(`Underlying MQTT operation "${String(prop)}" called ` +
                                "on a null MQTT client -- only MQTT+ \"emit({ ..., dry: true })\" " +
                                "is supported in this special operation mode")
                        }
                }
            })
        }

        /*  store MQTT client  */
        this.mqtt = mqtt

        /*  hook into the MQTT message processing  */
        this.log("info", "hooking into MQTT client")
        this.messageHandler = (topic, message, packet) => {
            /*  convert message to codec-specific input format
                (NOTICE: MQTT.js uses Buffer in its handler signature only,
                but internally supports string or Buffer, while we are
                dealing with string or Uint8Array only)  */
            let input: Uint8Array | string
            if (this.options.codec === "json")
                input = message.toString()
            else if (this.options.codec === "cbor")
                input = Buffer.isBuffer(message)
                    ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
                    : message
            else
                throw new Error("invalid codec configured")
            this._onMessage(topic, input, packet)
        }
        this.mqtt.on("message", this.messageHandler)
    }

    /*  destroy API class  */
    async destroy () {
        this.log("info", "un-hooking from MQTT client")
        this.mqtt.off("message", this.messageHandler)
    }

    /*  create a registration for subsequent destruction  */
    protected makeRegistration (spool: Spool, kind: string, name: string, key: string): Registration {
        return {
            destroy: async (): Promise<void> => {
                if (!this.onRequest.has(key))
                    throw new Error(`destroy: ${kind} "${name}" not registered`)
                await spool.unroll(false)?.catch((err: Error) => {
                    this.error(err, `destroy: failed to cleanup: ${err.message}`)
                })
            }
        }
    }

    /*  subscribe to an MQTT topic (Promise-based)  */
    protected async subscribeTopic (topic: string, options: Partial<IClientSubscribeOptions> = {}) {
        this.log("info", `subscribing to MQTT topic "${topic}"`)
        return new Promise<void>((resolve, reject) => {
            this.mqtt.subscribe(topic, { qos: 2, ...options }, (err: Error | null, _granted: any) => {
                if (err) {
                    this.error(err, `subscribing to MQTT topic "${topic}" failed`)
                    reject(err)
                }
                else
                    resolve()
            })
        })
    }

    /*  unsubscribe from an MQTT topic (Promise-based)  */
    protected async unsubscribeTopic (topic: string) {
        this.log("info", `unsubscribing from MQTT topic "${topic}"`)
        return new Promise<void>((resolve, reject) => {
            this.mqtt.unsubscribe(topic, (err?: Error, _packet?: any) => {
                if (err) {
                    this.error(err, `unsubscribing from MQTT topic "${topic}" failed`)
                    reject(err)
                }
                else
                    resolve()
            })
        })
    }

    /*  publish to an MQTT topic (Promise-based)  */
    protected async publishToTopic (
        topic:   string,
        message: string | Uint8Array,
        options: IClientPublishOptions = {}
    ) {
        /*  determine buffer  */
        if (typeof message === "string")
            this.log("info", `publishing to MQTT topic "${topic}" (type: string, length: ${message.length} chars)`)
        else
            this.log("info", `publishing to MQTT topic "${topic}" (type: buffer, length: ${message.byteLength} bytes)`)

        /*  provide decoded message on demand  */
        const messageOnDemand = new PLazy<any>((resolve, reject) => {
            let parsed: any
            try {
                const payload = this.codec.decode(message)
                parsed = this.msg.parse(payload)
            }
            catch (err: unknown) {
                return reject(err)
            }
            resolve(parsed)
        })
        this.log("debug", `publishing to MQTT topic "${topic}"`, { message: messageOnDemand })

        /*  forward operation to underlying MQTT facility  */
        return new Promise<void>((resolve, reject) => {
            /*  NOTICE: MQTT.js is dealing with string or Buffer only  */
            const messageData = typeof message === "string"
                ? message
                : Buffer.from(message.buffer, message.byteOffset, message.byteLength)
            this.mqtt.publish(topic, messageData, options, (err?: Error) => {
                if (err) {
                    this.error(err, `publishing to MQTT topic "${topic}" failed`)
                    reject(err)
                }
                else
                    resolve()
            })
        })
    }

    /*  handle incoming MQTT message  */
    private _onMessage (topic: string, data: string | Uint8Array, packet: IPublishPacket): void {
        /*  parse MQTT topic  */
        const topicMatch = this.options.topicMatch(topic)
        if (topicMatch === null)
            return

        /*  parse MQTT data into payload object  */
        if (typeof data === "string")
            this.log("info", `received from MQTT topic "${topic}" (type: string, length: ${data.length} chars)`)
        else
            this.log("info", `received from MQTT topic "${topic}" (type: buffer, length: ${data.byteLength} bytes)`)
        let payload: any
        try {
            payload = this.codec.decode(data)
        }
        catch (err: unknown) {
            this.error(ensureError(err, "failed to parse message into object"))
            return
        }

        /*  parse payload object into typed MQTT+ message  */
        let message: any
        try {
            message = this.msg.parse(payload)
        }
        catch (err: unknown) {
            this.error(ensureError(err, "failed to parse object into typed message object"))
            return
        }
        this.log("debug", `received from MQTT topic "${topic}"`, { message })

        /*  dispatch MQTT+ message  */
        if (this.msg.isRequest(message)) {
            /*  dispatch request message  */
            const handler = this.onRequest.get(`${topicMatch.operation}:${message.name}`)
            if (handler !== undefined) {
                try {
                    handler(message, topicMatch.name)
                }
                catch (err: unknown) {
                    this.error(ensureError(err, `dispatching request message from MQTT topic "${topic}" failed`))
                }
            }
        }
        else if (this.msg.isResponse(message)) {
            /*  dispatch response message  */
            const handler = this.onResponse.get(`${topicMatch.operation}:${message.id}`)
            if (handler !== undefined) {
                try {
                    handler(message, topicMatch.name)
                }
                catch (err: unknown) {
                    this.error(ensureError(err, `dispatching response message from MQTT topic "${topic}" failed`))
                }
            }
        }
    }
}
