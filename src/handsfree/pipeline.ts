import { adaptReference, Calibrator, features, measure, type FeatureVec, type Measures, type Reference } from './features'
import { canonicalSides, type BodyObs, type Observation } from './observation'
import { PointSmoother } from './smoothing'

/**
 * Which body to use when two engines run. MediaPipe has per-landmark
 * visibility; DETRPose finds people more consistently when the head is
 * cropped or close. 'mp-first' takes MediaPipe whenever it sees the
 * shoulders, else DETRPose.
 */
export type BodySource = 'mp' | 'detr' | 'mp-first' | 'detr-first'
type EngineKey = 'mp' | 'detr'

const shouldersSeen = (b: BodyObs | null | undefined) => !!b && (b.points[11]!.v + b.points[12]!.v) / 2 > 0.5

export function pickBody(obs: Observation, source: BodySource, prefer?: EngineKey): BodyObs | null {
  const mp = obs.body
  const detr = obs.detr ?? null
  switch (source) {
    case 'mp':
      return mp
    case 'detr':
      return detr
    case 'mp-first':
      // Sticky: stay with the engine in use while it still sees the shoulders.
      if (prefer === 'detr' && detr && shouldersSeen(detr)) return detr
      return shouldersSeen(mp) ? mp : (detr ?? mp)
    case 'detr-first':
      return detr ?? mp
  }
}

export interface Perceived {
  t: number
  measures: Measures
  /** null until calibrated. */
  features: FeatureVec | null
}

const keyOf = (b: BodyObs | null | undefined): EngineKey => (b?.engine === 'detrpose' ? 'detr' : 'mp')

/**
 * Observation -> smoothed landmarks -> measures -> calibrated features.
 * Calibration happens while `calibrating` is on (the setup's "stand on the
 * rug, look at the screen", or the first moments before the prayer), and
 * the reference then slowly follows the person whenever the decoder says
 * they are standing. Each body engine gets its own smoother and its own
 * reference: their landmarks sit in slightly different places, so features
 * are only ever measured against the same engine's standing pose.
 */
export class Perception {
  private smoothers = { mp: new PointSmoother(), detr: new PointSmoother() }
  private calibrators = { mp: new Calibrator(), detr: new Calibrator() }
  private refs: Record<EngineKey, Reference | null> = { mp: null, detr: null }
  private last: EngineKey | null = null

  constructor(
    ref?: Reference | null,
    private readonly source: BodySource = 'mp-first',
  ) {
    if (ref) this.refs.mp = ref
  }

  /** The reference for framing advice (MediaPipe's when there is one). */
  get ref(): Reference | null {
    return this.refs.mp ?? this.refs.detr
  }

  private measureWith(obs: Observation, b: BodyObs | null, t: number) {
    const body = b ? { ...b, points: this.smoothers[keyOf(b)].smooth(canonicalSides(b.points), t) } : null
    return measure({ ...obs, body })
  }

  push(obs: Observation, { calibrating = false, standing = false } = {}): Perceived {
    const t = obs.t / 1000
    const picked = pickBody(obs, this.source, this.last ?? undefined)
    const key = keyOf(picked)
    if (picked) this.last = key
    const m = this.measureWith(obs, picked, t)
    // Calibrate (or follow) every engine that sees the person, not just the picked one.
    const others = ([obs.body, obs.detr] as (BodyObs | null | undefined)[]).filter((b): b is BodyObs => !!b && b !== picked)
    const all: [EngineKey, typeof m][] = [[key, m], ...others.map((b) => [keyOf(b), this.measureWith(obs, b, t)] as [EngineKey, typeof m])]
    for (const [k, mm] of all) {
      if (!mm.body) continue
      if (calibrating) {
        this.calibrators[k].add(mm)
        const r = this.calibrators[k].reference()
        if (r) this.refs[k] = r
      } else if (standing && this.refs[k]) this.refs[k] = adaptReference(this.refs[k]!, mm)
    }
    const ref = this.refs[key] ?? this.ref
    return { t: obs.t, measures: m, features: ref ? features(m, ref) : null }
  }

  get calibrationFrames() {
    return Math.max(this.calibrators.mp.count, this.calibrators.detr.count)
  }

  recalibrate() {
    this.calibrators.mp.reset()
    this.calibrators.detr.reset()
  }

  reset() {
    this.smoothers.mp.reset()
    this.smoothers.detr.reset()
    this.recalibrate()
    this.refs = { mp: null, detr: null }
  }
}
