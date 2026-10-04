/**
 * Companions the user can choose from. Any humanoid works: a VRM file, or a
 * GLB with a Mixamo-style skeleton in T- or A-pose (see docs/characters.md).
 */
export interface CharacterInfo {
  id: string
  name: string
  url: string
  /** Shown in the picker so artists get credit. */
  credit: string
  /** Re-skin the asset with PrayAlong's soft clay look (for placeholders). */
  clay?: boolean
}

export const CHARACTERS: readonly CharacterInfo[] = [
  {
    id: 'mannequin',
    name: 'Studio',
    url: '/avatars/mannequin.glb',
    credit: 'X Bot · Mixamo',
    clay: true,
  },
]

export const DEFAULT_CHARACTER = CHARACTERS[0]!
