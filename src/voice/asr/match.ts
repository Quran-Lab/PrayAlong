// Phoneme matching for prayer recitation. Input: symbol tokens from the Zipformer CTC (the Quran Lab
// alphabet of 250 symbols). Targets: phoneme strings split greedily, longest symbol first, into the
// same alphabet. Semi-global alignment: the pattern may sit anywhere in the hypothesis.
import SYMBOLS from './symbols.json'

const SET = new Set<string>(SYMBOLS as string[])
const MAXLEN = Math.max(...(SYMBOLS as string[]).map((s) => s.length))

/** Split a phoneme string into model symbols (greedy, longest first). */
export function tokenize(ph: string): string[] {
  const out: string[] = []
  let i = 0
  while (i < ph.length) {
    let n = Math.min(MAXLEN, ph.length - i)
    while (n > 0 && !SET.has(ph.slice(i, i + n))) n--
    if (n === 0) {
      i++ // a space or a character outside the alphabet
      continue
    }
    out.push(ph.slice(i, i + n))
    i += n
  }
  return out
}

// Same base letter with a different vowel or length counts half: the ASR wavers on harakat.
const base = (s: string) => s[0]
const sub = (a: string, b: string) => (a === b ? 0 : base(a) === base(b) ? 0.5 : 1)
const INS = 0.7 // an extra token in the hypothesis
const DEL = 1 // a pattern token that wasn't heard

export interface Hit {
  start: number
  end: number
  score: number
}

/** The best occurrence of `pat` in `hyp[from..]`; score = cost / pattern length (0 = exact). */
export function findBest(hyp: readonly string[], pat: readonly string[], from = 0): Hit | null {
  const m = pat.length
  const n = hyp.length - from
  if (m === 0 || n <= 0) return null
  let prev = new Float64Array(n + 1)
  let cur = new Float64Array(n + 1)
  let prevS = new Int32Array(n + 1)
  let curS = new Int32Array(n + 1)
  for (let j = 0; j <= n; j++) {
    prev[j] = 0
    prevS[j] = j
  }
  for (let i = 1; i <= m; i++) {
    cur[0] = i * DEL
    curS[0] = 0
    for (let j = 1; j <= n; j++) {
      const d = prev[j - 1]! + sub(pat[i - 1]!, hyp[from + j - 1]!)
      const up = prev[j]! + DEL
      const left = cur[j - 1]! + INS
      if (d <= up && d <= left) {
        cur[j] = d
        curS[j] = prevS[j - 1]!
      } else if (up <= left) {
        cur[j] = up
        curS[j] = prevS[j]!
      } else {
        cur[j] = left
        curS[j] = curS[j - 1]!
      }
    }
    ;[prev, cur] = [cur, prev]
    ;[prevS, curS] = [curS, prevS]
  }
  let bj = 1
  for (let j = 1; j <= n; j++) if (prev[j]! < prev[bj]!) bj = j
  return { start: from + prevS[bj]!, end: from + bj, score: prev[bj]! / m }
}

export const ACCEPT = 0.36
