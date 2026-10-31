import { describe, expect, it } from 'vitest'
import { RepetitionBell } from './repetition-bell'

describe('RepetitionBell', () => {
  it('rings once per new repetition, brighter on the last', () => {
    const bell = new RepetitionBell()
    expect(bell.heard(5, 0, 3)).toBeNull()
    expect(bell.heard(5, 1, 3)).toBe('rep')
    expect(bell.heard(5, 1, 3)).toBeNull() // the same repetition reported again
    expect(bell.heard(5, 2, 3)).toBe('rep')
    expect(bell.heard(5, 3, 3)).toBe('last')
    expect(bell.heard(5, 4, 3)).toBeNull() // said a fourth time: still done
  })

  it('takes the highest count from any source without ringing twice', () => {
    const bell = new RepetitionBell()
    expect(bell.heard(5, 2, 3)).toBe('rep') // follower jumps ahead
    expect(bell.heard(5, 1, 3)).toBeNull() // bursts catch up later
    expect(bell.heard(5, 2, 3)).toBeNull()
  })

  it('stays quiet for lines said once', () => {
    expect(new RepetitionBell().heard(2, 1, 1)).toBeNull()
  })

  it('keeps steps apart, and rings again after going back', () => {
    const bell = new RepetitionBell()
    bell.heard(5, 3, 3)
    expect(bell.heard(9, 1, 3)).toBe('rep')
    bell.rewind(5)
    expect(bell.heard(5, 1, 3)).toBe('rep')
  })
})
