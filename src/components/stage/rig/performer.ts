import * as THREE from 'three'
import { FINGER_CHAINS, type Drape, type Humanoid, type HumanBone } from './humanoid'
import { ZERO, type Tune } from './tuning'
import { GRIPS, PRAYER_POSES, waypoints, type Dir3, type HandSpec, type PoseName, type PrayerPose } from './prayer-poses'

/** Characters are scaled to this standing height so framing is consistent. */
export const STAGE_HEIGHT = 1.65

const DEG = Math.PI / 180
/** Root-space heights: y = 0 is the sole, which the stage sinks 6 mm into the plush. */
const PALM_SINK = 0.004
const FOREHEAD_SINK = 0.005
/** Toe tips rest on the plush top (root y = 0.006), 1 mm above it. */
const TOE_SINK = 0.007
/** How far a lowered shin (and the robe over it) may press into the plush. */
const SHIN_SINK = 0.012
/** Which corrective robe shape each floor posture uses. */
const DRAPE: Partial<Record<PoseName, Drape>> = {
  kneel: 'kneel',
  sujud: 'sujud',
  jalsah: 'sit',
  tashahhud: 'sit',
  'salam-right': 'sit',
  'salam-left': 'sit',
}
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const q = () => new THREE.Quaternion()
const vec = (d: Dir3, out = v()) => out.set(d[0], d[1], d[2])

function frameQuat(fingers: THREE.Vector3, palm: THREE.Vector3, out = q()) {
  const x = fingers.clone().normalize()
  const y = palm.clone().sub(x.clone().multiplyScalar(palm.dot(x))).normalize()
  const z = x.clone().cross(y)
  return out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z))
}

function worldQuat(o: THREE.Object3D, out = q()) {
  return o.getWorldQuaternion(out)
}
function worldPos(o: THREE.Object3D, out = v()) {
  return o.getWorldPosition(out)
}

/** Rotate `bone` (in world space) by `delta`, keeping its children attached. */
function rotateWorld(bone: THREE.Object3D, delta: THREE.Quaternion) {
  const parentWorld = bone.parent ? worldQuat(bone.parent) : q()
  const world = worldQuat(bone).premultiply(delta)
  bone.quaternion.copy(parentWorld.invert().multiply(world))
  bone.updateMatrixWorld(true)
}

/** Signed rotation of `rot` about `axis` (swing–twist decomposition). */
function twistAngle(rot: THREE.Quaternion, axis: THREE.Vector3) {
  const d = axis.x * rot.x + axis.y * rot.y + axis.z * rot.z
  let angle = 2 * Math.atan2(d, rot.w)
  if (angle > Math.PI) angle -= 2 * Math.PI
  if (angle < -Math.PI) angle += 2 * Math.PI
  return angle
}

function setWorldQuat(bone: THREE.Object3D, world: THREE.Quaternion) {
  const parentWorld = bone.parent ? worldQuat(bone.parent) : q()
  bone.quaternion.copy(parentWorld.invert().multiply(world))
  bone.updateMatrixWorld(true)
}

interface HandRest {
  quat: THREE.Quaternion // rest world rotation
  local: THREE.Quaternion // rest local rotation
  frame: THREE.Quaternion // rest (fingers, palm) frame in world
  upper: number
  lower: number
}

interface Metrics {
  footPad: number
  toePad: number
  kneePad: number
  palmPad: number
  headHalfWidth: number
  chestOffset: THREE.Vector3 // from chest bone, rest frame
  foreheadOffset: THREE.Vector3 // from head bone, rest frame
  restWorld: Map<HumanBone, THREE.Quaternion>
  hands: { left: HandRest; right: HandRest }
  /** Per finger bone: the axis that curls it towards the palm (normalized space). */
  curlAxis: Map<HumanBone, THREE.Vector3>
  /**
   * Rest pitch of each thigh from straight down, and of each shin relative
   * to its thigh (radians, +X pitch). Auto-rigs often put the knee joint in
   * front of the hip, so a pose that folds the legs would fold them along
   * that slant: sitting would lift the knees and stack the shins on the lap.
   */
  legRest: Record<'left' | 'right', { thigh: number; knee: number }>
}

/** A sparse set of skinned vertices, re-skinned each frame to find what touches the rug. */
interface Sample {
  mesh: THREE.SkinnedMesh
  index: number
}

/**
 * Samples packed per mesh for a fast, height-only skinning pass: bind-space
 * positions plus the four bone influences. Only the root-space height of
 * each vertex is ever needed, so each bone contributes one matrix row.
 */
class SampleSet {
  // `morph` holds each morph target's bind-space offsets for the samples, so
  // corrective cloth shapes (drapes) count when grounding the body.
  // `tucked` marks samples that a "*_tuck" morph presses under the rug (folded
  // shins and feet when sitting): hidden, so they must not hold the body up.
  private groups: {
    mesh: THREE.SkinnedMesh
    pos: Float32Array
    bone: Uint16Array
    weight: Float32Array
    morph: Float32Array[]
    tucks: { index: number; mask: Uint8Array }[]
  }[] = []
  private posed = new Float32Array(0)
  private row = new Float32Array(0)
  private m = new THREE.Matrix4()
  private toRoot = new THREE.Matrix4()
  readonly size: number

