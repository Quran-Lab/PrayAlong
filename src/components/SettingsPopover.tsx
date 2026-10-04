import { MapPin, Settings2 } from 'lucide-react'
import { Popover } from 'radix-ui'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import { useSession, type ArabicSize, type Pace } from '@/state/session'
import { CHARACTERS } from './stage/characters'
import { Button, Kbd, Segmented, Switch } from './ui/primitives'

const SIZES: { value: ArabicSize; label: React.ReactNode }[] = [
  { value: 'm', label: <span className="arabic text-sm">أ</span> },
  { value: 'l', label: <span className="arabic text-base">أ</span> },
  { value: 'xl', label: <span className="arabic text-lg">أ</span> },
]
const PACES: { value: Pace; label: string }[] = [
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'brisk', label: 'Brisk' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 px-1">
      <h3 className="text-[11px] font-medium tracking-[0.14em] text-ink-muted uppercase">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsPopover({ clock, characterId, onCharacter }: { clock: PrayerClock; characterId: string; onCharacter: (id: string) => void }) {
  const settings = useSession((s) => s.settings)
  const update = useSession((s) => s.updateSettings)
  const { place } = clock

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="quiet" size="icon" aria-label="Settings">
          <Settings2 className="size-[18px]" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={10}
          align="end"
          collisionPadding={12}
          className="z-50 w-[min(20rem,calc(100vw-1.5rem))] animate-pop space-y-5 rounded-2xl border border-line bg-raised/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          <Section title="Show">
            <Switch label="Transliteration" checked={settings.transliteration} onCheckedChange={(v) => update({ transliteration: v })} />
            <Switch label="Translation" checked={settings.translation} onCheckedChange={(v) => update({ translation: v })} />
          </Section>
          <Section title="Arabic size">
            <Segmented id="size" value={settings.arabicSize} options={SIZES} onChange={(v) => update({ arabicSize: v })} />
          </Section>
          <Section title="Guidance pace">
            <Segmented id="pace" value={settings.pace} options={PACES} onChange={(v) => update({ pace: v })} />
          </Section>
          {CHARACTERS.length > 1 && (
            <Section title="Companion">
              <Segmented id="character" value={characterId} options={CHARACTERS.map((c) => ({ value: c.id, label: c.name }))} onChange={onCharacter} />
            </Section>
          )}
          <Section title="Prayer times">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-ink-soft">
                <MapPin className="size-4 shrink-0 text-ink-muted" />
                <span className="truncate">
                  {place.source === 'gps' ? 'Your location' : `${place.label ?? 'Your time zone'} (approx.)`}
                </span>
              </span>
              {place.source !== 'gps' && (
                <button onClick={clock.useMyLocation} disabled={clock.locating} className="shrink-0 cursor-pointer text-xs font-medium text-mint hover:underline disabled:opacity-50">
                  {clock.locating ? 'Locating…' : 'Use my location'}
                </button>
              )}
            </div>
            <p className="text-xs text-ink-faint">Muslim World League method</p>
          </Section>
          <div className="hidden flex-wrap gap-x-3 gap-y-1.5 border-t border-line px-1 pt-3 text-xs text-ink-muted md:flex">
            <span className="flex items-center gap-1.5"><Kbd>Space</Kbd> next</span>
            <span className="flex items-center gap-1.5"><Kbd>←</Kbd> back</span>
            <span className="flex items-center gap-1.5"><Kbd>P</Kbd> auto-play</span>
            <span className="flex items-center gap-1.5"><Kbd>H</Kbd> hands-free</span>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
