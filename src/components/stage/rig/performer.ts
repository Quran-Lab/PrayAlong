import * as THREE from 'three'
import { ClothDrape } from './garment'
import type { Humanoid } from './humanoid'
import { isPoseName, waypoints, type PoseName, type Waypoint } from './prayer-poses'

/** Characters are scaled to this standing height so framing is consistent. */
export const STAGE_HEIGHT = 1.65

const DEG = Math.PI / 180
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

/** Every bone's local rotation, position and scale in one posture, in `Performer.bones` order. */
interface Pose {
  q: THREE.Quaternion[]
  p: THREE.Vector3[]
  s: THREE.Vector3[]
}

/** Seconds to move into a posture: big moves to and from the floor take a little longer. */
function durationFor(from: PoseName, to: PoseName) {
  if (to === 'descend' || from === 'rise') return 1.0
  if (to === 'rise' || from === 'descend') return 0.8
  return 0.9
}

/**
 * Drives one companion through the prayer. The postures come with the character (one glTF
 * animation each, authored and checked against the fiqh in tools/characters/poses.py), so every
 * hand, knee and forehead lands where it was placed; between them the bones are blended, through
 * the waypoints the Sunnah moves by (prayer-poses.ts), and the clothes follow, draped by a cloth
 * simulation for each posture (garment.ts).
 */
export class Performer {
  readonly root = new THREE.Group()
  private readonly rig = new THREE.Group()
  private readonly bones: THREE.Object3D[] = []
  private readonly poses = new Map<PoseName, Pose>()
  private readonly drape: ClothDrape
  private readonly chest: THREE.Object3D | null

  private pose: PoseName = 'rest'
  private from: PoseName = 'rest'
  private start: Pose
  private queue: Waypoint[] = []
  private t = 1
  private duration = 1
  /** Seconds left to stay in the pose just reached before moving on. */
  private hold = 0
  private holdNext = 0
  private clock = 0

  constructor(private readonly humanoid: Humanoid) {
    this.rig.add(humanoid.scene)
    this.root.add(this.rig)
    humanoid.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        // Exporters may default morph weights to 1; the clothes are set per posture below.
        ;(o as THREE.Mesh).morphTargetInfluences?.fill(0)
      }
    })
    this.readPoses()
    this.chest = humanoid.raw.upperChest ?? humanoid.raw.chest ?? null
    this.drape = new ClothDrape(humanoid.scene)
    this.start = this.snapshot()
    this.measure()
    this.jumpTo('rest')
  }

  get posture() {
    return this.pose
  }

  /** True while moving between postures (the stage renders at full rate). */
  get moving() {
    return this.t < 1 || this.hold > 0 || this.queue.length > 0
  }

  // ————————————————————————————————————————————— the character's postures

  private readPoses() {
    const byName = new Map<string, THREE.Object3D>()
    this.humanoid.scene.traverse((o) => byName.set(o.name, o))
    const tracks = new Map<string, Map<string, number[]>>()
    for (const clip of this.humanoid.clips) {
      if (!isPoseName(clip.name)) continue
      const values = new Map<string, number[]>()
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name)
        if (!byName.has(nodeName)) continue
        if (!this.bones.includes(byName.get(nodeName)!)) this.bones.push(byName.get(nodeName)!)
        // Through the track's own interpolant: exporters may write cubic splines (tangents first).
        const sample = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant()
        values.set(`${nodeName}.${propertyName}`, Array.from(sample.evaluate(track.times[0]!)))
      }
      tracks.set(clip.name, values)
    }
    if (!tracks.has('rest')) throw new Error('This character has no prayer postures (see tools/characters/poses.py)')
    for (const [name, values] of tracks) {
      const q: THREE.Quaternion[] = []
      const p: THREE.Vector3[] = []
      const s: THREE.Vector3[] = []
      for (const bone of this.bones) {
        const r = values.get(`${bone.name}.quaternion`)
        const t = values.get(`${bone.name}.position`)
        const k = values.get(`${bone.name}.scale`)
        q.push(r ? new THREE.Quaternion().fromArray(r) : bone.quaternion.clone())
        p.push(t ? new THREE.Vector3().fromArray(t) : bone.position.clone())
        // Unit scale unless the posture says otherwise: the bind pose read back from a compressed
        // file's inverse bind matrices can carry the quantization's scale.
        s.push(k ? new THREE.Vector3().fromArray(k) : new THREE.Vector3(1, 1, 1))
      }
      this.poses.set(name as PoseName, { q, p, s })
    }
  }

  /** Scale to the stage height, standing; the mat is the posture files' floor. */
  private measure() {
    this.apply(this.poses.get('rest')!, this.poses.get('rest')!, 1)
    this.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(this.humanoid.scene, true)
    this.rig.scale.setScalar(STAGE_HEIGHT / Math.max(1e-6, box.max.y - box.min.y))
    this.rig.position.y = -box.min.y * this.rig.scale.y
    this.root.updateMatrixWorld(true)
  }

  private poseOf(name: PoseName) {
    return this.poses.get(name) ?? this.poses.get('rest')!
  }

  private snapshot(): Pose {
    return { q: this.bones.map((b) => b.quaternion.clone()), p: this.bones.map((b) => b.position.clone()), s: this.bones.map((b) => b.scale.clone()) }
  }

  private apply(a: Pose, b: Pose, e: number) {
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i]!.quaternion.copy(a.q[i]!).slerp(b.q[i]!, e)
      this.bones[i]!.position.copy(a.p[i]!).lerp(b.p[i]!, e)
      this.bones[i]!.scale.copy(a.s[i]!).lerp(b.s[i]!, e)
    }
  }

  // ————————————————————————————————————————————— choosing postures

  /** Snap without animation (first render, reduced motion). */
  jumpTo(name: PoseName) {
    this.pose = this.from = name
    this.queue = []
    this.t = 1
    this.hold = 0
    this.start = this.poseOf(name)
    this.update(0)
  }

  setPosture(name: PoseName) {
    const last = this.queue.at(-1)?.pose ?? this.pose
    if (name === last) return
    // Plan from the pose the body is in (or heading to) now.
    this.queue = waypoints(this.pose, name)
    this.hold = 0
    this.startNext()
  }

  private startNext() {
    const step = this.queue.shift()
    if (!step) return
    this.holdNext = step.hold
    // Blend from wherever the bones are now, so a change of mind mid-move stays smooth.
    this.start = this.snapshot()
    this.from = this.pose
    this.pose = step.pose
    this.t = 0
    this.duration = durationFor(this.from, this.pose)
  }

  // ————————————————————————————————————————————— per frame

  update(dt: number) {
    this.clock += dt
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration)
      if (this.t >= 1) this.hold = this.holdNext
    } else if (this.hold > 0) this.hold = Math.max(0, this.hold - dt)
    if (this.t >= 1 && this.hold <= 0 && this.queue.length) this.startNext()
    const e = easeInOut(this.t)
    this.apply(this.start, this.poseOf(this.pose), e)

    // Gentle breathing so the figure never looks frozen (not while the forehead is down).
    if (this.chest?.parent && this.pose !== 'sujud') {
      this.root.updateMatrixWorld(true)
      const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(this.chest.parent.getWorldQuaternion(new THREE.Quaternion()).invert())
      this.chest.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, Math.sin(this.clock * 1.5) * 0.18 * DEG))
    }
    this.drape.set(this.from, this.pose, e)
    this.root.updateMatrixWorld(true)
    this.humanoid.finish(dt)
  }

  dispose() {
    this.humanoid.dispose()
  }
}
