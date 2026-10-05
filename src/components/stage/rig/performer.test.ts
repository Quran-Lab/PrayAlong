import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { GltfHumanoid } from './humanoid'
import { Performer } from './performer'
import { POSE_NAMES } from './prayer-poses'

async function companion(name: string) {
  const data = await readFile(`public/avatars/${name}.glb`)
  // No images in Node: the face's texture is not needed to measure the body.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(() => ({ name: 'no-textures', loadTexture: () => Promise.resolve(new THREE.Texture()) }))
  const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  const h = new GltfHumanoid(gltf.scene, gltf.animations)
  const performer = new Performer(h)
  // On a raised stage, as in the app: everything below is measured from the mat.
  const mount = new THREE.Group()
  mount.position.y = 0.35
  mount.add(performer.root)
  const at = (o: THREE.Object3D) => performer.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()))
  const bone = (name: string) => at(h.scene.getObjectByName(name)!)
  return { h, performer, at, bone }
}

/** The lowest visible point of each mesh, in stage space. */
function lowest(performer: Performer) {
  const out: Record<string, number> = {}
  performer.root.traverseVisible((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    for (let i = 0; i < mesh.geometry.attributes.position!.count; i++) {
      const p = performer.root.worldToLocal(mesh.localToWorld(mesh.getVertexPosition(i, new THREE.Vector3())))
      out[mesh.name] = Math.min(out[mesh.name] ?? Infinity, p.y)
    }
  })
  return out
}

