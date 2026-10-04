let ctx: AudioContext | null = null

/**
 * A soft two-note bell, generated (no audio files), plus a tiny haptic tap
 * on phones — so you know PrayAlong followed you without looking up.
 */
export function chime() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    for (const [i, freq] of [659.25, 987.77].entries()) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      const start = now + i * 0.09
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.06, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 1.2)
    }
  } catch {
    /* audio unavailable */
  }
  navigator.vibrate?.(25)
}
