import * as THREE from 'three'
import { GarmentDrape } from './garment'
import type { Humanoid, HumanBone } from './humanoid'
import { prayerPose, waypoints, type Dir3, type HandSpec, type PoseName, type PrayerPose, type Waypoint } from './prayer-poses'

/** Characters are scaled to this standing height so framing is consistent. */
export const STAGE_HEIGHT = 1.65

const DEG = Math.PI / 180
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
  private drape: GarmentDrape

  private pose: PoseName = 'rest'
  private from: PoseName = 'rest'
  private queue: Waypoint[] = []
  private t = 1
  private duration = 1
  /** Seconds left to stay in the pose just reached before moving on. */
  private hold = 0
  private holdNext = 0

  private fkCurrent = new Map<HumanBone, THREE.Quaternion>()
  private fkFrom = new Map<HumanBone, THREE.Quaternion>()
  private armFrom: { left: ArmState; right: ArmState } | null = null
  private eyes = 0
  private eyesFrom = 0
  private clock = 0

  constructor(private readonly humanoid: Humanoid, private readonly compact = false) {
    this.rig.add(humanoid.scene)
    this.root.add(this.rig)
    humanoid.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true
        o.receiveShadow = true
        const material = (o as THREE.Mesh).material
        if (!Array.isArray(material) && material.name === 'Trousers') o.visible = false
      }
    })
    this.measure()
    this.drape = new GarmentDrape(humanoid, this.root)
    this.jumpTo('rest')
  }

  get posture() {
    return this.pose
  }

  /** True while moving between postures (the stage renders at full rate). */
  get moving() {
    return this.t < 1 || this.hold > 0 || this.queue.length > 0
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

    const foreheadY = head.y + headH * 0.43
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

    const footY = Math.min(P('leftFoot')!.y, P('rightFoot')!.y)
    const toesY = h.raw.leftToes ? P('leftToes')!.y : footY * 0.35
    this.metrics = {
      footPad: footY,
      toePad: toesY,
      kneePad: 0.03 * H,
      palmPad: 0.012 * H,
      headHalfWidth,
      chestOffset,
      foreheadOffset,
      restWorld,
      hands: { left: hand('left'), right: hand('right') },
    }
  }

  // ————————————————————————————————————————————— choosing postures

  /** Snap without animation (first render, reduced motion). */
  jumpTo(name: PoseName) {
    this.pose = this.from = name
    this.queue = []
    this.t = 1
    this.hold = 0
    this.fkCurrent.clear()
    this.fkFrom.clear()
    for (const [bone, deg] of Object.entries(prayerPose(name, this.compact).fk) as [HumanBone, readonly number[]][])
      this.fkCurrent.set(bone, this.toQuat(deg))
    this.armFrom = null
    this.eyes = prayerPose(name, this.compact).eyesClosed
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
    const next = step.pose
    this.holdNext = step.hold
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
      if (this.t >= 1) this.hold = this.holdNext
    } else if (this.hold > 0) this.hold = Math.max(0, this.hold - dt)
    if (this.t >= 1 && this.hold <= 0 && this.queue.length) this.startNext()
    const e = easeInOut(this.t)
    const target = prayerPose(this.pose, this.compact)
    const h = this.humanoid

    // 1. Forward kinematics: blend every authored bone towards the target.
    const bones = new Set<HumanBone>([...this.fkFrom.keys(), ...(Object.keys(target.fk) as HumanBone[])])
    for (const bone of bones) {
      const to = target.fk[bone] ? this.toQuat(target.fk[bone]!) : q()
      const from = this.fkFrom.get(bone) ?? (this.fkCurrent.get(bone) ?? q())
      this.fkCurrent.set(bone, (this.fkCurrent.get(bone) ?? q()).copy(from).slerp(to, e))
    }
    for (const bone of Object.keys(h.raw) as HumanBone[]) h.setRotation(bone, this.fkCurrent.get(bone) ?? q())

    // Gentle breathing so the figure never looks frozen.
    const breath = this.pose === 'sujud' ? 0 : Math.sin(this.clock * 1.5) * 0.18 * DEG
    const chest = this.fkCurrent.get('chest') ?? q()
    h.setRotation('chest', chest.clone().multiply(q().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -breath)))
    h.applyPose()
    this.root.updateMatrixWorld(true)

    // 2. Plant the body on the mat; in sujud, lower the forehead onto it.
    this.ground(target)
    const forehead = this.pose === 'sujud' ? e : this.from === 'sujud' ? 1 - e : 0
    if (forehead > 0) this.lowerForehead(target, forehead)

    // 3. Hands rest on the corrected lap, not the hidden leg surface.
    this.drape.update()
    this.placeArms(target, e)

    // 4. Face.
    this.eyes = THREE.MathUtils.lerp(this.eyesFrom, target.eyesClosed, e)
    h.setExpression('blink', this.eyes)
    h.setExpression('relaxed', this.eyes * 0.6)
    const points = (pose: PoseName) => pose === 'tashahhud' || pose === 'tawarruk' ? 1 : 0
    h.setExpression('point', THREE.MathUtils.lerp(points(this.from), points(this.pose), e))
    h.finish(dt)
    this.drape.update()
  }

  private ground(target: PrayerPose) {
    const h = this.humanoid
    const m = this.metrics
    const contacts = new Set([...target.contacts, ...prayerPose(this.from, this.compact).contacts])
    const P = (b: HumanBone) => worldPos(h.raw[b]!)
    const origin = this.root.getWorldPosition(v())
    let lowest = Infinity
    for (const side of ['left', 'right'] as const) {
      if (contacts.has('feet')) lowest = Math.min(lowest, P(`${side}Foot`).y - m.footPad)
      if (contacts.has('toes') && h.raw[`${side}Toes`]) lowest = Math.min(lowest, P(`${side}Toes`).y - m.toePad)
      if (contacts.has('knees')) lowest = Math.min(lowest, P(`${side}LowerLeg`).y - m.kneePad)
    }
    // Keep the toes where they started — people pray on one spot.
    const anchor = h.raw.leftToes && h.raw.rightToes ? P('leftToes').add(P('rightToes')).multiplyScalar(0.5) : P('leftFoot').add(P('rightFoot')).multiplyScalar(0.5)
    this.rig.position.x -= anchor.x - origin.x
    this.rig.position.z -= anchor.z - origin.z
    this.rig.position.y -= lowest - origin.y
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
    for (let i = 0; i < 6; i++) {
      // Keep the face facing the mat as the torso settles, not the crown.
      const headGoal = q().setFromAxisAngle(X, Math.PI / 2).multiply(m.restWorld.get('head')!)
      setWorldQuat(h.raw.head!, worldQuat(h.raw.head!).slerp(headGoal, weight))
      const head = worldPos(h.raw.head!)
      const headRot = worldQuat(h.raw.head!).multiply(m.restWorld.get('head')!.clone().invert())
      const forehead = head.add(m.foreheadOffset.clone().applyQuaternion(headRot))
      const hips = worldPos(h.raw.hips!)
      const reach = Math.max(0.15, Math.hypot(forehead.z - hips.z, forehead.x - hips.x))
      const error = forehead.y - this.root.getWorldPosition(v()).y - 0.003
      extra = THREE.MathUtils.clamp(extra + (error / reach) * weight, -0.4, 0.45)
      const bend = q().setFromAxisAngle(X, extra)
      const unbend = q().setFromAxisAngle(X, -extra)
      h.setRotation('hips', (this.fkCurrent.get('hips') ?? q()).clone().premultiply(bend))
      h.setRotation('leftUpperLeg', unbend.clone().multiply(this.fkCurrent.get('leftUpperLeg') ?? q()))
      h.setRotation('rightUpperLeg', unbend.clone().multiply(this.fkCurrent.get('rightUpperLeg') ?? q()))
      h.applyPose()
      this.root.updateMatrixWorld(true)
      this.ground(target)
      setWorldQuat(h.raw.head!, worldQuat(h.raw.head!).slerp(headGoal, weight))
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
        target = hip.lerp(knee, 0.63).addScaledVector(top, 0.058 * H)
        const local = this.root.worldToLocal(target.clone())
        const cloth = this.drape.support(local.x, local.z + 0.045 * H)
        if (cloth !== undefined) {
          local.y = Math.max(local.y, cloth + 0.026 * H)
          target = this.root.localToWorld(local)
        }
        break
      }
      case 'ground': {
        const shoulder = P(`${side}UpperArm`)
        const forehead = P('head').add(m.foreheadOffset.clone().applyQuaternion(normalizedWorld('head')))
        target = v().set(shoulder.x + s * (this.compact ? 0.012 : 0.03) * H, this.root.getWorldPosition(v()).y + 0.028 * H, forehead.z - 0.075 * H)
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
      const spec = prayerPose(this.pose, this.compact)[side]
      return { target: this.root.worldToLocal(worldPos(h.raw[`${side}Hand`]!)), pole: vec(spec.pole).normalize(), frame }
    }
    return { left: snap('left'), right: snap('right') }
  }

  private placeArms(target: PrayerPose, e: number) {
    const h = this.humanoid
    for (const side of ['left', 'right'] as const) {
      const to = this.anchorFor(side, target[side])
      const from = this.armFrom?.[side] ?? this.anchorFor(side, prayerPose(this.from, this.compact)[side])
      const goal = this.root.localToWorld(from.target.clone().lerp(to.target, e))
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
    this.drape.dispose()
    this.humanoid.dispose()
  }
}
