import type * as THREE from 'three'
import type { PoseName } from './prayer-poses'

/**
 * The garments' shape in each posture, baked by a cloth simulation around the body
 * (tools/characters/drape.py) as one morph target per posture: "pose_ruku", "pose_sujud" …
 * Between two postures the two shapes blend as the body moves, and once it arrives the cloth
 * is exactly where the simulation left it: no arm, leg or mat ever shows through.
 */
export class ClothDrape {
  private readonly targets: { influences: number[]; index: Map<string, number> }[] = []

  constructor(scene: THREE.Object3D) {
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      const dict = mesh.morphTargetDictionary
      if (!mesh.isMesh || !dict || !mesh.morphTargetInfluences) return
      const index = new Map<string, number>()
      for (const [name, i] of Object.entries(dict)) if (name.startsWith('pose_')) index.set(name.slice(5), i)
      if (index.size) this.targets.push({ influences: mesh.morphTargetInfluences, index })
    })
  }

  /** On the way from one posture to another, `e` (0–1) of the way there. */
  set(from: PoseName, to: PoseName, e: number) {
    for (const { influences, index } of this.targets) {
      for (const i of index.values()) influences[i] = 0
      const a = index.get(from)
      const b = index.get(to)
      if (a !== undefined) influences[a]! += 1 - e
      if (b !== undefined) influences[b]! += e
    }
  }
}
