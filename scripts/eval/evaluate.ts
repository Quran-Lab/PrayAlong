// Replays recorded observations through the hands-free engines and scores
// them against the ground truth.
//
//   node scripts/eval/run.mjs evaluate [--tag x] [--split tune|test|all] [--json out.json] [--sweep]
//
// Engines:
//   new        calibrated features -> per-frame classifier -> sequence decoder
//   old-lite   the previous engine: MediaPipe lite -> classify.ts -> stabilizer -> session.onPose
//   old-detr   the same with DETRPose (the previous WebGPU upgrade)
//
// Metrics (per transition = each movement into the next posture of the prayer):
//   detected   the app moved to that posture between the movement's start
//              and 1.5 s after the body arrived
//   false      the app moved to a posture the person was not in (or before
//              they started moving)
//   latency    movement start -> step change, and arrival -> step change
//   frame acc  per-frame argmax class on settled frames
import { writeFileSync } from 'node:fs'
import { buildSequence, nextPoseChange } from '../../src/sequence/build'
import type { PoseClass, Step } from '../../src/sequence/types'
import { DEFAULT_TUNING, SequenceDecoder, segmentsOf, type DecoderTuning, type Segment as SeqSegment } from '../../src/handsfree/decoder'
import { Perception, type BodySource } from '../../src/handsfree/pipeline'
import { posterior, POSE_CLASSES, usePostureModel } from '../../src/handsfree/posterior'
import { useChangeModel } from '../../src/handsfree/change'
import { existsSync, readFileSync } from 'node:fs'
import type { Keypoint } from '../../src/handsfree/types'
import { classifyPose, torsoLength } from './baseline/classify-old'
import { PoseStabilizer } from './baseline/stabilizer-old'
import { classOf } from './common'
import { gtAt, loadClips, type Clip } from './dataset'

const args = process.argv.slice(2)
const opt = (k: string, d: string) => (args.includes(k) ? args[args.indexOf(k) + 1]! : d)
const tag = opt('--tag', '')
const split = opt('--split', 'all')
const jsonOut = opt('--json', '')
const source = opt('--source', 'mp-first') as BodySource
const WINDOW = 1.5
/** The app's own fallback: a missed movement is followed by time this long after it started. */
const FALLBACK_S = 6

const steps = buildSequence('fajr').steps
const seqSegs = segmentsOf(steps)
const stepSeg: number[] = []
seqSegs.forEach((s, i) => {
  for (let j = s.start; j <= s.end; j++) stepSeg[j] = i
})

interface Event {
  t: number
  seg: number
  reason: string
}

interface Transition {
  seg: number
  kind: string
  onset: number
  settled: number
  detectedAt: number | null
}

interface ClipResult {
  clip: string
  meta: Clip['meta']
  transitions: Transition[]
  falseAdvances: { t: number; seg: number; gt: number; reason: string }[]
  frames: { total: number; correct: number; covered: number }
  confusion: Record<string, Record<string, number>>
}

/** GT segment index (into the prayer's segments) at time t; -1 before the takbir. */
function gtSegments(clip: Clip) {
  const real = clip.segments.filter((s) => !s.distractor && s.posture !== 'rest')
  if (real.length !== seqSegs.length) throw new Error(`${clip.name}: ${real.length} labelled segments, prayer has ${seqSegs.length}`)
  real.forEach((s, i) => {
    const want = seqSegs[i]!.posture
    const same = s.posture === want || (want === 'tashahhud' && s.posture === 'tashahhud')
    if (!same) throw new Error(`${clip.name}: segment ${i} is ${s.posture}, prayer expects ${want}`)
  })
  return real
}

