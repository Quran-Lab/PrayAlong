/**
 * The follower compares what the model hears with what the line says on a
 * reduced "skeleton" alphabet, not on raw tokens.
 *
 * The CTC model writes duration by repetition (a 4-count madd is four madd
 * letters, a geminate is two consonants) and splits it into tokens however its
 * vocabulary happens to. Neither carries information about WHERE in the prayer
 * someone is, and both vary between people (madd length, how long a
 * beginner holds a vowel). So: madd letters become their short vowel, the
 * nasalised/hidden variants become their base letter, qalqalah and sakt marks
 * go, and runs of the same symbol collapse to one.
 */

const MAP: Record<string, string> = {
  // madd letters -> the short vowel they lengthen
  'ا': 'َ', // alef -> fatha
  'ۥ': 'ُ', // small waw -> damma
  'ۦ': 'ِ', // small yeh -> kasra
  'ـ': 'َ', // tatweel (imala alef) -> fatha
  '۪': 'َ', // imala mark -> fatha
  // nasal / softened variants -> base letter
  'ں': 'ن', // noon ghunna -> noon
  '۾': 'م', // meem mukhfah -> meem
  'ٲ': 'ء', // hamza musahhala -> hamza
  'ؙ': 'ُ', // damma mukhtalasa -> damma
}
const DROP = new Set(['ڇ', 'ۜ', ' ', '‏']) // qalqalah, sakt, separators

export const VOWELS = new Set(['َ', 'ُ', 'ِ'])

/** One phonetic-script string -> skeleton symbols (no collapsing across calls). */
export function skeletonChars(text: string): string[] {
  const out: string[] = []
  for (const ch of text) {
    if (DROP.has(ch)) continue
    out.push(MAP[ch] ?? ch)
  }
  return out
}

/**
 * Pairs a non-native speaker (or the model) commonly swaps. Substituting one
 * for the other is cheap, so a heavy accent does not read as a different line.
 */
const CONFUSABLE: string[][] = [
  ['س', 'ص', 'ث', 'ز'], // s, emphatic s, th, z
  ['ت', 'ط'], // t, emphatic t
  ['د', 'ض', 'ذ', 'ظ', 'ز'], // d, emphatic d, dh, emphatic dh, z
  ['ه', 'ح', 'خ'], // h, pharyngeal h, kh
  ['ء', 'ع'], // hamza, ain
  ['ك', 'ق'], // k, q
  ['غ', 'ر', 'خ'], // gh, r, kh
  ['ن', 'م'], // n, m (assimilation, ikhfa)
  ['و', 'ُ'], // waw vs damma (diphthongs)
  ['ي', 'ِ'], // yeh vs kasra
]
const CONFUSE = new Map<string, Set<string>>()
for (const group of CONFUSABLE) {
  for (const a of group) {
    const set = CONFUSE.get(a) ?? new Set<string>()
    for (const b of group) if (b !== a) set.add(b)
    CONFUSE.set(a, set)
  }
}

export function subCost(a: string, b: string): number {
  if (a === b) return 0
  const va = VOWELS.has(a)
  const vb = VOWELS.has(b)
  if (va && vb) return 0.4
  if (CONFUSE.get(a)?.has(b)) return 0.45
  return va || vb ? 0.9 : 1
}

/** Cost of hearing a symbol the text does not have. */
export const insCost = (h: string) => (VOWELS.has(h) ? 0.45 : 0.9)
/** Cost of the text having a symbol nobody said (the model drops vowels a lot). */
export const delCost = (t: string) => (VOWELS.has(t) ? 0.35 : 0.85)

export interface SkeletonWord {
  /** Index into the skeleton of the first symbol of this word (after collapsing). */
  start: number
  /** Exclusive end. A word can be empty when collapsing merged it into its neighbour. */
  end: number
}

export interface LineSkeleton {
  symbols: string[]
  words: SkeletonWord[]
}

/** Phoneme words of one line -> one collapsed skeleton with word spans. */
export function lineSkeleton(words: readonly string[]): LineSkeleton {
  const symbols: string[] = []
  const spans: SkeletonWord[] = []
  for (const word of words) {
    const start = symbols.length
    for (const s of skeletonChars(word)) {
      if (symbols.length && symbols[symbols.length - 1] === s) continue
      symbols.push(s)
    }
    spans.push({ start, end: symbols.length })
  }
  return { symbols, words: spans }
}

/**
 * Streams decoder tokens into skeleton symbols, collapsing repeats across
 * token boundaries (a geminate is often split over two tokens).
 */
export class SymbolStream {
  private last = ''
  reset() {
    this.last = ''
  }
  push(tokens: readonly string[]): string[] {
    const out: string[] = []
    for (const token of tokens) {
      for (const s of skeletonChars(token)) {
        if (s === this.last) continue
        this.last = s
        out.push(s)
      }
    }
    return out
  }
}
