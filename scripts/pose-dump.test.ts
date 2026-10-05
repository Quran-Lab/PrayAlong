// Dumps posed skinned vertex positions and per-vertex skinning matrices for
// corrective drape shapes. Run: POSE_GLB=... POSE=jalsah POSE_OUT=... npx vitest run scripts/pose-dump.test.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import * as THREE from 'three'
import { parseHumanoid } from '../src/components/stage/rig/humanoid'
import { Performer } from '../src/components/stage/rig/performer'
import type { PoseName } from '../src/components/stage/rig/prayer-poses'
;(globalThis as { self?: unknown }).self ??= globalThis

it.skipIf(!process.env.POSE_GLB)('dump posed mesh', async () => {
  const buf = readFileSync(process.env.POSE_GLB!)
  const h = await parseHumanoid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const p = new Performer(h)
  p.jumpTo(process.env.POSE as PoseName)
  for (let i = 0; i < 10; i++) p.update(1 / 60)
  h.scene.updateMatrixWorld(true)
  let mesh: THREE.SkinnedMesh | null = null
  h.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (m.isSkinnedMesh && (!mesh || m.geometry.attributes.position!.count > mesh.geometry.attributes.position!.count)) mesh = m
  })
  const m = mesh! as THREE.SkinnedMesh
  m.skeleton.update()
  const n = m.geometry.attributes.position!.count
  const posed = new Float32Array(n * 3), rest = new Float32Array(n * 3)
  const skin = new Float32Array(n * 16)
  const v = new THREE.Vector3()
  const si = m.geometry.attributes.skinIndex!, sw = m.geometry.attributes.skinWeight!
  const bm = m.skeleton.boneMatrices
  const acc = new THREE.Matrix4(), tmp = new THREE.Matrix4()
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(m.geometry.attributes.position as THREE.BufferAttribute, i); rest.set([v.x, v.y, v.z], i * 3)
    m.getVertexPosition(i, v); posed.set([v.x, v.y, v.z], i * 3) // mesh-local, skinned
    // S = bindInv · Σ w B · bind  (maps rest local -> posed local)
    acc.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k); if (!w) continue
      tmp.fromArray(bm, si.getComponent(i, k) * 16)
      for (let e = 0; e < 16; e++) acc.elements[e]! += tmp.elements[e]! * w
    }
    tmp.copy(m.bindMatrixInverse).multiply(acc).multiply(m.bindMatrix)
    skin.set(tmp.elements, i * 16)
  }
  // world transform of the mesh, to know where the floor is (root y = 0 is the sole)
  const toRoot = new THREE.Matrix4().copy(p.root.matrixWorld).invert().multiply(m.matrixWorld)
  writeFileSync(process.env.POSE_OUT!, JSON.stringify({ n, posed: Array.from(posed), rest: Array.from(rest), skin: Array.from(skin), toRoot: toRoot.elements, name: m.name }))
}, 120000)
