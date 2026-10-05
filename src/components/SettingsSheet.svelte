<script lang="ts">
  import Check from '@lucide/svelte/icons/check'
  import MapPin from '@lucide/svelte/icons/map-pin'
  import BACKDROPS from '@/content/backdrops.json'
  import { quranCredit } from '@/content/lines'
  import { detectLocale, LOCALES, OFFERED } from '@/i18n'
  import { i18n, t } from '@/i18n/i18n.svelte'
  import { CRESCENT, PALETTES } from '@/lib/brand'
  import { clock } from '@/lib/prayer-clock.svelte'
  import { methodLabel } from '@/lib/prayer-times'
  import { display, session, type TextSize, type Theme } from '@/state/session.svelte'
  import { CHARACTERS, FIGURE, OUTFITS } from './stage/characters'
  import Segmented from './ui/Segmented.svelte'
  import Sheet from './ui/Sheet.svelte'
  import Switch from './ui/Switch.svelte'

  /**
   * What the learner can change: the companion and how things look. Everything else (spoken
   * instructions, following the recitation, the pace) is part of praying with PrayAlong.
   */
  let { open = $bindable(false) }: { open: boolean } = $props()

  const settings = $derived(session.settings)
  const update = (patch: Parameters<typeof session.updateSettings>[0]) => session.updateSettings(patch)
  const show = $derived(display(settings, i18n.locale))
  const languages = $derived([
    { value: 'auto' as const, label: t('settings.auto'), hint: LOCALES[detectLocale()].name },
    ...OFFERED.map((value) => ({ value, label: LOCALES[value].name, hint: '' })),
  ])
  const photo = $derived(BACKDROPS[session.prayer])
  const about = $derived([
    { label: t('about.recitations'), value: t('about.recitationsBy') },
    ...(i18n.locale === 'ar' ? [] : [{ label: t('about.translation'), value: quranCredit(i18n.locale) }]),
    { label: t('about.reciter'), value: t('qari.name') },
    { label: t('about.voice'), value: t('about.voiceBy') },
  ])
</script>

