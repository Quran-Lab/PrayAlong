import { Switch as RadixSwitch, Tooltip as RadixTooltip } from 'radix-ui'
import { motion } from 'motion/react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function Tooltip({ content, children, side = 'bottom' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <RadixTooltip.Root delayDuration={350}>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={8}
          className="z-50 rounded-lg border border-line bg-raised/95 px-2.5 py-1.5 text-xs text-ink-soft shadow-xl shadow-black/40 backdrop-blur-md animate-pop"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-white/[0.04] px-1.5 font-sans text-[10.5px] font-medium text-ink-muted">
      {children}
    </kbd>
  )
}

type ButtonProps = ComponentProps<'button'> & { variant?: 'primary' | 'ghost' | 'quiet'; size?: 'md' | 'lg' | 'icon' }

export function Button({ variant = 'ghost', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium transition-[background,box-shadow,color,transform] duration-200 ease-(--ease-calm) active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        size === 'icon' && 'size-10',
        variant === 'primary' &&
          'bg-mint text-canvas shadow-[0_8px_30px_-8px_color-mix(in_oklab,var(--accent)_60%,transparent)] hover:brightness-110',
        variant === 'ghost' && 'glass text-ink hover:bg-white/[0.08]',
        variant === 'quiet' && 'text-ink-muted hover:bg-white/[0.06] hover:text-ink',
        className,
      )}
    />
  )
}

export function Switch({ checked, onCheckedChange, label }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1.5 text-sm text-ink-soft">
      {label}
      <RadixSwitch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="relative h-6 w-10 shrink-0 cursor-pointer rounded-full bg-white/10 transition-colors data-[state=checked]:bg-mint-strong"
      >
        <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
      </RadixSwitch.Root>
    </label>
  )
}

/** A small segmented control with a sliding highlight. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  id,
}: {
  value: T
  options: readonly { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
  id: string
}) {
  return (
    <div role="radiogroup" className="grid auto-cols-fr grid-flow-col rounded-xl border border-line bg-white/[0.03] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative h-8 cursor-pointer rounded-lg px-2 text-[13px] transition-colors',
            o.value === value ? 'text-ink' : 'text-ink-muted hover:text-ink-soft',
          )}
        >
          {o.value === value && (
            <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg bg-white/[0.09]" transition={{ type: 'spring', bounce: 0.15, duration: 0.4 }} />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
