import { describe, expect, it } from 'vitest'
import { classifyPose } from './classify'
import { PoseStabilizer } from './stabilizer'
import type { Keypoint } from './types'

/**
 * Synthetic side-view skeletons (person facing right, image y down), built
 * from a few joint positions so the tests read like stick figures.
 */
function skeleton(j: { head: [number, number]; shoulder: [number, number]; hip: [number, number]; knee: [number, number]; ankle: [number, number]; wrist: [number, number] }): Keypoint[] {
  const k = (p: [number, number], dx = 0): Keypoint => ({ x: p[0] + dx, y: p[1] })
  return [
    k(j.head, 0.02), k(j.head, 0.01), k(j.head, 0.01), k(j.head), k(j.head),
    k(j.shoulder, 0.01), k(j.shoulder, -0.01), k(j.wrist), k(j.wrist), k(j.wrist), k(j.wrist),
    k(j.hip, 0.01), k(j.hip, -0.01), k(j.knee), k(j.knee), k(j.ankle), k(j.ankle),
  ]
}

const standing = skeleton({ head: [0.5, 0.15], shoulder: [0.5, 0.25], hip: [0.5, 0.5], knee: [0.5, 0.7], ankle: [0.5, 0.9], wrist: [0.52, 0.42] })
const handsUp = skeleton({ head: [0.5, 0.15], shoulder: [0.5, 0.25], hip: [0.5, 0.5], knee: [0.5, 0.7], ankle: [0.5, 0.9], wrist: [0.5, 0.14] })
const bowing = skeleton({ head: [0.78, 0.5], shoulder: [0.72, 0.5], hip: [0.48, 0.5], knee: [0.5, 0.7], ankle: [0.5, 0.9], wrist: [0.52, 0.68] })
const prostrating = skeleton({ head: [0.85, 0.88], shoulder: [0.75, 0.8], hip: [0.5, 0.65], knee: [0.55, 0.9], ankle: [0.3, 0.9], wrist: [0.8, 0.9] })
const sitting = skeleton({ head: [0.5, 0.45], shoulder: [0.5, 0.55], hip: [0.48, 0.8], knee: [0.7, 0.86], ankle: [0.42, 0.88], wrist: [0.62, 0.8] })

describe('classifyPose', () => {
  it.each([
    ['standing', standing],
    ['hands-raised', handsUp],
    ['bowing', bowing],
    ['prostrating', prostrating],
    ['sitting', sitting],
  ] as const)('recognises %s', (expected, kp) => {
    expect(classifyPose(kp).pose).toBe(expected)
  })

  it('recognises a bow seen head-on by torso foreshortening', () => {
    const frontBow = skeleton({ head: [0.5, 0.47], shoulder: [0.5, 0.42], hip: [0.5, 0.5], knee: [0.5, 0.7], ankle: [0.5, 0.9], wrist: [0.5, 0.66] })
    expect(classifyPose(frontBow, 0.25).pose).toBe('bowing')
  })
})

describe('PoseStabilizer', () => {
  it('ignores flicker and reports a held pose once', () => {
    const s = new PoseStabilizer(400, 800, 0.7)
    const out: (string | null)[] = []
    let t = 0
    const feed = (p: Parameters<typeof s.push>[0], frames: number) => {
      for (let i = 0; i < frames; i++) out.push(s.push(p, (t += 80)))
    }
    feed('standing', 10)
    feed('bowing', 1) // a single misread
    feed('standing', 5)
    feed('bowing', 16)
    expect(out.filter(Boolean)).toEqual(['standing', 'bowing'])
  })
})
