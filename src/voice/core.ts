import type { SurahId } from '@/content/recitations'
import { switchSurah } from '@/sequence/build'
import type { PrayerId, Step } from '@/sequence/types'
import { announcedBy, VoiceDriver, type DriverAction, type DriverConfig, type SessionView } from './driver'
import { Follower, type FollowerOptions } from './follower'
import type { FollowerEvent, FollowStep } from './types'

export const followSteps = (steps: readonly Step[]): FollowStep[] =>
  steps.map((s, i) => ({ lineId: s.recitationId, repeat: s.repeat, voice: s.voice, takbirBefore: announcedBy(steps, i) === 'takbir' }))

export interface CoreHooks {
  /** Current session state. */
  view: () => SessionView
  /** Apply one action to the session (forward only). */
  apply: (a: DriverAction) => void
  onEvent?: (e: FollowerEvent, now: number) => void
  onAction?: (a: DriverAction, now: number) => void
}

/**
 * The decoder-to-session loop, shared by the app hook and the replay harness
 * so the harness measures exactly what ships. Times: `now` is milliseconds on
 * whatever clock the caller uses (wall clock live, audio clock in replay).
 */
export class VoiceCore {
  readonly follower: Follower
  readonly driver: VoiceDriver
  private steps: readonly Step[]

  constructor(
    steps: readonly Step[],
    driver: Partial<DriverConfig> & Pick<DriverConfig, 'stepMs'>,
    private hooks: CoreHooks,
    follower: Partial<FollowerOptions> = {},
  ) {
    this.steps = steps
    this.follower = new Follower(followSteps(steps), follower)
    this.driver = new VoiceDriver(driver)
  }

  /** The session changed (any source): re-anchor the follower, reset timers. */
  sync(now: number) {
    const v = this.hooks.view()
    if (v.steps !== this.steps) {
      this.steps = v.steps
      this.follower.setSteps(followSteps(v.steps), v.phase === 'ready' ? 0 : v.index)
    } else this.follower.setAnchor(v.phase === 'ready' ? 0 : v.index)
    this.driver.sync(v, now)
  }

  tokens(tokens: readonly string[], at: number, now: number) {
    // The decoder hearing phonemes is speech, even when it is too quiet (or
    // too noisy) for the energy gate to say so. Never a speech onset: tokens
    // lag the audio, so the last phonemes of a line arrive after the session
    // moved on and would look like the next line being started.
    if (tokens.length) this.driver.onTokens(now)
    this.handle(this.follower.push(tokens, at), now)
  }

  endpoint(at: number, now: number) {
    this.follower.segmentEnd()
    this.handle(this.follower.flush(at), now)
  }

  /** ~10 Hz from the worker: speech activity at audio time `at`. */
  level(speech: boolean, at: number, now: number) {
    this.driver.onLevel(speech, now)
    this.handle(this.follower.level(at, speech), now)
  }

  /** The companion started or stopped reciting (holds the line timers). */
  companion(on: boolean, now: number) {
    this.driver.setCompanion(on, now)
  }

  tick(now: number) {
    this.act(this.driver.tick(this.hooks.view(), now), now)
  }

  private handle(events: FollowerEvent[], now: number) {
    // Repetition counts first, so the driver judges events with them.
    const v = this.hooks.view()
    this.driver.setReps(v.index, this.follower.repsOf(v.index))
    for (const e of events) {
      this.hooks.onEvent?.(e, now)
      this.act(this.driver.onEvent(e, this.hooks.view(), now), now)
    }
  }

  private act(a: DriverAction | null, now: number) {
    if (!a) return
    this.hooks.onAction?.(a, now)
    this.hooks.apply(a)
    this.sync(now)
  }
}

/** A minimal session for replay and tests: same forward-only semantics as the store. */
export class SessionSim {
  phase: SessionView['phase'] = 'ready'
  index = 0
  steps: readonly Step[]
  surahs: Partial<Record<number, SurahId>> = {}
  /** `prayer` enables surah switches (needed to rebuild the sequence). */
  constructor(steps: readonly Step[], readonly prayer?: PrayerId) {
    this.steps = steps
  }
  view = (): SessionView => ({ phase: this.phase, index: this.index, steps: this.steps })
  apply = (a: DriverAction) => {
    if (a.type === 'begin') {
      if (this.phase === 'ready') {
        this.phase = 'praying'
        this.index = 0
      }
    } else if (a.type === 'finish') {
      if (this.phase === 'praying' && this.index === this.steps.length - 1) this.phase = 'complete'
    } else if (a.type === 'surah') {
      if (!this.prayer || this.surahs[a.rakah] === a.surah) return
      const seq = { version: 1 as const, prayer: this.prayer, rakahs: 0, steps: [...this.steps] }
      const r = switchSurah(seq, this.surahs, a.rakah, a.surah, this.index)
      this.steps = r.sequence.steps
      this.surahs = r.surahs
      this.index = r.index
    } else if (this.phase === 'praying' && a.index > this.index) {
      this.index = Math.min(a.index, this.steps.length - 1)
    }
  }
}
