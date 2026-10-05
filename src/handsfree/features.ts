import { BP, LUMA_H, LUMA_W, type Observation, type Point } from './observation'

/**
 * Crop-tolerant posture features for a camera low on the floor, in front of
 * the worshipper. Everything is measured against a calibration taken while
 * the person stands on the rug looking at the screen, so it works whatever
 * the distance, height, tilt or angle of the laptop:
 *
 *  - the head: where it is and how big it looks (it drops and grows a lot
 *    in ruku and sujud, as it comes towards the lens);
 *  - the shoulders: height and width (foreshortening when bowing);
 *  - how far the head sits above the shoulders (it collapses in ruku);
 *  - the hands (ears for takbir), the hips and knees when visible;
 *  - the face, when the face model finds one (size, pitch);
 *  - a model-free cue: the bottom of the frame suddenly filled by something
 *    close (a prostration right at the laptop).
 *
 * Geometry is done in square units: x is scaled by the frame's aspect ratio
 * so horizontal and vertical distances compare (normalized x and y are not
 * the same length on a 4:3 frame).
 */

const HEAD = [BP.nose, BP.leftEye, BP.rightEye, BP.leftEar, BP.rightEar, BP.mouthLeft, BP.mouthRight] as const
const VIS = 0.5

interface Sq {
  x: number
  y: number
  v: number
}

const sq = (p: Point, aspect: number): Sq => ({ x: p.x * aspect, y: p.y, v: p.v })
const mid = (a: Sq, b: Sq): Sq => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) })
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

/** Raw, per-frame measurements in square units (frame height = 1). */
export interface Measures {
  /** Frame width / height. */
  aspect: number
  body: boolean
  face: boolean
  /** Head centre and size (from body landmarks, else the face box). */
  headX: number
  headY: number
  headSize: number
  headVis: number
  shX: number
  shY: number
  shW: number
  shVis: number
  hipY: number
  hipVis: number
  kneeVis: number
  /** Shoulders to hips (when the hips are seen), and its angle from vertical in degrees. */
  torso: number
  tilt: number
  /** Highest wrist, and wrists' visibility. */
  wristY: number
  wristVis: number
  /** Distance of the nearer wrist to the head, in shoulder widths. */
  wristHead: number
  /** Horizontal gap between the wrists, in shoulder widths (wide at the ears for takbir, together on the chest in qiyam). */
  wristSpread: number
  /** Nose offset towards the worshipper's right, in shoulder widths (salam). */
  turn: number
  /** Left-ear minus right-ear visibility (turning shows one ear, hides the other). */
  earBias: number
  faceH: number
  faceY: number
  facePitch: number
  faceYaw: number
  luma: number[] | null
}

