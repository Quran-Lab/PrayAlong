import { Switch as RadixSwitch, Tooltip as RadixTooltip } from 'radix-ui'
import { LiquidPill } from './LiquidGlass'
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
          className="glass-panel glass-sheet z-50 rounded-xl px-2.5 py-1.5 text-xs text-ink-soft animate-pop"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="glass-chip inline-flex h-5 min-w-5 items-center justify-center rounded-md px-1.5 font-sans text-xs font-medium text-ink-muted">
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
        'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full font-medium transition-[background-color,color,scale,filter] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-base',
        size === 'icon' && 'size-11 sm:size-10',
        variant === 'primary' && 'glass-solid text-canvas hover:brightness-110',
        variant === 'ghost' && 'glass-chip text-ink',
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
        className="glass-chip h-6 w-10 shrink-0 cursor-pointer rounded-full transition-colors data-[state=checked]:bg-mint-strong/70"
      >
        <RadixSwitch.Thumb className="block size-5 translate-x-0.5 rounded-full bg-[linear-gradient(180deg,#fff,#e9e4dc)] shadow-[0_2px_6px_rgb(0_0_0/0.35),inset_0_-1px_0_rgb(0_0_0/0.08)] transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] data-[state=checked]:translate-x-[18px]" />
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
    <div role="radiogroup" className="glass-chip grid auto-cols-fr grid-flow-col rounded-xl p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative h-8 cursor-pointer rounded-lg px-2 text-sm transition-colors',
            o.value === value ? 'text-ink' : 'text-ink-muted hover:text-ink-soft',
          )}
        >
          {o.value === value && (
            <LiquidPill layoutId={`seg-${id}`} className="rounded-lg" />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
