import type { Attachment } from 'svelte/attachments'

/**
 * Fit a fixed-size box's text: sets `--fit` (from `min` to 1) on the box, and the font sizes
 * inside multiply by it. Runs again when the box is resized, when the fonts arrive, and when
 * `key` changes (pass whatever changes the text: settings, language).
 */
export function fitText(key: unknown, min = 0.55): Attachment<HTMLElement> {
  void key
  return (box) => {
    const fits = () => box.scrollHeight <= box.clientHeight + 1
    const run = () => {
      box.style.setProperty('--fit', '1')
      if (fits()) return
      let lo = min
      let hi = 1
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2
        box.style.setProperty('--fit', mid.toFixed(3))
        if (fits()) lo = mid
        else hi = mid
      }
      box.style.setProperty('--fit', lo.toFixed(3))
    }
    // The box's size comes from the layout, never from its text, so fitting can't loop.
    const ro = new ResizeObserver(run)
    ro.observe(box)
    let alive = true
    document.fonts?.ready.then(() => alive && run())
    return () => {
      alive = false
      ro.disconnect()
    }
  }
}