  constructor(samples: Sample[]) {
    const byMesh = new Map<THREE.SkinnedMesh, number[]>()
    for (const { mesh, index } of samples) byMesh.set(mesh, [...(byMesh.get(mesh) ?? []), index])
    const p = new THREE.Vector3()
    for (const [mesh, list] of byMesh) {
      const { position, skinIndex, skinWeight } = mesh.geometry.attributes
      const pos = new Float32Array(list.length * 3)
      const bone = new Uint16Array(list.length * 4)
      const weight = new Float32Array(list.length * 4)
      list.forEach((i, n) => {
        p.fromBufferAttribute(position as THREE.BufferAttribute, i).applyMatrix4(mesh.bindMatrix)
        pos.set([p.x, p.y, p.z], n * 3)
        for (let k = 0; k < 4; k++) {
          bone[n * 4 + k] = skinIndex!.getComponent(i, k)
          weight[n * 4 + k] = skinWeight!.getComponent(i, k)
        }
      })
      const bindLinear = new THREE.Matrix3().setFromMatrix4(mesh.bindMatrix)
      const rest = new THREE.Vector3()
      const morph = (mesh.geometry.morphAttributes.position ?? []).map((attr) => {
        const out = new Float32Array(list.length * 3)
        list.forEach((i, n) => {
          p.fromBufferAttribute(attr as THREE.BufferAttribute, i)
          if (!mesh.geometry.morphTargetsRelative) p.sub(rest.fromBufferAttribute(position as THREE.BufferAttribute, i))
          p.applyMatrix3(bindLinear)
          out.set([p.x, p.y, p.z], n * 3)
        })
        return out
      })
      const tucks = Object.entries(mesh.morphTargetDictionary ?? {})
        .filter(([name]) => name.endsWith('_tuck'))
        .map(([, index]) => {
          const delta = morph[index]!
          const mask = new Uint8Array(list.length)
          for (let n = 0; n < list.length; n++)
            mask[n] = Math.abs(delta[n * 3]!) + Math.abs(delta[n * 3 + 1]!) + Math.abs(delta[n * 3 + 2]!) > 1e-6 ? 1 : 0
          return { index, mask }
        })
      this.groups.push({ mesh, pos, bone, weight, morph, tucks })
    }
    this.size = samples.length
  }

  /** Lowest sample, as a height in `root`'s space. */
  lowest(root: THREE.Object3D) {
    let low = Infinity
    for (const { mesh, pos: bindPos, bone, weight, morph, tucks } of this.groups) {
      const hidden = tucks.filter((t) => (mesh.morphTargetInfluences?.[t.index] ?? 0) > 0.5).map((t) => t.mask)
      let pos = bindPos
      const influences = mesh.morphTargetInfluences
      if (morph.length && influences?.some((w) => w > 1e-4)) {
        if (this.posed.length < bindPos.length) this.posed = new Float32Array(bindPos.length)
        pos = this.posed.subarray(0, bindPos.length)
        pos.set(bindPos)
        morph.forEach((delta, t) => {
          const w = influences[t] ?? 0
          if (w > 1e-4) for (let i = 0; i < delta.length; i++) pos[i]! += w * delta[i]!
        })
      }
      const bones = mesh.skeleton.bones
      const inverses = mesh.skeleton.boneInverses
      if (this.row.length < bones.length * 4) this.row = new Float32Array(bones.length * 4)
      // root⁻¹ · meshWorld · bind⁻¹ · boneWorld · boneInverse, keeping only the Y row.
      this.toRoot.copy(root.matrixWorld).invert().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse)
      for (let b = 0; b < bones.length; b++) {
        const e = this.m.multiplyMatrices(this.toRoot, bones[b]!.matrixWorld).multiply(inverses[b]!).elements
        this.row[b * 4] = e[1]!
        this.row[b * 4 + 1] = e[5]!
        this.row[b * 4 + 2] = e[9]!
        this.row[b * 4 + 3] = e[13]!
      }
      const r = this.row
      for (let n = 0, count = pos.length / 3; n < count; n++) {
        if (hidden.length && hidden.some((m) => m[n])) continue
        const x = pos[n * 3]!, y = pos[n * 3 + 1]!, z = pos[n * 3 + 2]!
        let h = 0
        for (let k = 0; k < 4; k++) {
          const w = weight[n * 4 + k]!
          if (w === 0) continue
          const o = bone[n * 4 + k]! * 4
          h += w * (r[o]! * x + r[o + 1]! * y + r[o + 2]! * z + r[o + 3]!)
        }
        if (h < low) low = h
      }
    }
    return low
  }
}

interface ArmState {
  target: THREE.Vector3 // root space
  pole: THREE.Vector3
  frame: THREE.Quaternion
}

/**
 * Drives one humanoid through the prayer: blends postures, keeps the feet
 * planted and the body on the mat, and places the hands with IK.
 */
export class Performer {
  readonly root = new THREE.Group()
  private readonly rig = new THREE.Group()
  private metrics!: Metrics
  private body = new SampleSet([])
  private hands = { left: new SampleSet([]), right: new SampleSet([]) }
  private face = new SampleSet([])
  private toes = { left: new SampleSet([]), right: new SampleSet([]) }

  /** Raise the hands going into ruku and rising from it (raf' al-yadayn). */
  raiseHands = false
  /** Where each upper leg sits in its parent at rest (for the tuned leg drop). */
  private legRest = new Map<'left' | 'right', THREE.Vector3>()
  /** Per-posture fine-tuning for this character (see tuning.ts). */
  tune: (pose: PoseName) => Tune = () => ZERO
  private pose: PoseName = 'rest'
  private from: PoseName = 'rest'
  private queue: PoseName[] = []
  private t = 1
  private duration = 1

  private fkCurrent = new Map<HumanBone, THREE.Quaternion>()
  /** This frame's leg rotations (posture, rest-slant fix and tune), for the forehead solver. */
  private legPosed = new Map<HumanBone, THREE.Quaternion>()
  private fkFrom = new Map<HumanBone, THREE.Quaternion>()
  private armFrom: { left: ArmState; right: ArmState } | null = null
  private eyes = 0
  private eyesFrom = 0
  private clock = 0