<Sheet bind:open title={t('settings.title')}>
  <div class="sections">
    <section>
      <h3>{t('settings.companion')}</h3>
      <div class="cards">
        {#each CHARACTERS as c (c.id)}
          <button type="button" class="card" aria-pressed={settings.characterId === c.id} onclick={() => update({ characterId: c.id })}>
            <img src={c.thumbnail} alt="" width="160" height="160" loading="lazy" />
            <span>{t(c.nameKey)}</span>
          </button>
        {/each}
      </div>
      <div class="field">
        <span class="label">{t('settings.outfit')}</span>
        <div class="outfits" role="radiogroup" aria-label={t('settings.outfit')}>
          {#each OUTFITS as o (o.id)}
            <button
              type="button"
              role="radio"
              aria-checked={settings.outfit === o.id}
              aria-label={t(`outfit.${o.id}`)}
              title={t(`outfit.${o.id}`)}
              style:--swatch={o.color}
              onclick={() => update({ outfit: o.id })}
            ></button>
          {/each}
        </div>
      </div>
      <p class="soon"><span>{t('companion.auto')}</span><span class="tag">{t('ui.soon')}</span></p>
    </section>

    <section>
      <h3>{t('settings.display')}</h3>
      <div class="field">
        <span class="label">{t('settings.size')}</span>
        <Segmented
          label={t('settings.size')}
          value={settings.textSize}
          options={[
            { value: 'm', label: 'A', size: 13 },
            { value: 'l', label: 'A', size: 16 },
            { value: 'xl', label: 'A', size: 19 },
          ]}
          onchange={(v) => update({ textSize: v as TextSize })}
        />
      </div>
      <div class="group">
        <Switch label={t('settings.transliteration')} checked={show.transliteration} onchange={(v) => update({ transliteration: v })} />
        <Switch label={t('settings.translation')} checked={show.translation} onchange={(v) => update({ translation: v })} />
        <Switch label={t('settings.arabic')} checked={show.arabic} onchange={(v) => update({ arabic: v })} />
      </div>
      <div class="field">
        <span class="label">{t('settings.appearance')}</span>
        <Segmented
          label={t('settings.appearance')}
          value={settings.theme}
          options={[
            { value: 'system', label: t('settings.system') },
            { value: 'light', label: t('settings.light') },
            { value: 'dark', label: t('settings.dark') },
          ]}
          onchange={(v) => update({ theme: v as Theme })}
        />
      </div>
      <div class="field">
        <span class="label">{t('settings.palette')}</span>
        <div class="palettes" role="radiogroup" aria-label={t('settings.palette')}>
          {#each PALETTES as p (p)}
            <button type="button" role="radio" aria-checked={settings.palette === p} data-palette={p} onclick={() => update({ palette: p })}>
              <svg viewBox="-8 -8 64 64" aria-hidden="true"><rect x="-8" y="-8" width="64" height="64" rx="14" /><path d={CRESCENT} /></svg>
              <span>{t(`palette.${p}`)}</span>
              {#if p === 'plum' || p === 'indigo'}<small>{t(`palette.${p}Hint`)}</small>{/if}
            </button>
          {/each}
        </div>
      </div>
    </section>

    <section>
      <h3>{t('settings.language')}</h3>
      <div class="langs" role="radiogroup" aria-label={t('settings.language')}>
        {#each languages as l (l.value)}
          <button type="button" role="radio" aria-checked={settings.locale === l.value} onclick={() => update({ locale: l.value })}>
            <span>
              <span class="name">{l.label}</span>
              {#if l.hint}<small>{l.hint}</small>{/if}
            </span>
            {#if settings.locale === l.value}<Check size={16} />{/if}
          </button>
        {/each}
      </div>
    </section>

    <section>
      <h3>{t('settings.times')}</h3>
      <div class="place">
        <span><MapPin size={16} />{clock.place.source === 'gps' ? t('settings.yourLocation') : t('settings.approx', { place: clock.place.label ?? t('settings.yourZone') })}</span>
        {#if clock.place.source !== 'gps'}
          <button type="button" class="btn quiet sm" onclick={clock.useMyLocation} disabled={clock.locating}>{clock.locating ? t('settings.locating') : t('settings.useLocation')}</button>
        {/if}
      </div>
      <p class="fine">{t('settings.method', { method: methodLabel() })}</p>
    </section>

    <section class="about">
      <h3>{t('settings.about')}</h3>
      <dl>
        {#each about as row (row.label)}
          <div><dt>{row.label}</dt><dd>{row.value}</dd></div>
        {/each}
        <div>
          <dt>{t('about.photo')}</dt>
          <dd><a href={photo.page} target="_blank" rel="noreferrer">{t('about.photoBy', { what: photo.what, by: photo.by })}</a></dd>
        </div>
        <div>
          <dt>{t('about.figure')}</dt>
          <dd><a href={FIGURE.page} target="_blank" rel="noreferrer">{t('about.figureBy', { what: FIGURE.title, by: FIGURE.author })}</a></dd>
        </div>
      </dl>
    </section>
  </div>
</Sheet>

<style>
  .sections {
    display: grid;
    gap: var(--space-6);
  }
  section {
    display: grid;
    gap: var(--space-3);
  }
  h3 {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--ink-muted);
  }
  .field {
    display: grid;
    gap: 6px;
  }
  .label {
    font-size: 14px;
    font-weight: 500;
  }
  /* Switches read as one list: a surface, rows split by hairlines. */
  .group {
    padding: 2px 14px;
    border-radius: var(--radius-surface);
    background: var(--surface);
  }
  .group :global(.row + .row) {
    border-top: 1px solid var(--line);
  }
  .soon {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    font-size: 14px;
    color: var(--ink-muted);
  }
  .cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .card {
    display: grid;
    gap: var(--space-2);
    justify-items: center;
    padding: 8px 8px 10px;
    border: 0;
    border-radius: var(--radius-surface);
    background: var(--surface);
    font-size: 14px;
    font-weight: 500;
    transition:
      background var(--dur-standard) var(--ease-out),
      color var(--dur-standard) var(--ease-out);
  }
  .card:hover {
    background: var(--surface-hover);
  }
  .card img {
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    object-fit: cover;
    border-radius: 8px;
    background: var(--paper);
    transition: scale var(--dur-standard) var(--ease-out);
  }
  .card[aria-pressed='true'] {
    background: var(--brand-tint);
    color: var(--brand);
    font-weight: 600;
  }
  /* The clothes: round swatches of the fabric; the chosen one is ringed in the brand ink. */
  .outfits {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .outfits button {
    width: 34px;
    height: 34px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--swatch);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent),
      0 0 0 0 var(--surface),
      0 0 0 0 var(--brand);
    transition: box-shadow 260ms cubic-bezier(0.34, 1.4, 0.64, 1);
  }
  .outfits button[aria-checked='true'] {
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--ink) 14%, transparent),
      0 0 0 3px var(--surface),
      0 0 0 5px var(--brand);
  }
  /* Each swatch is the app icon in its palette: the tile keeps its colour in both themes. */
  .palettes {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
  }
  .palettes button {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 2px;
    padding: 10px 4px 8px;
    border: 0;
    border-radius: var(--radius-surface);
    background: var(--surface);
    font-size: 13px;
    line-height: 1.3;
    transition:
      background var(--dur-standard) var(--ease-out),
      color var(--dur-standard) var(--ease-out);
  }
  .palettes button:hover {
    background: var(--surface-hover);
  }
  .palettes button[aria-checked='true'] {
    background: var(--brand-tint);
    color: var(--brand);
    font-weight: 600;
  }
  .palettes svg {
    width: 34px;
    height: 34px;
    margin-bottom: 4px;
    transition: scale 420ms cubic-bezier(0.34, 1.4, 0.64, 1);
  }
  .palettes button[aria-checked='true'] svg {
    scale: 1.08;
  }
  .palettes rect {
    fill: var(--p-700);
  }
  .palettes path {
    fill: var(--p-50);
  }
  .palettes small {
    font-size: 11px;
    font-weight: 400;
    color: var(--ink-muted);
  }
  .langs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }
  .langs button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 52px;
    padding: 6px 14px;
    border: 0;
    border-radius: var(--radius-control);
    background: var(--surface);
    text-align: start;
    font-size: 14px;
    transition:
      background var(--dur-standard) var(--ease-out),
      color var(--dur-standard) var(--ease-out);
  }
  .langs button:hover {
    background: var(--surface-hover);
  }
  .langs button[aria-checked='true'] {
    background: var(--brand-tint);
    color: var(--brand);
    font-weight: 600;
  }
  .langs small {
    display: block;
    font-size: 12px;
    font-weight: 400;
    color: var(--ink-muted);
  }
  .place {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: 15px;
  }
  .place > span {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .fine {
    margin-top: -6px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--ink-muted);
  }
  /* About: label and value, one line each. */
  .about {
    padding-top: var(--space-5);
    border-top: 1px solid var(--line);
  }
  dl {
    display: grid;
    gap: var(--space-3);
    margin: 0;
  }
  dl div {
    display: grid;
    grid-template-columns: 9em 1fr;
    gap: var(--space-3);
    font-size: 13px;
    line-height: 1.45;
  }
  dt {
    color: var(--ink-muted);
  }
  dd {
    margin: 0;
    color: var(--ink);
  }
  dd a {
    color: inherit;
    text-decoration: underline;
    text-decoration-color: var(--line-strong);
    text-underline-offset: 3px;
    transition: text-decoration-color var(--dur-fast) var(--ease-out);
  }
  dd a:hover {
    text-decoration-color: currentColor;
  }
</style>
