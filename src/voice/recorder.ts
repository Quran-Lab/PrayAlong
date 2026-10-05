/**
 * Opt-in session recording, so real sessions become replay fixtures.
 *
 * Audio (the raw microphone at 16 kHz, before the companion gate) stays in the
 * ASR worker; this keeps the log of everything the engine did, on the worker's
 * audio clock, and saves both as local downloads. Nothing is uploaded.
 *
 * Log entries are [audioSeconds, kind, data]. Kinds: tokens, endpoint, level
 * (speech changes plus a level every second), event (follower), action (driver
 * move), session (index or phase change), gate, companion.
 */

export type RecordKind = 'tokens' | 'endpoint' | 'level' | 'event' | 'action' | 'session' | 'gate' | 'companion' | 'note'

export interface SessionRecordFile {
  version: 1
  app: 'prayalong'
  startedAt: string
  prayer: string
  /** Worker audio clock (s) at the first recorded sample: subtract it to index the WAV. */
  audioStart: number
  sampleRate: number
  userAgent: string
  entries: [number, RecordKind, unknown][]
}

export class SessionRecorder {
  readonly startedAt = new Date()
  entries: [number, RecordKind, unknown][] = []
  private lastAt = 0
  private lastSpeech: boolean | null = null
  private lastLevelLog = -Infinity

  constructor(readonly prayer: string) {}

  /** `at`: worker audio clock in seconds (or the latest one seen, for UI-side entries). */
  add(kind: RecordKind, data: unknown, at = this.lastAt) {
    this.lastAt = Math.max(this.lastAt, at)
    this.entries.push([Math.round(at * 1000) / 1000, kind, data])
  }

  level(speech: boolean, rms: number, at: number) {
    if (speech === this.lastSpeech && at - this.lastLevelLog < 1) return
    this.lastSpeech = speech
    this.lastLevelLog = at
    this.add('level', { speech, rms: Math.round(rms * 10000) / 10000 }, at)
  }

  file(audioStart: number, sampleRate: number): SessionRecordFile {
    return {
      version: 1,
      app: 'prayalong',
      startedAt: this.startedAt.toISOString(),
      prayer: this.prayer,
      audioStart,
      sampleRate,
      userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
      entries: this.entries,
    }
  }
}

/** 16-bit mono WAV around existing PCM. */
export function wavFromInt16(pcm: Int16Array, sampleRate: number): Blob {
  const header = new DataView(new ArrayBuffer(44))
  const str = (o: number, s: string) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  header.setUint32(4, 36 + pcm.byteLength, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, sampleRate, true)
  header.setUint32(28, sampleRate * 2, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  str(36, 'data')
  header.setUint32(40, pcm.byteLength, true)
  return new Blob([header.buffer, pcm.buffer as ArrayBuffer], { type: 'audio/wav' })
}

/** Save a blob as a local download (no network). */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export function recordingName(prayer: string, d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `prayalong-${prayer}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
