import { describe, expect, it } from 'vitest'
import fixtures from './face-fixtures.json'
import { signature, type Signature } from './face-signature'
import { FaceTracker, type Box, type Detection } from './face-track'

const box = (cx: number, cy: number, h: number): Box => ({ x: cx - h * 0.4, y: cy - h / 2, w: h * 0.8, h })
const det = (cx: number, cy: number, h: number, score = 0.92): Detection => ({ score, box: box(cx, cy, h) })
const FACE = () => det(0.5, 0.3, 0.15)
const LAMP = () => det(0.85, 0.2, 0.12, 0.85)

/** Run frames every 80 ms; returns the visible flags. */
function feed(tr: FaceTracker, t0: number, t1: number, dets: (t: number) => Detection[], sujud = false) {
  const out: boolean[] = []
  for (let t = t0; t < t1; t += 80) out.push(tr.push(t, dets(t), { sujud }).visible)
  return out
}

describe('FaceTracker', () => {
  it('locks only after a strong, steady face for 0.6 s', () => {
    const tr = new FaceTracker()
    // weak face never locks
    feed(tr, 0, 2000, () => [det(0.5, 0.3, 0.15, 0.7)])
    expect(tr.locked).toBe(false)
    // too small never locks
    feed(tr, 2000, 4000, () => [det(0.5, 0.3, 0.05)])
    expect(tr.locked).toBe(false)
    // jumping around never locks
    feed(tr, 4000, 6000, (t) => [det(0.15 + ((Math.round(t / 80) % 4) * 0.25), 0.3, 0.15)])
    expect(tr.locked).toBe(false)
    feed(tr, 6000, 6500, () => [FACE()])
    expect(tr.locked).toBe(false)
    feed(tr, 6500, 7000, () => [FACE()])
    expect(tr.locked).toBe(true)
  })

  it('ignores a lamp (a second detection) while locked', () => {
    const tr = new FaceTracker()
    feed(tr, 0, 1500, () => [FACE(), LAMP()])
    expect(tr.locked).toBe(true)
    // The person leaves (sujud); the lamp lights up as a "face" elsewhere: not visible.
    const vis = feed(tr, 1000, 3000, () => [LAMP()], true)
    expect(vis.every((v) => !v)).toBe(true)
    // Lamp and face together: only the face counts, and the track stays on it.
    feed(tr, 3000, 4000, () => [LAMP(), FACE()])
    expect(tr.track!.x + tr.track!.w / 2).toBeCloseTo(0.5, 1)
    expect(tr.ignored).toHaveLength(1)
  })

  it('a different-sized face in the same spot does not match', () => {
    const tr = new FaceTracker()
    feed(tr, 0, 1000, () => [FACE()])
    const vis = feed(tr, 1000, 2000, () => [det(0.5, 0.3, 0.5)])
    expect(vis.every((v) => !v)).toBe(true)
  })

  it('follows gradual movement (rising from ruku)', () => {
    const tr = new FaceTracker()
    feed(tr, 0, 1000, () => [det(0.5, 0.6, 0.3)])
    // Over 0.8 s the face moves up by 0.3 and shrinks to 0.18.
    const vis = feed(tr, 1000, 1800, (t) => {
      const k = (t - 1000) / 800
      return [det(0.5, 0.6 - 0.3 * k, 0.3 - 0.12 * k)]
    })
    expect(vis.every(Boolean)).toBe(true)
  })

  it('re-locks after a long loss only via the same confirmation', () => {
    const tr = new FaceTracker()
    feed(tr, 0, 1000, () => [FACE()])
    const id = tr.track!.id
    feed(tr, 1000, 5200, () => []) // > 4 s outside sujud
    expect(tr.locked).toBe(false)
    // A lone strong detection somewhere else is not "found" until confirmed for 0.6 s.
    const vis = feed(tr, 5200, 5700, () => [det(0.3, 0.4, 0.15)])
    expect(vis.every((v) => !v)).toBe(true)
    feed(tr, 5700, 6000, () => [det(0.3, 0.4, 0.15)])
    expect(tr.locked).toBe(true)
    expect(tr.track!.id).not.toBe(id)
  })

  it('keeps the track through a long sujud and accepts a lone strong face coming back anywhere after 0.4 s', () => {
    const tr = new FaceTracker()
    feed(tr, 0, 1000, () => [FACE()])
    feed(tr, 1000, 9000, () => [], true)
    expect(tr.locked).toBe(true)
    const vis = feed(tr, 9000, 10000, () => [det(0.3, 0.55, 0.2)], true)
    expect(vis.slice(0, 4).every((v) => !v)).toBe(true) // < 0.4 s
    expect(vis.at(-1)).toBe(true)
    // But two strong candidates (face + lamp) elsewhere: ambiguous, nothing counts.
    const tr2 = new FaceTracker()
    feed(tr2, 0, 1000, () => [FACE()])
    const vis2 = feed(tr2, 1000, 3000, () => [det(0.2, 0.6, 0.2), LAMP()], true)
    expect(vis2.every((v) => !v)).toBe(true)
  })

  it('a lamp seen next to the face is never locked onto after a long loss', () => {
    const tr = new FaceTracker()
    feed(tr, 0, 1500, () => [FACE(), LAMP()])
    const vis = feed(tr, 1500, 12000, () => [LAMP()])
    expect(vis.every((v) => !v)).toBe(true)
    expect(tr.locked).toBe(false)
  })

  it('still locks when the laptop is busy and frames come slowly (300 ms apart)', () => {
    const tr = new FaceTracker()
    for (let t = 0; t < 1500; t += 300) tr.push(t, [FACE()])
    expect(tr.locked).toBe(true)
  })

  it('single-frame flickers of a strong detection never lock', () => {
    const tr = new FaceTracker()
    feed(tr, 0, 5000, (t) => (Math.round(t / 80) % 5 === 0 ? [FACE()] : []))
    expect(tr.locked).toBe(false)
  })
})

