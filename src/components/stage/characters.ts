/**
 * Companions the user can choose from. Any humanoid works: a VRM file, or a
 * GLB with a Mixamo-style skeleton in T- or A-pose (see docs/characters.md).
 */
/**
 * Where a character file is served from. Hosts that don't serve .glb (a
 * claude.ai artifact) get a base64 text copy instead — see
 * scripts/build-artifact.mjs.
 */
export const avatarUrl = (file: string) =>
  `${import.meta.env.BASE_URL}avatars/${file}${import.meta.env.VITE_PACKED_ASSETS ? '.b64.txt' : ''}`

export interface CharacterInfo {
  id: string
  name: string
  url: string
  /** Shown in the picker so artists get credit. */
  credit: string
  /** Re-skin the asset with PrayAlong's soft clay look (for placeholders). */
  clay?: boolean
  /** Square portrait for the picker. */
  thumbnail?: string
}

export const CHARACTERS: readonly CharacterInfo[] = [
  {
    id: 'mannequin',
    name: 'Studio',
    url: avatarUrl('mannequin.glb'),
    credit: 'X Bot · Mixamo',
    clay: true,
  },
]

export const DEFAULT_CHARACTER = CHARACTERS[0]!
