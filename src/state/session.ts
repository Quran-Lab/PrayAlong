import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildSequence, nextPoseChange, switchSurah as switchSurahIn } from '@/sequence/build'
import type { SurahId } from '@/content/recitations' // [voice]
import { READS_ARABIC, type Locale } from '@/i18n/locales'
import type { PoseClass, PrayerId, PrayerSequence, Step } from '@/sequence/types'

export type Phase = 'ready' | 'praying' | 'complete'
export type Pace = 'slow' | 'normal' | 'brisk'
export type TextSize = 'm' | 'l' | 'xl'
export type Mode = 'teach' | 'pray'

export interface Settings {
  /** 'auto' follows the browser language. */
  locale: 'auto' | Locale
  /** null = the default for the language (Arabic script only for those who read it). */
  arabic: boolean | null
  transliteration: boolean | null
  translation: boolean | null
  textSize: TextSize
  pace: Pace
  /** Soft chime + haptic when hands-free follows a movement. */
  sounds: boolean
  characterId: string
  /**
   * teach: the companion says how to do each movement and recites each line for you to
   * repeat. pray: you recite, PrayAlong follows quietly (the microphone is never muted).
   */
  mode: Mode
  /** 0..1 */
  volume: number
  /** Raise the hands going into ruku and rising from it (raf' al-yadayn). */
  raiseHands: boolean
  /** Keep this session's microphone audio and voice log on this device, to save and send for debugging. */
  recordSessions: boolean
}

/** What to show, after applying per-language defaults. */
export function display(settings: Settings, locale: Locale) {
  const readsArabic = READS_ARABIC.has(locale)
  return {
    arabic: settings.arabic ?? readsArabic,
    transliteration: settings.transliteration ?? !readsArabic,
    translation: settings.translation ?? locale !== 'ar',
  }
}

export const PACE_FACTOR: Record<Pace, number> = { slow: 1.35, normal: 1, brisk: 0.75 }

interface SessionState {
  prayer: PrayerId
  /** "auto" until the user picks a prayer themselves. */
  prayerSource: 'auto' | 'manual'
  sequence: PrayerSequence
  phase: Phase
  index: number
  /** Timed guidance when hands-free is off. */
  autoplay: boolean
  handsFree: boolean
  /** Hands-free driven by on-screen buttons instead of the camera. */
  demo: boolean
  settings: Settings

  /** Follow the clock — ignored once the user has chosen, or while praying. */
  autoSelectPrayer: (id: PrayerId) => void
  choosePrayer: (id: PrayerId) => void
  begin: () => void
  next: () => void
  prev: () => void
  goTo: (index: number) => void
  restart: () => void
  setAutoplay: (on: boolean) => void
  setHandsFree: (on: boolean) => void
  setDemo: (on: boolean) => void
  updateSettings: (patch: Partial<Settings>) => void
  /** A stable pose reported by demo mode (or the compatibility engine). */
  onPose: (pose: PoseClass) => void
  /**
   * The hands-free decoder recognised a movement: go to this step. Only
   * ever moves forward; starts the prayer from 'ready'.
   */
  followTo: (index: number) => void
  // [voice] begin: another short surah for a rak'ah (voice follow heard one, or the user chose it).
  surahs: Partial<Record<number, SurahId>>
  switchSurah: (rakah: number, surah: SurahId) => void
  // [voice] end
}

const fresh = (prayer: PrayerId) => ({ prayer, sequence: buildSequence(prayer), phase: 'ready' as Phase, index: 0, surahs: {} as Partial<Record<number, SurahId>> })

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      ...fresh('dhuhr'),
      prayerSource: 'auto',
      autoplay: false,
      handsFree: false,
      demo: false,
      settings: {
        locale: 'auto',
        arabic: null,
        transliteration: null,
        translation: null,
        textSize: 'l',
        pace: 'normal',
        sounds: true,
        characterId: 'yusuf',
        mode: 'teach',
        volume: 0.9,
        raiseHands: true,
        recordSessions: false,
      },

      autoSelectPrayer: (id) => {
        const { prayerSource, phase, prayer } = get()
        if (prayerSource === 'auto' && phase === 'ready' && prayer !== id) set(fresh(id))
      },
      choosePrayer: (id) => set({ ...fresh(id), prayerSource: 'manual', autoplay: false }),
      begin: () => set({ phase: 'praying', index: 0 }),
      next: () => {
        const { phase, index, sequence } = get()
        if (phase === 'ready') return set({ phase: 'praying', index: 0 })
        if (phase !== 'praying') return
        if (index < sequence.steps.length - 1) set({ index: index + 1 })
        else set({ phase: 'complete', autoplay: false })
      },
      prev: () => {
        const { phase, index, sequence } = get()
        if (phase === 'complete') return set({ phase: 'praying', index: sequence.steps.length - 1 })
        if (phase === 'praying' && index > 0) set({ index: index - 1 })
      },
      goTo: (index) => {
        const { sequence } = get()
        set({ phase: 'praying', index: Math.max(0, Math.min(index, sequence.steps.length - 1)) })
      },
      restart: () => set({ ...fresh(get().prayer), autoplay: false }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setHandsFree: (handsFree) => set({ handsFree, autoplay: false, demo: handsFree && get().demo }),
      setDemo: (demo) => set({ demo, handsFree: demo || get().handsFree, autoplay: false }),
      updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      // [voice] begin
      switchSurah: (rakah, surah) => {
        const { sequence, surahs, index } = get()
        if (surahs[rakah] === surah) return
        set(switchSurahIn(sequence, surahs, rakah, surah, index))
      },
      // [voice] end

      onPose: (pose) => {
        const { phase, index, sequence } = get()
        if (phase === 'ready') {
          if (pose === 'hands-raised') set({ phase: 'praying', index: 0 })
          return
        }
        if (phase !== 'praying') return
        // Only listen for the *next* movement, so a misread can never skip ahead.
        const target = nextPoseChange(sequence.steps, index)
        if (target >= 0 && sequence.steps[target]!.pose === pose) set({ index: target })
      },
      followTo: (target) => {
        const { phase, index, sequence } = get()
        if (phase === 'complete' || target < 0 || target >= sequence.steps.length) return
        if (phase === 'ready') return set({ phase: 'praying', index: target })
        if (target > index) set({ index: target })
      },
    }),
    {
      name: 'prayalong:session',
      version: 5,
      partialize: (s) => ({ settings: s.settings }),
      // Older saves predate languages and companions; keep only what still fits.
      migrate: (persisted) => {
        const p = persisted as { settings: Partial<Settings> & Record<string, unknown> }
        if (p?.settings) {
          // v4: no more ambience. v5: two modes replace the voice, guide and repeat-after switches.
          delete p.settings.ambience
          if (!p.settings.mode) p.settings.mode = p.settings.repeatAfter === false && p.settings.guide === false ? 'pray' : 'teach'
          delete p.settings.voice
          delete p.settings.guide
          delete p.settings.repeatAfter
        }
        return p as { settings: Settings }
      },
      merge: (persisted, current) => ({
        ...current,
        settings: { ...current.settings, ...((persisted as { settings?: Partial<Settings> })?.settings ?? {}) },
      }),
    },
  ),
)

export const currentStep = (s: Pick<SessionState, 'sequence' | 'index'>): Step => s.sequence.steps[s.index]!
