import * as THREE from 'three'
import type { VRM } from '@pixiv/three-vrm'

/**
 * A character-agnostic view of a humanoid rig.
 *
 * Poses are authored once in a *normalized* space — every bone's rest
 * orientation is the identity, axes are world-aligned, the character faces
 * +Z and its left is +X. This adapter maps that onto whatever the asset
 * actually has, so one pose library drives any character:
 *
 *  - VRM 0.x / 1.0 (VRoid, VRM exporters) via @pixiv/three-vrm
 *  - glTF/GLB with a Mixamo-style skeleton — Mixamo, AccuRIG, Meshy, Tripo,
 *    Avaturn and most auto-riggers export these names (with or without the
 *    "mixamorig:" prefix).
 */

const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const
const JOINTS = { Thumb: ['Metacarpal', 'Proximal', 'Distal'], other: ['Proximal', 'Intermediate', 'Distal'] } as const
type Side = 'left' | 'right'
type FingerBone<S extends Side> =
  | `${S}Thumb${(typeof JOINTS.Thumb)[number]}`
  | `${S}${Exclude<(typeof FINGERS)[number], 'Thumb'>}${(typeof JOINTS.other)[number]}`
function fingerBones<S extends Side>(side: S): FingerBone<S>[] {
  return FINGERS.flatMap((f) => (f === 'Thumb' ? JOINTS.Thumb : JOINTS.other).map((j) => `${side}${f}${j}`)) as FingerBone<S>[]
}
/** Finger chains, root to tip: [finger][joint]. */
export const FINGER_CHAINS = (side: Side) =>
  FINGERS.map((f) => ((f === 'Thumb' ? JOINTS.Thumb : JOINTS.other).map((j) => `${side}${f}${j}`) as HumanBone[]))

export const HUMAN_BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  ...fingerBones('left'),
  ...fingerBones('right'),
] as const
export type HumanBone = (typeof HUMAN_BONES)[number]

const MIXAMO_FINGER = { Thumb: 'Thumb', Index: 'Index', Middle: 'Middle', Ring: 'Ring', Little: 'Pinky' } as const
const MIXAMO_JOINT: Record<string, number> = { Metacarpal: 1, Proximal: 1, Intermediate: 2, Distal: 3 }
const mixamoFingers = () => {
  const out: Record<string, string> = {}
  for (const side of ['left', 'right'] as const)
    for (const f of FINGERS) {
      const joints = f === 'Thumb' ? JOINTS.Thumb : JOINTS.other
      joints.forEach((j, i) => {
        // Mixamo numbers each chain 1..3 from the knuckle.
        out[`${side}${f}${j}`] = `${side === 'left' ? 'Left' : 'Right'}Hand${MIXAMO_FINGER[f]}${f === 'Thumb' ? i + 1 : MIXAMO_JOINT[j]}`
      })
    }
  return out
}

const MIXAMO: Record<HumanBone, string> = {
  ...(mixamoFingers() as Record<string, string>),
  hips: 'Hips', spine: 'Spine', chest: 'Spine1', upperChest: 'Spine2', neck: 'Neck', head: 'Head',
  leftShoulder: 'LeftShoulder', leftUpperArm: 'LeftArm', leftLowerArm: 'LeftForeArm', leftHand: 'LeftHand',
  rightShoulder: 'RightShoulder', rightUpperArm: 'RightArm', rightLowerArm: 'RightForeArm', rightHand: 'RightHand',
  leftUpperLeg: 'LeftUpLeg', leftLowerLeg: 'LeftLeg', leftFoot: 'LeftFoot', leftToes: 'LeftToeBase',
  rightUpperLeg: 'RightUpLeg', rightLowerLeg: 'RightLeg', rightFoot: 'RightFoot', rightToes: 'RightToeBase',
} as Record<HumanBone, string>

const REQUIRED: HumanBone[] = [
  'hips', 'spine', 'head',
  'leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot',
]

export type Expression = 'blink' | 'happy' | 'relaxed'
/**
 * Corrective cloth shapes for floor postures: how a long robe settles when
 * sitting, kneeling or in sujud. Authored per character (see
 * docs/characters.md) and faded in with the posture by the performer.
 */