function score(clip: Clip, events: Event[], frameVotes: { t: number; cls: PoseClass | null }[]): ClipResult {
  const real = gtSegments(clip)
  const gtAtT = (t: number) => {
    let g = -1
    for (let i = 0; i < real.length; i++) if (real[i]!.onset <= t + 1e-6) g = i
    return g
  }
  const transitions: Transition[] = real.map((s, i) => ({ seg: i, kind: seqSegs[i]!.kind, onset: s.onset, settled: s.settled ?? s.onset + 1, detectedAt: null }))
  const falseAdvances: ClipResult['falseAdvances'] = []
  for (const e of events) {
    const g = gtAtT(e.t)
    if (e.seg > g) falseAdvances.push({ t: e.t, seg: e.seg, gt: g, reason: e.reason })
    else {
      const tr = transitions[e.seg]!
      if (tr.detectedAt === null) tr.detectedAt = e.t
    }
  }
  const confusion: ClipResult['confusion'] = {}
  let total = 0
  let correct = 0
  let covered = 0
  for (const v of frameVotes) {
    const gt = gtAt(clip, v.t)
    if (!gt.settled) continue
    const want = classOf(gt.posture)
    total++
    if (v.cls) covered++
    if (v.cls === want) correct++
    const row = (confusion[want] ??= {})
    row[v.cls ?? 'none'] = (row[v.cls ?? 'none'] ?? 0) + 1
  }
  return { clip: clip.name, meta: clip.meta, transitions, falseAdvances, frames: { total, correct, covered }, confusion }
}

function calibrationEnd(clip: Clip) {
  const first = clip.segments.find((s) => s.posture !== 'rest')
  return (first?.onset ?? 3) - 0.3
}

export interface RunOptions {
  tuning?: Partial<DecoderTuning>
  source?: BodySource
  /**
   * 'chained': the session carries over from movement to movement, with the
   * app's timer fallback (a missed movement is followed FALLBACK_S after
   * it started). 'resync': before each movement starts, a decoder that fell
   * behind is put back where the person is, isolating each transition.
   */
  mode?: 'chained' | 'resync'
}

/** Where the app would correct the session at time t (timer fallback or resync), or null. */
function correction(real: { onset: number; settled: number | null }[], t: number, current: number, mode: 'chained' | 'resync') {
  for (let j = 0; j < real.length; j++) {
    // chained: the app's own timer fallback; resync: an ideal fallback the
    // moment a movement's detection window has passed.
    const at = mode === 'chained' ? real[j]!.onset + FALLBACK_S : (real[j]!.settled ?? real[j]!.onset + 1) + WINDOW
    if (t >= at && t < at + 0.07 && current < j) return j
  }
  return null
}

/**
 * Leave-one-character-out: with --loco <dir>, each clip is decoded with the
 * models fitted without its character (<dir>/posture-<character>.json and
 * change-<character>.json, written by scripts/eval/loco.sh).
 */
const locoDir = opt('--loco', '')
function useModelsFor(clip: Clip) {
  if (!locoDir) return
  const c = String(clip.meta.character)
  const p = `${locoDir}/posture-${c}.json`
  if (!existsSync(p)) throw new Error(`no leave-one-out model for ${c}`)
  usePostureModel(JSON.parse(readFileSync(p, 'utf8')))
  useChangeModel(JSON.parse(readFileSync(`${locoDir}/change-${c}.json`, 'utf8')))
}

type Post = ReturnType<typeof posterior>
const NOBODY = (t: number): Post => ({ t, p: { standing: 0.2, 'hands-raised': 0.2, bowing: 0.2, prostrating: 0.2, sitting: 0.2 }, conf: 0, present: false, turn: NaN, faceYaw: NaN, f: null })

/**
 * The whole new engine on one clip. With `cache`, the per-frame posteriors
 * of a previous run are reused (decoder sweeps); the standing-reference
 * adaptation then follows that earlier run.
 */
