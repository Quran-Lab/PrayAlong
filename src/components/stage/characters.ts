/**
 * Companions the user can choose from. Any humanoid works: a VRM file, or a
 * GLB with a Mixamo-style skeleton in T- or A-pose (see docs/characters.md).
 * The two adults are faceless by design, like the Quran Lab mascots.
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
  /** i18n key for the name shown in the picker. */
  nameKey: 'companion.brother' | 'companion.sister'
  url: string
  /** Shown in the picker so artists get credit. */
  credit: string
  /** Square portrait for the picker. */
  thumbnail: string
}

export const CHARACTERS: readonly CharacterInfo[] = [
  {
    id: 'brother',
    nameKey: 'companion.brother',
    url: avatarUrl('brother.glb'),
    credit: 'PrayAlong · tools/characters/build_brother.py',
    thumbnail: `${import.meta.env.BASE_URL}avatars/brother.avif`,
  },
  {
    id: 'sister',
    nameKey: 'companion.sister',
    url: avatarUrl('sister.glb'),
    credit: 'PrayAlong · tools/characters/build_sister.py',
    thumbnail: `${import.meta.env.BASE_URL}avatars/sister.avif`,
  },
]

export const DEFAULT_CHARACTER = CHARACTERS[0]!
export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? DEFAULT_CHARACTER