export type Drape = 'sit' | 'kneel' | 'sujud'

const MORPH_ALIASES: Record<Expression | `drape:${Drape}`, string[]> = {
  blink: ['eyeBlinkLeft', 'eyeBlinkRight', 'eyesClosed', 'EyesClosed', 'Blink', 'blink', 'Eye_Blink_L', 'Eye_Blink_R'],
  happy: ['mouthSmileLeft', 'mouthSmileRight', 'mouthSmile', 'Smile', 'smile'],
  relaxed: ['relaxed', 'Relaxed'],
  'drape:sit': ['drape_sit'],
  'drape:kneel': ['drape_kneel'],
  'drape:sujud': ['drape_sujud'],
}

export interface Humanoid {
  readonly scene: THREE.Object3D
  /** The asset's own bones (after the adapter has written the pose into them). */
  readonly raw: Partial<Record<HumanBone, THREE.Object3D>>
  /** Set a normalized local rotation. Bones the asset lacks are ignored. */
  setRotation(bone: HumanBone, q: THREE.Quaternion): void
  /** Copy normalized rotations onto the raw skeleton. */
  applyPose(): void
  /** Per-frame work that must run after IK (VRM spring bones, expressions…). */
  finish(dt: number): void
  setExpression(name: Expression, weight: number): void
  /** Corrective cloth shape weight (0..1). Characters without one ignore it. */
  setDrape(name: Drape, weight: number): void
  dispose(): void
}

/**
 * Put every bone back in the pose the mesh was skinned in (usually a T- or
 * A-pose), whatever pose the file happens to be saved in. Unlike
 * `Skeleton.pose()`, this respects transforms on non-bone parents such as a
 * scaled Blender "Armature" node.
 */
function restoreBindPose(mesh: THREE.SkinnedMesh) {
  const { bones, boneInverses } = mesh.skeleton
  const world = new Map<THREE.Object3D, THREE.Matrix4>()
  bones.forEach((bone, i) => world.set(bone, mesh.bindMatrix.clone().multiply(boneInverses[i]!.clone().invert())))
  const depth = (o: THREE.Object3D) => {
    let d = 0
    for (let p = o.parent; p; p = p.parent) d++
    return d
  }
  for (const bone of [...bones].sort((a, b) => depth(a) - depth(b))) {
    const parent = bone.parent!
    let parentWorld = world.get(parent)
    if (!parentWorld) {
      parent.updateWorldMatrix(true, false)
      parentWorld = parent.matrixWorld
    }
    parentWorld.clone().invert().multiply(world.get(bone)!).decompose(bone.position, bone.quaternion, bone.scale)
  }
}

const sanitize = (name: string) => name.replace(/^mixamorig\d*[:_]?/i, '').replace(/[:.\s]/g, '')

/** glTF with a Mixamo-style skeleton. Mirrors three-vrm's normalization. */
class GltfHumanoid implements Humanoid {
  readonly raw: Partial<Record<HumanBone, THREE.Object3D>> = {}
  private normalized = new Map<HumanBone, THREE.Quaternion>()
  private restLocal = new Map<HumanBone, THREE.Quaternion>()
  private parentRestWorld = new Map<HumanBone, THREE.Quaternion>()
  private morphs: { mesh: THREE.Mesh; index: number; expression: Expression | `drape:${Drape}` }[] = []
  private tmp = new THREE.Quaternion()

