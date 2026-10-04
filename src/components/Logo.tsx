export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 select-none">
      <svg viewBox="0 0 32 32" className="size-8 text-mint" aria-hidden>
        <path
          d="M20.6 5.6a11 11 0 1 0 5.9 16.6A9 9 0 1 1 20.6 5.6Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="m23.6 9.2.7 1.5 1.6.2-1.2 1.1.3 1.6-1.4-.8-1.4.8.3-1.6-1.2-1.1 1.6-.2Z" fill="currentColor" opacity=".9" />
      </svg>
      {!compact && <span className="text-[1.15rem] font-semibold tracking-[-0.01em] text-ink">PrayAlong</span>}
    </div>
  )
}
