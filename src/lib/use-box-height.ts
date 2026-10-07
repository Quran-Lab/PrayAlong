import { useLayoutEffect, useRef, useState } from 'react'

/** An element's rendered height in whole pixels, kept up to date as it resizes. */
export function useBoxHeight<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setHeight(Math.round(el.getBoundingClientRect().height))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, height] as const
}

/**
 * Small devices (few cores or little memory) drop the glass blur up front; the rest drop
 * it while the speech decoder falls behind. The page then marks <html data-lite>.
 */
export const LITE_DEVICE =
  typeof navigator !== 'undefined' &&
  ((navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 2)
