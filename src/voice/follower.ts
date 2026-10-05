import phonemeTable from '@/content/phonemes.json'
import { delCost, insCost, lineSkeleton, subCost, SymbolStream, VOWELS, type LineSkeleton } from './phonetic'
import { SHORT_SURAHS, type SurahId } from '@/content/recitations'
import type { FollowerEvent, FollowStep, KeywordKind } from './types'

/**
 * Constrained voice follower.
 *
 * It never searches the Quran (or even the whole prayer): it aligns what the
 * model hears against the line the session is on and the next few lines only,
 * so an accent, a mumble or a noise can at worst look like "this line" or "the
 * next one", never like something three minutes away.
 *
 * One aligner over a small prayer graph. Everything heard since the anchor
 * line started is aligned (edit distance on the skeleton alphabet) against the
 * expected path from here:
 *
 *    line x repeat -> [takbir?] -> next posture's line -> ...
 *                  \-> another short surah's opening (a branch)
 *
 *  - Repeated lines are loops: each finished repetition is committed and the
 *    next utterance can only be the next one; extra repetitions restart the
 *    last one cheaply.
 *  - Lines can be skipped (forgot it, tasbih said once) or restarted (false
 *    start, hesitation); the basmala before a surah is an optional prefix.
 *  - "Allahu akbar" is an optional node before every posture it announces: the
 *    movement phrase is reported when the best path goes through it. Inside a
 *    posture there is no such node, so nothing there can be taken for it.
 *  - While a short surah is due, the openings of the others are branches; the
 *    person reciting one is reported (event 'surah') when the best path is in
 *    it, clearly cheaper than the planned surah and every other branch.
 *
 * The cheapest path's end is where the person is now.
 *
 * Every event is monotonic: progress is never reported backwards, and each line
 * completes at most once per evaluation, so a misheard burst can move the
 * session by one line, not several.
 */

const LINES = (phonemeTable as { lines: Record<string, { words: string[]; optional?: number }> }).lines
const SKELETONS = new Map<string, LineSkeleton & { optional: number }>()
/** The target phonemes of one word of a line (for logs). */
export function targetWord(lineId: string, wordIndex: number): string {
  return LINES[lineId]?.words[wordIndex] ?? ''
}

