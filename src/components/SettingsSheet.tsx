import { Check, MapPin } from 'lucide-react'
import { quranCredit } from '@/content/lines'
import { detectLocale, LOCALES, useLocale, useT, type Locale } from '@/i18n'
import { cn } from '@/lib/cn'
import { methodLabel } from '@/lib/prayer-times'
import type { PrayerClock } from '@/lib/use-prayer-clock'
import { display, useSession, type Pace, type TextSize } from '@/state/session'
import { ModePicker } from './ModePicker'
import { CHARACTERS } from './stage/characters'
import { Sheet } from './ui/Sheet'
import { Kbd, Segmented, Switch } from './ui/primitives'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-ink-soft">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsSheet({ open, onOpenChange, clock }: { open: boolean; onOpenChange: (o: boolean) => void; clock: PrayerClock }) {
  const t = useT()
  const locale = useLocale()
  const settings = useSession((s) => s.settings)
  const update = useSession((s) => s.updateSettings)
  const demo = useSession((s) => s.demo)
  const setDemo = useSession((s) => s.setDemo)
  const show = display(settings, locale)
  const { place } = clock

  const languages: { value: 'auto' | Locale; label: string; hint?: string }[] = [
    { value: 'auto', label: t('settings.auto'), hint: LOCALES[detectLocale()].name },
    ...(Object.entries(LOCALES) as [Locale, (typeof LOCALES)[Locale]][]).map(([value, l]) => ({ value, label: l.name })),
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('settings.title')}>
      <div className="space-y-6 pb-2">
        <Section title={t('settings.language')}>
          <div className="grid grid-cols-2 gap-1.5" role="radiogroup">
            {languages.map((l) => {
              const active = settings.locale === l.value
              return (
                <button
                  key={l.value}
                  role="radio"
                  aria-checked={active}
                  onClick={() => update({ locale: l.value })}
                  className={cn(
                    'flex cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-start text-sm transition-colors',
                    active ? 'border-mint/45 bg-mint/[0.08] text-ink' : 'border-line text-ink-soft hover:bg-white/[0.04]',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{l.label}</span>
                    {l.hint && <span className="block truncate text-sm text-ink-muted">{l.hint}</span>}
                  </span>
                  {active && <Check className="size-4 shrink-0 text-mint" />}
                </button>
              )
            })}
          </div>
        </Section>

        <Section title={t('settings.mode')}>
          <ModePicker compact />
        </Section>

        <Section title={t('settings.sound')}>
          <Switch label={t('settings.record')} checked={settings.recordSessions} onCheckedChange={(v) => update({ recordSessions: v })} />
          <label className="flex items-center justify-between gap-4 pt-1 text-sm text-ink-soft">
            {t('settings.volume')}
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) => update({ volume: Number(e.target.value) })}
              className="w-40 accent-[var(--accent)]"
            />
          </label>
        </Section>

        <Section title={t('settings.practice')}>
          <Switch label={t('settings.raiseHands')} checked={settings.raiseHands} onCheckedChange={(v) => update({ raiseHands: v })} />
          <p className="text-sm leading-relaxed text-ink-faint">{t('settings.raiseHandsNote')}</p>
        </Section>

        <Section title={t('settings.show')}>
          <Switch label={t('settings.transliteration')} checked={show.transliteration} onCheckedChange={(v) => update({ transliteration: v })} />
          <Switch label={t('settings.translation')} checked={show.translation} onCheckedChange={(v) => update({ translation: v })} />
          <Switch label={t('settings.arabic')} checked={show.arabic} onCheckedChange={(v) => update({ arabic: v })} />
        </Section>

        <Section title={t('settings.size')}>
          <Segmented<TextSize>
            id="size"
            value={settings.textSize}
            options={[
              { value: 'm', label: <span className="text-sm">A</span> },
              { value: 'l', label: <span className="text-base">A</span> },
              { value: 'xl', label: <span className="text-lg">A</span> },
            ]}
            onChange={(v) => update({ textSize: v })}
          />
        </Section>

        <Section title={t('settings.pace')}>
          <Segmented<Pace>
            id="pace"
            value={settings.pace}
            options={[
              { value: 'slow', label: t('settings.slow') },
              { value: 'normal', label: t('settings.normal') },
              { value: 'brisk', label: t('settings.brisk') },
            ]}
            onChange={(v) => update({ pace: v })}
          />
        </Section>

        {CHARACTERS.length > 1 && (
          <Section title={t('settings.companion')}>
            <div className="grid grid-cols-2 gap-2">
              {CHARACTERS.map((c) => {
                const active = settings.characterId === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => update({ characterId: c.id })}
                    aria-pressed={active}
                    className={cn(
                      'group relative flex cursor-pointer flex-col items-center overflow-hidden rounded-2xl border p-2 pb-2.5 transition-colors',
                      active ? 'border-mint/50 bg-mint/[0.08]' : 'border-line hover:bg-white/[0.04]',
                    )}
                  >
                    {c.thumbnail ? (
                      <img src={c.thumbnail} alt="" className="aspect-square w-full rounded-xl object-cover" loading="lazy" />
                    ) : (
                      <div className="aspect-square w-full rounded-xl bg-white/[0.04]" />
                    )}
                    <span className={cn('mt-2 text-sm', active ? 'text-ink' : 'text-ink-soft')}>{c.name}</span>
                  </button>
                )
              })}
            </div>
          </Section>
        )}

        <Section title={t('hf.button')}>
          <Switch label={t('settings.demo')} checked={demo} onCheckedChange={setDemo} />
          <Switch label={t('settings.sounds')} checked={settings.sounds} onCheckedChange={(v) => update({ sounds: v })} />
        </Section>

        <Section title={t('settings.times')}>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-ink-soft">
              <MapPin className="size-4 shrink-0 text-ink-muted" />
              <span className="truncate">
                {place.source === 'gps' ? t('settings.yourLocation') : t('settings.approx', { place: place.label ?? t('settings.yourZone') })}
              </span>
            </span>
            {place.source !== 'gps' && (
              <button onClick={clock.useMyLocation} disabled={clock.locating} className="shrink-0 cursor-pointer text-sm font-medium text-mint hover:underline disabled:opacity-50">
                {clock.locating ? t('settings.locating') : t('settings.useLocation')}
              </button>
            )}
          </div>
          <p className="text-sm text-ink-faint">{t('settings.method', { method: methodLabel() })}</p>
        </Section>

        <div className="hidden flex-wrap gap-x-3 gap-y-1.5 border-t border-line pt-4 text-sm text-ink-muted md:flex">
          <span className="flex items-center gap-1.5"><Kbd>{t('key.space')}</Kbd> {t('settings.keys.next')}</span>
          <span className="flex items-center gap-1.5"><Kbd>{LOCALES[locale].dir === 'rtl' ? '→' : '←'}</Kbd> {t('settings.keys.back')}</span>
          <span className="flex items-center gap-1.5"><Kbd>P</Kbd> {t('settings.keys.auto')}</span>
          <span className="flex items-center gap-1.5"><Kbd>H</Kbd> {t('settings.keys.hf')}</span>
        </div>
        <p className="text-sm leading-relaxed text-ink-faint">{t('settings.sources', { credit: quranCredit(locale) })}</p>
      </div>
    </Sheet>
  )
}
