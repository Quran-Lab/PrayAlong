import { useEffect, useState } from 'react'
/**
 * PrayAlong's sound: the companion's voice.
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
}

const BASE = `${import.meta.env.BASE_URL}audio/`

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
  private buffers = new Map<string, Promise<AudioBuffer | null>>()
  private playing: { src: AudioBufferSourceNode; gain: GainNode }[] = []

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
    this.setSpeaking(false)
  }
}

export const audio = new Engine()

/** React: whether the companion is speaking right now. */
export function useCompanionSpeaking() {
  const [on, setOn] = useState(audio.speaking)
  useEffect(() => audio.onSpeaking(setOn), [])
  return on
}
