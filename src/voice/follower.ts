import phonemeTable from '@/content/phonemes.json'
import { delCost, insCost, lineSkeleton, subCost, SymbolStream, VOWELS, type LineSkeleton } from './phonetic'
import type { FollowerEvent, FollowStep, KeywordKind } from './types'

/**
 * Constrained voice follower.
 *
 * It never searches the Quran (or even the whole prayer): it aligns what the
 * model hears against the line the session is on and the next few lines only,
 * so an accent, a mumble or a noise can at worst look like "this line" or "the
 * next one", never like something three minutes away.
 *
 * Two independent listeners share one symbol stream:
 *
 *  - The line tracker: an edit-distance alignment of everything heard since the
 *    anchor line started against [anchor line x repeat, next line, ...], with
 *    two extra moves so real recitation does not read as errors: SKIP a whole
 *    line (forgot it, or said a tasbih once instead of three times) and
 *    RESTART the current line (hesitation, false start, an extra repetition).
 *    The cheapest alignment's end column is where the person is now.
 *  - The keyword spotter: approximate substring matching of the movement
 *    phrases (Allahu akbar, sami'a Allahu liman hamidah, as-salamu alaykum wa
 *    rahmatullah, amin) anywhere in the stream. Whether a keyword may move the
 *    session is the driver's decision, not the spotter's.
 *
 * Every event is monotonic: progress is never reported backwards, and each line
 * completes at most once per evaluation, so a misheard burst can move the
 * session by one line, not several.
 */

const LINES = (phonemeTable as { lines: Record<string, { words: string[] }> }).lines
const SKELETONS = new Map<string, LineSkeleton>()
export function skeletonOf(lineId: string): LineSkeleton | null {
  let sk = SKELETONS.get(lineId)
  if (!sk) {
    const entry = LINES[lineId]
    if (!entry) return null
    sk = lineSkeleton(entry.words)
    SKELETONS.set(lineId, sk)
  }
  return sk
}

export const KEYWORD_LINES: Record<KeywordKind, string> = {
  takbir: 'takbir',
  tasmi: 'tasmi',
  salam: 'salam',
  amin: 'amin',
}

export interface FollowerOptions {
  /** How many steps (from the anchor) the tracker may align against. */
  windowSteps: number
  /** Cost of skipping a whole line nobody said. */
  skipCost: number
  /** Cost of skipping a remaining repetition (tasbih said once, not three times). */
  repSkipCost: number
  /** Cost of starting the current line again. */
  restartCost: number
  /** Insertion cost while between lines (pauses, coughs, a takbir), per symbol. */
  gapInsCost: number
  /** Minimum share of a line's symbols that must match for it to count as said. */
  lineMatch: { aloud: number; quiet: number }
  /** Minimum share of a word's symbols that must match to report it on its own. */
  wordMatch: number
  /** Matched symbols needed inside a later line before the earlier one counts as finished. */
  enterSymbols: number
  /** Keyword thresholds: max alignment cost per keyword symbol. */
  keywordCost: Record<KeywordKind, number>
  /** Longest heard history kept (symbols) before the tracker re-anchors itself. */
  maxHeard: number
  /** Seconds without new symbols before a partly heard last word finishes its line. */
  idleSec: number
  /** Share of the last word that must have been heard for that. */
  idleLastWord: number
  /** Unexplained symbols (no word reported) before looking further ahead. */
  lostSymbols: number
  lostWindowSteps: number
  lostSkipCost: number
}

export const DEFAULT_FOLLOWER: FollowerOptions = {
  windowSteps: 4,
  skipCost: 5,
  repSkipCost: 0.8,
  restartCost: 2.5,
  gapInsCost: 0.5,
  lineMatch: { aloud: 0.5, quiet: 0.35 },
  wordMatch: 0.34,
  enterSymbols: 4,
  keywordCost: { takbir: 0.24, tasmi: 0.26, salam: 0.22, amin: 0.12 },
  maxHeard: 500,
  idleSec: 1.0,
  idleLastWord: 0.3,
  lostSymbols: 35,
  lostWindowSteps: 12,
  lostSkipCost: 2,
}

