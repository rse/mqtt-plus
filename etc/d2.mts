
import fs     from "node:fs"
import { D2 } from "@terrastruct/d2"

const d2 = new D2()

const include = fs.readFileSync(process.argv[2], "utf8")
const diag    = fs.readFileSync(process.argv[3], "utf8")

const result = await d2.compile(`${include}\n${diag}`)
const svg = await d2.render(result.diagram, result.renderOptions)

fs.writeFileSync(process.argv[4], svg, "utf8")
process.exit(0)

