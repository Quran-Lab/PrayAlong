// PrayAlong's brand: the crescent mark and the colour palettes. The palettes' colours live in
// app.css only (`--p-50` … `--p-950` per `[data-palette]`); code reads them back from there.
// See docs/DESIGN.md.

/** Plum is PrayAlong's own; Indigo is Quran Lab's; Teal and Graphite are for those who prefer them. */
export const PALETTES = ['plum', 'indigo', 'teal', 'graphite'] as const
export type Palette = (typeof PALETTES)[number]
export const DEFAULT_PALETTE: Palette = 'plum'
export const isPalette = (v: unknown): v is Palette => PALETTES.includes(v as Palette)

/**
 * The mark: a crescent with rounded tips, in a 48 × 48 box. The same moon as on the rug (a circle
 * less one 0.86 its size, moved up and to the right), with tips as round as the Quran Lab bars.
 * Made by tools/brand/crescent.py.
 */
export const CRESCENT =
  'M39.70 41.36A22 22 0 1 1 19.47 2.73A2.2 2.2 0 0 1 21.89 6.23A18.92 18.92 0 0 0 38.20 37.38A2.2 2.2 0 0 1 39.70 41.36Z'
/** The crescent's own bounds inside the 48 box, for setting it beside text. */
export const CRESCENT_BOX = { x: 5, y: 2.6, w: 35.63, h: 42.8 }

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const
export type Scale = Record<(typeof STEPS)[number], string>

/** A palette's scale, read from app.css through a hidden probe (whatever the page's palette). */
export function paletteScale(palette: Palette): Scale {
  const probe = document.createElement('i')
  probe.dataset.palette = palette
  probe.hidden = true
  document.body.append(probe)
  const css = getComputedStyle(probe)
  const scale = Object.fromEntries(STEPS.map((n) => [n, css.getPropertyValue(`--p-${n}`).trim()])) as Scale
  probe.remove()
  return scale
}

/** The app icon: a paper crescent on a rounded tile. */
export function iconSvg(tile: string, ink = '#faf9f6') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 64 64"><rect x="-8" y="-8" width="64" height="64" rx="14" fill="${tile}"/><path d="${CRESCENT}" fill="${ink}"/></svg>`
}

/** Use a palette on the page: the colour tokens, and the favicon to match. */
export function applyPalette(palette: Palette) {
  document.documentElement.dataset.palette = palette
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon) icon.href = `data:image/svg+xml,${encodeURIComponent(iconSvg(paletteScale(palette)[700]))}`
}
