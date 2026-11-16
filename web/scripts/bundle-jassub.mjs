// Pre-bundles JASSUB (libass in WebAssembly) into public/jassub/ so Next never bundles it: Turbopack's production build
// hangs on JASSUB's self-spawning worker. The page loads /jassub/jassub.js at runtime. Runs before dev/build (generated, gitignored).
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'rolldown'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'jassub', 'dist')
const out = join(root, 'public', 'jassub')
rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'wasm'), { recursive: true })
// Two separate bundles that keep JASSUB's relative layout: jassub.js → ./worker/worker.js → ../wasm/*.wasm
await build({ input: join(src, 'jassub.js'), output: { file: join(out, 'jassub.js'), format: 'esm', minify: true }, logLevel: 'warn' })
await build({ input: join(src, 'worker', 'worker.js'), output: { file: join(out, 'worker', 'worker.js'), format: 'esm', minify: true, codeSplitting: false }, logLevel: 'warn' })
for (const f of ['jassub-worker.wasm', 'jassub-worker-modern.wasm']) cpSync(join(src, 'wasm', f), join(out, 'wasm', f))
cpSync(join(src, 'default.woff2'), join(out, 'default.woff2'))
console.log('jassub → public/jassub')
