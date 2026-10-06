import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { parseHumanoid } from './humanoid'
import { Performer } from './performer'

// The meshopt decoder expects a browser global.
;(globalThis as { self?: unknown }).self ??= globalThis
import type { PoseName } from './prayer-poses'

// The stage mounts the performer this high (rug top minus the plush sink).
const MOUNT = 0.028
const CHARACTERS = ['yusuf', 'maryam', 'ahmad', 'aisha']

async function performer(file = 'public/avatars/yusuf.glb') {
  const buf = readFileSync(file)
  const humanoid = await parseHumanoid(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  const p = new Performer(humanoid)
  const mount = new THREE.Group()
  mount.position.y = MOUNT
  mount.add(p.root)
  mount.updateMatrixWorld(true)
  return { p, humanoid }
}

const run = (p: Performer, seconds: number, step = 1 / 60) => {
  for (let t = 0; t < seconds; t += step) p.update(step)
}

/** Lowest skinned vertex per body part (by dominant skin weight), world y. */
function lowestByPart(humanoid: Awaited<ReturnType<typeof parseHumanoid>>) {
  const name = new Map<THREE.Object3D, string>()
  for (const [k, o] of Object.entries(humanoid.raw)) name.set(o!, k)
  const part = (b: THREE.Object3D) => {
    for (let o: THREE.Object3D | null = b; o; o = o.parent)
      if (name.has(o)) return name.get(o)!.replace(/^(left|right)/, '').replace(/^(Thumb|Index|Middle|Ring|Little)\w+$/, 'Hand')
    return '?'
  }
  const low: Record<string, number> = {}
  const v = new THREE.Vector3()
  humanoid.scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh
    if (!m.isSkinnedMesh) return
    const { skinIndex, skinWeight, position } = m.geometry.attributes
    // Parts a "*_tuck" drape presses under the rug (folded shins, spare hem)
    // are meant to be hidden there; they are not resting on it.
    const tucks = Object.entries(m.morphTargetDictionary ?? {})
      .filter(([n, idx]) => n.endsWith('_tuck') && (m.morphTargetInfluences?.[idx] ?? 0) > 0.5)
      .map(([, idx]) => m.geometry.morphAttributes.position![idx]!)
    const tucked = (i: number) => tucks.some((a) => Math.abs(a.getX(i)) + Math.abs(a.getY(i)) + Math.abs(a.getZ(i)) > 1e-6)
    for (let i = 0; i < position!.count; i++) {
      if (tucked(i)) continue
      let b = 0
      for (let k = 1; k < 4; k++) if (skinWeight!.getComponent(i, k) > skinWeight!.getComponent(i, b)) b = k
      const key = part(m.skeleton.bones[skinIndex!.getComponent(i, b)]!)
      m.getVertexPosition(i, v)
      m.localToWorld(v)
      low[key] = Math.min(low[key] ?? Infinity, v.y)
    }
  })
  return low
}

describe('Performer', () => {
  it('the first ruku does not tip the legs (fixed blend start for every bone)', async () => {
    const { p, humanoid } = await performer()
    p.jumpTo('qiyam')
    p.setPosture('ruku')
    const lean: number[] = []
    for (let i = 0; i < 60; i++) {
      p.update(1 / 60)
      const hip = humanoid.raw.leftUpperLeg!.getWorldPosition(new THREE.Vector3())
      const knee = humanoid.raw.leftLowerLeg!.getWorldPosition(new THREE.Vector3())
      const t = hip.sub(knee)
      lean.push((Math.atan2(t.z, t.y) * 180) / Math.PI)
    }
    // The thighs move steadily from standing to the ruku lean. The old blend
    // swung them ~35° forwards and back on the first ruku.
    const first = lean[0]!, last = lean.at(-1)!
    const overshoot = Math.max(...lean.map((a) => Math.max(a - Math.max(first, last), Math.min(first, last) - a)))
    expect(overshoot).toBeLessThan(3)
  })

  it('the first and a later ruku move the same way', async () => {
    const { p, humanoid } = await performer()
    const trace = () => {
      const out: number[] = []
      for (let i = 0; i < 60; i++) {
        p.update(1 / 60)
        out.push(humanoid.raw.head!.getWorldPosition(new THREE.Vector3()).y)
      }
      return out
    }
    p.jumpTo('qiyam')
    p.setPosture('ruku')
    const first = trace()
    p.setPosture('itidal')
    run(p, 2)
    p.setPosture('qiyam')
    run(p, 2)
    p.setPosture('ruku')
    const later = trace()
    for (let i = 0; i < first.length; i++) expect(Math.abs(first[i]! - later[i]!)).toBeLessThan(0.01)
  })

  const RUG_TOP = MOUNT + 0.006
  // Into the plush is fine (it is 34 mm deep, cloth hems sink a little more); through it or hovering is not.
  const onRug = (y: number | undefined, part: string) => {
    expect(y, part).toBeGreaterThan(RUG_TOP - 0.02)
    expect(y, part).toBeLessThan(RUG_TOP + 0.012)
  }

  it.each(CHARACTERS)('%s: in sujud the forehead, palms and knees rest on the rug', async (c) => {
    const { p, humanoid } = await performer(`public/avatars/${c}.glb`)
    p.jumpTo('qiyam')
    for (const step of ['ruku', 'itidal', 'sujud'] as PoseName[]) {
      p.setPosture(step)
      run(p, 3)
    }
    const low = lowestByPart(humanoid)
    onRug(low.head, 'head')
    onRug(low.Hand, 'hands')
    // The knee touches through the robe, whose cloth there follows the thigh.
    onRug(Math.min(low.LowerLeg ?? Infinity, low.UpperLeg ?? Infinity), 'knees')
    // The seventh point of contact: toes bent on the rug, within 8 mm of its top.
    // (Maryam's abaya covers her feet completely: she has no toe geometry.)
    if (low.Toes !== undefined) {
      // Maryam's and Aisha's feet are covered by their robes: no visible toes to place.
      if (!['maryam', 'aisha'].includes(c)) {
        expect(low.Toes, 'toes').toBeGreaterThan(RUG_TOP - 0.008)
        expect(low.Toes, 'toes').toBeLessThan(RUG_TOP + 0.008)
      }
    }
  })

  it.each(CHARACTERS)('%s: nothing sinks through the rug in any posture', async (c) => {
    const { p, humanoid } = await performer(`public/avatars/${c}.glb`)
    for (const pose of ['qiyam', 'ruku', 'kneel', 'sujud', 'jalsah', 'tashahhud'] as PoseName[]) {
      p.jumpTo(pose)
      run(p, 0.5)
      const lowest = Math.min(...Object.values(lowestByPart(humanoid)))
      expect(lowest, pose).toBeGreaterThan(RUG_TOP - 0.02)
      expect(lowest, pose).toBeLessThan(RUG_TOP + 0.012)
    }
  })
})
