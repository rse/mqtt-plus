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
import { MqttClient, IClientPublishOptions,
    IClientSubscribeOptions,
    IPublishPacket }                         from "mqtt"

/*  internal requirements  */
import { APISchema }                         from "./mqtt-plus-api"
import { EventEmission,
    ServiceCallRequest,
    ServiceCallResponse,
    ResourceTransferRequest,
    ResourceTransferResponse,
    MsgTrait }                               from "./mqtt-plus-msg"
import { APIOptions }                        from "./mqtt-plus-options"

/*  MQTTp Base class with shared infrastructure  */
export class BaseTrait<T extends APISchema = APISchema> extends MsgTrait<T> {
    protected mqtt: MqttClient
    private _messageHandler: (topic: string, message: Uint8Array, packet: IPublishPacket) => void

    /*  construct API class  */
    constructor (
        mqtt: MqttClient,
        options: Partial<APIOptions> = {}
    ) {
        super(options)

        /*  store MQTT client  */
        this.mqtt = mqtt

        /*  hook into the MQTT message processing  */
        this._messageHandler = (topic, message, packet) => {
            this._onMessage(topic, message, packet)
        }
        this.mqtt.on("message", this._messageHandler)
    }

    /*  destroy API class  */
    destroy () {
        this.mqtt.off("message", this._messageHandler)
    }

    /*  subscribe to an MQTT topic (Promise-based)  */
    protected async _subscribeTopic (topic: string, options: Partial<IClientSubscribeOptions> = {}) {
        return new Promise<void>((resolve, reject) => {
            this.mqtt.subscribe(topic, { qos: 2, ...options }, (err: Error | null, _granted: any) => {
                if (err) reject(err)
                else     resolve()
            })
        })
    }

    /*  unsubscribe from an MQTT topic (Promise-based)  */
    protected async _unsubscribeTopic (topic: string) {
        return new Promise<void>((resolve, reject) => {
            this.mqtt.unsubscribe(topic, (err?: Error, _packet?: any) => {
                if (err) reject(err)
                else     resolve()
            })
        })
    }

    /*  handle incoming MQTT message  */
    private _onMessage (topic: string, message: Uint8Array, packet: IPublishPacket): void {
        /*  try to parse message as payload  */
        let parsed:
            EventEmission             |
            ServiceCallRequest        |
            ServiceCallResponse       |
            ResourceTransferRequest   |
            ResourceTransferResponse
        try {
            let input: Uint8Array | string = message
            if (this.options.codec === "json")
                input = message.toString()
            const payload = this.codec.decode(input)
            parsed = this.msg.parse(payload)
        }
        catch (_err: unknown) {
            const err = _err instanceof Error
                ? new Error(`failed to parse message: ${_err.message}`)
                : new Error("failed to parse message")
            this.mqtt.emit("error", err)
            return
        }

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