interface Unit {
  step: number
  rep: number
  lineId: string
  lastRep: boolean
  voice: 'aloud' | 'quiet'
  start: number
  end: number
  /** Absolute [start, end) per word. */
  words: { start: number; end: number }[]
}

interface Heard {
  s: string
  at: number
  /** Running symbol number (survives trimming of the history). */
  n: number
}

interface Spotted {
  kind: KeywordKind
  confidence: number
  startN: number
  endN: number
}

const OP_DIAG = 1
const OP_INS = 2
const OP_DEL = 3
const OP_SKIP = 4
const OP_RESTART = 5

interface Alignment {
  end: number
  cost: number
  /** Column each heard symbol was consumed at (index = heard index). */
  rowCol: Int32Array
  /** Whether each heard symbol was matched (diag with a low substitution cost). */
  rowMatch: Uint8Array
  /** Per column: was it matched by some heard symbol on the best path. */
  colMatch: Uint8Array
}

export interface FollowerSnapshot {
  anchor: number
  /** Step, repetition and word the person is on now (the word in progress). */
  step: number
  wordIndex: number
  rep: number
  /**
   * How far through `wordIndex` (0..1), in phoneme positions of the aligned
   * skeleton: the finest unit the model gives. 1 on the last word of a line
   * means the line has been said to its end.
   */
  fill: number
  heard: number
  cost: number
}

export class Follower {
  readonly opts: FollowerOptions
  private steps: FollowStep[] = []
  private anchor = 0
  private units: Unit[] = []
  private T: string[] = []
  private boundary = new Uint8Array(1)
  private heard: Heard[] = []
  private count = 0
  private lost = false
  /** Symbol count at the last word reported (or anchor move). */
  private progressN = 0
  private idleDoneFor = -1
  private stream = new SymbolStream()
  private spotter: KeywordSpotter
  /** Last word reported, as step*1e6 + rep*1e3 + word: reports only ever increase. */
  private wordMark = -1
  private lastDone = -1
  private started = new Set<number>()
  private last: Alignment | null = null
  private lastSnapshot: FollowerSnapshot = { anchor: 0, step: 0, wordIndex: 0, rep: 0, fill: 0, heard: 0, cost: 0 }

  constructor(steps: FollowStep[] = [], opts: Partial<FollowerOptions> = {}) {
    this.opts = { ...DEFAULT_FOLLOWER, ...opts, keywordCost: { ...DEFAULT_FOLLOWER.keywordCost, ...opts.keywordCost } }
    this.spotter = new KeywordSpotter(this.opts.keywordCost)
    this.setSteps(steps)
  }

  setSteps(steps: FollowStep[], anchor = 0) {
    this.steps = steps
    this.heard = []
    this.reanchor(anchor)
  }

  /**
   * The session is now on `index`. When that is the line right after the one
   * this follower just finished, what was heard of it is kept (the person is
   * already saying it); any other move (a timer, the camera, a tap) re-anchors
   * and keeps only the last second of audio.
   */
  setAnchor(index: number) {
    if (index === this.anchor) return
    // Moving onto a line this follower has already finished the one before of
    // (possibly catching up over several): keep what was heard after it.
    if (index > this.anchor && index <= this.lastDone + 1 && this.last) {
      const keepFrom = this.exitRow(this.last, index - 1)
      this.heard = this.heard.slice(keepFrom)
      this.reanchor(index, true)
      return
    }
    // Keep a little of what was just heard (the person may already be on the
    // new line), but nothing the last alignment already credited to an earlier
    // line: the tail of the previous line must not complete the new one.
    let keepFrom = 0
    if (this.last) {
      for (let i = 0; i < this.last.rowCol.length && i < this.heard.length; i++) {
        if (!this.last.rowMatch[i]) continue
        const col = this.last.rowCol[i]!
        const unit = this.units.find((u) => col > u.start && col <= u.end)
        if (unit && unit.step < index) keepFrom = i + 1
      }
    }
    const lastAt = this.heard.at(-1)?.at ?? 0
    this.heard = this.heard.slice(keepFrom).filter((h) => h.at >= lastAt - 1)
    this.reanchor(index)
  }

