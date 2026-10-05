import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { GltfHumanoid } from './humanoid'
import { Performer } from './performer'
import { PRAYER_POSES, type PoseName } from './prayer-poses'

async function companion(name: string) {
  const data = await readFile(`public/avatars/${name}.glb`)
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  const h = new GltfHumanoid(gltf.scene)
  return { h, performer: new Performer(h, name === 'sister') }
}

for (const name of ['brother', 'sister']) describe(`${name} prayer rig`, () => {
  it('keeps sujud contacts on the actual mat, including under a translated stage', async () => {
    const { h, performer } = await companion(name)
    const mount = new THREE.Group()
    mount.position.y = 0.35
    mount.add(performer.root)
    performer.jumpTo('sujud')
    const local = (o: THREE.Object3D) => performer.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()))
    for (const side of ['left', 'right'] as const) {
      expect(local(h.raw[`${side}Toes`]!).y).toBeLessThan(0.04)
      expect(local(h.raw[`${side}LowerLeg`]!).y).toBeLessThan(0.075)
      expect(local(h.raw[`${side}Hand`]!).y).toBeGreaterThan(0.03)
      expect(local(h.raw[`${side}Hand`]!).y).toBeLessThan(0.065)
      expect(local(h.raw[`${side}LowerArm`]!).y).toBeGreaterThan(0.09)
    }
    performer.dispose()
  })

  it('has a working right-index gesture and returns to an open hand', async () => {
    const { h, performer } = await companion(name)
    let found = false
    performer.jumpTo('tashahhud')
    h.scene.traverse(o => {
      const mesh = o as THREE.Mesh
      const index = mesh.morphTargetDictionary?.prayerPoint
      if (index === undefined) return
      found = true
      expect(mesh.morphTargetInfluences![index]).toBe(1)
    })
    expect(found).toBe(true)
    performer.jumpTo('jalsah')
    h.scene.traverse(o => {
      const mesh = o as THREE.Mesh
      const index = mesh.morphTargetDictionary?.prayerPoint
      if (index !== undefined) expect(mesh.morphTargetInfluences![index]).toBe(0)
    })
    performer.dispose()
  })

  it('keeps every visible surface finite and above the mat in every settled pose', async () => {
    const { performer } = await companion(name)
    for (const pose of Object.keys(PRAYER_POSES) as PoseName[]) {
      performer.jumpTo(pose)
      let min = Infinity
      let part = ''
      performer.root.traverseVisible(o => {
        const mesh = o as THREE.Mesh
        if (!mesh.isMesh) return
        for (let i = 0; i < mesh.geometry.attributes.position!.count; i++) {
          const point = mesh.getVertexPosition(i, new THREE.Vector3())
          performer.root.worldToLocal(mesh.localToWorld(point))
          expect(Number.isFinite(point.lengthSq()), `${pose} ${mesh.name}`).toBe(true)
          if (point.y < min) { min = point.y; part = mesh.name }
        }
      })
      expect(min, `${pose}: ${part} penetrates the mat`).toBeGreaterThan(-0.012)
    }
    performer.dispose()
  })
})
