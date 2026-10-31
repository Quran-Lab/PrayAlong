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

/**
 * A short, soft bell for each repetition of a repeated line (tasbih ×3) that
 * PrayAlong hears, so it can be counted without looking. The last repetition
 * rings a little brighter, rising to the fifth: done.
 */
export function ding(last = false, volume = 1) {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    const peak = 0.07 * Math.max(0, Math.min(1, volume))
    const notes: [freq: number, at: number][] = last ? [[1046.5, 0], [1568, 0.11]] : [[1046.5, 0]]
    for (const [freq, at] of notes) {
      // A bell: the note plus a quieter, slightly inharmonic overtone.
      for (const [ratio, level] of [[1, 1], [2.76, 0.18]] as const) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = freq * ratio
        const start = now + at
        gain.gain.setValueAtTime(0, start)
        gain.gain.linearRampToValueAtTime(peak * level, start + 0.006)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (ratio === 1 ? 0.7 : 0.25))
        osc.connect(gain).connect(ctx.destination)
        osc.start(start)
        osc.stop(start + 0.75)
      }
    }
  } catch {
    /* audio unavailable */
  }
  navigator.vibrate?.(last ? [18, 60, 18] : 15)
}
