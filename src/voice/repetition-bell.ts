/**
 * Decides when a repetition of a repeated line (tasbih ×3) has newly been
 * heard, so the app can ring one ding for each — however many sources report
 * it (the phoneme follower, speech bursts) and in whatever order.
 */
export class RepetitionBell {
  private rang = new Map<number, number>()

  /**
   * `reps` repetitions of step `step` (repeated `repeat` times) have been
   * heard. Returns 'rep' or 'last' when that is news, null otherwise.
   */
  heard(step: number, reps: number, repeat: number): 'rep' | 'last' | null {
    if (repeat < 2) return null
    const n = Math.min(Math.floor(reps), repeat)
    if (n <= (this.rang.get(step) ?? 0)) return null
    this.rang.set(step, n)
    return n >= repeat ? 'last' : 'rep'
  }

  /** The person went back to `index`: steps from there on may be said again. */
  rewind(index: number) {
    for (const step of [...this.rang.keys()]) if (step >= index) this.rang.delete(step)
  }

  reset() {
    this.rang.clear()
  }
}
