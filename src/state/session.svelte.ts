import { buildSequence, nextPoseChange } from '@/sequence/build'
import { OFFERED, READS_ARABIC, type Locale } from '@/i18n/locales'
import { DEFAULT_OUTFIT, isOutfit, type Outfit } from '@/components/stage/characters'
import { DEFAULT_PALETTE, isPalette, type Palette } from '@/lib/brand'
import type { PoseClass, PrayerId, PrayerSequence, Step } from '@/sequence/types'

export type Phase = 'ready' | 'praying' | 'complete'
export type TextSize = 'm' | 'l' | 'xl'
export type Theme = 'system' | 'light' | 'dark'
/**
 * How the learner prays this time. Both follow the body (camera) and the recitation (microphone)
 * and speak each movement; "watch" also plays the qari's example before each verse of Al-Fātiḥah.
 */
export type Mode = 'watch' | 'practice'

export interface Settings {
  /** 'auto' follows the browser language. */
  locale: 'auto' | Locale
  /** null = the default for the language. */
  arabic: boolean | null
  transliteration: boolean | null
  translation: boolean | null
  textSize: TextSize
  characterId: string
  /** The colour of the companion's clothes. */
  outfit: Outfit
  theme: Theme
  /** The brand colour (docs/DESIGN.md). */
  palette: Palette
  /** Follow the body with the camera. On unless the learner turns it off in the header. */
  handsFree: boolean
}

/**
 * What to show, after applying per-language defaults. The Arabic is always
 * shown by default, in Uthman Taha Naskh, with the pronunciation under it for
 * everyone who doesn't read Arabic script.
 */
export function display(settings: Settings, locale: Locale) {
  const readsArabic = READS_ARABIC.has(locale)
  return {
    arabic: settings.arabic ?? true,
    transliteration: settings.transliteration ?? !readsArabic,
    translation: settings.translation ?? locale !== 'ar',
  }
}

const DEFAULT_SETTINGS: Settings = {
  locale: 'auto',
  arabic: null,
  transliteration: null,
  translation: null,
  textSize: 'l',
  characterId: 'brother',
  outfit: DEFAULT_OUTFIT,
  theme: 'system',
  palette: DEFAULT_PALETTE,
  handsFree: true,
}

const STORAGE_KEY = 'prayalong:session'

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null')
    // Older saves (Zustand) wrap the settings in { state }.
    const saved = (raw?.state?.settings ?? raw?.settings ?? {}) as Partial<Settings>
    // Only the settings that still exist (older saves have voice switches, pace and so on).
    const settings: Settings = { ...DEFAULT_SETTINGS }
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[])
      if (saved[key] !== undefined) Object.assign(settings, { [key]: saved[key] })
    if (!isPalette(settings.palette)) settings.palette = DEFAULT_PALETTE
    if (!isOutfit(settings.outfit)) settings.outfit = DEFAULT_OUTFIT
    if (settings.locale !== 'auto' && !OFFERED.includes(settings.locale)) settings.locale = 'auto'
    return settings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/**
 * The prayer session: which prayer, where in it we are, and the user's
 * settings (the only part that is saved). Plain methods on reactive state,
 * so components and tests drive it the same way.
 */
export class Session {
  prayer = $state<PrayerId>('dhuhr')
  /** "auto" until the user picks a prayer themselves. */
  prayerSource = $state<'auto' | 'manual'>('auto')
  sequence = $state.raw<PrayerSequence>(buildSequence('dhuhr'))
  phase = $state<Phase>('ready')
  index = $state(0)
  /** Timed guidance when hands-free is off. */
  autoplay = $state(false)
  /** The camera is on: the learner chose a mode with hands-free on. */
  handsFree = $state(false)
  mode = $state<Mode>('watch')
  /** Hands-free driven by on-screen buttons instead of the camera. */
  demo = $state(false)
  settings = $state<Settings>(loadSettings())

  get step(): Step {
    return this.sequence.steps[this.index]!
  }

  private fresh(prayer: PrayerId) {
    this.prayer = prayer
    this.sequence = buildSequence(prayer)
    this.phase = 'ready'
    this.index = 0
  }

  /** Follow the clock — ignored once the user has chosen, or while praying. */
  autoSelectPrayer(id: PrayerId) {
    if (this.prayerSource === 'auto' && this.phase === 'ready' && this.prayer !== id) this.fresh(id)
  }
  choosePrayer(id: PrayerId) {
    this.fresh(id)
    this.prayerSource = 'manual'
  }
  begin() {
    this.phase = 'praying'
    this.index = 0
  }
  next() {
    if (this.phase === 'ready') return this.begin()
    if (this.phase !== 'praying') return
    if (this.index < this.sequence.steps.length - 1) this.index++
    else {
      this.phase = 'complete'
      this.autoplay = false
    }
  }
  prev() {
    if (this.phase === 'complete') {
      this.phase = 'praying'
      this.index = this.sequence.steps.length - 1
    } else if (this.phase === 'praying' && this.index > 0) this.index--
  }
  goTo(index: number) {
    this.phase = 'praying'
    this.index = Math.max(0, Math.min(index, this.sequence.steps.length - 1))
  }
  restart() {
    this.fresh(this.prayer)
  }
  setAutoplay(on: boolean) {
    this.autoplay = on
  }
  setHandsFree(on: boolean) {
    this.handsFree = on
    this.autoplay = false
    this.demo = on && this.demo
  }
  setDemo(on: boolean) {
    this.demo = on
    this.handsFree = on || this.handsFree
    this.autoplay = false
  }
  updateSettings(patch: Partial<Settings>) {
    this.settings = { ...this.settings, ...patch }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings: this.settings, version: 3 }))
    } catch {
      /* private mode — settings last for this visit */
    }
  }

  /** A stable pose reported by the hands-free engine. */
  onPose(pose: PoseClass) {
    if (this.phase === 'ready') {
      if (pose === 'hands-raised') this.begin()
      return
    }
    if (this.phase !== 'praying') return
    // Only listen for the *next* movement, so a misread can never skip ahead.
    const target = nextPoseChange(this.sequence.steps, this.index)
    if (target < 0) return
    const want = this.sequence.steps[target]!.pose
    // Standing up with the hands raised (rising from ruku, or for the third rak'ah) is standing.
    const raisedToStand = want === 'standing' && pose === 'hands-raised' && this.step.pose !== 'hands-raised'
    if (want === pose || raisedToStand) this.index = target
  }
}

export const session = new Session()