/** A line's skeleton; `optional` = how many leading words may be left out (the basmala). */
export function skeletonOf(lineId: string): (LineSkeleton & { optional: number }) | null {
  let sk = SKELETONS.get(lineId)
  if (!sk) {
    const entry = LINES[lineId]
    if (!entry) return null
    sk = { ...lineSkeleton(entry.words), optional: entry.optional ?? 0 }
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
  /** Cost of leaving out the optional takbir node before a posture (unheard or whispered). */
  takbirSkipCost: number
  /** Cost of entering another short surah than the planned one (a branch). */
  branchCost: number
  /** How much cheaper the best branch path must be than the planned surah to switch. */
  branchMargin: number
  /** Share of the takbir node that must be heard to report the movement phrase. */
  takbirMatch: number
  /** Longest heard history kept (symbols) before the tracker re-anchors itself. */
  maxHeard: number
  /** Seconds without new symbols before a partly heard last word finishes its line. */
  idleSec: number
  /** Share of the last word that must have been heard for that. */
  idleLastWord: number
  /** Energy silence after a fully heard line that confirms it is over. */
  confirmSilenceSec: number
  /** Hold a finished line at fill 1 this long before it completes (0: the UI shows the hold instead, without delaying the session). */
  holdSec: number
  /** Unexplained symbols (no word reported) before looking further ahead. */
  lostSymbols: number
  lostWindowSteps: number
  lostSkipCost: number
  /** Cost of leaving out an optional prefix (the basmala before a surah). */
  optionalSkipCost: number
  /** Cost of one more repetition than a repeated line asks for. */
  extraRepCost: number
}

export const DEFAULT_FOLLOWER: FollowerOptions = {
  windowSteps: 4,
  skipCost: 5,
  repSkipCost: 0.8,
  restartCost: 2.5,
  gapInsCost: 0.5,
  lineMatch: { aloud: 0.4, quiet: 0.3 },
  optionalSkipCost: 0.6,
  extraRepCost: 0.8,
  wordMatch: 0.34,
  enterSymbols: 4,
  takbirSkipCost: 0.3,
  branchCost: 1,
  branchMargin: 2,
  takbirMatch: 0.55,
  maxHeard: 500,
  idleSec: 1.0,
  idleLastWord: 0.6,
  confirmSilenceSec: 0.15,
  holdSec: 0,
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
  /**
   * line: a line of the prayer (one repetition of it); takbir: the optional
   * "Allahu akbar" said while moving into `step`; branch: the opening of
   * another short surah than the planned one, entered from where the planned
   * surah starts.
   */
  kind: 'line' | 'takbir' | 'branch'
  surah?: SurahId
  /** End of an optional prefix (the basmala before a surah); = start when none. */
  optEnd: number
  /** Absolute [start, end) per word. */
  words: { start: number; end: number }[]
}

interface Heard {
  s: string
  at: number
  /** Running symbol number (survives trimming of the history). */
  n: number
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
  /** Cost of the best path ending at each column (all of the heard so far). */
  endCost: Float32Array
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
  /** Repetitions of `step` said to their end (tasbih x3: 0, 1, 2, 3). */
  repsDone: number
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
  /** Predecessor column (and entry cost) of each target column: the graph's edges. */
  private prevCol = new Int32Array(1)
  private prevCost = new Float32Array(1)
  /** The planned short surah in the window: where it starts, and its step. */
  private planned: { surah: SurahId; step: number; startCol: number; endCol: number } | null = null
  /** Steps whose announcing takbir has been reported. */
  private takbirSaid = new Set<number>()
  /** Symbol count at the last word reported (or anchor move). */
  private progressN = 0
  private idleDoneFor = -1
  private voicedAt = -Infinity
  private pending = false
  private committing = false
  private fullFor = -1
  private fullAt = Infinity
  /** Repetitions fully said, per step (only ever goes up). */
  private repsDone = new Map<number, number>()
  private stream = new SymbolStream()
  /** Last word reported, as step*1e6 + rep*1e3 + word: reports only ever increase. */
  private wordMark = -1
  private lastDone = -1
  private started = new Set<number>()
  private last: Alignment | null = null
  private lastSnapshot: FollowerSnapshot = { anchor: 0, step: 0, wordIndex: 0, rep: 0, fill: 0, repsDone: 0, heard: 0, cost: 0 }

  constructor(steps: FollowStep[] = [], opts: Partial<FollowerOptions> = {}) {
    this.opts = { ...DEFAULT_FOLLOWER, ...opts }
    this.setSteps(steps)
  }

  setSteps(steps: FollowStep[], anchor = 0) {
    const same = steps.length === this.steps.length && steps.every((s, i) => s.lineId === this.steps[i]?.lineId)
    // The same prayer up to here with another surah from now on (the person
    // began reciting a different one): keep the last seconds just heard, so
    // the verse they are in the middle of still counts.
    const samePrefix = anchor > 0 && steps.slice(0, anchor).every((s, i) => s.lineId === this.steps[i]?.lineId)
    this.steps = steps
    const lastAt = this.heard.at(-1)?.at ?? 0
    this.heard = samePrefix ? this.heard.filter((h) => h.at >= lastAt - 4) : []
    if (!same && !samePrefix) {
      // A different prayer: nothing said so far applies.
      this.repsDone.clear()
      this.started.clear()
      this.wordMark = -1
    }
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
   * The energy gate, about ten times a second (`speech` at audio time `at`).
   * Re-runs the rules that need silence: a fully heard line waiting for its
   * confirmation, or a line whose last word was only partly heard, finished
   * once the person has stopped.
   */
  level(at: number, speech = false): FollowerEvent[] {
    if (speech) this.voicedAt = at
    const lastAt = this.heard.at(-1)?.at
    if (lastAt === undefined) return []
    if (this.pending) return this.evaluate(at, true)
    if (this.idleDoneFor === this.count && at - lastAt > 2.5 * this.opts.idleSec) return []
    if (at - lastAt < this.opts.idleSec / 2) return []
    if (at - lastAt >= 2.5 * this.opts.idleSec) this.idleDoneFor = this.count
    return this.evaluate(at, true)
  }

  /** @deprecated use level() */
  idle(at: number, speech = false): FollowerEvent[] {
    return this.level(at, speech)
  }

  /** A decoder segment ended (real silence): do not collapse across it. */
  segmentEnd() {
    this.stream.reset()
  }

  /** Newly emitted decoder tokens, at audio time `at` (seconds). */
  push(tokens: readonly string[], at: number): FollowerEvent[] {
    const symbols = this.stream.push(tokens)
    if (!symbols.length) return []
    for (const s of symbols) this.heard.push({ s, at, n: this.count++ })
    if (!this.lost && this.count - this.progressN > this.opts.lostSymbols) this.enterLost()
    if (this.heard.length > this.opts.maxHeard) {
      // Too much unexplained audio: keep only the recent part. The anchor
      // stays with the session (moving it ahead would make the next sync
      // re-anchor backwards and forget repetitions).
      this.heard = this.heard.slice(-60)
      this.reanchor(this.anchor, true)
    }
    return this.evaluate(at)
  }

  /** Re-run the decision rules without new audio (e.g. after a pause). */
  flush(at: number): FollowerEvent[] {
    return this.heard.length ? this.evaluate(at) : []
  }

  /** Repetitions of `step` said to their end so far. */
  repsOf(step: number): number {
    return this.repsDone.get(step) ?? 0
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
    this.pending = false
    this.fullFor = -1
    if (!keep) {
      // Repetition counts survive every re-anchor: only a new prayer (setSteps)
      // clears them, so a repetition said is never taken back.
      this.wordMark = Math.max(this.wordMark, this.anchor * 1e6 + (this.repsDone.get(this.anchor) ?? 0) * 1e3 - 1)
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

  /**
   * The expected path from the anchor as a graph over target columns:
   *   [takbir?] line x repeat, [takbir?] next line, ...
   * plus, while a short surah is due, a branch per other short surah entered
   * from where the planned one starts. Each column has one predecessor (and an
   * entry cost); skips, restarts and loops are epsilon edges (see jumps()).
   */
  private buildWindow() {
    this.last = null
    this.units = []
    this.T = []
    const prevCol: number[] = [0]
    const prevCost: number[] = [0]
    const bounds: number[] = [0]
    const add = (unit: Omit<Unit, 'start' | 'end' | 'words' | 'optEnd'>, sk: LineSkeleton & { optional: number }, entry?: { col: number; cost: number }) => {
      const start = this.T.length
      for (const s of sk.symbols) {
        prevCol.push(this.T.length)
        prevCost.push(0)
        this.T.push(s)
      }
      if (entry) {
        prevCol[start + 1] = entry.col
        prevCost[start + 1] = entry.cost
      }
      const u: Unit = {
        ...unit,
        start,
        end: this.T.length,
        words: sk.words.map((w) => ({ start: start + w.start, end: start + w.end })),
        optEnd: start + (sk.optional ? sk.words[sk.optional - 1]!.end : 0),
      }
      this.units.push(u)
      bounds.push(this.T.length)
      return u
    }
    this.planned = null
    const span = this.lost ? this.opts.lostWindowSteps : this.opts.windowSteps
    const takbir = skeletonOf('takbir')
    for (let step = this.anchor; step < Math.min(this.steps.length, this.anchor + span); step++) {
      const info = this.steps[step]!
      const sk = skeletonOf(info.lineId)
      if (!sk || !sk.symbols.length) continue
      // "Allahu akbar" while moving into this posture: an optional node.
      if (info.takbirBefore && step > this.anchor && takbir) add({ step, rep: 0, lineId: 'takbir', lastRep: true, voice: 'aloud', kind: 'takbir' }, takbir)
      const reps = Math.max(1, info.repeat)
      // Repetitions already said are not in the window: new speech can only
      // be the next repetition (or a restart of it), never an earlier one.
      const firstRep = step === this.anchor ? Math.min(this.repsDone.get(step) ?? 0, reps - 1) : 0
      for (let rep = firstRep; rep < reps; rep++) {
        const u = add({ step, rep, lineId: info.lineId, lastRep: rep === reps - 1, voice: info.voice, kind: 'line' }, sk)
        const surah = (Object.keys(SHORT_SURAHS) as SurahId[]).find((x) => SHORT_SURAHS[x].lines[0] === info.lineId)
        if (surah && !this.planned) this.planned = { surah, step, startCol: u.start, endCol: u.end }
        else if (this.planned && SHORT_SURAHS[this.planned.surah].lines.includes(info.lineId as never)) this.planned.endCol = u.end
      }
    }
    // Branches: the other short surahs' openings, entered from the planned
    // surah's start (al-Asr's first verse is one word, so its second too).
    if (this.planned && this.planned.step >= this.anchor) {
      for (const surah of Object.keys(SHORT_SURAHS) as SurahId[]) {
        if (surah === this.planned.surah) continue
        const lines = SHORT_SURAHS[surah].lines.slice(0, surah === 'asr' ? 3 : 2)
        lines.forEach((lineId, k) => {
          const sk = skeletonOf(lineId)
          if (!sk) return
          add({ step: this.planned!.step + k, rep: 0, lineId, lastRep: true, voice: 'aloud', kind: 'branch', surah }, sk, k === 0 ? { col: this.planned!.startCol, cost: this.opts.branchCost } : undefined)
        })
      }
    }
    this.prevCol = Int32Array.from(prevCol)
    this.prevCost = Float32Array.from(prevCost)
    this.boundary = new Uint8Array(this.T.length + 1)
    for (const b of bounds) this.boundary[b] = 1
    this.lastSnapshot = { anchor: this.anchor, step: this.anchor, wordIndex: 0, rep: 0, fill: 0, repsDone: this.repsDone.get(this.anchor) ?? 0, heard: this.heard.length, cost: 0 }
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
    const P = this.prevCol
    const PC = this.prevCost

    // Row 0: nothing heard yet; reaching column j means deleting the path to it.
    for (let j = 1; j <= M; j++) {
      D[j] = D[P[j]!]! + PC[j]! + delCost(T[j - 1]!)
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
          const p = P[j]!
          const diag = D[prev + p]! + PC[j]! + subCost(h, t)
          if (diag < best) {
            best = diag
            o = OP_DIAG
          }
          const del = D[base + p]! + PC[j]! + delCost(t)
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
        j = P[j]!
      } else if (o === OP_INS) {
        rowCol[i - 1] = j
        i--
      } else if (o === OP_DEL) {
        j = P[j]!
      } else if (o === OP_SKIP || o === OP_RESTART) {
        j = src[k]!
      } else {
        break
      }
    }
    return { end, cost: D[last + end]!, rowCol, rowMatch, colMatch, endCost: D.slice(last, last + W) }
  }

  /** Skip and restart moves, applied to row i after the ordinary DP. */
  private jumps(D: Float32Array, op: Uint8Array, src: Int32Array, i: number, W: number) {
    const base = i * W
    const { skipCost, repSkipCost, restartCost } = this.opts
    const P = this.prevCol
    // Deletions onward from a column whose value just improved (same line only).
    const propagate = (from: number, until: number) => {
      for (let j = from + 1; j <= until; j++) {
        if (P[j] !== j - 1) break
        const d = D[base + j - 1]! + delCost(this.T[j - 1]!)
        if (d >= D[base + j]!) break
        D[base + j] = d
        op[base + j] = OP_DEL
      }
    }
    // Restart: from anywhere inside a line (or its end) back to its start.
    for (const u of this.units) {
      if (u.kind !== 'line') continue
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
      // One more repetition of a repeated line (tasbih said 4 or 5 times):
      // from its finished last repetition back to its start, cheaply, so the
      // extra ones never read as the next posture's identical line.
      if (u.lastRep && (this.steps[u.step]?.repeat ?? 1) > 1) {
        const v = D[base + u.end]! + this.opts.extraRepCost
        if (v < D[base + u.start]!) {
          D[base + u.start] = v
          op[base + u.start] = OP_RESTART
          src[base + u.start] = u.end
        }
      }
    }
    // Skip whole units, left to right so several can be skipped in a row.
    for (const u of this.units) {
      // The basmala before a surah may be said or not: skipping it is cheap.
      // A branch's basmala is entered from the planned surah's start.
      if (u.optEnd > u.start) {
        const fromBranch = u.kind === 'branch' && this.planned && P[u.start + 1] !== u.start
        const srcCol = fromBranch ? this.planned!.startCol : u.start
        const v = D[base + srcCol]! + (fromBranch ? this.opts.branchCost : 0) + this.opts.optionalSkipCost
        if (v < D[base + u.optEnd]!) {
          D[base + u.optEnd] = v
          op[base + u.optEnd] = OP_SKIP
          src[base + u.optEnd] = srcCol
          propagate(u.optEnd, u.end)
        }
      }
      if (u.kind === 'branch') continue
      // A takbir node is optional (often whispered or unheard); lines cost more.
      const cost = u.kind === 'takbir' ? this.opts.takbirSkipCost : u.rep > 0 ? repSkipCost : this.lost ? this.opts.lostSkipCost : skipCost
      const v = D[base + u.start]! + cost
      if (v < D[base + u.end]!) {
        D[base + u.end] = v
        op[base + u.end] = OP_SKIP
        src[base + u.end] = u.start
        // Re-propagate deletions into the next unit from the new boundary value.
        const next = this.units.find((x) => x.start === u.end && x.kind !== 'branch')
        if (next) propagate(u.end, next.end)
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

    // The best path is in another surah's opening: decide whether to switch.
    // Only with enough of it heard and clearly cheaper than the planned surah.
    // The unit the path ends in (a column at a unit's end belongs to it).
    const endUnit = units.find((u) => u.kind === 'branch' && al.end > u.start && al.end <= u.end)
    if (endUnit && this.planned) {
      const surah = endUnit.surah!
      const branch = units.filter((u) => u.kind === 'branch' && u.surah === surah)
      const heardOf = branch.reduce((n, u) => n + unitMatched[units.indexOf(u)]!, 0)
      let bestBranch = Infinity
      for (const u of branch) for (let c = u.start + 1; c <= u.end; c++) bestBranch = Math.min(bestBranch, al.endCost[c]!)
      let bestPlanned = Infinity
      for (let c = this.planned.startCol; c <= this.planned.endCol; c++) bestPlanned = Math.min(bestPlanned, al.endCost[c]!)
      // ...and than every other branch: al-Falaq and an-Nas share their first
      // three words, so their last word decides.
      let bestOther = Infinity
      for (const u of units) {
        if (u.kind !== 'branch' || u.surah === surah) continue
        for (let c = u.start + 1; c <= u.end; c++) bestOther = Math.min(bestOther, al.endCost[c]!)
      }
      if (heardOf >= 8 && bestBranch + this.opts.branchMargin <= bestPlanned && bestBranch + this.opts.branchMargin / 2 <= bestOther) {
        const len = branch.reduce((n, u) => n + u.end - u.start, 0)
        events.push({ kind: 'surah', surah, step: this.planned.step, confidence: round(Math.min(1, heardOf / Math.max(8, len * 0.6))), at })
      }
      // Lines before the surah (amin) may still finish below; nothing else moves.
    }
    const inBranch = !!endUnit

    // The movement phrase: the path went through (or is in) a takbir node and
    // most of it was heard.
    for (let ui = 0; ui <= cur; ui++) {
      const u = units[ui]!
      if (u.kind !== 'takbir' || this.takbirSaid.has(u.step)) continue
      const matched = unitMatched[ui]! / Math.max(1, u.end - u.start)
      if (matched >= this.opts.takbirMatch) {
        this.takbirSaid.add(u.step)
        events.push({ kind: 'takbir', confidence: round(matched), at, start: at })
      }
    }

    // Words: report every word the cursor has passed, in order, once.
    words: for (let ui = 0; ui <= cur && !inBranch; ui++) {
      const u = units[ui]!
      if (u.kind !== 'line') continue
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
    for (let ui = 0; ui <= cur && !inBranch; ui++) {
      const u = units[ui]!
      if (u.kind !== 'line' || u.rep !== 0 || this.started.has(u.step)) continue
      const stepMatched = units.filter((v) => v.step === u.step && v.kind === 'line').reduce((sum, v) => sum + unitMatched[units.indexOf(v)]!, 0)
      const firstWord = u.words[0]
      const need = this.opts.enterSymbols + 2
      if (stepMatched >= need && firstWord && (wordFrac(firstWord) >= 0.6 || stepMatched >= 2 * need)) {
        this.started.add(u.step)
        const total = units.filter((v) => v.step === u.step && v.kind === 'line').reduce((sum, v) => sum + (v.end - v.start), 0)
        events.push({ kind: 'lineStart', step: u.step, lineId: u.lineId, confidence: round(Math.min(1, stepMatched / Math.max(6, total * 0.3))), at })
      }
    }

    // A repetition said to its end (tasbih x3) is committed: its phonemes and
    // its unit leave the window, so the next utterance can only be the next
    // repetition. Confirmed like a line: the next one has begun, or quiet.
    if (!this.committing && !inBranch) {
      const own = units.filter((u) => u.step === this.anchor && u.kind === 'line')
      const first = own[0]
      if (first && own.length > 1 && al.end >= first.end) {
        const fi = units.indexOf(first)
        const len = first.end - first.start
        const heardEnough = unitMatched[fi]! >= Math.max(2, len * this.opts.lineMatch[first.voice])
        const lastW = first.words.at(-1)
        const endHeard = !lastW || wordHeardToEnd(al, lastW)
        const nextBegun = unitMatched[fi + 1]! >= 2
        const quiet = at - this.voicedAt >= this.opts.confirmSilenceSec
        if (heardEnough && endHeard && (nextBegun || quiet)) {
          this.repsDone.set(this.anchor, Math.max(this.repsDone.get(this.anchor) ?? 0, first.rep + 1))
          let keepFrom = 0
          for (let r = 0; r < al.rowCol.length; r++) {
            const c = al.rowCol[r]!
            if (c < first.end || (c === first.end && al.rowMatch[r])) keepFrom = r + 1
          }
          this.heard = this.heard.slice(keepFrom)
          this.buildWindow()
          this.committing = true
          try {
            return [...events, ...this.evaluate(at, idle)]
          } finally {
            this.committing = false
          }
        }
      }
    }

    // Line done: at most one per evaluation, strictly in order.
    const nextStep = this.lastDone + 1
    const stepUnits = units.filter((u) => u.step === nextStep && u.kind === 'line')
    if (stepUnits.length && !(inBranch && this.planned && nextStep >= this.planned.step)) {
      const lastUnit = stepUnits.at(-1)!
      const voice = lastUnit.voice
      const done = al.end >= lastUnit.end
      const matchedLast = unitMatched[units.indexOf(lastUnit)]! / Math.max(1, lastUnit.end - lastUnit.start)
      // Heard of what comes after this step (its next line, or the takbir of
      // the next posture); branches count only once they are switched to.
      const laterMatched = units.filter((u) => u.step > nextStep && u.kind !== 'branch' && units.indexOf(u) <= cur).reduce((s, u) => s + unitMatched[units.indexOf(u)]!, 0)
      // Repetitions committed earlier are no longer in the window: count them in.
      const repsSaid = stepUnits[0]!.rep + stepUnits.filter((u) => unitMatched[units.indexOf(u)]! >= Math.max(2, (u.end - u.start) * this.opts.lineMatch[voice])).length
      const lastWord = lastUnit.words.at(-1)
      // The last word must really have been said to its end: its final
      // phoneme decoded (or nearly all of it with one of the last two), not
      // just its onset reached by skipping the rest.
      const lastWordHeard = !!lastWord && done && wordHeardToEnd(al, lastWord)
      const nextStarted = laterMatched >= 2
      const full = done && lastWordHeard && matchedLast >= this.opts.lineMatch[voice]
      if (!full || this.fullFor !== nextStep) this.fullAt = full ? at : Infinity
      this.fullFor = full ? nextStep : -1
      // Confirmed once the person is quiet (energy) or the next line has
      // begun, and after a short hold so the finished line is seen whole.
      const quiet = at - this.voicedAt >= this.opts.confirmSilenceSec || (idle && at - (this.heard.at(-1)?.at ?? at) >= 0.6)
      const finishedHere = full && (nextStarted || (quiet && at - this.fullAt >= this.opts.holdSec))
      this.pending = full && !finishedHere
      const movedOn = laterMatched >= this.opts.enterSymbols && repsSaid > 0
      const movedOnUnheard = laterMatched >= 2 * this.opts.enterSymbols + 2
      // Silence after a partly heard last word (noise ate its end, or a
      // trailing consonant the model dropped): the line is over. Never on the
      // onset of the word: most of it must have been heard.
      let stoppedInLastWord = false
      if (idle && lastWord && al.end > lastWord.start && matchedLast >= this.opts.lineMatch[voice] * 0.8 && !finishedHere) {
        let m = 0
        for (let c = lastWord.start + 1; c <= Math.min(al.end, lastWord.end); c++) m += al.colMatch[c]!
        const part = m / Math.max(1, lastWord.end - lastWord.start)
        // Consonants of the last word not yet heard: "ghay" of "ghayruk" leaves
        // r and k, so the person is mid-word (a held vowel), not done.
        let missing = 0
        for (let c = Math.max(al.end, lastWord.start) + 1; c <= lastWord.end; c++) if (!VOWELS.has(this.T[c - 1]!)) missing++
        const silent = at - Math.max(this.voicedAt, this.heard.at(-1)?.at ?? 0)
        const symbolGap = at - (this.heard.at(-1)?.at ?? at)
        const mostly = part >= this.opts.idleLastWord && missing <= 1
        stoppedInLastWord = mostly && (silent >= this.opts.idleSec || symbolGap >= 3 * this.opts.idleSec)
      }
      if (finishedHere || movedOn || movedOnUnheard || stoppedInLastWord) {
        this.pending = false
        this.repsDone.set(nextStep, Math.max(this.repsDone.get(nextStep) ?? 0, repsSaid))
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
        events.push({ kind: 'lineDone', step: nextStep, lineId: lastUnit.lineId, confidence: round(conf), reps: this.repsDone.get(nextStep) ?? repsSaid, at })
      }
    }

    // Snapshot for the UI: the word in progress and how far through it.
    // A line whose last phoneme has just been heard stays on its last word
    // with fill 1 until the next line actually starts.
    if (inBranch) return events
    // The cursor is on a line: inside a takbir node, the person has finished
    // the line before it.
    let ci = cur
    while (ci > 0 && units[ci]!.kind !== 'line') ci--
    let cu = units[ci]?.kind === 'line' ? units[ci] : undefined
    let prevLine = ci - 1
    while (prevLine >= 0 && units[prevLine]!.kind !== 'line') prevLine--
    const prev = units[prevLine]
    if (cu && prev && (al.end === prev.end || ci !== cur)) cu = ci !== cur ? units[ci] : prev
    if (cu) {
      let wordIndex = cu.words.findIndex((w) => w.end > al.end)
      let fill = 1
      if (wordIndex < 0) wordIndex = cu.words.length - 1
      else {
        const w = cu.words[wordIndex]!
        fill = w.end > w.start ? Math.min(1, Math.max(0, (al.end - w.start) / (w.end - w.start))) : 1
      }
      // A completed line always shows its last word whole (the idle rule can
      // finish a line whose last phonemes the model never emitted).
      if (cu.step <= this.lastDone && cu.step >= this.anchor) {
        const lastOfStep = [...units].reverse().find((u) => u.step === cu!.step && u.kind === 'line')
        if (lastOfStep) {
          cu = lastOfStep
          wordIndex = cu.words.length - 1
          fill = 1
        }
      }
      // Repetitions said to their end so far (live; never goes down).
      const step = cu.step
      const passed = (units.find((u) => u.step === step && u.kind === 'line')?.rep ?? 0) + units.filter((u) => u.step === step && u.kind === 'line' && al.end >= u.end && unitMatched[units.indexOf(u)]! >= 2).length
      const repsDone = Math.max(this.repsDone.get(step) ?? 0, passed)
      this.repsDone.set(step, repsDone)
      this.lastSnapshot = { anchor: this.anchor, step, rep: cu.rep, wordIndex, fill: round(fill), repsDone, heard: this.heard.length, cost: round(al.cost) }
    }
    return events
  }
}

const round = (v: number) => Math.round(v * 100) / 100

/**
 * A word said to its end: its final phoneme decoded, or nearly all of it
 * with one of its last two (not just its onset reached by skipping the rest).
 */
function wordHeardToEnd(al: Alignment, w: { start: number; end: number }): boolean {
  if (w.end <= w.start) return true
  let m = 0
  for (let c = w.start + 1; c <= w.end; c++) m += al.colMatch[c]!
  const tail = al.colMatch[w.end]! + (w.end - 1 > w.start ? al.colMatch[w.end - 1]! : 0)
  return al.colMatch[w.end] === 1 || (m / (w.end - w.start) >= 0.7 && tail > 0)
}

/**
 * Counts as "heard": the same symbol, or an accent-level consonant swap. A
 * different short vowel is cheap in the alignment cost but is not evidence.
 */
const isMatch = (h: string, t: string) => h === t || (!VOWELS.has(h) && !VOWELS.has(t) && subCost(h, t) <= 0.45)
