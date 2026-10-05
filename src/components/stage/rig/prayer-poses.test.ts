import { describe, expect, it } from 'vitest'
import { waypoints } from './prayer-poses'

const path = (from: Parameters<typeof waypoints>[0], to: Parameters<typeof waypoints>[1]) => waypoints(from, to).map((w) => w.pose)

describe('the companion moves between postures as the Sunnah does', () => {
  it('raises the hands before bowing and when rising from it (al-Bukhari 735)', () => {
    expect(path('qiyam', 'ruku')).toEqual(['takbir', 'ruku'])
    expect(path('ruku', 'itidal')).toEqual(['takbir', 'itidal'])
    expect(waypoints('ruku', 'itidal')[0]!.hold).toBeGreaterThan(0)
  })

  it('puts the hands down before the knees (Abu Dawud 840)', () => {
    expect(path('itidal', 'sujud')).toEqual(['descend', 'sujud'])
  })

  it('sits for a moment before standing up from a prostration, then rises on the fists (al-Bukhari 823)', () => {
    expect(path('sujud', 'qiyam')).toEqual(['jalsah', 'rise', 'qiyam'])
  })

  it('raises the hands again when standing up from the first tashahhud (al-Bukhari 739)', () => {
    expect(path('tashahhud', 'qiyam')).toEqual(['rise', 'takbir', 'qiyam'])
  })

  it('goes straight between the postures on the floor', () => {
    expect(path('sujud', 'jalsah')).toEqual(['jalsah'])
    expect(path('jalsah', 'sujud')).toEqual(['sujud'])
    expect(path('tawarruk', 'salam-right')).toEqual(['salam-right'])
  })
})