  /**
   * Audio time `at` with no new symbols for a while: re-run the rules that
   * need silence (a line whose last word was only partly heard is finished
   * once the person has stopped).
   */
  idle(at: number, speech = false): FollowerEvent[] {
    const lastAt = this.heard.at(-1)?.at
    if (lastAt === undefined || this.idleDoneFor === this.count) return []
    // Energy says silence, or (noise keeps the energy gate open) the decoder
    // has been quiet for twice as long.
    const quietFor = at - lastAt
    if (quietFor < (speech ? 2 : 1) * this.opts.idleSec) return []
    this.idleDoneFor = this.count
    return this.evaluate(at, true)
  }

  /** A decoder segment ended (real silence): do not collapse across it. */
  segmentEnd() {
    this.stream.reset()
  }

  /** Newly emitted decoder tokens, at audio time `at` (seconds). */
  push(tokens: readonly string[], at: number): FollowerEvent[] {
    const symbols = this.stream.push(tokens)
    if (!symbols.length) return []
    const spotted: Spotted[] = []
    for (const s of symbols) {
      const n = this.count++
      this.heard.push({ s, at, n })
      const kw = this.spotter.push(s, n)
      if (kw) spotted.push(kw)
    }
    if (!this.lost && this.count - this.progressN > this.opts.lostSymbols) this.enterLost()
    if (this.heard.length > this.opts.maxHeard) {
      // Lost: re-anchor where the alignment last put us.
      const here = this.lastSnapshot.step
      this.heard = this.heard.slice(-60)
      this.reanchor(Math.max(here, this.anchor))
    }
    const events = this.evaluate(at)
    // A keyword only counts when the expected lines do not already explain
    // those sounds: "Allahumma barik" is phonetically close to "Allahu akbar",
    // but while the person is on that salawat line the tracker has matched it.
    const keywordEvents: FollowerEvent[] = []
    for (const kw of spotted) {
      if (this.explainedElsewhere(kw)) continue
      const first = this.heard.find((h) => h.n >= kw.startN)
      keywordEvents.push({ kind: kw.kind, confidence: kw.confidence, at, start: first?.at ?? at })
    }
    return [...keywordEvents, ...events]
  }

  /** Share of the keyword's symbols matched by the tracker to a different line. */
  private explainedElsewhere(kw: Spotted): boolean {
    const al = this.last
    if (!al) return false
    const line = KEYWORD_LINES[kw.kind]
    let total = 0
    let other = 0
    for (let i = 0; i < this.heard.length; i++) {
      const h = this.heard[i]!
      if (h.n < kw.startN || h.n > kw.endN) continue
      total++
      if (!al.rowMatch[i]) continue
      const col = al.rowCol[i]!
      const unit = this.units.find((u) => col > u.start && col <= u.end)
      if (unit && unit.lineId !== line) other++
    }
    return total > 0 && other / total >= 0.6
  }

  /** Re-run the decision rules without new audio (e.g. after a pause). */
  flush(at: number): FollowerEvent[] {
    return this.heard.length ? this.evaluate(at) : []
  }

  snapshot(): FollowerSnapshot {
    return this.lastSnapshot
  }

  /** Units in the current window, for the lab view. */
  window(): readonly { step: number; rep: number; lineId: string }[] {
    return this.units
  }

  /** `keep`: the move continues this follower's own progress (keep word and start marks). */
  private reanchor(index: number, keep = false) {
    this.anchor = Math.max(0, index)
    this.lastDone = keep ? Math.max(this.lastDone, this.anchor - 1) : this.anchor - 1
    // Still catching up (the voice is well past the new anchor): stay wide.
    if (!keep || this.lastSnapshot.step < this.anchor + 2) this.lost = false
    if (!keep) {
      this.wordMark = this.anchor * 1e6 - 1
      this.started = new Set([...this.started].filter((s) => s < this.anchor))
    }
    this.progressN = this.count
    this.buildWindow()
  }

