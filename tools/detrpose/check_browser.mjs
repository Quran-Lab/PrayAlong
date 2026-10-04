#!/usr/bin/env node
// Run a DETRPose ONNX model in headless Chromium with the exact onnxruntime-web bundle the app
// imports (`import('onnxruntime-web')` -> dist/ort.bundle.min.mjs), on the 'wasm' and 'webgpu'
// execution providers, and compare against golden outputs from verify_onnx.py --dump.
//
//   node tools/detrpose/check_browser.mjs <model.onnx> <golden_dir> [--ep wasm,webgpu] [--runs 5] [--no-coi]
//
// WebGPU runs on SwiftShader (CPU) in this headless setup, so its latency is meaningless here; the
// point is op coverage, numerical agreement and the list of nodes that fall back to CPU.
// The page is served cross-origin-isolated (COOP/COEP) unless --no-coi, which is what multi-threaded
// WASM needs in a real browser.
import { createServer } from 'node:http'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const args = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = args.indexOf(name)
  if (i < 0) return dflt
  const v = args[i + 1]
  args.splice(i, 2)
  return v
}
const eps = opt('--ep', 'wasm,webgpu').split(',')
const runs = Number(opt('--runs', '5'))
const coi = !args.includes('--no-coi')
const [modelPath, goldenDir] = args.filter((a) => !a.startsWith('--'))
if (!modelPath || !goldenDir) {
  console.error('usage: node check_browser.mjs <model.onnx> <golden_dir> [--ep wasm,webgpu] [--runs N] [--no-coi]')
  process.exit(2)
}
// resolve the package's dist folder via an exported entry (package.json itself is not exported)
const ortDist = dirname(createRequire(import.meta.url).resolve('onnxruntime-web'))
const cases = readdirSync(goldenDir).filter((f) => f.endsWith('.input.bin')).map((f) => f.replace('.input.bin', ''))

const page = /* html */ `<!doctype html><meta charset="utf-8"><title>detrpose check</title><script type="module">
const ort = await import('/ort/ort.bundle.min.mjs')
window.check = async (ep, cases, runs) => {
  const log = []
  ort.env.logLevel = 'warning'
  const t0 = performance.now()
  const session = await ort.InferenceSession.create('/model.onnx', { executionProviders: [ep], graphOptimizationLevel: 'all', logSeverityLevel: ep === 'webgpu' ? 0 : 2 })
  const create = performance.now() - t0
  const res = { ep, create, crossOriginIsolated: self.crossOriginIsolated, threads: ort.env.wasm.numThreads, cases: [] }
  let first
  for (const name of cases) {
    const data = new Float32Array(await (await fetch('/golden/' + name + '.input.bin')).arrayBuffer())
    first ??= data
    const gold = await (await fetch('/golden/' + name + '.json')).json()
    const out = await session.run({
      images: new ort.Tensor('float32', data, [1, 3, 640, 640]),
      orig_target_sizes: new ort.Tensor('int64', new BigInt64Array([1n, 1n]), [1, 2]),
    })
    const s = out.scores.data, k = out.keypoints.data
    let best = 0; for (let i = 1; i < s.length; i++) if (s[i] > s[best]) best = i
    let gb = 0; for (let i = 1; i < gold.scores.length; i++) if (gold.scores[i] > gold.scores[gb]) gb = i
    let err = 0
    for (let j = 0; j < 17; j++) err = Math.max(err, Math.hypot((k[(best * 17 + j) * 2] - gold.keypoints[gb][j][0]) * gold.width, (k[(best * 17 + j) * 2 + 1] - gold.keypoints[gb][j][1]) * gold.height))
    res.cases.push({ name, types: [out.scores.type, out.labels.type, out.keypoints.type], dims: out.keypoints.dims, score: s[best], gold: gold.scores[gb],
      people: Array.from(s).filter((v) => v >= 0.4).length, goldPeople: gold.scores.filter((v) => v >= 0.4).length, kpErrPx: err })
  }
  const feeds = { images: new ort.Tensor('float32', first, [1, 3, 640, 640]), orig_target_sizes: new ort.Tensor('int64', new BigInt64Array([1n, 1n]), [1, 2]) }
  await session.run(feeds)
  const times = []
  for (let i = 0; i < runs; i++) { const t = performance.now(); await session.run(feeds); times.push(performance.now() - t) }
  times.sort((a, b) => a - b)
  res.latency = { min: times[0], median: times[Math.floor(times.length / 2)] }
  await session.release()
  return res
}
window.ready = true
</script>`

const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json' }
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0])
  let file
  if (url === '/') file = null
  else if (url === '/model.onnx') file = modelPath
  else if (url.startsWith('/ort/')) file = join(ortDist, url.slice(5))
  else if (url.startsWith('/golden/')) file = join(goldenDir, url.slice(8))
  const headers = coi ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } : {}
  if (file === null) {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html' })
    return res.end(page)
  }
  if (!file || !existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  res.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
  res.end(readFileSync(file))
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const p = await browser.newPage()
const logs = []
p.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`))
await p.goto(base)
await p.waitForFunction(() => window.ready === true, null, { timeout: 60000 })
console.log(`model ${modelPath}\nbrowser ${browser.version()}, onnxruntime-web bundle ${ortDist}/ort.bundle.min.mjs`)
let failed = false
for (const ep of eps) {
  logs.length = 0
  try {
    const r = await p.evaluate(([ep, cases, runs]) => window.check(ep, cases, runs), [ep, cases, runs])
    console.log(`\n[${ep}] session ${r.create.toFixed(0)} ms, crossOriginIsolated=${r.crossOriginIsolated}, wasm threads=${r.threads}; latency min ${r.latency.min.toFixed(0)} ms, median ${r.latency.median.toFixed(0)} ms`)
    for (const c of r.cases) {
      const ok = Math.abs(c.score - c.gold) < 0.03 && c.kpErrPx < 6 && Math.abs(c.people - c.goldPeople) <= 1
      failed ||= !ok
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${c.name}: out ${c.types.join('/')} kp[${c.dims}] best ${c.score.toFixed(4)} (golden ${c.gold.toFixed(4)}), people ${c.people}/${c.goldPeople}, kp err ${c.kpErrPx.toFixed(2)} px`)
    }
  } catch (e) {
    failed = true
    console.log(`\n[${ep}] FAIL: ${e.message.split('\n')[0]}`)
  }
  // ORT's verbose 'Node placements' report: which nodes ended up on which EP
  const placement = logs.filter((l) => /placed on \[/.test(l)).map((l) => l.replace(/^.*?(All nodes|Node\(s\))/s, '$1'))
  if (placement.length) console.log('  node placement:\n    ' + placement.join('\n').split('\n').slice(0, 40).join('\n    '))
  const errs = logs.filter((l) => /\[pageerror\]|\[E:onnxruntime|\[W:onnxruntime/.test(l) && !/VerifyEachNodeIsAssignedToAnEp|CleanUnusedInitializers|MergeShapeInfo/.test(l))
  if (errs.length) console.log('  errors:\n    ' + errs.slice(0, 8).join('\n    '))
}
await browser.close()
server.close()
console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: OK')
process.exitCode = failed ? 1 : 0
