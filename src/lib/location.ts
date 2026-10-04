/**
 * Where the user is, for prayer times. We never prompt on load: until the
 * user opts in, we estimate from the device time zone, which picks the right
 * prayer almost all of the time.
 */

export interface Place {
  latitude: number
  longitude: number
  /** "gps" when the browser gave us a position; "timezone" when estimated. */
  source: 'gps' | 'timezone'
  label?: string
}

const STORAGE_KEY = 'prayalong:place'

// Representative cities for common time zones. Good enough to decide which
// prayer is current; exact times need the real position.
const ZONES: Record<string, [lat: number, lon: number, label: string]> = {
  'Europe/Copenhagen': [55.68, 12.57, 'Copenhagen'],
  'Europe/Stockholm': [59.33, 18.07, 'Stockholm'],
  'Europe/Oslo': [59.91, 10.75, 'Oslo'],
  'Europe/Helsinki': [60.17, 24.94, 'Helsinki'],
  'Europe/Berlin': [52.52, 13.4, 'Berlin'],
  'Europe/Amsterdam': [52.37, 4.9, 'Amsterdam'],
  'Europe/Brussels': [50.85, 4.35, 'Brussels'],
  'Europe/Paris': [48.86, 2.35, 'Paris'],
  'Europe/London': [51.51, -0.13, 'London'],
  'Europe/Dublin': [53.35, -6.26, 'Dublin'],
  'Europe/Madrid': [40.42, -3.7, 'Madrid'],
  'Europe/Rome': [41.9, 12.5, 'Rome'],
  'Europe/Vienna': [48.21, 16.37, 'Vienna'],
  'Europe/Zurich': [47.38, 8.54, 'Zürich'],
  'Europe/Istanbul': [41.01, 28.98, 'Istanbul'],
  'Europe/Sarajevo': [43.86, 18.41, 'Sarajevo'],
  'Europe/Moscow': [55.76, 37.62, 'Moscow'],
  'Asia/Riyadh': [24.71, 46.68, 'Riyadh'],
  'Asia/Dubai': [25.2, 55.27, 'Dubai'],
  'Asia/Qatar': [25.29, 51.53, 'Doha'],
  'Asia/Kuwait': [29.38, 47.99, 'Kuwait City'],
  'Asia/Baghdad': [33.31, 44.36, 'Baghdad'],
  'Asia/Tehran': [35.69, 51.39, 'Tehran'],
  'Asia/Amman': [31.95, 35.93, 'Amman'],
  'Asia/Beirut': [33.89, 35.5, 'Beirut'],
  'Asia/Jerusalem': [31.77, 35.21, 'Jerusalem'],
  'Asia/Karachi': [24.86, 67.0, 'Karachi'],
  'Asia/Kolkata': [28.61, 77.21, 'Delhi'],
  'Asia/Dhaka': [23.81, 90.41, 'Dhaka'],
  'Asia/Kuala_Lumpur': [3.14, 101.69, 'Kuala Lumpur'],
  'Asia/Singapore': [1.35, 103.82, 'Singapore'],
  'Asia/Jakarta': [-6.21, 106.85, 'Jakarta'],
  'Asia/Tashkent': [41.3, 69.24, 'Tashkent'],
  'Africa/Cairo': [30.04, 31.24, 'Cairo'],
  'Africa/Casablanca': [33.57, -7.59, 'Casablanca'],
  'Africa/Algiers': [36.75, 3.06, 'Algiers'],
  'Africa/Tunis': [36.81, 10.18, 'Tunis'],
  'Africa/Lagos': [6.52, 3.38, 'Lagos'],
  'Africa/Nairobi': [-1.29, 36.82, 'Nairobi'],
  'Africa/Johannesburg': [-26.2, 28.05, 'Johannesburg'],
  'America/New_York': [40.71, -74.01, 'New York'],
  'America/Toronto': [43.65, -79.38, 'Toronto'],
  'America/Chicago': [41.88, -87.63, 'Chicago'],
  'America/Denver': [39.74, -104.99, 'Denver'],
  'America/Los_Angeles': [34.05, -118.24, 'Los Angeles'],
  'America/Sao_Paulo': [-23.55, -46.63, 'São Paulo'],
  'Australia/Sydney': [-33.87, 151.21, 'Sydney'],
  'Australia/Melbourne': [-37.81, 144.96, 'Melbourne'],
}

export function estimateFromTimeZone(date = new Date()): Place {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const known = ZONES[zone]
  if (known) return { latitude: known[0], longitude: known[1], source: 'timezone', label: known[2] }
  // Unknown zone: put the sun's noon where the clock says it is.
  const offsetHours = -date.getTimezoneOffset() / 60
  return { latitude: 30, longitude: offsetHours * 15, source: 'timezone' }
}

export function loadSavedPlace(): Place | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const place = JSON.parse(raw) as Place
    return Number.isFinite(place.latitude) && Number.isFinite(place.longitude) ? place : null
  } catch {
    return null
  }
}

function savePlace(place: Place) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(place))
  } catch {
    /* storage unavailable — fine, we just ask again next time */
  }
}

export function requestDevicePlace(): Promise<Place> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Location is not available on this device'))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const place: Place = {
          // ~1 km precision is plenty for prayer times and kinder to privacy.
          latitude: Math.round(pos.coords.latitude * 100) / 100,
          longitude: Math.round(pos.coords.longitude * 100) / 100,
          source: 'gps',
        }
        savePlace(place)
        resolve(place)
      },
      (err) => reject(err),
      { enableHighAccuracy: false, maximumAge: 6 * 60 * 60 * 1000, timeout: 15_000 },
    )
  })
}

/** True when the user already granted location, so we can refresh silently. */
export async function hasLocationPermission(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return status?.state === 'granted'
  } catch {
    return false
  }
}