export function measure(obs: Observation): Measures {
  const a = obs.aspect
  const m: Measures = {
    aspect: a,
    body: false, face: false,
    headX: NaN, headY: NaN, headSize: NaN, headVis: 0,
    shX: NaN, shY: NaN, shW: NaN, shVis: 0,
    hipY: NaN, hipVis: 0, kneeVis: 0, torso: NaN, tilt: NaN,
    wristY: NaN, wristVis: 0, wristHead: NaN, wristSpread: NaN,
    turn: NaN, earBias: 0,
    faceH: NaN, faceY: NaN, facePitch: NaN, faceYaw: NaN,
    luma: obs.luma,
  }
  const f = obs.face
  if (f) {
    m.face = true
    m.faceH = f.box.h
    m.faceY = f.box.y + f.box.h / 2
    m.facePitch = f.pitch
    m.faceYaw = f.yaw
  }
  const pts = obs.body?.points
  if (pts) {
    m.body = true
    const P = (i: number) => sq(pts[i]!, a)
    const head = HEAD.map(P)
    // Landmarks an engine doesn't have (DETRPose: no mouth) come with v = 0.
    const seen = head.filter((p) => p.v > VIS)
    const weak = head.filter((p) => p.v > 0.1)
    m.headVis = head.reduce((s, p) => s + p.v, 0) / head.length
    const use = seen.length >= 2 ? seen : weak
    if (use.length) {
      m.headX = use.reduce((s, p) => s + p.x, 0) / use.length
      m.headY = use.reduce((s, p) => s + p.y, 0) / use.length
    }
    const lE = P(BP.leftEar), rE = P(BP.rightEar)
    const pair = (a: Sq, b: Sq, k: number) => (a.v > 0.3 && b.v > 0.3 ? dist(a, b) * k : NaN)
    const sizes = [
      pair(lE, rE, 1),
      pair(P(BP.leftEyeOuter), P(BP.rightEyeOuter), 1.9),
      pair(P(BP.leftEye), P(BP.rightEye), 2.6),
      pair(P(BP.nose), mid(P(BP.mouthLeft), P(BP.mouthRight)), 4),
    ].filter(Number.isFinite)
    m.headSize = sizes.length ? Math.max(...sizes) : NaN
    m.earBias = lE.v - rE.v

    const lS = P(BP.leftShoulder), rS = P(BP.rightShoulder)
    const sh = mid(lS, rS)
    m.shX = sh.x
    m.shY = sh.y
    m.shW = Math.max(dist(lS, rS), 1e-3)
    m.shVis = (lS.v + rS.v) / 2
    const hip = mid(P(BP.leftHip), P(BP.rightHip))
    m.hipY = hip.y
    m.hipVis = (P(BP.leftHip).v + P(BP.rightHip).v) / 2
    m.kneeVis = (P(BP.leftKnee).v + P(BP.rightKnee).v) / 2
    if (m.hipVis > 0.3 && hip.y > sh.y - 0.5) {
      m.torso = dist(sh, hip)
      m.tilt = (Math.atan2(Math.abs(sh.x - hip.x), hip.y - sh.y) * 180) / Math.PI
    }

    const wrists = [P(BP.leftWrist), P(BP.rightWrist)]
    m.wristVis = Math.max(wrists[0]!.v, wrists[1]!.v)
    const vis = wrists.filter((w) => w.v > 0.3)
    if (vis.length) {
      m.wristY = Math.min(...vis.map((w) => w.y))
      if (Number.isFinite(m.headX)) m.wristHead = Math.min(...vis.map((w) => dist(w, { x: m.headX, y: m.headY }))) / m.shW
    }
    if (vis.length === 2) m.wristSpread = Math.abs(vis[0]!.x - vis[1]!.x) / m.shW
    // Towards the worshipper's right: from the left shoulder to the right one.
    const rx = (rS.x - lS.x) / m.shW
    const ry = (rS.y - lS.y) / m.shW
    const nose = P(BP.nose)
    m.turn = ((nose.x - sh.x) * rx + (nose.y - sh.y) * ry) / m.shW
  } else if (f) {
    // No body: the face box still says where the head is.
    m.headX = (f.box.x + f.box.w / 2) * a
    m.headY = m.faceY
    m.headSize = Math.max(f.box.w * a, f.box.h) * 1.05
    m.headVis = 0.6
  }
  return m
}

/** What "standing on the rug, looking at the screen" looks like from this laptop. */
export interface Reference {
  headX: number
  headY: number
  headSize: number
  shY: number
  shW: number
  /** Head above shoulders, in shoulder widths. */
  neck: number
  /** Shoulders to hips, when the hips were seen. */
  torso: number
  faceH: number
  luma: number[] | null
  /** The head was out of view when calibrating (estimated from the shoulders). */
  headCut?: boolean
}

/** Head centre above the shoulders, and head size, in shoulder widths (standing, seen from the floor). */
const TYPICAL_NECK = 0.75
const TYPICAL_HEAD = 0.55

const median = (xs: number[]) => {
  const s = xs.filter(Number.isFinite).sort((p, q) => p - q)
  return s.length ? s[s.length >> 1]! : NaN
}

/**
 * Collects quiet standing frames and turns them into a Reference. `add`
 * returns true once there's enough (by default ~1.2 s with head and
 * shoulders in view).
 */
export class Calibrator {
  private frames: Measures[] = []
  constructor(private readonly needed = 18) {}

