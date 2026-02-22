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
import { SignJWT }         from "jose/jwt/sign"
import { jwtVerify }       from "jose/jwt/verify"
import * as pbkdf2         from "@stablelib/pbkdf2"
import * as sha256         from "@stablelib/sha256"

/*  internal requirements  */
import type { APISchema }  from "./mqtt-plus-api"
import { MetaTrait }       from "./mqtt-plus-meta"

/*  type of the "auth" options  */
export type AuthMode   = "require" | "optional"
export type AuthRole   = string
export type AuthOption = AuthRole | { mode: AuthMode, roles: AuthRole[] }
type TokenPayload = { roles: AuthRole[], id?: string, exp?: number }

/*  reusable encoder instance  */
const textEncoder = new TextEncoder()

/*  authentication trait  */
export class AuthTrait<T extends APISchema = APISchema> extends MetaTrait<T> {
    /*  internal state  */
    private _credential: Uint8Array | null = null
    private _tokens = new Set<string>()

    /*  store server-side secret credential  */
    credential (credential: string) {
        /*  sanity check argument  */
        if (credential.length === 0)
            throw new Error("credential must not be empty")

        /*  use a derived key with minimum length of 32 for JWT HS256  */
        const pass = textEncoder.encode(credential)
        const salt = textEncoder.encode("mqtt-plus")
        this._credential = pbkdf2.deriveKey(sha256.SHA256, pass, salt, 600000, 32)
    }

    /*  issue client-side token on server-side  */
    async issue (payload: TokenPayload) {
        if (this._credential === null)
            throw new Error("credential has to be provided before issuing tokens")
        if (payload.roles.length === 0)
            throw new Error("payload.roles must be a non-empty array")
        if (payload.roles.length > 64)
            throw new Error("payload.roles must not exceed 64 roles")
        const jwt = new SignJWT(payload)
        jwt.setProtectedHeader({ alg: "HS256", typ: "JWT" })
        const token = await jwt.sign(this._credential)
        return token
    }

    /*  retrieve/add/remove client-side token (client-side)  */
    authenticate (): string[] | undefined
    authenticate (token: string): void
    authenticate (token: string, remove: boolean): void
    authenticate (token?: string, remove?: boolean): string[] | undefined | void {
        if (token === undefined)
            return this._tokens.size > 0 ? Array.from(this._tokens) : undefined
        else if (remove === true)
            this._tokens.delete(token)
        else
            this._tokens.add(token)
    }

    /*  validate client-side token on server-side  */
    private async validateToken (token: string) {
        if (this._credential === null)
            throw new Error("credential has to be provided before validating tokens")
        const result = await jwtVerify(token, this._credential).catch(() => null)
        return (result?.payload as TokenPayload) ?? null
    }

    /*  check whether request is authenticated  */
    protected async authenticated (clientId: string | undefined, tokens: string[] | undefined, option: AuthOption) {
        let authenticated = false

        /*  determine authentication configuration  */
        let mode:  AuthMode
        let roles: string[]
        if (typeof option === "string") {
            mode  = "require"
            roles = [ option ]
        }
        else {
            mode  = option.mode
            roles = option.roles
        }

        /*  iterate over all roles and try to authenticate token (first-match, max 8)  */
        if (tokens !== undefined) {
            for (const token of tokens.slice(0, 8)) {
                if (token.length > 8192)
                    continue
                const payload = await this.validateToken(token)
                if (payload === null)
                    continue
                if (payload.id && payload.id !== clientId)
                    continue
                if (!Array.isArray(payload.roles))
                    continue
                if (payload.roles.length > 64)
                    continue
                for (const role of roles) {
                    if (payload.roles.includes(role)) {
                        authenticated = true
                        break
                    }
                }
                if (authenticated)
                    break
            }
        }

        /*  handle optional case  */
        if (!authenticated && mode === "optional")
            authenticated = true

        return authenticated
    }
}