export function runNew(clip: Clip, opts: RunOptions = {}, cache?: Post[]): ClipResult & { posts: Post[] } {
  useModelsFor(clip)
  const perception = new Perception(null, opts.source ?? source)
  const dec = new SequenceDecoder(steps, opts.tuning ?? {})
  dec.sync('ready', 0, 0)
  const real = gtSegments(clip)
  const calEnd = calibrationEnd(clip)
  const events: Event[] = []
  const votes: { t: number; cls: PoseClass | null }[] = []
  const posts: Post[] = []
  let standing = false
  const mode = opts.mode ?? 'chained'
  clip.frames.forEach((f, i) => {
    const t = f.t / 1000
    const fix = correction(real, t, dec.segment, mode)
    if (fix !== null) dec.sync(fix < 0 ? 'ready' : 'praying', fix < 0 ? 0 : seqSegs[fix]!.start, f.t)
    let post: Post
    if (cache) post = cache[i]!
    else if (f.obs) {
      const r = perception.push(f.obs, { calibrating: t < calEnd, standing })
      post = posterior(f.t, r.features, r.measures)
    } else post = NOBODY(f.t)
    posts.push(post)
    const best = post.conf > 0 ? POSE_CLASSES.reduce((a, b) => (post.p[b] > post.p[a] ? b : a)) : null
    votes.push({ t, cls: best })
    const adv = dec.push(post)
    if (adv && adv.index >= 0) events.push({ t, seg: stepSeg[adv.index]!, reason: adv.reason })
    const st = dec.status(f.t)
    standing = st.current === 'standing' && dec.segment >= 0 && post.p.standing > 0.8
  })
  return { ...score(clip, events, votes), posts }
}

export function runOld(clip: Clip, which: 'lite' | 'detrpose', mode: 'chained' | 'resync' = 'chained'): ClipResult {
  const real = gtSegments(clip)
  const stab = new PoseStabilizer()
  let standingTorso: number | undefined
  let phase: 'ready' | 'praying' = 'ready'
  let index = 0
  const events: Event[] = []
  const votes: { t: number; cls: PoseClass | null }[] = []
  for (const f of clip.frames) {
    const t = f.t / 1000
    // The same session corrections as for the new engine.
    const fix = correction(real, t, phase === 'ready' ? -1 : stepSeg[index]!, mode)
    if (fix !== null) {
      if (fix < 0) phase = 'ready'
      else {
        phase = 'praying'
        index = seqSegs[fix]!.start
      }
    }
    const kp = (which === 'lite' ? f.lite : f.detrpose) as Keypoint[] | null | undefined
    let changed: PoseClass | null
    if (kp) {
      const reading = classifyPose(kp, standingTorso)
      if (reading.pose === 'standing') {
        const len = torsoLength(kp)
        standingTorso = standingTorso ? standingTorso * 0.9 + len * 0.1 : len
      }
      votes.push({ t, cls: reading.pose })
      changed = stab.push(reading.pose, f.t)
    } else {
      votes.push({ t, cls: null })
      changed = stab.push(null, f.t)
    }
    if (!changed) continue
    // session.onPose, as it was.
    if (phase === 'ready') {
      if (changed === 'hands-raised') {
        phase = 'praying'
        index = 0
        events.push({ t, seg: 0, reason: 'camera' })
      }
      continue
    }
    const target = nextPoseChange(steps as Step[], index)
    if (target >= 0 && steps[target]!.pose === changed) {
      index = target
      events.push({ t, seg: stepSeg[target]!, reason: 'camera' })
    }
  }
  return score(clip, events, votes)
}

// --------------------------------------------------------- reporting

interface Agg {
  transitions: number
  detected: number
  falseAdvances: number
  latOnset: number[]
  latSettled: number[]
  frames: number
  correct: number
  clips: number
}

const empty = (): Agg => ({ transitions: 0, detected: 0, falseAdvances: 0, latOnset: [], latSettled: [], frames: 0, correct: 0, clips: 0 })