describe('FaceTracker identity memory', () => {
  const fx = fixtures as Record<string, Record<string, string>>
  const crop = (who: string, v = 'base') => signature(Uint8Array.from(Buffer.from(fx[who]![v]!, 'base64')))
  const lampCrop = () => {
    const px = new Uint8Array(32 * 32 * 4)
    for (let i = 0; i < 1024; i++) {
      const d = Math.hypot((i % 32) - 16, Math.floor(i / 32) - 16) / 22
      px.set([255, Math.max(0, 230 - 120 * d), Math.max(0, 150 - 150 * d), 255], i * 4)
    }
    return signature(px)
  }
  const as = (d: Detection, s: () => Signature): Detection => ({ ...d, sig: s })
  const variants = ['base', 'shift', 'bigger', 'darker']
  const ahmad = (t: number) => as(FACE(), () => crop('ahmad', variants[Math.round(t / 80) % 4]))

  function learned() {
    const tr = new FaceTracker()
    feed(tr, 0, 2000, (t) => [ahmad(t)])
    expect(tr.locked).toBe(true)
    expect(tr.template).not.toBeNull()
    return tr
  }

  it('remembers the face and re-acquires the same face after sujud', () => {
    const tr = learned()
    feed(tr, 2000, 10000, () => [], true)
    // comes back up somewhere else, same person
    const vis = feed(tr, 10000, 11500, (t) => [as(det(0.35, 0.5, 0.18), () => crop('ahmad', variants[Math.round(t / 80) % 4]))], true)
    expect(vis.at(-1)).toBe(true)
    expect(tr.lastSim!).toBeGreaterThanOrEqual(0.75)
  })

  it('a different face is rejected, even at the same position', () => {
    const tr = learned()
    const vis = feed(tr, 2000, 5000, () => [as(FACE(), () => crop('yusuf'))])
    expect(vis.filter(Boolean).length).toBeLessThanOrEqual(2) // at most the frames before the next identity check
    expect(vis.slice(3).every((v) => !v)).toBe(true)
    // ...and after a long loss it never re-locks onto another person
    const vis2 = feed(tr, 5000, 15000, () => [as(det(0.3, 0.4, 0.15), () => crop('aisha'))])
    expect(vis2.every((v) => !v)).toBe(true)
    expect(tr.locked).toBe(false)
    // the right person does
    feed(tr, 15000, 16500, (t) => [as(det(0.3, 0.4, 0.15), () => crop('ahmad', variants[Math.round(t / 80) % 4]))])
    expect(tr.locked).toBe(true)
  })

  it('a different face coming up from sujud does not count', () => {
    const tr = learned()
    feed(tr, 2000, 6000, () => [], true)
    const vis = feed(tr, 6000, 9000, () => [as(det(0.35, 0.5, 0.18), () => crop('yusuf'))], true)
    expect(vis.every((v) => !v)).toBe(true)
  })

  it('a lamp is rejected by identity too (even a strong one, never seen next to the face)', () => {
    const tr = learned()
    feed(tr, 2000, 6000, () => [], true)
    const vis = feed(tr, 6000, 9000, () => [as(det(0.8, 0.2, 0.14, 0.9), lampCrop)], true)
    expect(vis.every((v) => !v)).toBe(true)
    const vis2 = feed(tr, 9000, 20000, () => [as(det(0.8, 0.2, 0.14, 0.9), lampCrop)])
    expect(vis2.every((v) => !v)).toBe(true)
  })

  it('identity is checked only every 3rd frame while locked', () => {
    const tr = new FaceTracker()
    let calls = 0
    feed(tr, 0, 2000, (t) => [as(FACE(), () => (calls++, crop('ahmad', variants[Math.round(t / 80) % 4])))])
    const before = calls
    feed(tr, 2000, 4400, (t) => [as(FACE(), () => (calls++, crop('ahmad', variants[Math.round(t / 80) % 4])))])
    // 30 frames: ~10 checks (+ a few slow template updates on confident matches)
    expect(calls - before).toBeLessThanOrEqual(20)
  })
})
