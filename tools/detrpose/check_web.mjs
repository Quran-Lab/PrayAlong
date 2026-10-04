#!/usr/bin/env node
// Run a DETRPose ONNX model through onnxruntime-web's WASM backend (the same CPU kernels the
// browser uses for executionProviders: ['wasm']) and compare against golden outputs from
// verify_onnx.py --dump.
//
//   node tools/detrpose/check_web.mjs <model.onnx> <golden_dir> [--threads N] [--runs N]
//
// Exit code 1 if the session cannot be created (unsupported op), the IO contract differs from
// src/handsfree/pose-worker.ts, or outputs drift from the golden data by more than the tolerances.
import { readFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
import { cpus } from 'node:os'
import * as ort from 'onnxruntime-web'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(name)
  if (i < 0) return dflt
  const v = args[i + 1]
  args.splice(i, 2)
  return Number(v)
}
const threads = flag('--threads', Math.min(4, cpus().length))
const runs = flag('--runs', 10)
const [modelPath, goldenDir] = args
if (!modelPath || !goldenDir) {
  console.error('usage: node check_web.mjs <model.onnx> <golden_dir> [--threads N] [--runs N]')
  process.exit(2)
}

ort.env.wasm.numThreads = threads
ort.env.logLevel = 'error'

const fail = (msg) => {
  console.error('FAIL:', msg)
  process.exitCode = 1
}

const bytes = readFileSync(modelPath)
console.log(`onnxruntime-web ${ort.env.versions?.web ?? ''} wasm, threads=${threads}`)
console.log(`model ${basename(modelPath)} ${(bytes.length / 1e6).toFixed(2)} MB`)

let t0 = performance.now()
const session = await ort.InferenceSession.create(bytes, {
  executionProviders: ['wasm'],
  graphOptimizationLevel: 'all',
})
console.log(`session create: ${(performance.now() - t0).toFixed(0)} ms`)
console.log('inputs :', session.inputNames.join(', '), '| outputs:', session.outputNames.join(', '))

const want = { inputs: ['images', 'orig_target_sizes'], outputs: ['scores', 'labels', 'keypoints'] }
for (const n of want.inputs) if (!session.inputNames.includes(n)) fail(`missing input ${n}`)
for (const n of want.outputs) if (!session.outputNames.includes(n)) fail(`missing output ${n}`)

// Exactly what pose-worker.ts feeds.
const feeds = (data) => ({
  images: new ort.Tensor('float32', data, [1, 3, 640, 640]),
  orig_target_sizes: new ort.Tensor('int64', new BigInt64Array([1n, 1n]), [1, 2]),
})

const cases = readdirSync(goldenDir).filter((f) => f.endsWith('.input.bin'))
if (!cases.length) fail(`no *.input.bin in ${goldenDir}`)

let firstInput
for (const f of cases) {
  const stem = f.replace('.input.bin', '')
  const buf = readFileSync(join(goldenDir, f))
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  firstInput ??= data
  const gold = JSON.parse(readFileSync(join(goldenDir, stem + '.json'), 'utf8'))
  const out = await session.run(feeds(data))

  const { scores, labels, keypoints } = out
  const sig = `scores ${scores.type}[${scores.dims}] labels ${labels.type}[${labels.dims}] keypoints ${keypoints.type}[${keypoints.dims}]`
  if (scores.type !== 'float32' || keypoints.type !== 'float32' || labels.type !== 'int64') fail(`dtypes ${sig}`)
  if (keypoints.dims.length !== 4 || keypoints.dims[2] !== 17 || keypoints.dims[3] !== 2) fail(`shape ${sig}`)

  const Q = scores.dims[1]
  const s = scores.data
  const k = keypoints.data
  // same selection as pose-worker.ts
  let best = 0
  for (let i = 1; i < Q; i++) if (s[i] > s[best]) best = i
  const gs = gold.scores
  let gbest = 0
  for (let i = 1; i < gs.length; i++) if (gs[i] > gs[gbest]) gbest = i
  let kpErr = 0
  for (let j = 0; j < 17; j++) {
    const dx = (k[(best * 17 + j) * 2] - gold.keypoints[gbest][j][0]) * gold.width
    const dy = (k[(best * 17 + j) * 2 + 1] - gold.keypoints[gbest][j][1]) * gold.height
    kpErr = Math.max(kpErr, Math.hypot(dx, dy))
  }
  // people above the app's 0.4 threshold, and the top score
  const people = Array.from(s).filter((v) => v >= 0.4).length
  const gpeople = gs.filter((v) => v >= 0.4).length
  const scoreErr = Math.abs(s[best] - gs[gbest])
  let kmin = Infinity
  let kmax = -Infinity
  for (const v of k) {
    kmin = Math.min(kmin, v)
    kmax = Math.max(kmax, v)
  }
  console.log(
    `${stem}: ${sig}\n  best score ${s[best].toFixed(4)} (golden ${gs[gbest].toFixed(4)}), people>=0.4 ${people} (golden ${gpeople}), ` +
      `best-person max keypoint err ${kpErr.toFixed(2)} px @ ${gold.width}x${gold.height}, keypoint range [${kmin.toFixed(3)}, ${kmax.toFixed(3)}]`,
  )
  if (scoreErr > 0.03) fail(`${stem}: top score drift ${scoreErr}`)
  if (kpErr > 6) fail(`${stem}: keypoint drift ${kpErr}px`)
  if (Math.abs(people - gpeople) > 1) fail(`${stem}: person count ${people} vs ${gpeople}`)
}

// latency (warm)
for (let i = 0; i < 2; i++) await session.run(feeds(firstInput))
const times = []
for (let i = 0; i < runs; i++) {
  t0 = performance.now()
  await session.run(feeds(firstInput))
  times.push(performance.now() - t0)
}
times.sort((a, b) => a - b)
const med = times[Math.floor(times.length / 2)]
console.log(`latency over ${runs} runs: min ${times[0].toFixed(0)} ms, median ${med.toFixed(0)} ms, max ${times.at(-1).toFixed(0)} ms`)
await session.release()
console.log(process.exitCode ? 'RESULT: FAIL' : 'RESULT: OK')