function add(a: Agg, r: ClipResult, opts: { skipSalam?: boolean } = {}) {
  a.clips++
  for (const tr of r.transitions) {
    if (opts.skipSalam && tr.kind.startsWith('salam')) continue
    a.transitions++
    if (tr.detectedAt !== null && tr.detectedAt <= tr.settled + WINDOW) {
      a.detected++
      a.latOnset.push(tr.detectedAt - tr.onset)
      a.latSettled.push(tr.detectedAt - tr.settled)
    }
  }
  a.falseAdvances += r.falseAdvances.length
  a.frames += r.frames.total
  a.correct += r.frames.correct
}

const median = (xs: number[]) => (xs.length ? xs.slice().sort((p, q) => p - q)[xs.length >> 1]! : NaN)
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) : '-')

function row(label: string, a: Agg) {
  return `| ${label} | ${a.clips} | ${pct(a.detected, a.transitions)}% (${a.detected}/${a.transitions}) | ${a.falseAdvances} | ${median(a.latOnset).toFixed(2)} | ${median(a.latSettled).toFixed(2)} | ${pct(a.correct, a.frames)}% |`
}

export function summarize(results: Record<string, ClipResult[]>, groups: string[] = ['gap', 'yaw', 'split', 'lightLevel', 'character']) {
  const lines: string[] = []
  const header = '| | clips | detected <= 1.5 s | false advances | median latency from movement start (s) | median latency from arrival (s) | frame accuracy |\n|---|---|---|---|---|---|---|'
  for (const [engine, rs] of Object.entries(results)) {
    lines.push(`\n### ${engine}\n`, header)
    const all = empty()
    rs.forEach((r) => add(all, r))
    lines.push(row('all', all))
    const noSalam = empty()
    rs.forEach((r) => add(noSalam, r, { skipSalam: true }))
    lines.push(row('all, without salams', noSalam))
    for (const g of groups) {
      const keys = [...new Set(rs.map((r) => String(r.meta[g])))].sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b))
      for (const k of keys) {
        const a = empty()
        rs.filter((r) => String(r.meta[g]) === k).forEach((r) => add(a, r))
        lines.push(row(`${g} = ${k}`, a))
      }
    }
  }
  return lines.join('\n')
}

export function perTransition(rs: ClipResult[]) {
  const by: Record<string, { n: number; det: number; lat: number[] }> = {}
  for (const r of rs)
    for (const tr of r.transitions) {
      const key = `${String(tr.seg).padStart(2, '0')} ${seqSegs[tr.seg]!.posture}`
      const b = (by[key] ??= { n: 0, det: 0, lat: [] })
      b.n++
      if (tr.detectedAt !== null && tr.detectedAt <= tr.settled + WINDOW) {
        b.det++
        b.lat.push(tr.detectedAt - tr.onset)
      }
    }
  return Object.entries(by)
    .sort()
    .map(([k, b]) => `| ${k} | ${pct(b.det, b.n)}% (${b.det}/${b.n}) | ${median(b.lat).toFixed(2)} |`)
    .join('\n')
}

// --------------------------------------------------------- main

