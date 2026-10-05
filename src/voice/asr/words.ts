// Word-by-word progress for the live highlight, as in Quran Lab Recite. A line's phoneme symbols are
// spread over its Arabic words by letter count; a word counts as heard once the symbols up to it are
// found in what the ASR heard. It only ever confirms: a word that wasn't heard is simply not lit.
import { ACCEPT, findBest } from './match'
import { targetFor } from './targets'

const MARKS = /[ً-ٰٟۖ-ۭـ]/g
const isPunct = (w: string) => /^[،,.؛۝]+$/.test(w)

export const arabicWords = (ar: string) => ar.split(/\s+/).filter(Boolean)

export const trackable = (lineId: string) => targetFor(lineId) !== null

/** How many of the line's Arabic words (from the start) were heard. */
export function wordsHeard(lineId: string, arabic: string, hyp: readonly string[]): number {
  const toks = targetFor(lineId)
  if (!toks || hyp.length < 2) return 0
  const words = arabicWords(arabic)
  const weights = words.map((w) => (isPunct(w) ? 0 : Math.max(1, w.replace(MARKS, '').length)))
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  const bounds = weights.map((w) => {
    acc += w
    return Math.round((acc / total) * toks.length)
  })
  for (let k = words.length - 1; k >= 0; k--) {
    if (weights[k] === 0) continue
    const hit = findBest(hyp, toks.slice(0, Math.max(3, bounds[k]!)))
    if (hit && hit.score <= ACCEPT) {
      let m = k + 1
      while (m < words.length && weights[m] === 0) m++
      return m
    }
  }
  return 0
}
