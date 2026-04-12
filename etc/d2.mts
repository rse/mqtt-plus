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

import fs     from "node:fs"
import { D2 } from "@terrastruct/d2"

try {
    const d2 = new D2()

    const include = fs.readFileSync(process.argv[2], "utf8")
    const diag    = fs.readFileSync(process.argv[3], "utf8")

    const result = await d2.compile({
        fs: { "diagram.d2": `${include}\n${diag}` },
        inputPath: "diagram.d2",
        options: {
            pad: 0
        }
    })
    const svg = await d2.render(result.diagram, result.renderOptions)

    fs.writeFileSync(process.argv[4], svg, "utf8")
    process.exit(0)
}
catch (error: any) {
    process.stderr.write(`d2: ERROR: ${error.message}\n`)
    process.exit(1)
}