const isMain = !!process.argv[1]?.endsWith('evaluate.bundle.mjs')
if (isMain) {
  const chars = opt('--chars', '')
  const clips = loadClips({ synth: '.eval/synth', obs: '.eval/obs', recorded: '.eval/recorded' }, tag).filter(
    (c) => (split === 'all' || c.meta.split === split) && (!chars || chars.split(',').includes(String(c.meta.character))),
  )
  console.log(`${clips.length} clips (${split})`)

  if (args.includes('--sweep')) {
    // Decoder sweep on cached posteriors. Pick on the tune characters only.
    const mode = opt('--mode', 'chained') as 'chained' | 'resync'
    const cached = clips.map((c) => ({ c, posts: runNew(c, { mode }).posts }))
    const rows: { key: string; tune: Agg; test: Agg }[] = []
    const grid = {
      scale: [0.75, 1, 1.25],
      drift: [1],
      wChange: [1],
      wClass: [1],
      moveMin: [0.5],
      baselineFrom: [0.3, 0.5, 0.7],
    }
    for (const scale of grid.scale)
      for (const drift of grid.drift)
        for (const wChange of grid.wChange)
          for (const wClass of grid.wClass)
            for (const moveMin of grid.moveMin)
            for (const baselineFrom of grid.baselineFrom) {
              const threshold = Object.fromEntries(Object.entries(DEFAULT_TUNING.threshold).map(([k, v]) => [k, v * scale])) as DecoderTuning['threshold']
              const tuning = { threshold, drift, wChange, wClass, moveMin, baselineFrom }
              const tune = empty()
              const test = empty()
              for (const { c, posts } of cached) add(c.meta.split === 'tune' ? tune : test, runNew(c, { mode, tuning }, posts))
              rows.push({ key: JSON.stringify({ scale, drift, wChange, wClass, moveMin, baselineFrom }), tune, test })
            }
    rows.sort((a, b) => a.tune.falseAdvances - b.tune.falseAdvances || b.tune.detected - a.tune.detected)
    console.log('| config | tune detected | tune false | tune latency | test detected | test false |\n|---|---|---|---|---|---|')
    for (const r of rows.slice(0, 40))
      console.log(`| ${r.key} | ${pct(r.tune.detected, r.tune.transitions)}% | ${r.tune.falseAdvances} | ${median(r.tune.latOnset).toFixed(2)} | ${pct(r.test.detected, r.test.transitions)}% | ${r.test.falseAdvances} |`)
    process.exit(0)
  }

  const mode = opt('--mode', 'chained') as 'chained' | 'resync'
  const results: Record<string, ClipResult[]> = { new: clips.map((c) => runNew(c, { mode })) }
  if (args.includes('--sources'))
    for (const src of ['mp', 'detr', 'mp-first', 'detr-first'] as const) if (src !== source) results[`new, body ${src}`] = clips.map((c) => runNew(c, { mode, source: src }))
  if (clips.some((c) => c.frames.some((f) => f.lite))) results['old (MediaPipe lite)'] = clips.map((c) => runOld(c, 'lite', mode))
  if (clips.some((c) => c.frames.some((f) => f.detrpose))) results['old (DETRPose)'] = clips.map((c) => runOld(c, 'detrpose', mode))
  console.log(`mode: ${mode}, body: ${source}`)
  console.log(summarize(results))
  console.log('\n### per transition (new)\n\n| segment | detected | median latency from start (s) |\n|---|---|---|')
  console.log(perTransition(results.new!))
  const fa = results.new!.flatMap((r) => r.falseAdvances.map((f) => `${r.clip} t=${f.t.toFixed(2)} -> seg ${f.seg} (${seqSegs[f.seg]!.posture}) while in ${f.gt} [${f.reason}]`))
  console.log(`\nfalse advances (new): ${fa.length}\n${fa.join('\n')}`)
  const missed = results.new!.flatMap((r) =>
    r.transitions.filter((tr) => tr.detectedAt === null || tr.detectedAt > tr.settled + WINDOW).map((tr) => `${r.clip} seg ${tr.seg} ${seqSegs[tr.seg]!.posture} ${tr.detectedAt === null ? 'never' : `late +${(tr.detectedAt - tr.settled).toFixed(2)} s`}`),
  )
  console.log(`\nmissed (new): ${missed.length}\n${missed.join('\n')}`)
  const conf: Record<string, Record<string, number>> = {}
  for (const r of results.new!) for (const [g, row] of Object.entries(r.confusion)) for (const [p, n] of Object.entries(row)) ((conf[g] ??= {})[p] = (conf[g]![p] ?? 0) + n)
  console.log('\nconfusion (new, settled frames; rows = truth):', JSON.stringify(conf, null, 1))
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results))
}

export type { SeqSegment }
