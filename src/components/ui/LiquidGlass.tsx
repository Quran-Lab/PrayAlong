import { motion } from 'motion/react'
import { cn } from '@/lib/cn'

/** One spring for everything that marks where you are: it settles without a bounce. */
export const SETTLE = { type: 'spring', bounce: 0.08, duration: 0.5 } as const

/**
 * The soft fill that marks where you are (the prayer, the movement, a choice). It glides to
 * the next item and settles; transform only, and with reduced motion it simply moves.
 */
export function LiquidPill({ layoutId, className }: { layoutId: string; className?: string }) {
  return <motion.span layoutId={layoutId} aria-hidden className={cn('astro-pill absolute inset-0', className)} transition={SETTLE} />
}
