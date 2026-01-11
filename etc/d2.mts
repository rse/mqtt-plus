
import fs     from "node:fs"
import { D2 } from "@terrastruct/d2"

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

