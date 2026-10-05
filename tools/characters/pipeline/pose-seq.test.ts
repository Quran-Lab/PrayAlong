// pose-seq.test.ts: dumps the real Performer moving from qiyam into a floor posture, frame by frame,
// for a cloth simulation: root-space positions of the body primitive per frame,
// root-space bone positions per frame, and for the last frame the per-vertex
// skinning matrices (rest local -> posed local) plus toRoot.
// POSE_GLB=x.glb POSES=jalsah,kneel,sujud POSE_OUT=prefix FRAMES=90
import { readFileSync, writeFileSync } from 'node:fs'
import { it } from 'vitest'
import * as THREE from 'three'
import { parseHumanoid } from '../../../src/components/stage/rig/humanoid'
import { Performer } from '../../../src/components/stage/rig/performer'
import type { PoseName } from '../../../src/components/stage/rig/prayer-poses'
;(globalThis as { self?: unknown }).self ??= globalThis

it.skipIf(!process.env.POSE_GLB)('dump posture sequences', async () => {
  const frames = Number(process.env.FRAMES ?? 90)
  for (const pose of process.env.POSES!.split(',')) {
    const buf = readFileSync(process.env.POSE_GLB!)
    const h = await parseHumanoid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const p = new Performer(h)
    p.jumpTo('qiyam')
    let mesh: THREE.SkinnedMesh | null = null
    const want = process.env.PRIM_MAT
    h.scene.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (!m.isSkinnedMesh) return
      const name = (m.material as THREE.Material).name
      if (want ? name === want : !mesh || m.geometry.attributes.position!.count > mesh.geometry.attributes.position!.count) mesh = m
    })
    const m = mesh! as THREE.SkinnedMesh
    const n = m.geometry.attributes.position!.count
    const pos = new Float32Array(frames * n * 3)
    const bones: Record<string, number[]>[] = []
    const v = new THREE.Vector3()
    const toRoot = new THREE.Matrix4()
    const rootInv = new THREE.Matrix4()
    p.setPosture(pose as PoseName)
    for (let f = 0; f < frames; f++) {
      p.update(1 / 30)
      h.scene.updateMatrixWorld(true)
      m.skeleton.update()
      rootInv.copy(p.root.matrixWorld).invert()
      toRoot.copy(rootInv).multiply(m.matrixWorld)
      for (let i = 0; i < n; i++) {
        m.getVertexPosition(i, v).applyMatrix4(toRoot)
        pos.set([v.x, v.y, v.z], (f * n + i) * 3)
      }
      const b: Record<string, number[]> = {}
      for (const [k, o] of Object.entries(h.raw)) b[k] = o!.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv).toArray()
      bones.push(b)
    }
    // last frame: skinning matrices for the rest-space morph
    const skin = new Float32Array(n * 16)
    const si = m.geometry.attributes.skinIndex!, sw = m.geometry.attributes.skinWeight!
    const bm = m.skeleton.boneMatrices
    const acc = new THREE.Matrix4(), tmp = new THREE.Matrix4()
    const posed = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      m.getVertexPosition(i, v); posed.set([v.x, v.y, v.z], i * 3)
      acc.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k); if (!w) continue
        tmp.fromArray(bm, si.getComponent(i, k) * 16)
        for (let e = 0; e < 16; e++) acc.elements[e]! += tmp.elements[e]! * w
      }
      tmp.copy(m.bindMatrixInverse).multiply(acc).multiply(m.bindMatrix)
      skin.set(tmp.elements, i * 16)
    }
    const out = process.env.POSE_OUT! + (want ? '_' + want : '')
    writeFileSync(`${out}_${pose}_seq.bin`, Buffer.from(pos.buffer))
    writeFileSync(`${out}_${pose}.bin`, Buffer.concat([Buffer.from(posed.buffer), Buffer.from(skin.buffer)]))
    writeFileSync(`${out}_${pose}.json`, JSON.stringify({ n, frames, toRoot: toRoot.elements, bones: bones.at(-1), seqBones: bones }))
  }
}, 900000)
