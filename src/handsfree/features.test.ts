import { describe, expect, it } from 'vitest'
import { blocker } from './advice'
import { Calibrator, features, measure } from './features'
import { BP, LUMA_H, LUMA_W, type Observation, type Point } from './observation'
import { Perception } from './pipeline'
import { posterior } from './posterior'
import { OneEuro } from './smoothing'

/**
 * A front-facing upper body in normalized image coordinates: head centre
 * (hx, hy), head width hw, shoulders at sy with width sw. The worshipper's
 * left is image right (an unmirrored camera).
 */
function body({ hx = 0.5, hy = 0.2, hw = 0.08, sy = 0.35, sw = 0.24, nose = 0, vis = 1, wristY = 0.6 } = {}): Point[] {
  const pts: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9, v: 0.1 }))
  const set = (i: number, x: number, y: number, v = vis) => (pts[i] = { x, y, v })
  set(BP.nose, hx + nose * sw, hy)
  set(BP.leftEye, hx + hw * 0.2, hy - 0.01)
  set(BP.rightEye, hx - hw * 0.2, hy - 0.01)
  set(BP.leftEyeOuter, hx + hw * 0.3, hy - 0.01)
  set(BP.rightEyeOuter, hx - hw * 0.3, hy - 0.01)
  set(BP.leftEar, hx + hw / 2, hy)
  set(BP.rightEar, hx - hw / 2, hy)
  set(BP.mouthLeft, hx + hw * 0.15, hy + 0.025)
  set(BP.mouthRight, hx - hw * 0.15, hy + 0.025)
  set(BP.leftShoulder, 0.5 + sw / 2, sy, 1)
  set(BP.rightShoulder, 0.5 - sw / 2, sy, 1)
  set(BP.leftWrist, 0.5 + sw / 2, wristY, 1)
  set(BP.rightWrist, 0.5 - sw / 2, wristY, 1)
  set(BP.leftHip, 0.5 + sw * 0.4, 0.8, 1)
  set(BP.rightHip, 0.5 - sw * 0.4, 0.8, 1)
  return pts
}

const obs = (points: Point[] | null, t = 0, luma: number[] | null = null): Observation => ({
  t,
  aspect: 4 / 3,
  body: points ? { engine: 'mp-full', points } : null,
  face: null,
  luma,
  ms: 10,
})

describe('measure', () => {
  it('measures in square units, so a 4:3 frame does not shrink horizontal distances', () => {
    const m = measure(obs(body({ sw: 0.24 })))
    // 0.24 of the width is 0.32 of the height on a 4:3 frame.
    expect(m.shW).toBeCloseTo(0.32, 5)
  })

  it('reads a head turn towards the worshipper’s right as positive', () => {
    // The worshipper's right shoulder is image-left; the nose moving there is a turn to their right.
    expect(measure(obs(body({ nose: -0.3 }))).turn).toBeGreaterThan(0.25)
    expect(measure(obs(body({ nose: 0.3 }))).turn).toBeLessThan(-0.25)
    expect(Math.abs(measure(obs(body())).turn)).toBeLessThan(0.05)
  })
})

describe('calibrated features', () => {
  const cal = new Calibrator(5)
  for (let i = 0; i < 6; i++) cal.add(measure(obs(body())))
  const ref = cal.reference()!

  it('calibrates from quiet standing frames', () => {
    expect(ref).not.toBeNull()
    expect(ref.headY).toBeCloseTo(0.2, 2)
  })

  it('sees the head drop and grow when bowing towards the lens', () => {
    const f = features(measure(obs(body({ hy: 0.3, hw: 0.14, sy: 0.32, sw: 0.3 }))), ref)
    expect(f.headDy).toBeGreaterThan(0.2)
    expect(f.headScale).toBeGreaterThan(0.4)
    // The head comes down to the shoulders: the "neck" collapses.
    expect(f.neck).toBeLessThan(-0.3)
  })

  it('sees sitting as the whole upper body lower, at the same size', () => {
    const f = features(measure(obs(body({ hy: 0.5, sy: 0.65 }))), ref)
    expect(f.headDy).toBeGreaterThan(0.8)
    expect(Math.abs(f.headScale)).toBeLessThan(0.1)
    expect(Math.abs(f.neck)).toBeLessThan(0.1)
  })

  it('sees hands raised to the ears', () => {
    expect(features(measure(obs(body({ wristY: 0.2 }))), ref).wristUp).toBeGreaterThan(0.3)
    expect(features(measure(obs(body({ wristY: 0.6 }))), ref).wristUp).toBeLessThan(-0.5)
  })
})

describe('posterior and fusion', () => {
  it('gives no evidence when nobody is in view', () => {
    const p = new Perception()
    for (let i = 0; i < 20; i++) p.push(obs(body(), i * 66), { calibrating: true })
    const r = p.push(obs(null, 2000))
    expect(posterior(2000, r.features, r.measures).conf).toBe(0)
  })

  it('reads something large and close filling the bottom of the frame as a prostration cue', () => {
    const bright = Array.from({ length: LUMA_W * LUMA_H }, () => 180)
    const p = new Perception()
    for (let i = 0; i < 20; i++) p.push(obs(body(), i * 66, bright), { calibrating: true })
    const dark = bright.map((v, i) => (Math.floor(i / LUMA_W) >= LUMA_H * 0.6 ? 40 : v))
    const r = p.push(obs(null, 2000, dark))
    const post = posterior(2000, r.features, r.measures)
    expect(post.conf).toBeGreaterThan(0)
    expect(post.p.prostrating).toBeGreaterThan(0.5)
  })
})

describe('advice', () => {
  it('asks to tilt the screen when the head is cut off while standing', () => {
    expect(blocker(measure(obs(body({ hy: 0.02 }))), { standing: true })).toBe('head-cut')
    expect(blocker(measure(obs(body())), { standing: true })).toBeNull()
    // Mid-prayer a cropped head is normal (sujud): no advice.
    expect(blocker(measure(obs(body({ hy: 0.02 }))), { standing: false })).toBeNull()
    expect(blocker(measure(obs(null)), { standing: false, nobodyFor: 2 })).toBe('no-person')
  })
})

describe('OneEuro', () => {
  it('smooths jitter but follows a real move', () => {
    const f = new OneEuro()
    let out = 0
    for (let i = 0; i < 30; i++) out = f.filter(0.5 + (i % 2 ? 0.01 : -0.01), i / 15)
    expect(Math.abs(out - 0.5)).toBeLessThan(0.006)
    for (let i = 30; i < 45; i++) out = f.filter(0.8, i / 15)
    expect(out).toBeGreaterThan(0.78)
  })
})
