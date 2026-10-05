// PrayAlong's voice:
// - the examples played before the learner's turn: the qari, Sheikh Khalifah At-Tunaiji, for the
//   Quran ayah by ayah (Quran is never TTS), and the recorded dhikr for every other line;
// - the voice coach: English lines pre-rendered with Inflect-Nano-v2 (tools/voice/render_coach.py),
//   other languages through the browser's own voice;
// - the Quran Lab ASR following the learner, word by word, on this device. It only ever confirms.
// One clip plays at a time, and while PrayAlong plays the microphone gate is closed so the speaker
// never counts as the learner.
import COACH from './coach-lines.json'
import type { AsrClient } from './asr/client'
import { wordsHeard } from './asr/words'

export type CoachKey = keyof typeof COACH.lines
export type AsrStatus = 'off' | 'loading' | 'asking' | 'on' | 'blocked' | 'unsupported' | 'error'

// public/audio/tunaiji and public/audio/dhikr, one clip per line, cut and checked with the Quran Lab
// ASR by tools/voice/cut_lines.py (docs/voice.md).
const QARI = new Set([
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `fatiha-${n}`),
  ...[1, 2, 3, 4].map((n) => `ikhlas-${n}`),
  ...[1, 2, 3, 4, 5].map((n) => `falaq-${n}`),
])
const DHIKR = new Set([
  'takbir', 'thana-1', 'thana-2', 'taawwudh', 'ruku', 'tasmi', 'tahmid', 'sujud', 'jalsah',
  'tashahhud-1', 'tashahhud-2', 'tashahhud-3', 'tashahhud-4', 'salawat-1', 'salawat-2', 'salawat-3', 'salawat-4',
  'refuge-1', 'refuge-2', 'salam', 'istighfar', 'antas-salam',
])
/** Who recites a line's example: the qari (Quran), the dhikr recording, or nobody yet. */
export const exampleOf = (lineId: string) => (QARI.has(lineId) ? 'qari' : DHIKR.has(lineId) ? 'dhikr' : null)

const at = (path: string) => new URL(path, document.baseURI).href

class Voice {
  /** What PrayAlong is playing right now, and for an example, whose line. */
  playing = $state<'example' | 'coach' | null>(null)
  line = $state<string | null>(null)
  asr = $state<AsrStatus>('off')
  /** Model download, 0–100. */
  progress = $state(0)
  /** What the ASR heard since the current line began (model symbols). */
  hyp = $state.raw<string[]>([])
  /** The learner is speaking (energy gate), for the listening dot. */
  speaking = $state(false)

  private audio: HTMLAudioElement | null = null
  private client: AsrClient | null = null
  private committed: string[] = []
  private token = 0

  /** Play one clip. Resolves when it ends, fails, or `signal` aborts (never rejects). */
  play(kind: 'example' | 'coach', src: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    const audio = (this.audio ??= new Audio())
    audio.pause()
    audio.src = src
    this.playing = kind
    this.client?.gate(false)
    return new Promise<void>((resolve) => {
      const done = () => {
        audio.removeEventListener('ended', done)
        audio.removeEventListener('error', done)
        signal.removeEventListener('abort', stop)
        if (this.playing === kind) this.playing = null
        // A short tail so the room's echo isn't heard as the learner.
        setTimeout(() => this.playing === null && this.client?.gate(true), 250)
        resolve()
      }
      const stop = () => {
        audio.pause()
        done()
      }
      audio.addEventListener('ended', done)
      audio.addEventListener('error', done)
      signal.addEventListener('abort', stop)
      audio.play().catch(done) // autoplay refused: carry on silently
    })
  }

  /** Play a line's example (resolves at once if it has none). */
  example(lineId: string, signal: AbortSignal) {
    const by = exampleOf(lineId)
    if (!by) return Promise.resolve()
    this.line = lineId
    return this.play('example', at(`audio/${by === 'qari' ? 'tunaiji' : 'dhikr'}/${lineId}.m4a`), signal).finally(() => {
      if (this.line === lineId) this.line = null
    })
  }

  /** Speak a coach line: the Inflect clip in English, the browser's voice in other languages. */
  coach(key: CoachKey, locale: string, text: string, signal: AbortSignal): Promise<void> {
    if (locale === 'en' || !('speechSynthesis' in window)) return this.play('coach', at(`audio/coach/${key}.m4a`), signal)
    return this.speak(text, locale, signal)
  }

  private speak(text: string, lang: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    u.rate = 0.95
    this.playing = 'coach'
    this.client?.gate(false)
    return new Promise<void>((resolve) => {
      const done = () => {
        signal.removeEventListener('abort', stop)
        if (this.playing === 'coach') this.playing = null
        setTimeout(() => this.playing === null && this.client?.gate(true), 250)
        resolve()
      }
      const stop = () => {
        speechSynthesis.cancel()
        done()
      }
      u.onend = done
      u.onerror = done
      signal.addEventListener('abort', stop)
      speechSynthesis.cancel()
      speechSynthesis.speak(u)
    })
  }

  /** Load the ASR (73 MB, once) and open the microphone. */
  async listen() {
    if (this.asr === 'loading' || this.asr === 'asking' || this.asr === 'on') return
    if (!globalThis.crossOriginIsolated || !navigator.mediaDevices?.getUserMedia) {
      this.asr = 'unsupported'
      return
    }
    const my = ++this.token
    this.asr = 'loading'
    this.progress = 0
    try {
      const { AsrClient } = await import('./asr/client')
      const c = await AsrClient.create((p) => (this.progress = p))
      if (my !== this.token) return void c.stop()
      c.onTokens = (tokens, final) => {
        if (final) {
          this.committed = this.committed.concat(tokens)
          this.hyp = this.committed
        } else this.hyp = this.committed.concat(tokens)
      }
      c.onActivity = (speech) => {
        if (speech !== this.speaking) this.speaking = speech
      }
      this.asr = 'asking'
      await c.startMic()
      if (my !== this.token) return void c.stop()
      c.gate(this.playing === null)
      this.client = c
      this.asr = 'on'
    } catch (e) {
      if (my !== this.token) return
      console.warn('[voice] ASR:', e)
      this.asr = (e as DOMException)?.name === 'NotAllowedError' ? 'blocked' : 'error'
    }
  }

  stopListening() {
    this.token++
    void this.client?.stop()
    this.client = null
    this.asr = 'off'
    this.speaking = false
    this.newLine()
  }

  /** Forget what was heard: a new line begins. */
  newLine() {
    this.committed = []
    this.hyp = []
    this.client?.reset()
  }

  /** How many Arabic words of this line were heard. */
  heard(lineId: string, arabic: string) {
    return this.asr === 'on' ? wordsHeard(lineId, arabic, this.hyp) : 0
  }

  /** Test hook: stream a recording to the ASR as if it were the learner. */
  feed(url: string) {
    return this.client?.feedUrl(url)
  }
}

export const voice = new Voice()
