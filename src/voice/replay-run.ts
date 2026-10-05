import { buildSequence } from '@/sequence/build'
import type { PrayerId, Step } from '@/sequence/types'
import { SessionSim, VoiceCore } from './core'
import { VoiceEngine } from './engine'
import { buildTimeline, encodeWav, renderTimeline, scoreReplay, type ReplayLog, type ReplayMetrics, type Timeline, type VoiceManifest } from './replay'

/**
 * Browser half of the replay harness (driven by scripts/voice-replay.mjs, or
 * by hand from /?lab&voice). Builds the prayer audio from the companion's
 * recordings, runs it through the REAL worker, follower and driver, and
 * scores the result against the word timings.
 */

export interface ReplayParams {
  prayer: PrayerId
  voice: string
  seed: number
  /** Speech-to-noise ratio in dB (null: clean). */
  snrDb: number | null
  /** Overall gain (0.1 = -20 dB). */
  gain: number
  /** Gain of lines the sequence marks quiet. */
  quietGain: number
  /** Feed the worker directly (fast) or listen through the microphone (fake capture). */
  source: 'feed' | 'mic'
  /** False starts, a forgotten quiet line, tasbih x1 / x5. */
  perturb: boolean
  /** Tasbih repetitions back to back (0 to 80 ms apart). */
  tight: boolean
  /** Consecutive ayat in one breath. */
  joined: boolean
  /** Another voice recites each line first (the companion from the speakers). */
  companion: string | null
  /** Silence the microphone while the companion speaks (the app's gate option). */
  gate: boolean
}

export const DEFAULT_REPLAY: ReplayParams = {
  prayer: 'fajr',
  voice: 'aisha',
  seed: 1,
  snrDb: null,
  gain: 1,
  quietGain: 1,
  source: 'feed',
  perturb: false,
  tight: false,
  joined: false,
  companion: null,
  gate: false,
}

export function replayParams(q: URLSearchParams): ReplayParams {
  const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d)
  return {
    prayer: (q.get('prayer') as PrayerId) || DEFAULT_REPLAY.prayer,
    voice: q.get('speaker') || DEFAULT_REPLAY.voice,
    seed: num('seed', 1),
    snrDb: q.has('snr') ? Number(q.get('snr')) : null,
    gain: num('gain', 1),
    quietGain: num('quietGain', 1),
    source: q.get('source') === 'mic' ? 'mic' : 'feed',
    perturb: q.has('perturb'),
    tight: q.has('tight'),
    joined: q.has('joined'),
    companion: q.get('companion'),
    gate: q.has('gate'),
  }
}

/** Companion bleed plus a short tail, as the app's gate would apply it. */
export function gateAt(tl: Timeline, t: number, tail = 0.35): boolean {
  return tl.clips.some((c) => c.kind === 'companion' && t >= c.start - 0.05 && t < c.start + c.dur + tail)
}

const SR = 16000

async function decodeClip(url: string): Promise<Float32Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const ctx = new OfflineAudioContext(1, SR, SR)
  const buf = await ctx.decodeAudioData(await res.arrayBuffer())
  return buf.getChannelData(0).slice()
}

export async function prepareReplay(p: ReplayParams): Promise<{ steps: Step[]; timeline: Timeline; pcm: Float32Array }> {
  const manifest = await (await fetch(new URL('audio/manifest.json', document.baseURI))).json()
  const lines = manifest.voices?.[p.voice]?.lines as VoiceManifest | undefined
  if (!lines) throw new Error(`no audio for voice ${p.voice}`)
  const companion = p.companion ? (manifest.voices?.[p.companion]?.lines as VoiceManifest | undefined) : undefined
  if (p.companion && !companion) throw new Error(`no audio for companion ${p.companion}`)
  const steps = buildSequence(p.prayer).steps
  const timeline = buildTimeline(steps, lines, { seed: p.seed, quietGain: p.quietGain, perturb: p.perturb, joined: p.joined, ...(p.tight ? { repPause: [0, 0.08] as [number, number] } : {}) }, companion)
  const pcm = new Map<string, Float32Array>()
  const keys = new Map(timeline.clips.map((c) => [c.key, c.key.replace(/^companion:/, '')]))
  await Promise.all([...keys].map(async ([key, src]) => pcm.set(key, await decodeClip(new URL(`audio/${src}`, document.baseURI).href))))
  return { steps, timeline, pcm: renderTimeline(timeline, pcm, { sampleRate: SR, gain: p.gain, snrDb: p.snrDb, seed: p.seed }) }
}

/**
 * Run a recorded session (WAV from "Record this session") through the real
 * worker, follower and driver for `prayer`, from the start of the prayer.
 * `log` gets one line per follower event and session move.
 */
