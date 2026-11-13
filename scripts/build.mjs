// Builds dist/ for OpenClaw: installed plugins must ship JavaScript, while TypeScript entries
// load only from a linked development folder. Node's own type stripping does the work, so the
// build needs no compiler or dependencies: `node scripts/build.mjs` (Node 22.13 or later).
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sources = ['index.ts', 'src/event.ts']

await rm(join(root, 'dist'), { recursive: true, force: true })
for (const source of sources) {
  const ts = await readFile(join(root, source), 'utf8')
  // Local imports name their .ts file; the built files sit side by side as .js.
  const js = stripTypeScriptTypes(ts, { mode: 'strip' }).replace(/(from\s+['"]\.{1,2}\/[^'"]+)\.ts(['"])/g, '$1.js$2')
  const target = join(root, 'dist', source.replace(/\.ts$/, '.js'))
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, js)
  console.log(`dist/${source.replace(/\.ts$/, '.js')}`)
}
