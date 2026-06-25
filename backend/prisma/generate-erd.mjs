// Generates a detailed ER diagram (every table's columns + types) from
// schema.prisma WITHOUT regenerating the Prisma client.
//
// Why a separate temp schema?
//  - Running the erd generator inside the normal `prisma generate` also rebuilds
//    the Prisma client, which fails with EPERM while the dev server holds the
//    query-engine .dll open (Windows file lock).
//  - Keeping the erd generator OUT of the committed schema keeps production
//    `prisma generate` (prod-only deps on Render) from trying to load it.
//
// Output: prisma/ERD-detailed.md  (Mermaid — render in VS Code / GitHub / mermaid.live)
// Run with:  npm run db:erd

import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const schemaPath = join(here, 'schema.prisma')
const tempPath = join(here, '.erd.temp.prisma')

let schema = readFileSync(schemaPath, 'utf8')

// Strip the existing `generator ... { }` blocks (client + any erd) so the temp
// schema only contains the datasource + models + our erd generator.
schema = schema.replace(/generator\s+\w+\s*\{[^}]*\}/g, '')

const erdGenerator = `
generator erd {
  provider = "prisma-erd-generator"
  output   = "ERD-detailed.md"
  includeRelationFromFields = true
}
`

writeFileSync(tempPath, erdGenerator + '\n' + schema)

try {
  execSync(`npx prisma generate --schema "${tempPath}"`, { cwd: here, stdio: 'inherit' })
  console.log('\n✅ ERD-detailed.md generated. Open it in VS Code (Mermaid preview) or paste into https://mermaid.live')
} finally {
  rmSync(tempPath, { force: true })
}