  /**
   * Lost: the person has said a good deal that none of the window's lines
   * explain (listening started late, or the session fell behind). Look
   * further ahead, still only along the prayer, with cheaper skips.
   */
  private enterLost() {
    this.lost = true
    this.heard = this.heard.slice(-60)
    this.buildWindow()
  }

  private buildWindow() {
    this.last = null
    this.units = []
    this.T = []
    const bounds: number[] = [0]
    const span = this.lost ? this.opts.lostWindowSteps : this.opts.windowSteps
    for (let step = this.anchor; step < Math.min(this.steps.length, this.anchor + span); step++) {
      const info = this.steps[step]!
      const sk = skeletonOf(info.lineId)
      if (!sk || !sk.symbols.length) continue
      const reps = Math.max(1, info.repeat)
      for (let rep = 0; rep < reps; rep++) {
        const start = this.T.length
        this.T.push(...sk.symbols)
        this.units.push({
          step,
          rep,
          lineId: info.lineId,
          lastRep: rep === reps - 1,
          voice: info.voice,
          start,
          end: this.T.length,
          words: sk.words.map((w) => ({ start: start + w.start, end: start + w.end })),
        })
        bounds.push(this.T.length)
      }
    }
    this.boundary = new Uint8Array(this.T.length + 1)
    for (const b of bounds) this.boundary[b] = 1
    this.lastSnapshot = { anchor: this.anchor, step: this.anchor, wordIndex: 0, rep: 0, fill: 0, heard: this.heard.length, cost: 0 }
  }

  /** First heard index that belongs after step `step` on the given alignment. */
  private exitRow(al: Alignment, step: number): number {
    const lastUnit = [...this.units].reverse().find((u) => u.step === step)
    if (!lastUnit) return 0
    let row = 0
    for (let i = 0; i < al.rowCol.length; i++) {
      const c = al.rowCol[i]!
      if (c < lastUnit.end || (c === lastUnit.end && al.rowMatch[i])) row = i + 1
    }
    return row
  }

  private align(): Alignment | null {
    const H = this.heard
    const T = this.T
    const n = H.length
    const M = T.length
    if (!n || !M) return null
    const W = M + 1
    const D = new Float32Array((n + 1) * W)
    const op = new Uint8Array((n + 1) * W)
    const src = new Int32Array((n + 1) * W)
    const { gapInsCost } = this.opts

    // Row 0: nothing heard yet; reaching column j means deleting T[0..j).
    for (let j = 1; j <= M; j++) {
      D[j] = D[j - 1]! + delCost(T[j - 1]!)
      op[j] = OP_DEL
    }
    this.jumps(D, op, src, 0, W)

    for (let i = 1; i <= n; i++) {
      const h = H[i - 1]!.s
      const base = i * W
      const prev = base - W
      const hIns = insCost(h)
      const gIns = VOWELS.has(h) ? Math.min(hIns, gapInsCost * 0.6) : gapInsCost
      for (let j = 0; j <= M; j++) {
        let best = D[prev + j]! + (this.boundary[j] ? gIns : hIns)
        let o = OP_INS
        if (j > 0) {
          const t = T[j - 1]!
          const diag = D[prev + j - 1]! + subCost(h, t)
          if (diag < best) {
            best = diag
            o = OP_DIAG
          }
          const del = D[base + j - 1]! + delCost(t)
          if (del < best) {
            best = del
            o = OP_DEL
          }
        }
        D[base + j] = best
        op[base + j] = o
      }
      this.jumps(D, op, src, i, W)
    }

    // Where the person is now: the cheapest end column. Ties go to the earlier
    // column, so silence after a word never reads as progress.
    const last = n * W
    let end = 0
    for (let j = 1; j <= M; j++) if (D[last + j]! < D[last + end]! - 1e-6) end = j

    // Backtrace.
    const rowCol = new Int32Array(n)
    const rowMatch = new Uint8Array(n)
    const colMatch = new Uint8Array(W)
    let i = n
    let j = end
    let guard = (n + 1) * (W + 2) * 2
    while ((i > 0 || j > 0) && guard-- > 0) {
      const k = i * W + j
      const o = op[k]!
      if (o === OP_DIAG) {
        rowCol[i - 1] = j
        if (isMatch(H[i - 1]!.s, T[j - 1]!)) {
          rowMatch[i - 1] = 1
          colMatch[j] = 1
        }
        i--
        j--
      } else if (o === OP_INS) {
        rowCol[i - 1] = j
        i--
      } else if (o === OP_DEL) {
        j--
      } else if (o === OP_SKIP || o === OP_RESTART) {
        j = src[k]!
      } else {
        break
      }
    }
    return { end, cost: D[last + end]!, rowCol, rowMatch, colMatch }
  }

