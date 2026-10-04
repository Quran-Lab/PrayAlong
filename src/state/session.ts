import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { buildSequence, nextPoseChange } from '@/sequence/build'
import type { PoseClass, PrayerId, PrayerSequence, Step } from '@/sequence/types'

export type Phase = 'ready' | 'praying' | 'complete'
export type Pace = 'slow' | 'normal' | 'brisk'
export type ArabicSize = 'm' | 'l' | 'xl'

export interface Settings {
  transliteration: boolean
  translation: boolean
  arabicSize: ArabicSize
  pace: Pace
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
  updateSettings: (patch: Partial<Settings>) => void
  /** A stable pose reported by the hands-free engine. */
  onPose: (pose: PoseClass) => void
}

const fresh = (prayer: PrayerId) => ({ prayer, sequence: buildSequence(prayer), phase: 'ready' as Phase, index: 0 })

export const useSession = create<SessionState>()(
  persist(
    (set, get) => ({
      ...fresh('dhuhr'),
      prayerSource: 'auto',
      autoplay: false,
      handsFree: false,
      settings: { transliteration: true, translation: true, arabicSize: 'l', pace: 'normal' },

      autoSelectPrayer: (id) => {
        const { prayerSource, phase, prayer } = get()
        if (prayerSource === 'auto' && phase === 'ready' && prayer !== id) set(fresh(id))
      },
      choosePrayer: (id) => set({ ...fresh(id), prayerSource: 'manual' }),
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
      restart: () => set({ ...fresh(get().prayer) }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setHandsFree: (handsFree) => set({ handsFree, autoplay: false }),
      updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

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
    }),
    {
      name: 'prayalong:session',
      partialize: (s) => ({ settings: s.settings }),
    },
  ),
)

export const currentStep = (s: Pick<SessionState, 'sequence' | 'index'>): Step => s.sequence.steps[s.index]!