for (const name of ['brother', 'sister']) describe(`${name}: the postures, as al-Albani describes them`, () => {
  it('carries every posture', async () => {
    const { h } = await companion(name)
    const clips = new Set(h.clips.map((c) => c.name))
    for (const pose of POSE_NAMES) expect(clips.has(pose), pose).toBe(true)
  })

  it('takbir: palms level with the shoulders, fingertips towards the ears, in front of the face', async () => {
    const { performer, bone } = await companion(name)
    performer.jumpTo('takbir')
    for (const side of ['Left', 'Right']) {
      const shoulder = bone(`${side}Arm`)
      const wrist = bone(`${side}Hand`)
      const tip = bone(`${side}HandMiddle3`)
      expect(wrist.y).toBeGreaterThan(shoulder.y - 0.02)
      expect(wrist.y).toBeLessThan(shoulder.y + 0.1)
      expect(tip.y).toBeGreaterThan(wrist.y + 0.08) // fingers up
      expect(Math.abs(wrist.x)).toBeLessThan(Math.abs(shoulder.x) + 0.02) // not out to the sides
      expect(wrist.z).toBeGreaterThan(shoulder.z) // in front
    }
    performer.dispose()
  })

  it('qiyam: the right hand over the left, on the chest', async () => {
    const { performer, bone } = await companion(name)
    performer.jumpTo('qiyam')
    const chest = bone('Spine2')
    for (const side of ['Left', 'Right']) {
      const wrist = bone(`${side}Hand`)
      expect(wrist.y).toBeGreaterThan(chest.y - 0.02)
      expect(Math.abs(wrist.x)).toBeLessThan(0.12)
    }
    expect(bone('RightHand').z).toBeGreaterThan(bone('LeftHand').z) // the right one on top
    performer.dispose()
  })

  it('ruku: the back flat and level, the head in line with it, the palms on the knees', async () => {
    const { performer, bone } = await companion(name)
    performer.jumpTo('ruku')
    const back = bone('Neck').sub(bone('Hips'))
    expect(Math.abs(Math.atan2(back.y, Math.hypot(back.x, back.z))) * 180 / Math.PI).toBeLessThan(12)
    const neck = bone('Head').sub(bone('Neck'))
    expect(Math.abs(Math.atan2(neck.y, Math.hypot(neck.x, neck.z))) * 180 / Math.PI).toBeLessThan(15)
    for (const side of ['Left', 'Right']) expect(bone(`${side}HandMiddle1`).distanceTo(bone(`${side}Leg`))).toBeLessThan(0.1)
    performer.dispose()
  })

  it("i'tidal: standing straight, the arms by the sides", async () => {
    const { performer, bone } = await companion(name)
    performer.jumpTo('itidal')
    for (const side of ['Left', 'Right']) expect(bone(`${side}Hand`).y).toBeLessThan(bone('Hips').y)
    performer.dispose()
  })

  it('goes down hands first: palms on the mat while the knees are still up', async () => {
    const { performer, bone } = await companion(name)
    performer.jumpTo('descend')
    for (const side of ['Left', 'Right']) {
      expect(bone(`${side}Hand`).y).toBeLessThan(0.08)
      expect(bone(`${side}Leg`).y).toBeGreaterThan(0.12)
    }
    performer.dispose()
  })

  it('sujud: forehead, palms, knees and toes on the mat; forearms raised', async () => {
    const { performer, bone } = await companion(name)
    performer.jumpTo('sujud')
    for (const side of ['Left', 'Right']) {
      expect(bone(`${side}ToeBase`).y).toBeLessThan(0.04)
      expect(bone(`${side}Leg`).y).toBeLessThan(0.075)
      expect(bone(`${side}Hand`).y).toBeLessThan(0.07)
      expect(bone(`${side}ForeArm`).y).toBeGreaterThan(0.09)
    }
    expect(bone('Head').y).toBeLessThan(0.16)
    performer.dispose()
  })

  it('tashahhud: the right index finger points while the hand is closed', async () => {
    const { performer, bone } = await companion(name)
    for (const pose of ['tashahhud', 'tawarruk'] as const) {
      performer.jumpTo(pose)
      const hand = bone('RightHand')
      expect(bone('RightHandIndex3').distanceTo(hand), pose).toBeGreaterThan(bone('RightHandMiddle3').distanceTo(hand) + 0.03)
    }
    performer.dispose()
  })

  it('salam: the head turns far to the right, then to the left', async () => {
    const { performer, h } = await companion(name)
    const head = h.scene.getObjectByName('Head')!
    const turn = () => head.getWorldQuaternion(new THREE.Quaternion())
    performer.jumpTo('tawarruk')
    const ahead = turn().invert()
    const yaw = () => {
      const face = new THREE.Vector3(0, 0, 1).applyQuaternion(turn().multiply(ahead))
      return (Math.atan2(face.x, face.z) * 180) / Math.PI
    }
    performer.jumpTo('salam-right')
    expect(yaw()).toBeLessThan(-55) // facing +z, the figure's right is -x
    performer.jumpTo('salam-left')
    expect(yaw()).toBeGreaterThan(55)
    performer.dispose()
  })

  it('has its clothes draped for every posture, and wears the settled one', async () => {
    const { h, performer } = await companion(name)
    const baked = new Set<string>()
    let garments = 0
    h.scene.traverse((o) => {
      const keys = Object.keys((o as THREE.Mesh).morphTargetDictionary ?? {}).filter((k) => k.startsWith('pose_'))
      if (keys.length) garments++
      for (const k of keys) baked.add(k.slice(5))
    })
    expect(garments).toBe(name === 'sister' ? 2 : 1)
    for (const pose of POSE_NAMES) expect(baked.has(pose), pose).toBe(true)
    performer.jumpTo('sujud')
    h.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      const index = mesh.morphTargetDictionary?.pose_sujud
      if (index === undefined) return
      const total = Object.entries(mesh.morphTargetDictionary!).filter(([k]) => k.startsWith('pose_')).reduce((sum, [, i]) => sum + mesh.morphTargetInfluences![i]!, 0)
      expect(total).toBeCloseTo(1)
      expect(mesh.morphTargetInfluences![index]).toBe(1)
    })
    performer.dispose()
  })

  it('keeps every visible surface finite and on or above the mat in every posture', async () => {
    const { performer } = await companion(name)
    for (const pose of POSE_NAMES) {
      performer.jumpTo(pose)
      for (const [mesh, y] of Object.entries(lowest(performer))) {
        expect(Number.isFinite(y), `${pose} ${mesh}`).toBe(true)
        expect(y, `${pose}: ${mesh} goes into the mat`).toBeGreaterThan(-0.012)
      }
    }
    performer.dispose()
  })
})
