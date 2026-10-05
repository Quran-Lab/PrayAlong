/**
 * Companions the user can choose from: both are one figure, sameka's "MUSLIM PRAYER ISLAM SALAH"
 * (CC BY 4.0), faceless like the Quran Lab mascot with two hamzahs for eyes, each in their own
 * clothes, carrying their prayer postures with them (docs/characters.md).
 */
export const FIGURE = {
  title: 'MUSLIM PRAYER ISLAM SALAH',
  author: 'sameka',
  page: 'https://sketchfab.com/3d-models/muslim-prayer-islam-salah-eb0f80a7278243b4988b159fc957bbd5',
} as const

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
    credit: `${FIGURE.title} by ${FIGURE.author} (CC BY 4.0) · tools/characters/build_brother.py`,
    thumbnail: `${import.meta.env.BASE_URL}avatars/brother.avif`,
  },
  {
    id: 'sister',
    nameKey: 'companion.sister',
    url: avatarUrl('sister.glb'),
    credit: `${FIGURE.title} by ${FIGURE.author} (CC BY 4.0) · tools/characters/build_sister.py`,
    thumbnail: `${import.meta.env.BASE_URL}avatars/sister.avif`,
  },
]

/**
 * Colours for the companion's clothes (the gamis and sirwal, or the abaya and khimar). The fabric's
 * sheen and folds stay; only the colour changes. Black is the brief's.
 */
export const OUTFITS = [
  { id: 'black', color: '#1c1c1f' },
  { id: 'navy', color: '#1e2a42' },
  { id: 'grey', color: '#56585e' },
  { id: 'brown', color: '#4e3d31' },
  { id: 'olive', color: '#484c35' },
  { id: 'white', color: '#ebe8e1' },
] as const
export type Outfit = (typeof OUTFITS)[number]['id']
export const DEFAULT_OUTFIT: Outfit = 'black'
export const isOutfit = (v: unknown): v is Outfit => OUTFITS.some((o) => o.id === v)
export const outfitColor = (id: string) => (OUTFITS.find((o) => o.id === id) ?? OUTFITS[0]).color
/** Materials that take the outfit colour (tools/characters/build_*.py). */
export const GARMENT_MATERIALS = new Set(['Thobe', 'Sirwal', 'Abaya', 'Khimar'])

export const DEFAULT_CHARACTER = CHARACTERS[0]!
export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? DEFAULT_CHARACTER
