/**
 * The camera, kept alive: a track that ends or stays muted (unplugged,
 * taken by another app, the laptop lid) is re-acquired with backoff, and a
 * new device appearing triggers another try. After the backoff runs out the
 * owner is told (`onGiveUp`) so the prayer can continue on timers, but the
 * camera keeps listening for devices and tries again when one appears.
 */
export type CameraState = 'starting' | 'live' | 'reconnecting' | 'lost' | 'denied' | 'missing'

export interface CameraOptions {
  facingMode: 'user' | 'environment'
  width?: number
  height?: number
  onStream: (stream: MediaStream | null) => void
  onState: (state: CameraState) => void
  /** Retry delays (ms) after the camera drops. */
  backoff?: number[]
  /** A muted track (no frames) counts as dropped after this long (ms). */
  muteGraceMs?: number
}

export class ResilientCamera {
  private stream: MediaStream | null = null
  private attempt = 0
  private retryTimer = 0
  private muteTimer = 0
  private stopped = false
  private readonly backoff: number[]
  private onDeviceChange = () => {
    // A camera came back (or a new one appeared): try again right away.
    if (!this.stopped && (this.state === 'lost' || this.state === 'reconnecting')) this.retryNow()
  }
  state: CameraState = 'starting'

  constructor(private readonly opts: CameraOptions) {
    this.backoff = opts.backoff ?? [1000, 3000, 10_000]
  }

  private set(state: CameraState) {
    if (this.state === state) return
    this.state = state
    this.opts.onState(state)
  }

  async start() {
    this.stopped = false
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange)
    await this.acquire(true)
  }

  private async acquire(first: boolean) {
    if (!navigator.mediaDevices?.getUserMedia) return this.set('missing')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: this.opts.facingMode, width: { ideal: this.opts.width ?? 640 }, height: { ideal: this.opts.height ?? 480 } },
        audio: false,
      })
      if (this.stopped) return stream.getTracks().forEach((t) => t.stop())
      this.attach(stream)
    } catch (err) {
      if (this.stopped) return
      const name = (err as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') return this.set('denied')
      if (first && (name === 'NotFoundError' || name === 'OverconstrainedError')) return this.set('missing')
      this.scheduleRetry()
    }
  }

  private attach(stream: MediaStream) {
    this.release()
    this.stream = stream
    this.attempt = 0
    const track = stream.getVideoTracks()[0]
    if (track) {
      track.addEventListener('ended', () => this.dropped())
      track.addEventListener('mute', () => {
        clearTimeout(this.muteTimer)
        this.muteTimer = window.setTimeout(() => track.muted && this.dropped(), this.opts.muteGraceMs ?? 2500)
      })
      track.addEventListener('unmute', () => clearTimeout(this.muteTimer))
    }
    this.opts.onStream(stream)
    this.set('live')
  }

  /** The live track ended or stayed muted. */
  dropped() {
    if (this.stopped) return
    this.release()
    this.opts.onStream(null)
    this.scheduleRetry()
  }

  private scheduleRetry() {
    clearTimeout(this.retryTimer)
    if (this.attempt >= this.backoff.length) return this.set('lost')
    this.set('reconnecting')
    const delay = this.backoff[this.attempt++]!
    this.retryTimer = window.setTimeout(() => void this.acquire(false), delay)
  }

  retryNow() {
    clearTimeout(this.retryTimer)
    this.attempt = 0
    this.set('reconnecting')
    void this.acquire(false)
  }

  private release() {
    clearTimeout(this.muteTimer)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
  }

  stop() {
    this.stopped = true
    clearTimeout(this.retryTimer)
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange)
    this.release()
    this.opts.onStream(null)
  }
}
