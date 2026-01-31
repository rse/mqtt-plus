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
import PLazy                                 from "p-lazy"
import { MqttClient,
    type OnMessageCallback,
    IClientSubscribeOptions,
    IClientPublishOptions,
    IPublishPacket }                         from "mqtt"

/*  internal requirements  */
import { APISchema }                         from "./mqtt-plus-api"
import { APIOptions }                        from "./mqtt-plus-options"
import { MetaTrait }                         from "./mqtt-plus-meta"
import { JSONX }                             from "./mqtt-plus-codec"

/*  MQTTp Base class with shared infrastructure  */
export class BaseTrait<T extends APISchema = APISchema> extends MetaTrait<T> {
    protected mqtt: MqttClient
    private _messageHandler: OnMessageCallback

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
                get(_target, prop, _receiver): any {
                    if (prop === "isFakeProxy")
                        return true
                    else
                        return () => {}
                }
            })
        }

        /*  store MQTT client  */
        this.mqtt = mqtt

        /*  hook into the MQTT message processing  */
        this.log("info", "hooking into MQTT client")
        this._messageHandler = (topic, message, packet) => {
            /*  NOTICE: MQTT.js uses Buffer in its handler signature only,
                but internally supports string or Buffer, while we are
                dealing with string or Uint8Array only  */
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
        this.mqtt.on("message", this._messageHandler)
    }

    /*  destroy API class  */
    destroy () {
        this.log("info", "un-hooking from MQTT client")
        this.mqtt.off("message", this._messageHandler)
    }

    /*  subscribe to an MQTT topic (Promise-based)  */
    protected async _subscribeTopic (topic: string, options: Partial<IClientSubscribeOptions> = {}) {
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
    protected async _unsubscribeTopic (topic: string) {
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
    protected async _publishToTopic (
        topic:   string,
        message: string | Uint8Array,
        options: IClientPublishOptions = {}
    ) {
        /*  determine buffer  */
        if (typeof message === "string")
            this.log("info", `publishing to MQTT topic "${topic}" (type: string, length: ${message.length} chars)`)
        else
            this.log("info", `publishing to MQTT topic "${topic}" (type: buffer, length: ${message.byteLength}) bytes`)

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
    private _onMessage (topic: string, message: string | Uint8Array, packet: IPublishPacket): void {
        /*  try to parse message as payload  */
        if (typeof message === "string")
            this.log("info", `received from MQTT topic "${topic}" (type: string, length: ${message.length} chars)`)
        else
            this.log("info", `received from MQTT topic "${topic}" (type: buffer, length: ${message.byteLength} bytes)`)
        let parsed: any
        try {
            const payload = this.codec.decode(message)
            parsed = this.msg.parse(payload)
        }
        catch (_err: unknown) {
            const err = _err instanceof Error
                ? new Error(`failed to parse message: ${_err.message}`, { cause: _err })
                : new Error("failed to parse message")
            this.error(err)
            return
        }
        this.log("debug", `received from MQTT topic "${topic}"`, { message: parsed })

        /*  dispatch to trait handlers  */
        this._dispatchMessage(topic, parsed)
    }

    /*  dispatch parsed message to appropriate handler
        (base implementation, to be overridden in sub-traits)  */
    protected _dispatchMessage (
        _topic:  string,
        _parsed: any
    ): void {}
}
