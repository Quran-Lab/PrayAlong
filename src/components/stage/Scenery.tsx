import type { PrayerId } from '@/sequence/types'

/**
 * The room behind the companion: a calm wall with one arched window showing
 * the sky at the hour of the prayer. Plain DOM layers under a transparent
 * WebGL canvas, coloured by the per-prayer tokens in index.css.
 */

// Where the sun or moon sits in the window (percent of the window box) and how big it is.
const SKY: Record<PrayerId, { x: number; y: number; size: number; moon?: boolean; horizon?: boolean }> = {
  fajr: { x: 30, y: 88, size: 13, horizon: true },
  dhuhr: { x: 58, y: 16, size: 15 },
  asr: { x: 72, y: 46, size: 15 },
  maghrib: { x: 50, y: 90, size: 24, horizon: true },
  isha: { x: 68, y: 20, size: 12, moon: true },
}

// A fixed scatter of stars (window-relative percentages), faded by --stars.
const STARS: readonly (readonly [number, number, number])[] = [
  [12, 10, 1.4], [24, 22, 1], [38, 8, 1.2], [52, 30, 0.9], [66, 12, 1.3], [80, 28, 1], [88, 9, 1.1],
  [18, 38, 0.8], [44, 44, 1], [74, 52, 0.8], [30, 58, 0.9], [86, 46, 1.2], [58, 62, 0.8], [8, 54, 1],
]

export function Scenery({ prayer, windowX = 50 }: { prayer: PrayerId; /** Window centre, % of the width. */ windowX?: number }) {
  const sky = SKY[prayer]
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Wall: lit softly from the window. */}
      <div
        className="absolute inset-0 transition-[background] duration-1000"
        style={{
          background:
            `radial-gradient(60% 55% at ${windowX}% 34%, color-mix(in oklab, var(--sky-mid) 16%, var(--room-3)) 0%, var(--room-2) 45%, var(--room) 100%)`,
        }}
      />

      {/* The arched window. Height-led so it stays behind the companion on any screen. */}
      <div className="absolute top-[7%] h-[64%] -translate-x-1/2 transition-[left] duration-700" style={{ aspectRatio: '0.6', left: `${windowX}%` }}>
        {/* Light spilling from the window onto the wall. */}
        <div
          className="absolute -inset-[30%] rounded-full opacity-60 blur-3xl transition-[background] duration-1000"
          style={{ background: 'radial-gradient(closest-side, var(--sun-glow), transparent)' }}
        />
        {/* Deep window reveal (the wall's thickness). */}
        <div className="absolute -inset-[5%] rounded-t-full" style={{ background: 'linear-gradient(180deg, color-mix(in oklab, var(--room-3) 80%, black), var(--room))' }} />
        {/* Sky */}
        <div
          className="absolute inset-0 overflow-hidden rounded-t-full transition-[background] duration-1000"
          style={{ background: 'linear-gradient(180deg, var(--sky-top) 0%, var(--sky-mid) 55%, var(--sky-low) 100%)' }}
        >
          {STARS.map(([x, y, s], i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white transition-opacity duration-1000"
              style={{ left: `${x}%`, top: `${y}%`, width: `${s * 3}px`, height: `${s * 3}px`, opacity: `calc(var(--stars) * ${0.5 + (i % 3) * 0.2})` }}
            />
          ))}
          {/* Sun or moon */}
          <span
            className="absolute rounded-full transition-all duration-1000"
            style={{
              left: `${sky.x}%`,
              top: `${sky.y}%`,
              width: `${sky.size}%`,
              aspectRatio: '1',
              transform: 'translate(-50%, -50%)',
              background: 'var(--sun)',
              boxShadow: sky.moon ? '0 0 50px 10px var(--sun-glow)' : '0 0 40px 14px var(--sun-glow), 0 0 120px 40px var(--sun-glow)',
              // A crescent moon at night: the disc masked by a second, offset circle.
              ...(sky.moon ? { maskImage: 'radial-gradient(circle at 72% 32%, transparent 46%, black 48%)', WebkitMaskImage: 'radial-gradient(circle at 72% 32%, transparent 46%, black 48%)' } : {}),
            }}
          />
          {sky.horizon && (
            // A soft distant horizon for sunrise and sunset.
            <div className="absolute inset-x-0 bottom-0 h-[16%]" style={{ background: 'linear-gradient(180deg, transparent, color-mix(in oklab, var(--room) 70%, var(--sky-low)))' }} />
          )}
          {/* Glazing bars */}
          <div className="absolute inset-y-0 left-1/2 w-[3%] -translate-x-1/2" style={{ background: 'color-mix(in oklab, var(--room-3) 85%, black)' }} />
          <div className="absolute inset-x-0 top-[58%] h-[2.2%]" style={{ background: 'color-mix(in oklab, var(--room-3) 85%, black)' }} />
          {/* Glass sheen */}
          <div className="absolute inset-0" style={{ background: 'linear-gradient(115deg, rgb(255 255 255 / 0.08), transparent 40%)' }} />
        </div>
        {/* Sill */}
        <div className="absolute inset-x-[-9%] bottom-[-3%] h-[4%] rounded-sm" style={{ background: 'color-mix(in oklab, var(--room-3) 70%, white 6%)' }} />
      </div>

      {/* Pool of window light on the floor. */}
      <div
        className="absolute bottom-[4%] h-[26%] w-[46%] -translate-x-1/2 rounded-[50%] blur-2xl transition-[background] duration-1000"
        style={{ left: `${windowX}%`, background: 'radial-gradient(closest-side, var(--spill), transparent)' }}
      />
    </div>
  )
}