export async function replayRecording(file: Blob, prayer: PrayerId, log: (line: string) => void) {
  const ctx = new OfflineAudioContext(1, SR, SR)
  const pcm = (await ctx.decodeAudioData(await file.arrayBuffer())).getChannelData(0).slice()
  const steps = buildSequence(prayer).steps
  const sim = new SessionSim(steps)
  let events = 0
  let moves = 0
  let timerMoves = 0
  const core = new VoiceCore(
    steps,
    { mode: 'full', stepMs: (s) => Math.max(s.timing.minMs, s.timing.expectedMs) },
    {
      view: sim.view,
      apply: sim.apply,
      onEvent: (e, now) => {
        events++
        if (e.kind !== 'word') log(`${(now / 1000).toFixed(2)}s event ${e.kind} ${'step' in e ? `${e.step} ${e.lineId}` : ''} (${e.confidence})`)
      },
      onAction: (a, now) => {
        moves++
        if (a.type === 'goTo' && a.reason === 'timer') timerMoves++
        log(`${(now / 1000).toFixed(2)}s MOVE ${a.type} ${'index' in a ? `${a.index} ${steps[a.index]?.recitationId}` : ''} (${a.reason})`)
      },
    },
  )
  core.sync(0)
  const engine = new VoiceEngine()
  engine.on((e) => {
    if (e.type === 'tokens') core.tokens(e.tokens, e.at, e.at * 1000 + e.decodeMs)
    else if (e.type === 'endpoint') core.endpoint(e.at, e.at * 1000)
    else if (e.type === 'level') {
      core.level(e.speech, e.at, e.at * 1000)
      core.tick(e.at * 1000)
    }
  })
  await engine.start({ mic: false })
  if (engine.status !== 'listening') throw new Error(`engine ${engine.status}: ${engine.error}`)
  const chunk = SR / 10
  const inflight: Promise<void>[] = []
  for (let off = 0; off < pcm.length; off += chunk) {
    inflight.push(engine.feed(pcm.slice(off, off + chunk), SR))
    if (inflight.length >= 16) await inflight.shift()
  }
  await Promise.all(inflight)
  await engine.finish()
  engine.stop()
  return { phase: sim.phase, index: sim.index, events, moves, timerMoves }
}

export function wavOf(pcm: Float32Array) {
  return encodeWav(pcm, SR)
}

export interface ReplayResult {
  params: ReplayParams
  metrics: ReplayMetrics
  log: ReplayLog
  timeline: Timeline
  wallSeconds: number
}

export async function runReplay(p: ReplayParams, onProgress?: (audioSec: number, total: number) => void): Promise<ReplayResult> {
  const started = performance.now()
  const { steps, timeline, pcm } = await prepareReplay(p)
  const sim = new SessionSim(steps)
  const log: ReplayLog = { events: [], actions: [], phase: 'ready', index: 0, audioSeconds: timeline.duration, decodeMs: [], tokens: [] }
  const core = new VoiceCore(
    steps,
    { mode: 'full', stepMs: (s) => Math.max(s.timing.minMs, s.timing.expectedMs) },
    {
      view: sim.view,
      apply: sim.apply,
      onEvent: (e, now) => log.events.push({ e, t: now / 1000 }),
      onAction: (a, now) => log.actions.push({ a, t: now / 1000 }),
    },
  )
  core.sync(0)
  const engine = new VoiceEngine()
  let lastAt = 0
  const pendingCompanion: { at: number; on: boolean }[] = []
  engine.on((e) => {
    if (e.type === 'tokens') {
      log.decodeMs.push(e.decodeMs)
      log.tokens!.push({ tokens: e.tokens, at: e.at + e.decodeMs / 1000, segment: e.segment })
      core.tokens(e.tokens, e.at, e.at * 1000 + e.decodeMs)
    } else if (e.type === 'endpoint') core.endpoint(e.at, e.at * 1000)
    else if (e.type === 'level') {
      lastAt = e.at
      // Companion on/off, applied on the audio clock in step with the decoder.
      while (pendingCompanion.length && pendingCompanion[0]!.at <= e.at) core.companion(pendingCompanion.shift()!.on, e.at * 1000)
      core.level(e.speech, e.at, e.at * 1000)
      core.tick(e.at * 1000)
      onProgress?.(e.at, timeline.duration)
    }
  })
  await engine.start({ mic: p.source === 'mic', micAfterLoad: true })
  if (engine.status !== 'listening') throw new Error(`engine ${engine.status}: ${engine.error}`)
  // Fake capture starts playing the file when the microphone opens; the worker's
  // clock starts at the first sample it receives, a little later.
  const offset = p.source === 'mic' ? engine.micLeadSec : 0

  if (p.source === 'feed') {
    const chunk = SR / 10
    const inflight: Promise<void>[] = []
    let gated = false
    let companionSpeaking = false
    for (let off = 0; off < pcm.length; off += chunk) {
      const speaking = gateAt(timeline, off / SR)
      if (speaking !== companionSpeaking) {
        companionSpeaking = speaking
        // The app knows when its own recitation plays, gate or not.
        pendingCompanion.push({ at: off / SR, on: speaking })
      }
      const gate = p.gate && speaking
      if (gate !== gated) engine.setGate((gated = gate))
      inflight.push(engine.feed(pcm.slice(off, off + chunk), SR))
      if (inflight.length >= 16) await inflight.shift()
    }
    await Promise.all(inflight)
    await engine.finish()
  } else {
    // The fake microphone plays the same file; wait until it has been heard.
    // With %noloop the capture simply stops at the end of the file.
    let seen = lastAt
    let stalled = 0
    while (lastAt + offset < timeline.duration - 0.2 && stalled < 12) {
      await new Promise((r) => setTimeout(r, 250))
      stalled = lastAt === seen ? stalled + 1 : 0
      seen = lastAt
    }
    await engine.finish()
    for (const x of log.events) x.t += offset
    for (const x of log.actions) x.t += offset
  }
  engine.stop()
  log.phase = sim.phase
  log.index = sim.index
  return { params: p, metrics: scoreReplay(timeline, steps, log), log, timeline, wallSeconds: Math.round((performance.now() - started) / 100) / 10 }
}
