/**
 * What the vision engines report for one camera frame. This is the boundary
 * between perception (workers, models) and interpretation (features,
 * decoder): everything after it is pure TypeScript that also runs in Node,
 * so recorded observations can be replayed for evaluation and tuning.
 *
 * Coordinates are normalized to the frame (0..1, y down) as the models
 * return them; `aspect` (width / height) is carried along so geometry can
 * be done in square units (see `sq()` in features.ts).
 */

/** BlazePose's 33 landmarks (MediaPipe Pose). */
export const BP = {
  nose: 0,
  leftEyeInner: 1, leftEye: 2, leftEyeOuter: 3, rightEyeInner: 4, rightEye: 5, rightEyeOuter: 6,
  leftEar: 7, rightEar: 8, mouthLeft: 9, mouthRight: 10,
  leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16,
  leftPinky: 17, rightPinky: 18, leftIndex: 19, rightIndex: 20, leftThumb: 21, rightThumb: 22,
  leftHip: 23, rightHip: 24, leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
  leftHeel: 29, rightHeel: 30, leftFootIndex: 31, rightFootIndex: 32,
} as const

/** One landmark: x, y normalized; v = visibility (0..1, likely in view and unoccluded). */
export interface Point {
  x: number
  y: number
  v: number
}

export interface BodyObs {
  /** The body engine that produced it. */
  engine: 'mp-full' | 'mp-lite' | 'mp-heavy' | 'detrpose'
  /** 33 BlazePose landmarks (DETRPose fills the COCO-17 subset, others v = 0). */
  points: Point[]
}

export interface FaceObs {
  /** Face box from the landmark mesh, normalized. */
  box: { x: number; y: number; w: number; h: number }
  /** Degrees. yaw > 0: the face turns towards image left (the worshipper's right, unmirrored frames). */
  yaw: number
  /** Degrees. pitch > 0: looking down. */
  pitch: number
  roll: number
  /** A few landmarks: nose tip, chin, forehead, eye outer corners. */
  nose: [number, number]
  chin: [number, number]
  forehead: [number, number]
  eyes: [number, number, number, number]
}

export interface Observation {
  /** Frame time, ms (performance.now() in the app, video time when replaying). */
  t: number
  /** Frame width / height. */
  aspect: number
  /** MediaPipe Pose (per-landmark visibility). */
  body: BodyObs | null
  /** A second body engine (DETRPose), when it runs: fused in pipeline.ts. */
  detr?: BodyObs | null
  face: FaceObs | null
  /**
   * 16 x 12 luma grid (0..255, row-major) of the whole frame: a cheap,
   * model-free cue for something large and close (a prostration right in
   * front of the lens fills the bottom of the frame).
   */
  luma: number[] | null
  /** Inference time for this frame, ms. */
  ms: number
}

export const LUMA_W = 16
export const LUMA_H = 12

/** Rotation matrix (column-major 4x4, MediaPipe's facial transformation) to yaw/pitch/roll in degrees. */
export function eulerFromMatrix(m: ArrayLike<number>) {
  // MediaPipe gives a column-major 4x4; r_ij = m[j * 4 + i].
  const r = (i: number, j: number) => m[j * 4 + i]!
  const pitch = Math.asin(Math.max(-1, Math.min(1, -r(1, 2))))
  const yaw = Math.atan2(r(0, 2), r(2, 2))
  const roll = Math.atan2(r(1, 0), r(1, 1))
  const deg = 180 / Math.PI
  return { yaw: yaw * deg, pitch: pitch * deg, roll: roll * deg }
}

/** COCO-17 index -> BlazePose index. */
export const BLAZE_FROM_COCO = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28] as const

/** COCO-17 keypoints (DETRPose) as a BlazePose-shaped body: missing landmarks get v = 0. */
export function bodyFromCoco(kps: readonly { x: number; y: number; v?: number }[], engine: BodyObs['engine'] = 'detrpose'): BodyObs {
  const points: Point[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, v: 0 }))
  kps.forEach((k, i) => {
    const inside = k.x >= 0 && k.x <= 1 && k.y >= 0 && k.y <= 1
    points[BLAZE_FROM_COCO[i]!] = { x: k.x, y: k.y, v: inside ? (k.v ?? 1) : 0 }
  })
  return { engine, points }
}

/** BlazePose left/right landmark pairs. */
const PAIRS: readonly (readonly [number, number])[] = [
  [1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22],
  [23, 24], [25, 26], [27, 28], [29, 30], [31, 32],
]

/**
 * Seen from the front and low, both engines sometimes swap a body's left
 * and right between frames (the shoulders of one frame become the other's),
 * which smoothing would then drag across the body. Put every pair in a
 * fixed image order instead: the worshipper's right on the image left, as
 * for a person facing an unmirrored camera. Nothing downstream needs true
 * anatomical sides (the salam direction is learned, see decoder.ts).
 */
export function canonicalSides(points: readonly Point[]): Point[] {
  const out = points.slice()
  for (const [l, r] of PAIRS) {
    const a = out[l]
    const b = out[r]
    if (a && b && a.v > 0.1 && b.v > 0.1 && a.x < b.x) {
      out[l] = b
      out[r] = a
    }
  }
  return out
}