  constructor(private readonly humanoid: Humanoid) {
    this.rig.add(humanoid.scene)
    this.root.add(this.rig)
    humanoid.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        // Textures carry their own soft shading; self-shadowing (cap on face) only darkens them.
        o.receiveShadow = false
      }
    })
    for (const side of ['left', 'right'] as const) {
      const b = humanoid.raw[`${side}UpperLeg`]
      if (b) this.legRest.set(side, b.position.clone())
    }
    this.measure()
    this.jumpTo('rest')
  }

  get posture() {
    return this.pose
  }

  // ————————————————————————————————————————————— measuring the character

  private measure() {
    const h = this.humanoid
    for (const bone of Object.keys(h.raw) as HumanBone[]) h.setRotation(bone, q())
    h.applyPose()
    this.root.updateMatrixWorld(true)

    const box = new THREE.Box3().setFromObject(h.scene, true)
    const scale = STAGE_HEIGHT / Math.max(1e-6, box.max.y - box.min.y)
    this.rig.scale.setScalar(scale)
    this.root.updateMatrixWorld(true)
    box.setFromObject(h.scene, true)
    this.rig.position.y -= box.min.y
    this.root.updateMatrixWorld(true)

    const H = STAGE_HEIGHT
    const P = (b: HumanBone) => (h.raw[b] ? worldPos(h.raw[b]!) : null)
    const restWorld = new Map<HumanBone, THREE.Quaternion>()
    for (const [b, node] of Object.entries(h.raw) as [HumanBone, THREE.Object3D][]) restWorld.set(b, worldQuat(node))

    this.collectSamples()

    // Sample the skinned surface once, in the rest pose.
    const points: THREE.Vector3[] = []
    h.scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isMesh || !mesh.geometry.attributes.position) return
      const count = mesh.geometry.attributes.position.count
      const stride = Math.max(1, Math.floor(count / 6000))
      for (let i = 0; i < count; i += stride) {
        const p = v()
        if (mesh.isSkinnedMesh) mesh.getVertexPosition(i, p)
        else p.fromBufferAttribute(mesh.geometry.attributes.position, i)
        points.push(mesh.localToWorld(p))
      }
    })
    const frontAt = (y: number, band: number, maxX: number) =>
      points.reduce((z, p) => (Math.abs(p.y - y) < band && Math.abs(p.x) < maxX ? Math.max(z, p.z) : z), -Infinity)

    const head = P('head')!
    const neck = P('neck') ?? head
    const spine = P('spine')!
    const chestBone = (h.raw.chest ? 'chest' : 'spine') as HumanBone
    const headTop = Math.max(...points.map((p) => p.y))
    const headH = headTop - head.y

    const chestY = spine.y + (neck.y - spine.y) * 0.3
    const chestFront = frontAt(chestY, 0.025 * H, 0.07 * H)
    const chestOffset = v().set(0, chestY, (Number.isFinite(chestFront) ? chestFront : spine.z + 0.1 * H) + 0.012 * H).sub(P(chestBone)!)

    const foreheadY = head.y + headH * 0.55
    const faceFront = frontAt(foreheadY, 0.02 * H, 0.05 * H)
    const foreheadOffset = v().set(0, foreheadY, Number.isFinite(faceFront) ? faceFront : head.z + 0.08 * H).sub(head)

    const headHalfWidth = points.reduce(
      (w, p) => (p.y > head.y + headH * 0.2 && p.y < head.y + headH * 0.6 ? Math.max(w, Math.abs(p.x - head.x)) : w),
      0.05 * H,
    )

    const hand = (side: 'left' | 'right'): HandRest => {
      const s = side === 'left' ? 1 : -1
      const wrist = P(`${side}Hand`)!
      const elbow = P(`${side}LowerArm`)!
      const shoulder = P(`${side}UpperArm`)!
      const middle = P(`${side}MiddleProximal`)
      const index = P(`${side}IndexProximal`)
      const little = P(`${side}LittleProximal`)
      const fingers = (middle ?? wrist.clone().add(wrist.clone().sub(elbow))).clone().sub(wrist).normalize()
      let palm = v().set(0, -1, 0)
      if (index && little) {
        palm = fingers.clone().cross(little.clone().sub(index)).normalize().multiplyScalar(s)
        if (palm.y > 0) palm.negate()
      }
      return {
        quat: restWorld.get(`${side}Hand`)!.clone(),
        local: h.raw[`${side}Hand`]!.quaternion.clone(),
        frame: frameQuat(fingers, palm),
        upper: shoulder.distanceTo(elbow),
        lower: elbow.distanceTo(wrist),
      }
    }

    // How far the palm surface sits below the wrist joint (the rest pose
    // holds the palms down), and the kneecap in front of the knee joint.
    const palmBelow = (side: 'left' | 'right') => {
      const wrist = P(`${side}Hand`)!
      const reach = 0.1 * H
      const s = side === 'left' ? 1 : -1
      return points.reduce(
        (d, p) => (p.distanceTo(wrist) < reach && (p.x - wrist.x) * s > 0.006 * H ? Math.max(d, wrist.y - p.y) : d),
        0.008 * H,
      )
    }
    const kneeFront = (side: 'left' | 'right') => {
      const knee = P(`${side}LowerLeg`)!
      const front = points.reduce(
        (z, p) => (Math.abs(p.y - knee.y) < 0.02 * H && Math.abs(p.x - knee.x) < 0.05 * H ? Math.max(z, p.z) : z),
        knee.z,
      )
      return front - knee.z
    }

    const pitchFromDown = (d: THREE.Vector3) => Math.atan2(-d.z, -d.y)
    const legRest = (side: 'left' | 'right') => {
      const hip = P(`${side}UpperLeg`)!, knee = P(`${side}LowerLeg`)!, ankle = P(`${side}Foot`)!
      const thigh = pitchFromDown(knee.clone().sub(hip))
      return { thigh, knee: pitchFromDown(ankle.clone().sub(knee)) - thigh }
    }

    const footY = Math.min(P('leftFoot')!.y, P('rightFoot')!.y)
    const toesY = h.raw.leftToes ? P('leftToes')!.y : footY * 0.35
    this.metrics = {
      footPad: footY,
      toePad: toesY,
      kneePad: Math.max(0.02 * H, Math.min(kneeFront('left'), kneeFront('right'), 0.06 * H)),
      palmPad: Math.min(Math.max(palmBelow('left'), palmBelow('right')), 0.04 * H),
      headHalfWidth,
      chestOffset,
      foreheadOffset,
      restWorld,
      hands: { left: hand('left'), right: hand('right') },
      curlAxis: new Map(),
      legRest: { left: legRest('left'), right: legRest('right') },
    }
    // Curl axes: finger direction × palm normal, so a positive angle folds
    // each joint towards the palm. Rigs without fingers simply skip this.
    for (const side of ['left', 'right'] as const) {
      const rest = this.metrics.hands[side]
      const palm = v().set(0, 1, 0).applyQuaternion(rest.frame)
      for (const chain of FINGER_CHAINS(side)) {
        chain.forEach((bone, i) => {
          const a = P(bone)
          const b = chain[i + 1] ? P(chain[i + 1]!) : null
          if (!a) return
          const dir = b ? b.clone().sub(a) : a.clone().sub(P(chain[i - 1] ?? `${side}Hand`) ?? a)
          if (dir.lengthSq() < 1e-10) return
          this.metrics.curlAxis.set(bone, dir.normalize().cross(palm).normalize())
        })
      }
    }
  }

  /**
   * Pick ~3000 support vertices (legs, pelvis) and ~400 per hand, split by the bone that
   * mostly drives them. Grounding against the real surface works for any
   * character, whatever its proportions, clothes or rig quirks.
   */
  private collectSamples() {
    const h = this.humanoid
    const handBones = { left: new Set<THREE.Object3D>(), right: new Set<THREE.Object3D>() }
    // Only what a person rests on grounds the body: legs, feet and the
    // pelvis (a seat on the heel). The torso and head are placed by the
    // forehead solver and the arms by IK, so they must not hold it up.
    const supportBones = new Set<THREE.Object3D>()
    if (h.raw.hips) supportBones.add(h.raw.hips)
    for (const side of ['left', 'right'] as const) {
      h.raw[`${side}Hand`]?.traverse((o) => handBones[side].add(o))
      h.raw[`${side}UpperLeg`]?.traverse((o) => supportBones.add(o))
    }
    const toeBones = { left: new Set<THREE.Object3D>(), right: new Set<THREE.Object3D>() }
    for (const side of ['left', 'right'] as const) h.raw[`${side}Toes`]?.traverse((o) => toeBones[side].add(o))
    const toes: Record<'left' | 'right', Sample[]> = { left: [], right: [] }
    const headBones = new Set<THREE.Object3D>()
    h.raw.head?.traverse((o) => headBones.add(o))
    const face: Sample[] = []
    const body: Sample[] = []
    const hands: Record<'left' | 'right', Sample[]> = { left: [], right: [] }
    const meshes: THREE.SkinnedMesh[] = []
    h.scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh && mesh.geometry.attributes.skinIndex) meshes.push(mesh)
    })
    const total = meshes.reduce((n, m) => n + m.geometry.attributes.position!.count, 0)
    // The cuff of a sleeve rides on the forearm but reaches past the wrist:
    // when the palms rest on the rug (sujud) it must stay above it too.
    const cuff = (['left', 'right'] as const).map((side) => {
      const fore = h.raw[`${side}LowerArm`], hand = h.raw[`${side}Hand`]
      if (!fore || !hand) return null
      const wrist = worldPos(hand)
      return { side, fore, wrist, reach: 0.3 * worldPos(fore).distanceTo(wrist) }
    })
    const p = v()
    for (const mesh of meshes) {
      const { skinIndex, skinWeight, position } = mesh.geometry.attributes
      const bones = mesh.skeleton.bones
      for (let i = 0; i < position!.count; i++) {
        let best = 0
        for (let k = 1; k < 4; k++) if (skinWeight!.getComponent(i, k) > skinWeight!.getComponent(i, best)) best = k
        const bone = bones[skinIndex!.getComponent(i, best)]
        const side = bone && handBones.left.has(bone) ? 'left' : bone && handBones.right.has(bone) ? 'right' : null
        const sleeve = cuff.find((c) => c && c.fore === bone)
        if (side) hands[side].push({ mesh, index: i })
        else if (sleeve && mesh.localToWorld(mesh.getVertexPosition(i, p)).distanceTo(sleeve.wrist) < sleeve.reach) hands[sleeve.side].push({ mesh, index: i })
        else if (bone && supportBones.has(bone)) body.push({ mesh, index: i })
        else if (bone && headBones.has(bone)) face.push({ mesh, index: i })
        if (bone && toeBones.left.has(bone)) toes.left.push({ mesh, index: i })
        else if (bone && toeBones.right.has(bone)) toes.right.push({ mesh, index: i })
      }
    }
    const thin = (list: Sample[], n: number) => {
      const stride = Math.max(1, Math.floor(list.length / n))
      return list.filter((_, i) => i % stride === 0)
    }
    this.body = new SampleSet(thin(body, Math.min(3000, total)))
    this.hands = { left: new SampleSet(thin(hands.left, 400)), right: new SampleSet(thin(hands.right, 400)) }
    this.face = new SampleSet(thin(face, 600))
    this.toes = { left: new SampleSet(thin(toes.left, 300)), right: new SampleSet(thin(toes.right, 300)) }
  }

  /** Lowest point of a sample set, in the root's own space. */
  private lowest(samples: SampleSet) {
    return samples.lowest(this.root)
  }

  // ————————————————————————————————————————————— choosing postures

  /** Snap without animation (first render, reduced motion). */
  jumpTo(name: PoseName) {
    this.pose = this.from = name
    this.queue = []
    this.t = 1
    this.fkCurrent.clear()
    // Seed every bone, so the first transition starts from a fixed snapshot
    // for all of them (bones the pose leaves out are at rest).
    for (const bone of Object.keys(this.humanoid.raw) as HumanBone[]) this.fkCurrent.set(bone, q())
    for (const [bone, deg] of Object.entries(PRAYER_POSES[name].fk) as [HumanBone, readonly number[]][])
      this.fkCurrent.set(bone, this.toQuat(deg))
    this.armFrom = null
    this.eyes = PRAYER_POSES[name].eyesClosed
    this.update(0)
  }

  setPosture(name: PoseName) {
    const last = this.queue.at(-1) ?? this.pose
    if (name === last) return
    this.queue = waypoints(last, name, this.raiseHands)
    this.startNext()
  }

  private startNext() {
    const next = this.queue.shift()
    if (!next) return
    this.fkFrom = new Map([...this.fkCurrent].map(([b, quat]) => [b, quat.clone()]))
    this.armFrom = this.t < 1 ? this.snapshotArms() : null
    this.eyesFrom = this.eyes
    this.from = this.pose
    this.pose = next
    this.t = 0
    // Big moves (to and from the floor) take a little longer.
    const big = next === 'kneel' || this.from === 'kneel'
    this.duration = big ? 0.75 : 0.95
  }

  private toQuat(deg: readonly number[], out = q()) {
    return out.setFromEuler(new THREE.Euler(deg[0]! * DEG, deg[1]! * DEG, deg[2]! * DEG, 'XYZ'))
  }

  // ————————————————————————————————————————————— per frame

  update(dt: number) {
    this.clock += dt
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.duration)
      if (this.t >= 1 && this.queue.length) this.startNext()
    }
    const e = easeInOut(this.t)
    const target = PRAYER_POSES[this.pose]
    const h = this.humanoid

    // 1. Forward kinematics: blend every authored bone towards the target.
    const bones = new Set<HumanBone>([...this.fkFrom.keys(), ...(Object.keys(target.fk) as HumanBone[])])
    for (const bone of bones) {
      const to = target.fk[bone] ? this.toQuat(target.fk[bone]!) : q()
      // Never fall back to fkCurrent here: it is overwritten every frame, so
      // the blend would compound and race ahead (the first-ruku wobble).
      const from = this.fkFrom.get(bone) ?? q()
      this.fkCurrent.set(bone, (this.fkCurrent.get(bone) ?? q()).copy(from).slerp(to, e))
    }
    // Tuned extra leg bend (degrees), blended with the posture change.
    const ta = this.tune(this.from), tb = this.tune(this.pose)
    const mix = (k: 'thigh' | 'shin' | 'foot' | 'spread') => THREE.MathUtils.lerp(ta[k], tb[k], e)
    const legTune: Partial<Record<HumanBone, THREE.Quaternion>> = {}
    const [thigh, shin, foot, spread] = [mix('thigh'), mix('shin'), mix('foot'), mix('spread')]
    if (thigh || shin || foot || spread) {
      for (const side of ['left', 'right'] as const) {
        const s = side === 'left' ? 1 : -1
        legTune[`${side}UpperLeg`] = this.toQuat([-thigh, 0, s * spread])
        legTune[`${side}LowerLeg`] = this.toQuat([shin, 0, 0])
        legTune[`${side}Foot`] = this.toQuat([foot, 0, 0])
      }
    }
    // Per-bone tuned rotations (degrees), blended between the two postures.
    for (const bone of new Set([...Object.keys(ta.bones), ...Object.keys(tb.bones)]) as Set<HumanBone>) {
      const a = ta.bones[bone] ?? [0, 0, 0], b = tb.bones[bone] ?? [0, 0, 0]
      const d = [0, 1, 2].map((i) => THREE.MathUtils.lerp(a[i]!, b[i]!, e))
      const extra = this.toQuat(d)
      legTune[bone] = legTune[bone] ? legTune[bone]!.clone().multiply(extra) : extra
    }
    // Folded legs first lose the rig's own rest slant (legRotation), then take the tune.
    const legBones = new Set<HumanBone>(['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'])
    for (const bone of Object.keys(h.raw) as HumanBone[]) {
      const base = legBones.has(bone) ? this.legRotation(bone as 'leftUpperLeg') : (this.fkCurrent.get(bone) ?? q())
      const rot = legTune[bone] ? base.clone().multiply(legTune[bone]!) : base
      if (legBones.has(bone)) this.legPosed.set(bone, rot)
      h.setRotation(bone, rot)
    }
    // Legs back at their rest place before any tuned drop below.
    for (const side of ['left', 'right'] as const) {
      const b = h.raw[`${side}UpperLeg`]
      const rest = this.legRest.get(side)
      if (b && rest) b.position.copy(rest)
    }
    this.poseFingers(target, e)

    // Gentle breathing so the figure never looks frozen.
    const breath = Math.sin(this.clock * 1.5) * 0.7 * DEG
    const chest = this.fkCurrent.get('chest') ?? q()
    h.setRotation('chest', chest.clone().multiply(q().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -breath)))
    h.applyPose()
    this.root.updateMatrixWorld(true)

    // 2. Let the robe settle (corrective drape shapes fade in with the
    // posture, before grounding so the settled cloth is what rests on the
    // mat), then plant the body; in sujud, lower the forehead onto it.
    for (const drape of ['sit', 'kneel', 'sujud'] as const) {
      const w = (DRAPE[this.pose] === drape ? e : 0) + (DRAPE[this.from] === drape ? 1 - e : 0)
      h.setDrape(drape, Math.min(1, w))
    }
    this.ground(target)
    const forehead = this.pose === 'sujud' ? e : this.from === 'sujud' ? 1 - e : 0
    if (forehead > 0) this.lowerForehead(target, forehead)
    this.plantToes(target, e)

    // 2b. Tuned sink into the rug (blends with the posture change).
    const sink = THREE.MathUtils.lerp(this.tune(this.from).sink, this.tune(this.pose).sink, e) * STAGE_HEIGHT
    const mv = [0, 1, 2].map((i) => THREE.MathUtils.lerp(ta.move[i]!, tb.move[i]!, e) * STAGE_HEIGHT)
    if (sink || mv.some(Boolean)) {
      this.rig.position.y -= sink - mv[1]!
      this.rig.position.x += mv[0]!
      this.rig.position.z += mv[2]!
      this.root.updateMatrixWorld(true)
    }
    // 2c. Tuned leg drop: legs move down from the hips (into the rug), the body stays.
    const drop = THREE.MathUtils.lerp(ta.legDrop, tb.legDrop, e) * STAGE_HEIGHT
    if (drop) {
      for (const side of ['left', 'right'] as const) {
        const b = h.raw[`${side}UpperLeg`]
        if (!b?.parent) continue
        const wp = b.getWorldPosition(v()).add(v(0, -drop, 0))
        b.position.copy(b.parent.worldToLocal(wp))
      }
      this.root.updateMatrixWorld(true)
    }

    // 3. Hands. Palms on the rug are corrected against their real surface,
    // so fingers never dip through it whatever the hand's shape.
    this.placeArms(target, e)
    const lift = { left: 0, right: 0 }
    let again = false
    for (const side of ['left', 'right'] as const) {
      const w = (target[side].anchor === 'ground' ? e : 0) + (PRAYER_POSES[this.from][side].anchor === 'ground' ? 1 - e : 0)
      if (w <= 0 || !this.hands[side].size) continue
      const gap = PALM_SINK - this.lowest(this.hands[side])
      if (gap > 0 || w > 0.5) {
        lift[side] = gap * Math.min(1, w)
        again = true
      }
    }
    if (again) this.placeArms(target, e, lift)

    // 4. Face.
    this.eyes = THREE.MathUtils.lerp(this.eyesFrom, target.eyesClosed, e)
    h.setExpression('blink', this.eyes)
    h.setExpression('relaxed', this.eyes * 0.6)
    h.finish(dt)
  }

  /**
   * The authored leg rotation, plus (when the knee is folded) a pitch that
   * first straightens the rig's own rest slant, so folded legs follow the
   * authored angles: knees on the mat, shins under the thighs. Straight
   * standing legs are left exactly as the character was modelled.
   */
  private legRotation(bone: 'leftUpperLeg' | 'rightUpperLeg' | 'leftLowerLeg' | 'rightLowerLeg') {
    const side = bone.startsWith('left') ? 'left' : 'right'
    const fk = this.fkCurrent.get(bone) ?? q()
    const knee = this.fkCurrent.get(`${side}LowerLeg`) ?? q()
    const fold = v().set(0, -1, 0).applyQuaternion(knee).angleTo(v().set(0, -1, 0))
    const s = THREE.MathUtils.smoothstep(fold, 30 * DEG, 80 * DEG)
    if (s <= 0) return fk.clone()
    const rest = this.metrics.legRest[side]
    const angle = -(bone.endsWith('UpperLeg') ? rest.thigh : rest.knee) * s
    return fk.clone().multiply(q().setFromAxisAngle(v().set(1, 0, 0), angle))
  }

  /** Blend each hand's finger shape from the previous posture's grip to this one's. */
  private poseFingers(target: PrayerPose, e: number) {
    const axes = this.metrics.curlAxis
    if (!axes.size) return
    const from = PRAYER_POSES[this.from]
    for (const side of ['left', 'right'] as const) {
      const a = GRIPS[from[side].grip ?? 'relaxed']
      const b = GRIPS[target[side].grip ?? 'relaxed']
      FINGER_CHAINS(side).forEach((chain, f) =>
        chain.forEach((bone, j) => {
          const axis = axes.get(bone)
          if (!axis) return
          const deg = THREE.MathUtils.lerp(a[f]![j]!, b[f]![j]!, e)
          this.humanoid.setRotation(bone, q().setFromAxisAngle(axis, deg * DEG))
        }),
      )
    }
  }

  private ground(target: PrayerPose) {
    const h = this.humanoid
    const m = this.metrics
    const contacts = new Set([...target.contacts, ...PRAYER_POSES[this.from].contacts])
    // Work in the root's own space: the stage mounts the root on top of the
    // rug, so world heights are offset by the rug and must not be used here.
    const P = (b: HumanBone) => this.root.worldToLocal(worldPos(h.raw[b]!))
    let lowest = Infinity
    for (const side of ['left', 'right'] as const) {
      if (contacts.has('feet')) lowest = Math.min(lowest, P(`${side}Foot`).y - m.footPad)
      if (contacts.has('toes') && h.raw[`${side}Toes`]) lowest = Math.min(lowest, P(`${side}Toes`).y - m.toePad)
      if (contacts.has('knees')) lowest = Math.min(lowest, P(`${side}LowerLeg`).y - m.kneePad)
    }
    // The real surface is the truth: shins in jalsah, kneecaps in sujud,
    // soles when standing. Joint pads are only a fallback for odd assets.
    if (this.body.size) lowest = this.lowest(this.body)
    // Keep the toes where they started — people pray on one spot.
    const anchor = h.raw.leftToes && h.raw.rightToes ? P('leftToes').add(P('rightToes')).multiplyScalar(0.5) : P('leftFoot').add(P('rightFoot')).multiplyScalar(0.5)
    this.rig.position.x -= anchor.x
    this.rig.position.z -= anchor.z
    this.rig.position.y -= lowest
    this.root.updateMatrixWorld(true)
  }

  /**
   * Pitch the torso around the hips (legs stay put) until the forehead rests
   * on the mat — whatever the character's proportions.
   */
  private lowerForehead(target: PrayerPose, weight: number) {
    const h = this.humanoid
    const m = this.metrics
    const X = new THREE.Vector3(1, 0, 0)
    let extra = 0
    for (let i = 0; i < 3; i++) {
      const head = worldPos(h.raw.head!)
      const headRot = worldQuat(h.raw.head!).multiply(m.restWorld.get('head')!.clone().invert())
      const forehead = this.root.worldToLocal(head.add(m.foreheadOffset.clone().applyQuaternion(headRot)))
      const hips = this.root.worldToLocal(worldPos(h.raw.hips!))
      const reach = Math.max(0.15, Math.hypot(forehead.z - hips.z, forehead.x - hips.x))
      // The forehead rests on the plush, level with the soles' sink.
      // Prefer the real surface of the head (forehead and nose touch first).
      const error = (this.face.size ? this.lowest(this.face) : forehead.y) - FOREHEAD_SINK
      extra = THREE.MathUtils.clamp(extra + (error / reach) * weight, -0.4, 0.45)
      const bend = q().setFromAxisAngle(X, extra)
      const unbend = q().setFromAxisAngle(X, -extra)
      h.setRotation('hips', (this.fkCurrent.get('hips') ?? q()).clone().premultiply(bend))
      h.setRotation('leftUpperLeg', unbend.clone().multiply(this.legPosed.get('leftUpperLeg') ?? this.legRotation('leftUpperLeg')))
      h.setRotation('rightUpperLeg', unbend.clone().multiply(this.legPosed.get('rightUpperLeg') ?? this.legRotation('rightUpperLeg')))
      h.applyPose()
      this.root.updateMatrixWorld(true)
      this.ground(target)
    }
  }

  /**
   * Kneeling and in sujud the toes are bent on the rug (the seventh point of
   * contact). Rig feet sit at their own angles, so authored ankle angles
   * leave the toes hovering: pitch each foot until its toe pads touch.
   */
  private plantToes(target: PrayerPose, e: number): boolean {
    const on = (pose: PrayerPose) => pose.contacts.includes('toes') && !pose.contacts.includes('feet')
    const w = (on(target) ? e : 0) + (on(PRAYER_POSES[this.from]) ? 1 - e : 0)
    if (w <= 0) return false
    const h = this.humanoid
    const axis = v().set(1, 0, 0).applyQuaternion(this.root.getWorldQuaternion(q()))
    for (const side of ['left', 'right'] as const) {
      const foot = h.raw[`${side}Foot`]
      const samples = this.toes[side]
      if (!foot || !samples.size) continue
      const shin = h.raw[`${side}LowerLeg`]
      // Lower the shin towards the rug (keeping the foot's own angle) until
      // the toes can reach, then pitch the foot so the toe pads touch.
      // The shin may come down only until it rests on the rug itself.
      const shinOk = () => this.lowest(this.body) > -SHIN_SINK
      const solve = (turn: (a: number) => void, limit: number, ok: () => boolean = () => true) => {
        let total = 0
        for (let i = 0; i < 5; i++) {
          const g0 = this.lowest(samples) - TOE_SINK
          if (!Number.isFinite(g0) || Math.abs(g0) < 0.0005) break
          const eps = 0.02
          turn(eps)
          const g1 = this.lowest(samples) - TOE_SINK
          turn(-eps)
          const slope = (g1 - g0) / eps
          if (Math.abs(slope) < 0.01) break
          const step = THREE.MathUtils.clamp(-g0 / slope, -0.2, 0.2)
          let next = THREE.MathUtils.clamp(total + step, -limit, limit)
          turn(next - total)
          for (let k = 0; k < 5 && !ok(); k++) {
            const back = (next - total) / 2
            turn(-back)
            next -= back
          }
          if (!ok()) {
            turn(total - next)
            break
          }
          total = next
        }
        return total
      }
      const shinStart = shin?.quaternion.clone()
      const footStart = foot.quaternion.clone()
      const turnShin = (a: number) => {
        if (!shin) return
        rotateWorld(shin, q().setFromAxisAngle(axis, a))
        rotateWorld(foot, q().setFromAxisAngle(axis, -a))
      }
      const turnFoot = (a: number) => rotateWorld(foot, q().setFromAxisAngle(axis, a))
      const shinAngle = solve(turnShin, 0.45, shinOk)
      const footAngle = solve(turnFoot, 0.9)
      // Blend with the posture change.
      if (shin && shinStart) shin.quaternion.copy(shinStart)
      foot.quaternion.copy(footStart)
      ;(shin ?? foot).updateMatrixWorld(true)
      turnShin(shinAngle * Math.min(1, w))
      turnFoot(footAngle * Math.min(1, w))
    }
    return true
  }

  private anchorFor(side: 'left' | 'right', spec: HandSpec): ArmState {
    const h = this.humanoid
    const m = this.metrics
    const H = STAGE_HEIGHT
    const s = side === 'left' ? 1 : -1
    const P = (b: HumanBone) => worldPos(h.raw[b]!)
    const normalizedWorld = (b: HumanBone) => worldQuat(h.raw[b]!).multiply(m.restWorld.get(b)!.clone().invert())
    let target: THREE.Vector3
    switch (spec.anchor) {
      case 'side': {
        const shoulder = P(`${side}UpperArm`)
        const arm = m.hands[side].upper + m.hands[side].lower
        target = shoulder.add(v().set(s * 0.03 * H, -arm * 0.97, 0.012 * H))
        break
      }
      case 'ears': {
        const head = P('head')
        // Beside the ears, slightly forward, palms facing the qibla.
        target = head.add(v().set(s * (m.headHalfWidth + 0.03 * H), -0.005 * H, 0.035 * H))
        break
      }
      case 'chest': {
        const bone = (h.raw.chest ? 'chest' : 'spine') as HumanBone
        target = P(bone).add(m.chestOffset.clone().applyQuaternion(normalizedWorld(bone)))
        break
      }
      case 'knees': {
        // Wrist sits above the knee so the palm cups the kneecap.
        target = P(`${side}LowerLeg`).add(v().set(s * 0.004 * H, 0.06 * H, 0.035 * H))
        break
      }
      case 'thighs': {
        // On top of the thigh, the palm just behind the kneecap.
        const hip = P(`${side}UpperLeg`)
        const knee = P(`${side}LowerLeg`)
        const along = knee.clone().sub(hip).normalize()
        const top = v().set(0, 1, 0).sub(along.clone().multiplyScalar(along.y))
        // Upright thighs (kneeling): rest the hands on their front instead.
        if (top.lengthSq() < 0.09) top.set(0, 0, 1)
        top.normalize()
        target = hip.lerp(knee, 0.62).addScaledVector(top, 0.042 * H)
        break
      }
      case 'ground': {
        // Palms flat on the rug beside the head: the wrist sits one palm
        // thickness above the surface, in the root's own space.
        const shoulder = this.root.worldToLocal(P(`${side}UpperArm`))
        const forehead = this.root.worldToLocal(P('head').add(m.foreheadOffset.clone().applyQuaternion(normalizedWorld('head'))))
        const local = v().set(shoulder.x + s * 0.03 * H, m.palmPad + PALM_SINK, forehead.z - 0.06 * H)
        // Short arms (children, big heads) cannot reach that far forward:
        // slide the palm back towards the shoulder until it can touch.
        const arm = (m.hands[side].upper + m.hands[side].lower) * 0.97
        const drop = shoulder.y - local.y
        const flat = v().set(local.x - shoulder.x, 0, local.z - shoulder.z)
        const room = Math.sqrt(Math.max(0, arm * arm - drop * drop))
        if (flat.length() > room) local.copy(shoulder).add(flat.setLength(room)).setY(m.palmPad + PALM_SINK)
        target = this.root.localToWorld(local)
        break
      }
    }
    if (spec.offset) target.add(vec(spec.offset).multiplyScalar(H))
    // Tuned hand lift for whichever posture this hand spec belongs to.
    const owner = PRAYER_POSES[this.pose][side] === spec ? this.pose : this.from
    const t = this.tune(owner)
    if (t.handUp || t.handFwd) target.add(v().set(0, t.handUp * H, t.handFwd * H).applyQuaternion(this.root.getWorldQuaternion(q())))
    return {
      target: this.root.worldToLocal(target),
      pole: vec(spec.pole).normalize(),
      frame: frameQuat(vec(spec.fingers), vec(spec.palm)),
    }
  }

  private snapshotArms() {
    const h = this.humanoid
    const snap = (side: 'left' | 'right'): ArmState => {
      const rest = this.metrics.hands[side]
      const world = worldQuat(h.raw[`${side}Hand`]!)
      // frame = world · rest⁻¹ · restFrame
      const frame = world.multiply(rest.quat.clone().invert()).multiply(rest.frame)
      const spec = PRAYER_POSES[this.pose][side]
      return { target: this.root.worldToLocal(worldPos(h.raw[`${side}Hand`]!)), pole: vec(spec.pole).normalize(), frame }
    }
    return { left: snap('left'), right: snap('right') }
  }

  private placeArms(target: PrayerPose, e: number, lift?: { left: number; right: number }) {
    const h = this.humanoid
    for (const side of ['left', 'right'] as const) {
      const to = this.anchorFor(side, target[side])
      const from = this.armFrom?.[side] ?? this.anchorFor(side, PRAYER_POSES[this.from][side])
      const local = from.target.clone().lerp(to.target, e)
      if (lift) local.y += lift[side] / Math.max(1e-6, this.root.scale.y)
      const goal = this.root.localToWorld(local)
      const pole = from.pole.clone().lerp(to.pole, e).normalize()
      const frame = from.frame.clone().slerp(to.frame, e)

      const upper = h.raw[`${side}UpperArm`]!
      const lower = h.raw[`${side}LowerArm`]!
      const hand = h.raw[`${side}Hand`]!
      const rest = this.metrics.hands[side]

      // Two-bone IK: elbow from the law of cosines, bent towards the pole.
      const pU = worldPos(upper)
      const a = rest.upper
      const b = rest.lower
      const toGoal = goal.clone().sub(pU)
      const dist = THREE.MathUtils.clamp(toGoal.length(), Math.abs(a - b) + 1e-4, a + b - 1e-4)
      const dir = toGoal.normalize()
      const cosA = (a * a + dist * dist - b * b) / (2 * a * dist)
      const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)))
      if (bend.lengthSq() < 1e-6) bend.set(0, 0, 1)
      bend.normalize()
      const elbow = pU.clone().addScaledVector(dir, a * cosA).addScaledVector(bend, a * Math.sqrt(Math.max(0, 1 - cosA * cosA)))

      rotateWorld(upper, q().setFromUnitVectors(worldPos(lower).sub(pU).normalize(), elbow.clone().sub(pU).normalize()))
      const pL = worldPos(lower)
      const wrist = pU.clone().addScaledVector(dir, dist)
      rotateWorld(lower, q().setFromUnitVectors(worldPos(hand).sub(pL).normalize(), wrist.sub(pL).normalize()))

      // Orient the palm, then give half of the wrist's twist to the forearm
      // (that's where pronation really happens) so the wrist never corkscrews.
      const desired = frame.clone().multiply(rest.frame.clone().invert()).multiply(rest.quat)
      setWorldQuat(hand, desired)
      const deviation = hand.quaternion.clone().multiply(rest.local.clone().invert())
      const twist = twistAngle(deviation, hand.position.clone().normalize())
      rotateWorld(lower, q().setFromAxisAngle(worldPos(hand).sub(worldPos(lower)).normalize(), twist * 0.5))
      setWorldQuat(hand, desired)
    }
  }

  dispose() {
    this.humanoid.dispose()
  }
}
