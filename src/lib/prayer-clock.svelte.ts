import { session } from '@/state/session.svelte'
import { estimateFromTimeZone, hasLocationPermission, loadSavedPlace, requestDevicePlace, type Place } from './location'
import { detectPrayer, timesFor } from './prayer-times'

/**
 * Knows where the user is and which prayer is due, and keeps the session's
 * prayer in step with the clock until the user picks one themselves.
 */
class PrayerClock {
  place = $state.raw<Place>(loadSavedPlace() ?? estimateFromTimeZone())
  now = $state.raw(new Date())
  locating = $state(false)
  detected = $derived(detectPrayer(this.place, this.now))
  times = $derived(timesFor(this.place, this.now))

  /** Call once from the root component. */
  start() {
    $effect(() => {
      const id = setInterval(() => (this.now = new Date()), 30_000)
      return () => clearInterval(id)
    })
    // If location was granted before, refresh it quietly — never prompt on load.
    $effect(() => {
      let alive = true
      hasLocationPermission().then((granted) => {
        if (granted) requestDevicePlace().then((p) => alive && (this.place = p)).catch(() => {})
      })
      return () => (alive = false)
    })
    $effect(() => session.autoSelectPrayer(this.detected.id))
  }

  useMyLocation = async () => {
    this.locating = true
    try {
      this.place = await requestDevicePlace()
    } catch {
      /* declined or unavailable — keep the time-zone estimate */
    } finally {
      this.locating = false
    }
  }
}

export const clock = new PrayerClock()
export type { PrayerClock }