  constructor(readonly scene: THREE.Object3D) {
    const byName = new Map<string, THREE.Object3D>()
    let skin: THREE.SkinnedMesh | null = null
    scene.updateMatrixWorld(true)
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone || o.type === 'Object3D') byName.set(sanitize(o.name), o)
      const mesh = o as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh) {
        mesh.frustumCulled = false
        if (!skin || mesh.skeleton.bones.length > skin.skeleton.bones.length) skin = mesh
      }
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).morphTargetDictionary) {
        const dict = (o as THREE.Mesh).morphTargetDictionary!
        for (const [expression, names] of Object.entries(MORPH_ALIASES) as [Expression | `drape:${Drape}`, string[]][]) {
          for (const n of names) if (n in dict) this.morphs.push({ mesh: o as THREE.Mesh, index: dict[n]!, expression })
        }
      }
    })
    for (const bone of HUMAN_BONES) {
      const node = byName.get(MIXAMO[bone])
      if (node) this.raw[bone] = node
    }
    const missing = REQUIRED.filter((b) => !this.raw[b])
    if (missing.length) throw new Error(`Character rig is missing bones: ${missing.join(', ')}`)
    if (skin) restoreBindPose(skin)

    scene.updateMatrixWorld(true)
    for (const [bone, node] of Object.entries(this.raw) as [HumanBone, THREE.Object3D][]) {
      this.restLocal.set(bone, node.quaternion.clone())
      this.parentRestWorld.set(bone, node.parent ? node.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion())
      this.normalized.set(bone, new THREE.Quaternion())
    }
  }

  setRotation(bone: HumanBone, q: THREE.Quaternion) {
    this.normalized.get(bone)?.copy(q)
  }

  applyPose() {
    for (const [bone, n] of this.normalized) {
      const node = this.raw[bone]!
      const parent = this.parentRestWorld.get(bone)!
      // raw = P⁻¹ · n · P · rest
      node.quaternion.copy(n).multiply(parent).premultiply(this.tmp.copy(parent).invert()).multiply(this.restLocal.get(bone)!)
    }
  }

  finish() {}

  setExpression(name: Expression, weight: number) {
    for (const m of this.morphs) if (m.expression === name && m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.index] = weight
  }

  setDrape(name: Drape, weight: number) {
    const key = `drape:${name}` as const
    for (const m of this.morphs) if (m.expression === key && m.mesh.morphTargetInfluences) m.mesh.morphTargetInfluences[m.index] = weight
  }

  dispose() {}
}

class VrmHumanoid implements Humanoid {
  readonly raw: Partial<Record<HumanBone, THREE.Object3D>> = {}
  readonly scene: THREE.Object3D

  constructor(private vrm: VRM) {
    this.scene = vrm.scene
    vrm.humanoid.autoUpdateHumanBones = false
    vrm.scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false
    })
    for (const bone of HUMAN_BONES) {
      const node = vrm.humanoid.getRawBoneNode(bone)
      if (node) this.raw[bone] = node
    }
  }

  setRotation(bone: HumanBone, q: THREE.Quaternion) {
    this.vrm.humanoid.getNormalizedBoneNode(bone)?.quaternion.copy(q)
  }

  applyPose() {
    this.vrm.humanoid.update()
  }

  finish(dt: number) {
    this.vrm.update(dt)
  }

  setExpression(name: Expression, weight: number) {
    this.vrm.expressionManager?.setValue(name, weight)
  }

  setDrape() {}

  dispose() {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      mesh.geometry?.dispose()
    })
  }
}

function base64ToBuffer(text: string): ArrayBuffer {
  const binary = atob(text.trim())
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export async function loadHumanoid(url: string): Promise<Humanoid> {
  if (url.endsWith('.b64.txt')) return parseHumanoid(base64ToBuffer(await (await fetch(url)).text()))
  return parseHumanoid(url)
}

/** Load from a URL, or parse a GLB/VRM already in memory (tests, artifact builds). */
export async function parseHumanoid(source: string | ArrayBuffer): Promise<Humanoid> {
  const [{ GLTFLoader }, vrmModule, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('@pixiv/three-vrm'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ])
  const loader = new GLTFLoader()
  loader.setMeshoptDecoder(MeshoptDecoder)
  loader.register((parser) => new vrmModule.VRMLoaderPlugin(parser))
  const gltf = typeof source === 'string' ? await loader.loadAsync(source) : await loader.parseAsync(source, '')
  const vrm = gltf.userData.vrm as VRM | undefined
  if (vrm) {
    vrmModule.VRMUtils.removeUnnecessaryVertices(gltf.scene)
    vrmModule.VRMUtils.combineSkeletons(gltf.scene)
    vrmModule.VRMUtils.rotateVRM0(vrm) // VRM 0.x faces -Z; normalize to +Z
    return new VrmHumanoid(vrm)
  }
  return new GltfHumanoid(gltf.scene)
}
