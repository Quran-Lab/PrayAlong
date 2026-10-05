import type { PoseClass } from '@/sequence/types'

/**
 * Turns a noisy stream of per-frame readings into calm, deliberate pose
 * changes: a pose must dominate the recent window and hold for a moment
 * before it counts. Emits only on change.
 */
export class PoseStabilizer {
  private window: { pose: PoseClass | null; t: number }[] = []
  private stable: PoseClass | null = null
  private candidate: PoseClass | null = null
  private since = 0

  constructor(
    private readonly holdMs = 300,
    private readonly windowMs = 700,
    private readonly agreement = 0.65,
  ) {}

  push(pose: PoseClass | null, t: number): PoseClass | null {
    this.window.push({ pose, t })
    while (this.window.length && this.window[0]!.t < t - this.windowMs) this.window.shift()

    const counts = new Map<PoseClass, number>()
    for (const r of this.window) if (r.pose) counts.set(r.pose, (counts.get(r.pose) ?? 0) + 1)
    let best: PoseClass | null = null
    let bestCount = 0
    for (const [p, c] of counts) if (c > bestCount) [best, bestCount] = [p, c]
    const dominant = best && bestCount / this.window.length >= this.agreement ? best : null

    if (dominant !== this.candidate) {
      this.candidate = dominant
      this.since = t
    }
    if (this.candidate && this.candidate !== this.stable && t - this.since >= this.holdMs) {
      this.stable = this.candidate
      return this.stable
    }
    return null
  }

  get current() {
    return this.stable
  }

  reset() {
    this.window = []
    this.stable = this.candidate = null
  }
}
