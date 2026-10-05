import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PRAYERS } from '@/content/prayers'
import { buildSequence } from '@/sequence/build'
import { exampleOf } from './voice.svelte'

describe('examples for "Watch it first"', () => {
  const lines = new Set(PRAYERS.flatMap((p) => buildSequence(p.id).steps.map((s) => s.recitationId)))

  it('every line of every prayer has one, except āmīn', () => {
    expect([...lines].filter((id) => !exampleOf(id))).toEqual(['amin'])
  })

  it('every example is a clip in public/audio, and so is the remembrance after the prayer', () => {
    for (const id of [...lines, 'istighfar', 'antas-salam']) {
      const by = exampleOf(id)
      if (by) expect(existsSync(`public/audio/${by === 'qari' ? 'tunaiji' : 'dhikr'}/${id}.m4a`), id).toBe(true)
    }
  })
})
