import type { Measures, Reference } from './features'

/**
 * What is stopping the camera from following, in words the worshipper can
 * act on (keys into the `hf.block.*` messages). Ordered by what to fix first.
 */
export type Blocker =
  | 'no-person' // nobody in view
  | 'too-dark' // the room is too dark for the camera
  | 'head-cut' // standing, the head is cut off at the top: tilt the screen back
  | 'too-close' // the body fills the frame: move the laptop back
  | 'too-far' // the person is tiny: bring the laptop closer
  | 'off-centre' // the person is at the edge of the frame
  | null

const mean = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0) / Math.max(1, xs.length)

/**
 * `standing`: the person is expected to stand (setup, before the prayer,
 * qiyam), when framing advice is meaningful. Mid-prayer, only "nobody" and
 * "too dark" are reported: in sujud a cropped head is normal.
 */
export function blocker(m: Measures | null, opts: { standing: boolean; ref?: Reference | null; nobodyFor?: number }): Blocker {
  const dark = m?.luma ? mean(m.luma) < 28 : false
  if (!m || (!m.body && !m.face)) return dark ? 'too-dark' : (opts.nobodyFor ?? 1) > 0.8 ? 'no-person' : null
  if (dark) return 'too-dark'
  if (!opts.standing) return null
  if (m.body) {
    // Head landmarks at the top edge or poorly seen while shoulders are fine.
    if ((Number.isFinite(m.headY) && m.headY < 0.04) || (m.headVis < 0.45 && m.shVis > 0.7)) return 'head-cut'
    if (m.shW > 0.62) return 'too-close'
    if (m.shW < 0.07) return 'too-far'
    if (Number.isFinite(m.shX) && (m.shX / m.aspect < 0.12 || m.shX / m.aspect > 0.88)) return 'off-centre'
  }
  return null
}

/** Is the camera well placed for the floor setup? Used by the setup coach. */
export function placementOk(m: Measures | null) {
  return blocker(m, { standing: true }) === null && !!m?.body && m.shVis > 0.7 && m.headVis > 0.6
}
