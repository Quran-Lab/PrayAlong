import { readFileSync } from 'node:fs'
import { it } from 'vitest'
import * as THREE from 'three'
import { parseHumanoid } from './humanoid'
import { Performer } from './performer'
it('dbg2', async () => {
  const buf = readFileSync(`public/avatars/yusuf.glb`)
  const h = await parseHumanoid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const p = new Performer(h)
  const g = new THREE.Group(); g.position.y = 0.028; g.add(p.root); g.updateMatrixWorld(true)
  p.jumpTo('sujud'); ;(globalThis as any).__dbg = 1; p.update(1/60); (globalThis as any).__dbg = 0
  const W = (o: THREE.Object3D) => p.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()))
  for (const b of ['hips','spine','chest','neck','head','leftLowerLeg','leftToes']) console.log('bone', b, W((h.raw as any)[b]).toArray().map((x:number)=>x.toFixed(3)).join(','))
})
