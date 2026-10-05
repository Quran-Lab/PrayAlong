/** Keep the screen awake while praying — nobody should have to tap mid-sujud. Returns a cleanup. */
export function holdWakeLock(): () => void {
  if (!('wakeLock' in navigator)) return () => {}
  let lock: WakeLockSentinel | null = null
  let cancelled = false
  const acquire = async () => {
    try {
      lock = await navigator.wakeLock.request('screen')
      if (cancelled) lock.release()
    } catch {
      /* denied or unsupported — not worth bothering the user */
    }
  }
  const onVisible = () => document.visibilityState === 'visible' && acquire()
  acquire()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    cancelled = true
    document.removeEventListener('visibilitychange', onVisible)
    lock?.release().catch(() => {})
  }
}
