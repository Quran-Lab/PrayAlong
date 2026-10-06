import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import type { PoseName } from './stage/rig/prayer-poses'

type Shot = 'sit' | 'finger' | 'sujud'

/** What a posture needs shown up close: how the feet are folded, the tashahhud finger. */
const SHOTS: Partial<Record<PoseName, Shot[]>> = {
  jalsah: ['sit'],
  tashahhud: ['finger', 'sit'],
  sujud: ['sujud'],
}
const TITLE = { sit: 'guide.feet', sujud: 'guide.feet', finger: 'guide.hand' } as const
const CAPTION = { sit: 'guide.sit', sujud: 'guide.sujud', finger: 'guide.finger' } as const

const src = (character: string, shot: Shot) => `${import.meta.env.BASE_URL}guides/${character}_${shot}.webp`

/** Load the pictures before they are needed, so they appear with the movement. */
function preload(character: string) {
  for (const shot of ['sit', 'finger', 'sujud'] as Shot[]) {
    const img = new Image()
    img.src = src(character, shot)
  }
}

const ease = [0.22, 1, 0.36, 1] as const

/**
 * A close-up of the detail that is hard to see on the companion: how to fold
 * the feet when sitting, the toes in sujud, the raised finger in the
 * tashahhud. It sits under the words, so what to say and how to sit read
 * together. Teach me opens it at each of those movements; Pray with me keeps
 * it as a small "Show how" to tap.
 */
export function PostureGuide({ posture, character, teach }: { posture: PoseName; character: string; teach: boolean }) {
  const t = useT()
  const shots = SHOTS[posture]
  // Open in both modes: it has to read from the mat, a metre from a laptop.
  const [open, setOpen] = useState(true)
  const [tab, setTab] = useState(0)

  useEffect(() => preload(character), [character])
  // Each new movement starts open in Teach me, on its first picture.
  useEffect(() => {
    setOpen(true)
    setTab(0)
  }, [posture, teach])

  const shot = shots?.[Math.min(tab, shots.length - 1)]
  return (
    <AnimatePresence mode="wait" initial={false}>
      {shots && shot && (
        <motion.div
          key={`${posture}-${open}`}
          initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: -6, filter: 'blur(3px)' }}
          transition={{ duration: 0.4, ease, delay: open ? 0.25 : 0 }}
          className="mx-auto mt-[clamp(1rem,2.6vh,1.75rem)] flex w-full max-w-[38rem] justify-center"
        >
          {open ? (
            <figure className="relative flex w-full items-stretch gap-3.5 rounded-[1.6rem] border border-mint/30 bg-white/[0.06] p-2.5 text-start sm:gap-4">
              <div className="relative aspect-square w-[clamp(6.5rem,15vw,12rem)] shrink-0 overflow-hidden rounded-2xl bg-[#f7f5f2]">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.img
                    key={shot}
                    src={src(character, shot)}
                    alt=""
                    initial={{ opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, ease }}
                    className="absolute inset-0 size-full object-cover"
                    draggable={false}
                  />
                </AnimatePresence>
              </div>
              <figcaption className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 py-1 pe-8">
                {shots.length > 1 ? (
                  <div role="tablist" className="flex w-fit gap-0.5 rounded-full bg-white/[0.06] p-0.5">
                    {shots.map((s, i) => (
                      <button
                        key={s}
                        role="tab"
                        aria-selected={i === tab}
                        onClick={() => setTab(i)}
                        className={cn(
                          'cursor-pointer rounded-full px-3 py-1 text-[length:var(--text-body)] font-semibold transition-colors',
                          i === tab ? 'bg-white/[0.12] text-ink' : 'text-ink-muted hover:text-ink-soft',
                        )}
                      >
                        {t(TITLE[s])}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className="text-[length:var(--text-body)] font-semibold text-mint">{t(TITLE[shot])}</span>
                )}
                <AnimatePresence mode="wait" initial={false}>
                  <motion.p
                    key={shot}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="text-[length:var(--text-meaning)] leading-snug font-medium text-pretty text-ink"
                  >
                    {t(CAPTION[shot])}
                  </motion.p>
                </AnimatePresence>
              </figcaption>
              <button
                onClick={() => setOpen(false)}
                aria-label={t('guide.close')}
                className="absolute end-2 top-2 grid size-8 cursor-pointer place-items-center rounded-full text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink-soft"
              >
                <X className="size-4" />
              </button>
            </figure>
          ) : (
            <button
              onClick={() => setOpen(true)}
              className="group flex cursor-pointer items-center gap-3.5 rounded-full border border-line bg-white/[0.035] py-1.5 ps-1.5 pe-6 text-ink-soft transition-colors hover:border-white/20 hover:text-ink"
            >
              <span className="size-14 overflow-hidden rounded-full bg-[#f7f5f2] sm:size-16">
                <img src={src(character, shot)} alt="" className="size-full object-cover" draggable={false} />
              </span>
              <span className="text-[length:var(--text-body)] font-semibold">
                {t('guide.open')}
                <span className="font-normal text-ink-muted"> · {t(TITLE[shot])}</span>
              </span>
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
