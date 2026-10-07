import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Bottom sheet on phones, side panel on larger screens. */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay fixed inset-0 z-40 bg-black/45" />
        <Dialog.Content
          className={cn(
            'glass-panel glass-sheet sheet-content fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[1.75rem] outline-none',
            'sm:inset-y-3 sm:start-auto sm:end-3 sm:bottom-3 sm:max-h-none sm:w-[26rem] sm:rounded-[1.5rem]',
            className,
          )}
        >
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/15 sm:hidden" />
          <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-4 pb-2 sm:pt-5">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-[-0.01em] text-ink">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm leading-relaxed text-ink-soft">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="-me-1 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-muted hover:bg-white/[0.07] hover:text-ink" aria-label="Close">
              <X className="size-[18px]" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
