/**
 * One Euro filter (Casiez et al., 2012): smooths jitter when a point is
 * still and follows quickly when it moves. Used per landmark coordinate.
 */
export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.6,
    private readonly dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  /** `t` in seconds. */
  filter(value: number, t: number) {
    if (this.x === null || t <= this.t) {
      this.x = value
      this.t = t
      return value
    }
    const dt = Math.min(1, t - this.t)
    this.t = t
    const dx = (value - this.x) / dt
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x)
    return this.x
  }

  reset() {
    this.x = null
    this.dx = 0
  }
}

/** Smooths a set of 2D points; a point that disappears restarts its filter when it returns. */
export class PointSmoother {
  private fx: OneEuro[] = []
  private fy: OneEuro[] = []
  private lastSeen: number[] = []

  constructor(
    private readonly minCutoff = 1.2,
    private readonly beta = 0.6,
  ) {}

  smooth<P extends { x: number; y: number; v: number }>(points: readonly P[], t: number, minV = 0.2): P[] {
    return points.map((p, i) => {
      this.fx[i] ??= new OneEuro(this.minCutoff, this.beta)
      this.fy[i] ??= new OneEuro(this.minCutoff, this.beta)
      if (p.v < minV) return p
      // Gone for more than half a second: don't drag the old position along.
      if (t - (this.lastSeen[i] ?? -Infinity) > 0.5) {
        this.fx[i]!.reset()
        this.fy[i]!.reset()
      }
      this.lastSeen[i] = t
      return { ...p, x: this.fx[i]!.filter(p.x, t), y: this.fy[i]!.filter(p.y, t) }
    })
  }

  reset() {
    this.fx = []
    this.fy = []
    this.lastSeen = []
  }
}
