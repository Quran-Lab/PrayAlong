import { describe, expect, it } from 'vitest'
import { waypoints } from './prayer-poses'

const path = (from: Parameters<typeof waypoints>[0], to: Parameters<typeof waypoints>[1]) => waypoints(from, to).map((w) => w.pose)

describe('the companion raises the hands where the Sunnah does (al-Bukhari 735, 739)', () => {
  it('before bowing and when rising from it', () => {
    expect(path('qiyam', 'ruku')).toEqual(['takbir', 'ruku'])
    expect(path('ruku', 'itidal')).toEqual(['takbir', 'itidal'])
  })

  it('when standing up from the first tashahhud, but not from a prostration', () => {
    expect(path('tashahhud', 'qiyam')).toEqual(['kneel', 'takbir', 'qiyam'])
    expect(path('sujud', 'qiyam')).toEqual(['kneel', 'qiyam'])
  })

  it('goes straight between postures elsewhere', () => {
    expect(path('itidal', 'sujud')).toEqual(['kneel', 'sujud'])
    expect(path('sujud', 'jalsah')).toEqual(['jalsah'])
    expect(waypoints('ruku', 'itidal')[0]!.hold).toBeGreaterThan(0)
  })
})
