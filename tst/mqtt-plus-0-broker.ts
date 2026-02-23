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

import chalk from "chalk"

/*  abstract broker base class  */
export default abstract class Broker {
    abstract start (): Promise<void>
    abstract stop  (): Promise<void>
    abstract logs  (): string | string[] | undefined

    /*  broker type (set by factory)  */
    static type: string = ""

    /*  broker factory: create broker instance based on environment variable  */
    static async create (): Promise<Broker> {
        Broker.type = process.env.MQTT_BROKER ?? "mosquitto"
        if (Broker.type === "aedes") {
            process.stderr.write(chalk.grey(`  [using internal ${chalk.bold("Aedes MQTT/3.1")} broker]\n\n`))
            const { default: AedesHelper } = await import("./mqtt-plus-0-broker-aedes")
            return new AedesHelper()
        }
        else if (Broker.type === "mosquitto") {
            process.stderr.write(chalk.grey(`  [using external ${chalk.bold("Mosquitto MQTT/5.0")} broker]\n\n`))
            const { default: MosquittoHelper } = await import("./mqtt-plus-0-broker-mosquitto")
            return new MosquittoHelper()
        }
        else
            throw new Error("invalid broker type")
    }
}
