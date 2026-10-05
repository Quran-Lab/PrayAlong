# PrayAlong design system

PrayAlong is a Quran Lab app, and its design system is a sibling of Quran Lab's
(`quranlab-web/DESIGN.md`). Read that first. This page lists only what PrayAlong does
differently, and why.

## Kept from Quran Lab

- **Paper and ink.** The same warm neutrals, light and dark. Pure white only on raised layers.
- **Type.** Plus Jakarta Sans for the interface, Noto Kufi Arabic for Arabic interface text,
  KFGQPC Uthman Taha Naskh for the Quran and every recited line (regular, never styled).
- **Space, the six radii and elevation**, and the "never" rules: no glows, gradients, pulsing,
  lifting on hover, tracked uppercase or pill-shaped everything.
- **Verdict colours stay verdicts.** Green, amber and red never decorate, so no brand palette is
  green, amber or red.

## What differs

| | Quran Lab | PrayAlong | Why |
| --- | --- | --- | --- |
| Brand ink | Indigo | **Plum** by default; the learner can pick Indigo, Teal or Graphite | Its own colour in the same family. Plum is the sky after Maghrib, and the colour of many prayer mats. |
| Mark | Five rounded bars (a voice) | **A crescent** with tips as round as the bars | The moon times the prayers. It is the same moon as on the rug. |
| Imagery | No photographs; dither and halftone in indigo | **Nature photographs** behind the 3D stage, one per prayer time, with no people | The companion needs a place to pray. |
| Figures | Dithered faceless reciters | **3D faceless companions** (brother, sister) | They demonstrate movements. Still faceless. |
| Type scale | Product scale | Adds **distance tokens** (`--d-*`) | Read from the prayer mat, two to seven steps from a laptop. |
| Verdicts | Correct, khafi, jali | **Correct** marks words heard; **khafi** is used for notices only; **jali is never used** | PrayAlong never corrects anyone. |
| Motion | Still UI; only live audio moves | **Motion explains change**: slides, crossfades, indicators that glide (see below) | A prayer is a sequence; motion shows where the learner is in it. |

## Motion

Things move only when something changes, and the motion says what changed. Nothing loops, pulses
or decorates, and `prefers-reduced-motion` turns all of it off (`app.css`).

| What | Motion | Where |
| --- | --- | --- |
| Next or previous line | The cards slide one card-width along the track (520 ms, `cubic-bezier(0.32, 0.72, 0, 1)`) | `Recitation.svelte` |
| A jump (from the dock) | The whole set is pushed the way the prayer went: old out one side, new in from the other, together, so cards never stack | `Recitation.svelte` (`push`) |
| Ready → praying → complete | The old panel fades out, the new one rises in; panel parts arrive one beat apart (60 ms) | `App.svelte`, `Panels.svelte` |
| Current movement in the dock | One highlight glides to it; the current rak'ah's bar widens | `PostureDock.svelte` |
| Segmented controls, switches | A thumb slides to the choice; switches settle with a slight overshoot | `ui/Segmented.svelte`, `ui/Switch.svelte` |
| Sheets | Up from the bottom on phones, in from the side from 720 px; they slide away when closed | `ui/Sheet.svelte` |
| Theme, colour, language | The page crossfades (View Transitions, 360 ms) | `App.svelte` |
| Status chips, words heard | Chips settle in; heard words take the "correct" colour over 320 ms | `Recitation.svelte` |
| After the prayer | The last card shows the remembrance in two columns; on phones the photograph steps back so the card has room (520 ms); the line being recited as an example takes the brand ink | `App.svelte`, `Panels.svelte` |

Hover is a fill change only (Quran Lab's rule); the arrow on the start screen's choices steps 3 px
toward where it leads.

## Palettes

The brand tokens (`--brand`, `--brand-hover`, `--brand-pressed`, `--on-brand`, `--brand-tint`,
`--focus`, `--state-reading`, `--photo-accent`) are built from one scale, `--p-50` to `--p-950`.
`<html data-palette="…">` picks the scale.

Each colourful scale reuses indigo's lightness and chroma (OKLCH) step by step, with the hue
turned. Because of that, every pairing keeps Quran Lab's contrast.

| Palette | Light brand (700) | Dark brand (300) | 700 on paper | White on 700 | 300 on dark paper | Note |
| --- | --- | --- | --- | --- | --- | --- |
| Plum | `#662371` | `#d492d0` | 9.8:1 | 10.3:1 | 7.9:1 | PrayAlong's own, the default. Hue 322°. |
| Indigo | `#2a3b8f` | `#9aa6f4` | 9.4:1 | 9.9:1 | 8.2:1 | Quran Lab's, unchanged. Hue 270°. |
| Teal | `#034e5f` | `#50bbe4` | 8.8:1 | 9.3:1 | 8.5:1 | Hue 220°. The closest to "heard" green, so it is a choice and not the default. |
| Graphite | `#2b2a27` | `#d6d2ca` | 13.6:1 | 14.4:1 | 12.4:1 | No colour: the brand is ink. |

Rules:

- Components use the semantic tokens. Only the palette picker's swatches read `--p-*` directly.
- `app.css` is the only place the colours are written. `src/lib/brand.ts` reads a scale back
  through a hidden probe element, so the rug and the favicon always match the CSS.
- To add a palette:
  1. Add a `[data-palette]` block to `app.css`, reusing indigo's lightness and chroma.
  2. Add its name to `PALETTES` in `brand.ts`.
  3. Add a `palette.<name>` string to `en.ts`.
  4. Check the four contrasts above.

  Never use green, amber or red hues.
- The 3D rug is woven in the palette: field 700, border 800, arch 600, crescent 200, dots 300,
  edge 900, with paper for the trim.

## The mark

The mark is a crescent: a circle, less a circle 0.86 its size moved right by 0.42 and up by 0.22
of the radius. This is the same moon that `rug-texture.ts` paints on the rug. Each tip is rounded
by a circle that touches both edges, so the mark shares the rounded ends of the Quran Lab bars.

- `tools/brand/crescent.py` writes the path as four arcs: `CRESCENT` and `CRESCENT_BOX` in
  `src/lib/brand.ts`.
- **In the header** it is set in ink, monochrome, beside the word "PrayAlong" (`Mark.svelte`).
- **As the app icon** it is a paper crescent on a 700 tile. `public/favicon.svg` is the Plum
  icon. At runtime the favicon follows the chosen palette.
- Never add a star, an outline or a gradient to it. It is not an icon for dark mode: Appearance
  uses words, not a moon.
- The brother's thobe carries the Quran Lab bars on the chest, as the maker's label.
- No stars, on the mark or anywhere: the rug carries the crescent alone.

## Files

| File | What |
| --- | --- |
| `src/app.css` | Tokens: the palettes, then light and dark. |
| `src/lib/brand.ts` | Palette names, the crescent path, `paletteScale`, `applyPalette` (tokens and favicon). |
| `src/components/Mark.svelte` | The mark. |
| `src/components/SettingsSheet.svelte` | Palette picker, under Appearance. |
| `src/components/stage/rug-texture.ts`, `rug.ts` | The rug in the palette; `recolor` reweaves it. |
| `tools/brand/crescent.py` | Makes the crescent path. |
