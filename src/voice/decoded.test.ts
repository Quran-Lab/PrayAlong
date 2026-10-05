import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSequence } from '@/sequence/build'
import type { PrayerId } from '@/sequence/types'
import { SessionSim, VoiceCore } from './core'
import { scoreReplay, type ReplayLog, type Timeline } from './replay'

/**
 * Regression on REAL decoder output: token streams the in-browser worker
 * produced for whole prayers (scripts/voice-replay.mjs, trimmed by
 * scripts/voice-fixture.mjs), replayed through the follower, driver and a
 * session. Catches follower or driver changes that break real recitation
 * without needing the model or a browser.
 */

interface Fixture {
  source: string
  params: { prayer: PrayerId; voice: string; perturb?: boolean; companion?: string | null; gate?: boolean }
  tokens: [number, number, string][]
  timeline: Timeline
}

const DIR = join(__dirname, 'fixtures')
const fixtures = readdirSync(DIR).filter((f) => f.endsWith('.json'))

function replay(fx: Fixture) {
  const steps = buildSequence(fx.params.prayer).steps
  const sim = new SessionSim(steps)
  const log: ReplayLog = { events: [], actions: [], phase: 'ready', index: 0, audioSeconds: fx.timeline.duration, decodeMs: [] }
  const core = new VoiceCore(
    steps,
    { mode: 'full', stepMs: (s) => Math.max(s.timing.minMs, s.timing.expectedMs) },
    { view: sim.view, apply: sim.apply, onEvent: (e, now) => log.events.push({ e, t: now / 1000 }), onAction: (a, now) => log.actions.push({ a, t: now / 1000 }) },
  )
  core.sync(0)
  const clips = fx.timeline.clips
  const speechAt = (t: number) => clips.some((c) => c.kind !== 'companion' && t >= c.start && t < c.start + c.dur)
  const companionAt = (t: number) => clips.some((c) => c.kind === 'companion' && t >= c.start - 0.05 && t < c.start + c.dur + 0.35)
  let k = 0
  let segment = 0
  let companion = false
  for (let t = 0.1; t <= fx.timeline.duration + 0.05; t = Math.round((t + 0.1) * 10) / 10) {
    while (k < fx.tokens.length && fx.tokens[k]![0] <= t) {
      const [at, seg, text] = fx.tokens[k++]!
      if (seg !== segment) {
        core.endpoint(at, at * 1000)
        segment = seg
      }
      core.tokens(text.split(' '), at, at * 1000)
    }
    const c = companionAt(t)
    if (c !== companion) core.companion((companion = c), t * 1000)
    core.level(speechAt(t), t, t * 1000)
    core.tick(t * 1000)
  }
  log.phase = sim.phase
  log.index = sim.index
  return scoreReplay(fx.timeline, steps, log)
}

describe('follower + driver on recorded decoder output', () => {
  for (const file of fixtures) {
    it(file, () => {
      const fx = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Fixture
      const m = replay(fx)
      expect(m.session.completed).toBe(true)
      expect(m.session.premature).toBe(0)
      expect(m.words.recall).toBeGreaterThanOrEqual(0.95)
      // The noisy, quiet fixture has tasbih repetitions the decoder emitted
      // nothing for; the following one is then credited late (about 3 to 4 s).
      expect(m.words.lagP95).toBeLessThanOrEqual(file.includes('snr10') ? 2.5 : 2)
      expect(m.lineDone.accuracy).toBeGreaterThanOrEqual(0.9)
      expect(m.keywords.takbirRecall).toBeGreaterThanOrEqual(0.9)
      expect(m.keywords.falseEvents).toBe(0)
    })
  }
})
