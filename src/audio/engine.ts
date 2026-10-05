import { useEffect, useState } from 'react'
/**
 * PrayAlong's sound: the companion's voice and the room's ambience.
 *
 * Everything is pre-generated and served as static files (see
 * tools/audio/). Audio is a bonus layer: any failure (blocked autoplay, a
 * missing file, a decode error) is swallowed and the prayer carries on with
 * its timers, so sound can never stall or jump a prayer.
 */

export interface Clip {
  src: string
  /** Seconds. */
  dur: number
  /** Per Arabic word: [start, end] in seconds. */
  words?: [number, number][]
}

export interface Manifest {
  version: number
  voices: Record<
    string,
    {
      lines: Record<string, Clip>
      /** Movement guidance per locale, keyed like the `hint.*` messages. */
      guide: Record<string, Record<string, Clip>>
    }
  >
  ambience: Record<string, string[]>
}

const BASE = `${import.meta.env.BASE_URL}audio/`
/** Crossfade between ambience takes and between prayers (seconds). */
const FADE_S = 6

let manifest: Manifest | null = null
let manifestLoad: Promise<Manifest | null> | null = null

export function loadManifest(): Promise<Manifest | null> {
  manifestLoad ??= fetch(`${BASE}manifest.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .then((m) => (manifest = m))
    .catch(() => null)
  return manifestLoad
}
export const getManifest = () => manifest

type Listener = (speaking: boolean) => void

class Engine {
  private listeners = new Set<Listener>()
  /** True while the companion's voice is playing (the mic follower ignores it). */
  speaking = false
  onSpeaking(fn: Listener) {
    this.listeners.add(fn)
    return () => void this.listeners.delete(fn)
  }
  private setSpeaking(on: boolean) {
    if (this.speaking === on) return
    this.speaking = on
    for (const fn of this.listeners) fn(on)
  }

  private ctx: AudioContext | null = null
  private master!: GainNode
  private voiceBus!: GainNode
  private ambienceBus!: GainNode
  private buffers = new Map<string, Promise<AudioBuffer | null>>()
  private playing: { src: AudioBufferSourceNode; gain: GainNode }[] = []
  private ambience: { prayer: string; timer: number; sources: { src: AudioBufferSourceNode; gain: GainNode }[] } | null = null
  private ambienceLevel = 0.42

  /** Must run inside a user gesture the first time (browsers block autoplay). */
  unlock() {
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        this.ctx = new Ctx()
        this.master = this.ctx.createGain()
        this.master.connect(this.ctx.destination)
        this.voiceBus = this.ctx.createGain()
        this.voiceBus.connect(this.master)
        this.ambienceBus = this.ctx.createGain()
        this.ambienceBus.gain.value = this.ambienceLevel
        this.ambienceBus.connect(this.master)
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume()
    } catch {
      this.ctx = null
    }
    return this.ctx !== null
  }

  get ready() {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  get now() {
    return this.ctx?.currentTime ?? 0
  }

  /** Seconds between scheduling a sound and hearing it (Bluetooth can add a lot). */
  get latency() {
    return (this.ctx?.outputLatency ?? 0) + (this.ctx?.baseLatency ?? 0)
  }

  /** Quieter once the prayer begins, so the room stays in the background. */
  setAmbienceLevel(level: number) {
    this.ambienceLevel = level
    if (this.ctx) this.ambienceBus.gain.setTargetAtTime(level, this.ctx.currentTime, 1.2)
  }

  setVolume(v: number) {
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05)
  }

  private load(src: string): Promise<AudioBuffer | null> {
    let p = this.buffers.get(src)
    if (!p) {
      p = fetch(BASE + src)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((b) => this.ctx!.decodeAudioData(b))
        .catch(() => null)
      this.buffers.set(src, p)
    }
    return p
  }

  /** Warm the cache (e.g. the next line) without playing. */
  preload(src: string) {
    if (this.ctx) void this.load(src)
  }

  /**
   * Speak a sequence of clips (a line said 3 times, a takbir then a line).
   * Resolves when done or stopped; `onClip` reports which clip is playing
   * and when it started (AudioContext time).
   */
  async speak(clips: { src: string; gain?: number }[], gapS = 0.45, onClip?: (index: number, startAt: number) => void): Promise<void> {
    if (!this.ctx) return
    this.stopSpeaking()
    const token = (this.token = {})
    const buffers = await Promise.all(clips.map((c) => this.load(c.src)))
    if (token !== this.token || !this.ctx) return
    let t = this.ctx.currentTime + 0.06
    this.duck(true)
    this.setSpeaking(true)
    const ends: Promise<void>[] = []
    buffers.forEach((buf, i) => {
      if (!buf) return
      const src = this.ctx!.createBufferSource()
      src.buffer = buf
      const gain = this.ctx!.createGain()
      gain.gain.value = clips[i]!.gain ?? 1
      src.connect(gain).connect(this.voiceBus)
      src.start(t)
      const startAt = t
      if (onClip) setTimeout(() => token === this.token && onClip(i, startAt), Math.max(0, (startAt - this.ctx!.currentTime) * 1000))
      this.playing.push({ src, gain })
      ends.push(new Promise((res) => (src.onended = () => res())))
      t += buf.duration + gapS
    })
    await Promise.all(ends)
    if (token === this.token) {
      this.duck(false)
      this.setSpeaking(false)
    }
  }
  private token = {}

  stopSpeaking() {
    this.token = {}
    for (const s of this.playing) {
      try {
        s.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.04)
        s.src.stop(this.ctx!.currentTime + 0.2)
      } catch {
        /* already stopped */
      }
    }
    this.playing = []
    this.duck(false)
    this.setSpeaking(false)
  }

  /** Lower the room while the companion speaks. */
  private duck(on: boolean) {
    if (!this.ctx) return
    this.ambienceBus.gain.setTargetAtTime(on ? this.ambienceLevel * 0.6 : this.ambienceLevel, this.ctx.currentTime, on ? 0.12 : 0.6)
  }

  /**
   * Endless ambience for a prayer: its takes shuffled and crossfaded, so it
   * never loops audibly. Switching prayers crossfades the rooms.
   */
  async startAmbience(prayer: string, takes: string[]) {
    if (!this.ctx || !takes.length) return
    if (this.ambience?.prayer === prayer) return
    const state = { prayer, timer: 0, sources: [] as { src: AudioBufferSourceNode; gain: GainNode }[] }
    const order = [...takes].sort(() => Math.random() - 0.5)
    // Have the first take ready before fading the old room out, so switching
    // prayers is a true crossfade rather than a dip.
    const first = await this.load(order[0]!)
    if (!this.ctx || !first) return
    this.stopAmbience(FADE_S)
    this.ambience = state
    let n = 0
    const playNext = (buf: AudioBuffer, at: number) => {
      if (this.ambience !== state || !this.ctx) return
      n++
      const src = this.ctx.createBufferSource()
      src.buffer = buf
      const gain = this.ctx.createGain()
      const start = Math.max(at, this.ctx.currentTime + 0.05)
      const end = start + buf.duration
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(1, start + FADE_S)
      gain.gain.setValueAtTime(1, end - FADE_S)
      gain.gain.linearRampToValueAtTime(0, end)
      src.connect(gain).connect(this.ambienceBus)
      src.start(start)
      src.stop(end + 0.1)
      state.sources.push({ src, gain })
      src.onended = () => (state.sources = state.sources.filter((s) => s.src !== src))
      // Fetch the next take now, then start it exactly as this one fades out.
      const nextAt = end - FADE_S
      const nextSrc = order[n % order.length]!
      void this.load(nextSrc).then((next) => {
        if (this.ambience !== state || !this.ctx) return
        const wait = Math.max(0, (nextAt - this.ctx.currentTime - 2) * 1000)
        state.timer = window.setTimeout(() => playNext(next ?? buf, nextAt), wait)
      })
    }
    playNext(first, this.ctx.currentTime)
  }

  stopAmbience(fadeS = 1.5) {
    const state = this.ambience
    this.ambience = null
    if (!state || !this.ctx) return
    clearTimeout(state.timer)
    for (const s of state.sources) {
      try {
        s.gain.gain.cancelScheduledValues(this.ctx.currentTime)
        s.gain.gain.setTargetAtTime(0, this.ctx.currentTime, fadeS / 3)
        s.src.stop(this.ctx.currentTime + fadeS + 0.2)
      } catch {
        /* already stopped */
      }
    }
  }
}

export const audio = new Engine()

/** React: whether the companion is speaking right now. */
export function useCompanionSpeaking() {
  const [on, setOn] = useState(audio.speaking)
  useEffect(() => audio.onSpeaking(setOn), [])
  return on
}
