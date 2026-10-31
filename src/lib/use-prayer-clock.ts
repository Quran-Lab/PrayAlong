import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from '@/state/session'
import { estimateFromTimeZone, hasLocationPermission, loadSavedPlace, requestDevicePlace, type Place } from './location'
import { detectPrayer, timesFor } from './prayer-times'

/**
 * Knows where the user is and which prayer is due, and keeps the session's
 * prayer in step with the clock until the user picks one themselves.
 */
export function usePrayerClock() {
  const [place, setPlace] = useState<Place>(() => loadSavedPlace() ?? estimateFromTimeZone())
  const [now, setNow] = useState(() => new Date())
  const [locating, setLocating] = useState(false)
  /** Why the last "Use my location" failed, to say so instead of doing nothing. */
  const [locationError, setLocationError] = useState<'denied' | 'unavailable' | null>(null)
  const autoSelect = useSession((s) => s.autoSelectPrayer)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  // If location was granted before, refresh it quietly — never prompt on load.
  useEffect(() => {
    let alive = true
    hasLocationPermission().then((granted) => {
      if (granted) requestDevicePlace().then((p) => alive && setPlace(p)).catch(() => {})
    })
    return () => {
      alive = false
    }
  }, [])

  const detected = useMemo(() => detectPrayer(place, now), [place, now])
  const times = useMemo(() => timesFor(place, now), [place, now])

  useEffect(() => autoSelect(detected.id), [detected.id, autoSelect])

  const useMyLocation = useCallback(async () => {
    setLocating(true)
    setLocationError(null)
    try {
      setPlace(await requestDevicePlace())
    } catch (err) {
      // Declined or unavailable: keep the time-zone estimate, and say why.
      setLocationError((err as GeolocationPositionError | undefined)?.code === 1 ? 'denied' : 'unavailable')
    } finally {
      setLocating(false)
    }
  }, [])

  return { place, detected, times, locating, locationError, useMyLocation }
}

export type PrayerClock = ReturnType<typeof usePrayerClock>