  /**
   * Usable for calibration: a body with the shoulders in view. The head may
   * be cut off at the top (a low laptop close to the rug); then the head
   * reference is estimated from the shoulders.
   */
  static usable(m: Measures) {
    return m.body && m.shVis > 0.6 && m.shW > 0.03
  }

  add(m: Measures) {
    if (!Calibrator.usable(m)) return false
    this.frames.push(m)
    if (this.frames.length > 60) this.frames.shift()
    return this.frames.length >= this.needed
  }

  get count() {
    return this.frames.length
  }

  reference(): Reference | null {
    if (this.frames.length < this.needed) return null
    const F = this.frames
    const withHead = F.filter((f) => f.headVis > 0.5 && Number.isFinite(f.headY))
    const lumas = F.map((f) => f.luma).filter((l): l is number[] => !!l)
    const shY = median(F.map((f) => f.shY))
    const shW = median(F.map((f) => f.shW))
    // Head cut off when standing: where it would be (just above the frame).
    const headCut = withHead.length < Math.max(3, F.length / 3)
    const H = headCut ? F : withHead
    return {
      headX: median(H.map((f) => (headCut ? f.shX : f.headX))),
      headY: headCut ? Math.min(shY - TYPICAL_NECK * shW, 0) : median(H.map((f) => f.headY)),
      headSize: headCut ? TYPICAL_HEAD * shW : median(H.map((f) => f.headSize)),
      shY,
      shW,
      neck: headCut ? TYPICAL_NECK : median(H.map((f) => (f.shY - f.headY) / f.shW)),
      torso: median(F.map((f) => f.torso)),
      faceH: median(F.map((f) => f.faceH)),
      luma: lumas.length ? lumas[0]!.map((_, i) => median(lumas.map((l) => l[i]!))) : null,
      headCut,
    }
  }

  reset() {
    this.frames = []
  }
}

/** Slowly follow the reference while the person is known to be standing (they shift on the rug). */
export function adaptReference(ref: Reference, m: Measures, rate = 0.03): Reference {
  if (!Calibrator.usable(m)) return ref
  const k = (a: number, b: number) => (Number.isFinite(b) ? (Number.isFinite(a) ? a + (b - a) * rate : b) : a)
  return {
    ...ref,
    headX: k(ref.headX, m.headX),
    headY: k(ref.headY, m.headY),
    headSize: k(ref.headSize, m.headSize),
    shY: k(ref.shY, m.shY),
    shW: k(ref.shW, m.shW),
    neck: k(ref.neck, (m.shY - m.headY) / m.shW),
    torso: k(ref.torso, m.torso),
    faceH: k(ref.faceH, m.faceH),
  }
}

/**
 * Feature vector names, in order. NaN means "not measurable in this frame";
 * the classifier pairs each with a missing indicator.
 */
export const FEATURES = [
  'present', // anything at all (body or face)
  'body', // the body model found someone
  'faceSeen', // the face model found a face
  'headDy', // head drop from standing, in standing shoulder widths (+ = lower)
  'headScale', // log head size vs standing
  'shDy', // shoulder drop vs standing
  'shScale', // log shoulder width vs standing
  'neck', // head above shoulders (in current shoulder widths) minus standing
  'headDx', // sideways head shift from standing, either way (a bow seen from an angle), standing shoulder widths
  'torsoRatio', // log shoulders-to-hips length vs standing (foreshortens when bowing towards the lens)
  'tilt', // torso angle from vertical, degrees / 90 (hips in view)
  'headVis', // head landmarks' visibility
  'shVis',
  'hipVis',
  'kneeVis',
  'headLow', // head centre position in the frame (0 top .. 1 bottom), raw
  'wristUp', // highest wrist above the shoulders, in shoulder widths
  'wristHead', // nearer wrist to the head, in shoulder widths
  'wristSpread', // gap between the wrists, in shoulder widths
  'faceScale', // log face height vs standing face (or head) size
  'facePitch',
  'lumaBottom', // change in the bottom-centre of the frame vs standing (0..1)
  'lumaDark', // how much darker the bottom-centre got (0..1)
  // Where the picture changed vs standing, on a 3 x 3 grid (top/middle/
  // bottom x left/centre/right), after removing any overall brightness
  // shift (auto-exposure). Model-free: works when no model finds the person.
  'lumaTL', 'lumaTC', 'lumaTR', 'lumaML', 'lumaMC', 'lumaMR', 'lumaBL', 'lumaBC', 'lumaBR',
] as const
export type FeatureName = (typeof FEATURES)[number]
export type FeatureVec = Record<FeatureName, number>