  /** Skip and restart moves, applied to row i after the ordinary DP. */
  private jumps(D: Float32Array, op: Uint8Array, src: Int32Array, i: number, W: number) {
    const base = i * W
    const { skipCost, repSkipCost, restartCost } = this.opts
    // Restart: from anywhere inside a unit (or its end) back to its start.
    for (const u of this.units) {
      let bestJ = -1
      let bestV = Infinity
      for (let j = u.start + 1; j <= u.end; j++) {
        if (D[base + j]! < bestV) {
          bestV = D[base + j]!
          bestJ = j
        }
      }
      if (bestJ >= 0 && bestV + restartCost < D[base + u.start]!) {
        D[base + u.start] = bestV + restartCost
        op[base + u.start] = OP_RESTART
        src[base + u.start] = bestJ
      }
    }
    // Skip whole units, left to right so several can be skipped in a row.
    for (const u of this.units) {
      const cost = u.rep > 0 ? repSkipCost : this.lost ? this.opts.lostSkipCost : skipCost
      const v = D[base + u.start]! + cost
      if (v < D[base + u.end]!) {
        D[base + u.end] = v
        op[base + u.end] = OP_SKIP
        src[base + u.end] = u.start
        // Re-propagate deletions into the next unit from the new boundary value.
        for (let j = u.end + 1; j <= this.T.length; j++) {
          const d = D[base + j - 1]! + delCost(this.T[j - 1]!)
          if (d >= D[base + j]!) break
          D[base + j] = d
          op[base + j] = OP_DEL
          if (this.boundary[j]) break
        }
      }
    }
  }

