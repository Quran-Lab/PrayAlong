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
    try {
      setPlace(await requestDevicePlace())
    } finally {
      setLocating(false)
    }
  }, [])

  return { place, detected, times, locating, useMyLocation }
}

export type PrayerClock = ReturnType<typeof usePrayerClock>
