
import type * as MQTTpt from "mqtt-plus"

export type API = {
    "example/sample": MQTTpt.Event<(a1: string, a2: number) => void>
    "example/hello":  MQTTpt.Service<(a1: string, a2: number) => string>
}