  private evaluate(at: number, idle = false): FollowerEvent[] {
    const al = this.align()
    if (!al) return []
    this.last = al
    const events: FollowerEvent[] = []
    const units = this.units

    // Per-unit and per-word match statistics on the best path.
    const unitMatched = units.map((u) => {
      let m = 0
      for (let c = u.start + 1; c <= u.end; c++) m += al.colMatch[c]!
      return m
    })
    const wordFrac = (w: { start: number; end: number }) => {
      if (w.end <= w.start) return 1
      let m = 0
      for (let c = w.start + 1; c <= w.end; c++) m += al.colMatch[c]!
      return m / (w.end - w.start)
    }

    // Unit and word the cursor is in.
    let cur = units.findIndex((u) => al.end < u.end || (al.end === u.end && u === units.at(-1)))
    if (cur < 0) cur = units.length - 1

    // Words: report every word the cursor has passed, in order, once.
    words: for (let ui = 0; ui <= cur; ui++) {
      const u = units[ui]!
      for (let wi = 0; wi < u.words.length; wi++) {
        const w = u.words[wi]!
        if (w.end > al.end) break words
        const mark = u.step * 1e6 + u.rep * 1e3 + wi
        if (mark <= this.wordMark) continue
        const frac = wordFrac(w)
        // A word that was not matched itself still counts once the person is
        // clearly past it (a later word in the same line matched well).
        const confirmedLater = u.words.slice(wi + 1).some((v) => v.end <= al.end && wordFrac(v) >= 0.5) ||
          units.slice(ui + 1, cur + 1).some((v) => unitMatched[units.indexOf(v)]! >= this.opts.enterSymbols)
        if (frac < this.opts.wordMatch && !confirmedLater) break words
        this.wordMark = mark
        this.progressN = this.count
        events.push({ kind: 'word', step: u.step, lineId: u.lineId, wordIndex: wi, rep: u.rep, confidence: round(frac), at })
      }
    }

    // Line start: the person is confidently inside a step's first unit.
    for (let ui = 0; ui <= cur; ui++) {
      const u = units[ui]!
      if (u.rep !== 0 || this.started.has(u.step)) continue
      const stepMatched = units.filter((v) => v.step === u.step).reduce((sum, v) => sum + unitMatched[units.indexOf(v)]!, 0)
      const firstWord = u.words[0]
      const need = this.opts.enterSymbols + 2
      if (stepMatched >= need && firstWord && (wordFrac(firstWord) >= 0.6 || stepMatched >= 2 * need)) {
        this.started.add(u.step)
        const total = units.filter((v) => v.step === u.step).reduce((sum, v) => sum + (v.end - v.start), 0)
        events.push({ kind: 'lineStart', step: u.step, lineId: u.lineId, confidence: round(Math.min(1, stepMatched / Math.max(6, total * 0.3))), at })
      }
    }

    // Line done: at most one per evaluation, strictly in order.
    const nextStep = this.lastDone + 1
    const stepUnits = units.filter((u) => u.step === nextStep)
    if (stepUnits.length) {
      const lastUnit = stepUnits.at(-1)!
      const voice = lastUnit.voice
      const done = al.end >= lastUnit.end
      const matchedLast = unitMatched[units.indexOf(lastUnit)]! / Math.max(1, lastUnit.end - lastUnit.start)
      const laterMatched = units.filter((u) => u.step > nextStep && units.indexOf(u) <= cur).reduce((s, u) => s + unitMatched[units.indexOf(u)]!, 0)
      const repsSaid = stepUnits.filter((u) => unitMatched[units.indexOf(u)]! >= Math.max(2, (u.end - u.start) * this.opts.lineMatch[voice])).length
      const finishedHere = done && matchedLast >= this.opts.lineMatch[voice]
      const movedOn = laterMatched >= this.opts.enterSymbols && repsSaid > 0
      const movedOnUnheard = laterMatched >= 2 * this.opts.enterSymbols + 2
      // Silence after a partly heard last word (noise ate its end, or a
      // trailing consonant the model dropped): the line is over.
      const lastWord = lastUnit.words.at(-1)
      let stoppedInLastWord = false
      if (idle && lastWord && al.end > lastWord.start && al.end < lastUnit.end && matchedLast >= this.opts.lineMatch[voice] * 0.8) {
        let m = 0
        for (let c = lastWord.start + 1; c <= al.end; c++) m += al.colMatch[c]!
        stoppedInLastWord = m / Math.max(1, lastWord.end - lastWord.start) >= this.opts.idleLastWord
      }
      if (finishedHere || movedOn || movedOnUnheard || stoppedInLastWord) {
        if (stoppedInLastWord && lastWord) {
          const wi = lastUnit.words.length - 1
          const mark = lastUnit.step * 1e6 + lastUnit.rep * 1e3 + wi
          if (mark > this.wordMark) {
            this.wordMark = mark
            events.push({ kind: 'word', step: lastUnit.step, lineId: lastUnit.lineId, wordIndex: wi, rep: lastUnit.rep, confidence: round(wordFrac(lastWord)), at })
          }
        }
        this.lastDone = nextStep
        const conf = finishedHere ? matchedLast : stoppedInLastWord ? Math.min(0.7, matchedLast) : movedOn ? 0.6 : 0.35
        events.push({ kind: 'lineDone', step: nextStep, lineId: lastUnit.lineId, confidence: round(conf), reps: repsSaid, at })
      }
    }

    // Snapshot for the UI: the word in progress and how far through it.
    // A line whose last phoneme has just been heard stays on its last word
    // with fill 1 until the next line actually starts.
    let cu = units[cur]
    const prev = units[cur - 1]
    if (cu && prev && al.end === prev.end) cu = prev
    if (cu) {
      let wordIndex = cu.words.findIndex((w) => w.end > al.end)
      let fill = 1
      if (wordIndex < 0) wordIndex = cu.words.length - 1
      else {
        const w = cu.words[wordIndex]!
        fill = w.end > w.start ? Math.min(1, Math.max(0, (al.end - w.start) / (w.end - w.start))) : 1
      }
      this.lastSnapshot = { anchor: this.anchor, step: cu.step, rep: cu.rep, wordIndex, fill: round(fill), heard: this.heard.length, cost: round(al.cost) }
    }
    return events
  }
}

