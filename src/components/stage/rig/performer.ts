import * as THREE from 'three'
import type { Humanoid, HumanBone } from './humanoid'
import { PRAYER_POSES, waypoints, type Dir3, type HandSpec, type PoseName, type PrayerPose } from './prayer-poses'

/** Characters are scaled to this standing height so framing is consistent. */
export const STAGE_HEIGHT = 1.65

const DEG = Math.PI / 180
/** Root-space heights: y = 0 is the sole, which the stage sinks 6 mm into the plush. */
const PALM_SINK = 0.004
const FOREHEAD_SINK = 0.005
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

const v = () => new THREE.Vector3()
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
  private groups: { mesh: THREE.SkinnedMesh; pos: Float32Array; bone: Uint16Array; weight: Float32Array }[] = []
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
      this.groups.push({ mesh, pos, bone, weight })
    }
    this.size = samples.length
  }

  /** Lowest sample, as a height in `root`'s space. */
  lowest(root: THREE.Object3D) {
    let low = Infinity
    for (const { mesh, pos, bone, weight } of this.groups) {
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

  private pose: PoseName = 'rest'
  private from: PoseName = 'rest'
  private queue: PoseName[] = []
  private t = 1
  private duration = 1

  private fkCurrent = new Map<HumanBone, THREE.Quaternion>()
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
        o.receiveShadow = true
      }
    })
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
    for (const mesh of meshes) {
      const { skinIndex, skinWeight, position } = mesh.geometry.attributes
      const bones = mesh.skeleton.bones
      for (let i = 0; i < position!.count; i++) {
        let best = 0
        for (let k = 1; k < 4; k++) if (skinWeight!.getComponent(i, k) > skinWeight!.getComponent(i, best)) best = k
        const bone = bones[skinIndex!.getComponent(i, best)]
        const side = bone && handBones.left.has(bone) ? 'left' : bone && handBones.right.has(bone) ? 'right' : null
        if (side) hands[side].push({ mesh, index: i })
        else if (bone && supportBones.has(bone)) body.push({ mesh, index: i })
        else if (bone && headBones.has(bone)) face.push({ mesh, index: i })
      }
    }
    const thin = (list: Sample[], n: number) => {
      const stride = Math.max(1, Math.floor(list.length / n))
      return list.filter((_, i) => i % stride === 0)
    }
    this.body = new SampleSet(thin(body, Math.min(3000, total)))
    this.hands = { left: new SampleSet(thin(hands.left, 400)), right: new SampleSet(thin(hands.right, 400)) }
    this.face = new SampleSet(thin(face, 600))
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
    this.queue = waypoints(last, name)
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
    for (const bone of Object.keys(h.raw) as HumanBone[]) h.setRotation(bone, this.fkCurrent.get(bone) ?? q())

    // Gentle breathing so the figure never looks frozen.
    const breath = Math.sin(this.clock * 1.5) * 0.7 * DEG
    const chest = this.fkCurrent.get('chest') ?? q()
    h.setRotation('chest', chest.clone().multiply(q().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -breath)))
    h.applyPose()
    this.root.updateMatrixWorld(true)

    // 2. Plant the body on the mat; in sujud, lower the forehead onto it.
    this.ground(target)
    const forehead = this.pose === 'sujud' ? e : this.from === 'sujud' ? 1 - e : 0
    if (forehead > 0) this.lowerForehead(target, forehead)

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
      h.setRotation('leftUpperLeg', unbend.clone().multiply(this.fkCurrent.get('leftUpperLeg') ?? q()))
      h.setRotation('rightUpperLeg', unbend.clone().multiply(this.fkCurrent.get('rightUpperLeg') ?? q()))
      h.applyPose()
      this.root.updateMatrixWorld(true)
      this.ground(target)
    }
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
        // On top of the thigh, a little behind the knee.
        const hip = P(`${side}UpperLeg`)
        const knee = P(`${side}LowerLeg`)
        const along = knee.clone().sub(hip).normalize()
        const top = v().set(0, 1, 0).sub(along.clone().multiplyScalar(along.y))
        // Upright thighs (kneeling): rest the hands on their front instead.
        if (top.lengthSq() < 0.09) top.set(0, 0, 1)
        top.normalize()
        target = hip.lerp(knee, 0.55).addScaledVector(top, 0.05 * H)
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
