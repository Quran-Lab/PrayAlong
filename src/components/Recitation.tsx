import { ArrowDownRight, Volume1, VolumeX } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { getRecitation } from '@/content/recitations'
import { cn } from '@/lib/cn'
import type { Step } from '@/sequence/types'
import type { ArabicSize, Settings } from '@/state/session'

const ARABIC: Record<ArabicSize, [short: string, long: string]> = {
  m: ['text-[1.85rem] sm:text-[2.2rem]', 'text-[1.5rem] sm:text-[1.85rem]'],
  l: ['text-[2.2rem] sm:text-[2.75rem]', 'text-[1.7rem] sm:text-[2.15rem]'],
  xl: ['text-[2.6rem] sm:text-[3.3rem]', 'text-[2rem] sm:text-[2.5rem]'],
}

const enter = { opacity: 0, y: 10, filter: 'blur(6px)' }
const shown = { opacity: 1, y: 0, filter: 'blur(0px)' }
const leave = { opacity: 0, y: -8, filter: 'blur(4px)' }
const calm = { duration: 0.5, ease: [0.22, 1, 0.36, 1] as const }

export function Recitation({ step, settings, timedMs }: { step: Step; settings: Settings; timedMs: number | null }) {
  const line = getRecitation(step.recitationId)
  const long = line.arabic.length > 46
  return (
    <div className="relative mx-auto flex w-full max-w-3xl flex-col items-center px-4 text-center" aria-live="polite">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={step.id} initial={enter} animate={shown} exit={leave} transition={calm} className="flex w-full flex-col items-center">
          <div className="mb-2 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 text-[11px] font-medium tracking-[0.14em] text-ink-muted uppercase">
            <span>{step.group}</span>
            {step.groupSize > 1 && (
              <span className="tabular text-ink-faint">
                {step.groupIndex + 1} of {step.groupSize}
              </span>
            )}
            {step.repeat > 1 && <span className="rounded-md bg-white/[0.07] px-1.5 py-0.5 tracking-normal text-ink-soft normal-case">×{step.repeat}</span>}
            <span className="flex items-center gap-1 tracking-normal text-ink-faint normal-case">
              {step.voice === 'aloud' ? <Volume1 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              {step.voice === 'aloud' ? 'aloud' : 'quietly'}
            </span>
          </div>
          {step.cue && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, ...calm }}
              className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-mint/25 bg-mint/[0.07] px-3 py-1 text-xs text-mint"
            >
              <ArrowDownRight className="size-3.5" />
              {step.cue}
            </motion.div>
          )}
          <p lang="ar" dir="rtl" className={cn('arabic font-normal text-balance text-ink', ARABIC[settings.arabicSize][long ? 1 : 0])}>
            {line.arabic}
          </p>
          {settings.transliteration && <p className="mt-1 text-[15px] text-balance text-ink-muted italic sm:text-base">{line.transliteration}</p>}
          {settings.translation && <p className="mt-1.5 max-w-2xl text-[15px] leading-relaxed text-balance text-ink-soft sm:text-[17px]">{line.translation}</p>}
          {timedMs !== null && (
            <div className="mt-4 h-[3px] w-20 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div className="h-full origin-left rounded-full bg-mint/70" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: timedMs / 1000, ease: 'linear' }} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}
