
Broker Setup
------------

**MQTT+** can be used with an arbitrary MQTT broker. One popular
MQTT broker is [Mosquitto](https://mosquitto.org/).
For establishing your own permanent MQTT environment, you can install the
[Mosquitto](https://mosquitto.org/) MQTT broker yourself and a setup
a `mosquitto.conf` file like...

```
[...]

password_file        mosquitto-pwd.txt
acl_file             mosquitto-acl.txt

[...]

#   additional listener
listener             1883 127.0.0.1
max_connections      -1
protocol             mqtt

[...]
```

...and an access control list in `mosquitto-acl.txt` like a simple and "allow-everything" ACL list
(assuming you are using `example/` as the prefix for all your endpoints)...

```
#   ==== shared/anonymous ACL ====

topic   read      $SYS/#
pattern write     $SYS/broker/connection/%c/state

topic   read      example/#
topic   write     example/#

#   ==== server/authenticated ACL ====

user    example

topic   read      example/#
topic   write     example/#
```

...or a comprehensive and "allow-minimum" ACL list (assuming you are using
`example/client/` and `example/server/` as the prefixes for all your endpoints)...


```
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
```

...and an `example` user (with password `example`) in `mosquitto-pwd.txt` like:

```
example:$6$awYNe6oCAi+xlvo5$mWIUqyy4I0O3nJ99lP1mkRVqsDGymF8en5NChQQxf7KrVJLUp1SzrrVDe94wWWJa3JGIbOXD9wfFGZdi948e6A==
```
