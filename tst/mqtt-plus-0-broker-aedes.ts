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
import net       from "node:net"

/*  external dependencies  */
import { Aedes } from "aedes"

/*  internal dependencies  */
import Broker    from "./mqtt-plus-0-broker"

/*  Aedes utility/helper class  */
export default class AedesHelper extends Broker {
    private aedes:  Aedes      | null = null
    private server: net.Server | null = null
    private _logs:  string[]          = []

    override async start () {
        /*  create Aedes broker instance  */
        this.aedes = await Aedes.createBroker()

        /*  authentication handler  */
        this.aedes.authenticate = (client, username, password, done) => {
            if (username === undefined || username === null) {
                /*  allow anonymous connections  */
                (client as any)._username = undefined
                done(null, true)
            }
            else if (username === "example" && password !== undefined && password.toString() === "example") {
                /*  allow authenticated connection  */
                (client as any)._username = username
                done(null, true)
            }
            else {
                const err = new Error("bad username or password") as any
                err.returnCode = 4
                done(err, false)
            }
        }

        /*  publish authorization handler
            NOTICE: unlike Mosquitto, Aedes disconnects the client when
            authorizePublish returns an error. For testing purposes, we
            accept all publishes and rely on MQTT+ level auth instead.  */
        this.aedes.authorizePublish = (_client, _packet, callback) => {
            callback(null)
        }

        /*  subscribe authorization handler
            NOTICE: unlike Mosquitto, Aedes disconnects the client when
            authorizeSubscribe returns an error, and MQTT.js 5.x throws an
            error when SUBACK code is 128 (null subscription). So we just
            accept all subscriptions and rely on MQTT+ level auth instead.  */
        this.aedes.authorizeSubscribe = (_client, subscription, callback) => {
            callback(null, subscription)
        }

        /*  logging: client connect  */
        this.aedes.on("client", (client) => {
            this._logs.push(`client connected: ${client.id}`)
        })

        /*  logging: client disconnect  */
        this.aedes.on("clientDisconnect", (client) => {
            this._logs.push(`client disconnected: ${client.id}`)
        })

        /*  logging: publish  */
        this.aedes.on("publish", (packet, client) => {
            const who = client ? client.id : "broker"
            this._logs.push(`publish: ${who} -> ${packet.topic}`)
        })

        /*  logging: subscribe  */
        this.aedes.on("subscribe", (subscriptions, client) => {
            for (const sub of subscriptions)
                this._logs.push(`subscribe: ${client.id} -> ${sub.topic}`)
        })

        /*  start TCP server  */
        this.server = net.createServer(this.aedes.handle)
        await new Promise<void>((resolve) => {
            this.server!.listen(1883, resolve)
        })
    }

    override async stop () {
        if (this.aedes !== null && this.server !== null) {
            await new Promise<void>((resolve) => { this.aedes!.close(() => { resolve() }) })
            await new Promise<void>((resolve) => { this.server!.close(() => { resolve() }) })
            await new Promise((resolve) => { setTimeout(resolve, 500) })
        }
    }

    override logs () {
        return this._logs.join("\n")
    }
}
