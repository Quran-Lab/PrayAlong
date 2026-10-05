// Bundles and runs a TypeScript evaluation script (resolving the app's `@/`
// alias), so the evaluation uses exactly the app's hands-free code.
//   node scripts/eval/run.mjs <evaluate|dump-features|fit-report> [args...]
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const [script, ...rest] = process.argv.slice(2)
mkdirSync(join(root, '.eval'), { recursive: true })
const outfile = join(root, '.eval', `${script.replace(/^.*[/]/, '').replace(/.ts$/, '')}.bundle.mjs`)
await build({
  entryPoints: [script.endsWith('.ts') ? resolve(script) : join(here, `${script}.ts`)],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile,
  alias: { '@': join(root, 'src') },
  define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'false' },
  logLevel: 'warning',
})
const r = spawnSync(process.execPath, ['--max-old-space-size=8192', outfile, ...rest], { stdio: 'inherit', cwd: root })
process.exit(r.status ?? 1)