function lumaCues(luma: number[] | null, ref: number[] | null) {
  if (!luma || !ref) return { change: NaN, dark: NaN }
  let change = 0
  let dark = 0
  let n = 0
  // Bottom third, middle half of the frame.
  for (let y = Math.floor(LUMA_H * 0.6); y < LUMA_H; y++)
    for (let x = Math.floor(LUMA_W * 0.2); x < Math.ceil(LUMA_W * 0.8); x++) {
      const i = y * LUMA_W + x
      change += Math.abs(luma[i]! - ref[i]!)
      dark += ref[i]! - luma[i]!
      n++
    }
  return { change: change / n / 255, dark: dark / n / 255 }
}

/** Mean absolute change per 3 x 3 region vs the reference, after removing the overall shift. */
function lumaGrid(luma: number[] | null, ref: number[] | null): number[] {
  if (!luma || !ref) return new Array(9).fill(NaN)
  let shift = 0
  for (let i = 0; i < luma.length; i++) shift += luma[i]! - ref[i]!
  shift /= luma.length
  const out = new Array(9).fill(0)
  const n = new Array(9).fill(0)
  for (let y = 0; y < LUMA_H; y++)
    for (let x = 0; x < LUMA_W; x++) {
      const r = Math.min(2, Math.floor((y * 3) / LUMA_H)) * 3 + Math.min(2, Math.floor((x * 3) / LUMA_W))
      const i = y * LUMA_W + x
      out[r] += Math.abs(luma[i]! - ref[i]! - shift)
      n[r]++
    }
  return out.map((v, r) => v / n[r] / 255)
}

export function features(m: Measures, ref: Reference): FeatureVec {
  const unit = ref.shW
  const luma = lumaCues(m.luma, ref.luma)
  const grid = lumaGrid(m.luma, ref.luma)
  const faceRef = Number.isFinite(ref.faceH) ? ref.faceH : ref.headSize * 0.9
  return {
    present: m.body || m.face ? 1 : 0,
    body: m.body ? 1 : 0,
    faceSeen: m.face ? 1 : 0,
    headDy: (m.headY - ref.headY) / unit,
    headScale: Math.log(m.headSize / ref.headSize),
    shDy: m.body ? (m.shY - ref.shY) / unit : NaN,
    shScale: m.body ? Math.log(m.shW / ref.shW) : NaN,
    neck: m.body ? (m.shY - m.headY) / m.shW - ref.neck : NaN,
    headDx: Math.abs(m.headX - ref.headX) / unit,
    torsoRatio: Number.isFinite(ref.torso) ? Math.log(m.torso / ref.torso) : NaN,
    tilt: m.tilt / 90,
    headVis: m.headVis,
    shVis: m.shVis,
    hipVis: m.hipVis,
    kneeVis: m.kneeVis,
    headLow: m.headY,
    wristUp: m.body && Number.isFinite(m.wristY) ? (m.shY - m.wristY) / m.shW : NaN,
    wristHead: m.wristHead,
    wristSpread: m.wristSpread,
    faceScale: m.face ? Math.log(m.faceH / faceRef) : NaN,
    facePitch: m.facePitch,
    lumaBottom: luma.change,
    lumaDark: luma.dark,
    lumaTL: grid[0]!, lumaTC: grid[1]!, lumaTR: grid[2]!,
    lumaML: grid[3]!, lumaMC: grid[4]!, lumaMR: grid[5]!,
    lumaBL: grid[6]!, lumaBC: grid[7]!, lumaBR: grid[8]!,
  }
}