const round = (v: number) => Math.round(v * 100) / 100

/**
 * Counts as "heard": the same symbol, or an accent-level consonant swap. A
 * different short vowel is cheap in the alignment cost but is not evidence.
 */
const isMatch = (h: string, t: string) => h === t || (!VOWELS.has(h) && !VOWELS.has(t) && subCost(h, t) <= 0.45)

/**
 * Approximate substring matching (Sellers) of each keyword against the symbol
 * stream: the keyword may start anywhere, and a detection fires as soon as the
 * cost of the best alignment ending here drops under the threshold.
 */
export class KeywordSpotter {
  private patterns: { kind: KeywordKind; P: string[]; col: Float32Array; startAt: Float64Array; limit: number; cooldown: number }[] = []

  constructor(costs: Record<KeywordKind, number>) {
    for (const kind of Object.keys(KEYWORD_LINES) as KeywordKind[]) {
      const sk = skeletonOf(KEYWORD_LINES[kind])
      if (!sk) continue
      const P = sk.symbols
      const col = new Float32Array(P.length + 1)
      this.patterns.push({ kind, P, col, startAt: new Float64Array(P.length + 1), limit: costs[kind] * P.length, cooldown: 0 })
      this.resetPattern(this.patterns.at(-1)!)
    }
  }

  private resetPattern(p: KeywordSpotter['patterns'][number]) {
    p.col[0] = 0
    for (let j = 1; j <= p.P.length; j++) p.col[j] = p.col[j - 1]! + delCost(p.P[j - 1]!) + 2 // fresh start must see the beginning
    p.startAt.fill(Infinity)
  }

  /** One more heard symbol (`n` = its running number). */
  push(s: string, n: number): Spotted | null {
    let fired: Spotted | null = null
    for (const p of this.patterns) {
      const { P, col, startAt } = p
      let diagPrev = col[0]!
      let diagStart = n
      col[0] = 0
      startAt[0] = n
      for (let j = 1; j <= P.length; j++) {
        const up = col[j]! + insCost(s)
        const diag = diagPrev + subCost(s, P[j - 1]!)
        const left = col[j - 1]! + delCost(P[j - 1]!)
        diagPrev = col[j]!
        const prevStart = startAt[j]!
        let v = up
        let st = prevStart
        if (diag < v) {
          v = diag
          st = diagStart
        }
        if (left < v) {
          v = left
          st = startAt[j - 1]!
        }
        diagStart = prevStart
        col[j] = v
        startAt[j] = st
      }
      if (p.cooldown > 0) {
        p.cooldown--
        continue
      }
      const cost = col[P.length]!
      if (cost <= p.limit && !fired) {
        const startN = startAt[P.length]!
        fired = { kind: p.kind, confidence: round(Math.max(0, 1 - cost / (P.length * 0.5))), startN: Number.isFinite(startN) ? startN : n, endN: n }
        this.resetPattern(p)
        p.cooldown = Math.ceil(P.length / 2)
      }
    }
    return fired
  }
}
