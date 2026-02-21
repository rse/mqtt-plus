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

/*  external dependencies  */
import textframe from "textframe"
import Mosquitto from "mosquitto"

/*  Mosquitto ACL
    NOTICE: schema is <app>/<tier>/<topic>/<operation>/<receiver>  */
const ACL = textframe(`
    #   ==== shared/anonymous ACL ====

    #   common
    topic   read      $SYS/#
    pattern write     $SYS/broker/connection/%c/state

    #   ---- event emission ----

    topic   write     example/server/+/event-emission/+

    topic   read      example/client/+/event-emission/any
    pattern read      example/client/+/event-emission/%c

    #   ---- service call ----

    topic   write     example/server/+/service-call-request/+
    pattern read      example/server/+/service-call-response/%c

    topic   read      example/client/+/service-call-request/any
    pattern read      example/client/+/service-call-request/%c
    pattern write     example/client/+/service-call-response/%c

    #   ---- source fetch ----

    topic   write     example/server/+/source-fetch-request/+
    pattern read      example/server/+/source-fetch-response/%c
    pattern read      example/server/+/source-fetch-chunk/%c
    topic   write     example/server/+/source-fetch-credit/+

    topic   read      example/client/+/source-fetch-request/any
    pattern read      example/client/+/source-fetch-request/%c
    topic   write     example/client/+/source-fetch-response/+
    topic   write     example/client/+/source-fetch-chunk/+

    #   ---- sink push ----

    topic   write     example/server/+/sink-push-request/+
    pattern read      example/server/+/sink-push-response/%c
    topic   write     example/server/+/sink-push-chunk/+

    topic   read      example/client/+/sink-push-request/any
    pattern read      example/client/+/sink-push-request/%c
    pattern write     example/client/+/sink-push-response/%c
    pattern read      example/client/+/sink-push-chunk/%c
    pattern read      example/client/+/sink-push-credit/%c

    #   ==== server/authenticated ACL ====

    user    example

    #   ---- event emission ----

    topic   write     example/client/+/event-emission/+

    topic   read      example/server/+/event-emission/any
    topic   read      $share/server/example/server/+/event-emission/any
    pattern read      example/server/+/event-emission/%c
    pattern read      $share/server/example/server/+/event-emission/%c

    #   ---- service call ----

    topic   read      example/server/+/service-call-request/any
    topic   read      $share/server/example/server/+/service-call-request/any
    pattern read      example/server/+/service-call-request/%c
    pattern read      $share/server/example/server/+/service-call-request/%c
    pattern write     example/server/+/service-call-response/+

    topic   write     example/client/+/service-call-request/+
    pattern read      example/client/+/service-call-response/%c

    #   ---- source fetch ----

    topic   read      example/server/+/source-fetch-request/any
    topic   read      $share/server/example/server/+/source-fetch-request/any
    pattern read      example/server/+/source-fetch-request/%c
    pattern read      $share/server/example/server/+/source-fetch-request/%c
    topic   write     example/server/+/source-fetch-response/+
    topic   write     example/server/+/source-fetch-chunk/+
    pattern read      example/server/+/source-fetch-credit/%c
    pattern read      $share/server/example/server/+/source-fetch-credit/%c

    topic   write     example/client/+/source-fetch-request/+
    pattern read      example/client/+/source-fetch-response/%c
    pattern read      example/client/+/source-fetch-chunk/%c

    #   ---- sink push ----

    topic   read      example/server/+/sink-push-request/any
    topic   read      $share/default/example/server/+/sink-push-request/any
    pattern read      example/server/+/sink-push-request/%c
    pattern read      $share/default/example/server/+/sink-push-request/%c
    topic   write     example/server/+/sink-push-response/+
    pattern read      example/server/+/sink-push-chunk/%c
    pattern read      $share/default/example/server/+/sink-push-chunk/%c
    topic   write     example/client/+/sink-push-credit/+

    topic   write     example/client/+/sink-push-request/+
    pattern read      example/client/+/sink-push-response/%c
    topic   write     example/client/+/sink-push-chunk/+
`)

/*  Mosquitto utility/helper class  */
export default class MosquittoHelper {
    private mosquitto: Mosquitto | null = null
    async start () {
        this.mosquitto = new Mosquitto({ acl: ACL })
        await this.mosquitto.start()
    }
    async stop () {
        if (this.mosquitto !== null) {
            await this.mosquitto.stop()
            await new Promise((resolve) => { setTimeout(resolve, 500) })
        }
    }
    logs () {
        if (this.mosquitto !== null)
            return this.mosquitto.logs()
    }
}

