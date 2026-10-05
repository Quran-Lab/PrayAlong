<script lang="ts">
  import { Coordinates, Qibla } from 'adhan'
  import ArrowRight from '@lucide/svelte/icons/arrow-right'
  import Check from '@lucide/svelte/icons/check'
  import Eye from '@lucide/svelte/icons/eye'
  import Navigation from '@lucide/svelte/icons/navigation'
  import PersonStanding from '@lucide/svelte/icons/person-standing'
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw'
  import { PRAYER_BY_ID } from '@/content/prayers'
  import { resolveLine } from '@/content/lines'
  import { i18n, t } from '@/i18n/i18n.svelte'
  import { fitText } from '@/lib/fit'
  import { clock } from '@/lib/prayer-clock.svelte'
  import { formatTime } from '@/lib/prayer-times'
  import { sourceText } from '@/lib/source-text'
  import { display, session, type Mode } from '@/state/session.svelte'
  import { voice } from '@/voice/voice.svelte'

  let { kind, onstart }: { kind: 'ready' | 'complete'; onstart: (mode: Mode) => void } = $props()

  const name = $derived(t(`prayer.${session.prayer}`))
  const info = $derived(PRAYER_BY_ID[session.prayer])
  const when = $derived.by(() => {
    const d = clock.detected
    if (session.prayer !== d.id) return t('ready.at', { time: formatTime(clock.times[session.prayer]) })
    return d.status === 'now' ? t('ready.until', { time: formatTime(d.endsAt) }) : t('ready.from', { time: formatTime(d.startsAt) })
  })
  const qibla = $derived(Math.round(Qibla(new Coordinates(clock.place.latitude, clock.place.longitude))))
  const show = $derived(display(session.settings, i18n.locale))
  // Right after the prayer: asking forgiveness three times, then "Allāhumma antas-salām" (Muslim 591).
  const after = $derived([
    { id: 'istighfar', line: resolveLine('istighfar', i18n.locale), times: 3 },
    { id: 'antas-salam', line: resolveLine('antas-salam', i18n.locale), times: 1 },
  ])
  const afterSource = $derived(sourceText(after[1]!.line.source, t))
  const order = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const
  const next = $derived(order[(order.indexOf(session.prayer) + 1) % order.length]!)
  const fitKey = $derived(`${kind}|${session.settings.textSize}|${show.arabic}|${show.transliteration}|${show.translation}|${i18n.locale}`)
</script>

<div class="panel" class:card={kind === 'complete'} {@attach fitText(fitKey, 0.7)}>
  {#if kind === 'ready'}
    <div class="content">
      <p class="meta rise" style:--i={0}><span class="brand">{name}</span> · <span class="num">{t('ready.rakahs', { n: info.rakahs })}</span> · <span class="num">{when}</span></p>
      <h1 class="rise" style:--i={1}>{t('ready.title')}</h1>
      <p class="lead rise" style:--i={2}>{t('ready.body')} {t('ready.follows')}</p>
      <div class="modes rise" style:--i={3} role="group" aria-label={t('mode.label')}>
        <button type="button" class="mode watch" onclick={() => onstart('watch')}>
          <span class="disc"><Eye size={20} /></span>
          <span class="text"><strong>{t('mode.watch')}</strong><small>{t('mode.watchHint')}</small></span>
          <ArrowRight size={18} class="go flip-rtl" />
        </button>
        <button type="button" class="mode" onclick={() => onstart('practice')}>
          <span class="disc"><PersonStanding size={20} /></span>
          <span class="text"><strong>{t('mode.practice')}</strong><small>{t('mode.practiceHint')}</small></span>
          <ArrowRight size={18} class="go flip-rtl" />
        </button>
      </div>
      <p class="hints rise" style:--i={4}>
        <span class="tag num"><Navigation size={14} style="transform: rotate({qibla - 45}deg)" />{t('ready.qibla', { deg: qibla })}</span>
      </p>
    </div>
  {:else}
    <!-- The last card: what to say right after the prayer, side by side, each in the same three voices
         as a line card (Arabic, how to say it, what it means). -->
    <div class="content wide" aria-live="polite">
      <header class="head rise" style:--i={0}>
        <span class="tag ok"><Check size={14} />{t('complete.done', { prayer: name })}</span>
        <button type="button" class="btn quiet sm" onclick={() => session.restart()}><RotateCcw size={15} />{t('complete.again')}</button>
      </header>
      <ol class="dhikr">
        {#each after as { id, line, times }, i (id)}
          <li class="rise" class:playing={voice.line === id} style:--i={i + 1}>
            <p class="count">{times > 1 ? t('complete.thrice') : t('complete.then')}</p>
            {#if show.arabic}<p lang="ar" dir="rtl" class="quran arabic">{line.arabic}</p>{/if}
            {#if show.transliteration}<p class="say">{line.transliteration}</p>{/if}
            {#if show.translation && line.meaning}<p class="meaning">{line.meaning}</p>{/if}
          </li>
        {/each}
      </ol>
      <footer class="foot rise" style:--i={3}>
        <span>{t('complete.after')} · {afterSource}</span>
        <span class="num">{t('complete.next', { prayer: t(`prayer.${next}`), time: formatTime(clock.times[next]) })}</span>
      </footer>
    </div>
  {/if}
</div>

<style>
  /* Fills the words area and fits its text to it (lib/fit.ts), like the line cards. */
  .panel {
    --fit: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    scrollbar-width: none;
    padding-inline: var(--space-4);
  }
  .content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(var(--space-3) * var(--fit));
    width: 100%;
    max-width: 640px;
    margin: auto;
    text-align: center;
  }
  /* Each part arrives a beat after the one above it. */
  .rise {
    animation: rise 560ms var(--ease-out) both;
    animation-delay: calc(80ms + var(--i) * 60ms);
  }
  @keyframes rise {
    from {
      opacity: 0;
      translate: 0 10px;
    }
  }
  .meta {
    font-size: calc(var(--d-label) * var(--fit));
    color: var(--ink-muted);
  }
  .brand {
    color: var(--brand);
    font-weight: 600;
  }
  h1 {
    font-size: calc(clamp(30px, 3.4vw, 52px) * var(--fit));
    font-weight: 300;
    line-height: 1.08;
    letter-spacing: -0.02em;
  }
  .lead {
    max-width: 44ch;
    font-size: calc(clamp(15px, 1.3vw, 19px) * var(--fit));
    line-height: 1.55;
    color: var(--ink-muted);
  }

  /* The two ways to pray: equal size, "watch first" in the brand ink. */
  .modes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 232px), 1fr));
    gap: var(--space-2);
    width: 100%;
    max-width: 560px;
    margin-top: calc(var(--space-2) * var(--fit));
  }
  .mode {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: calc(68px * var(--fit));
    padding: 10px 16px 10px 10px;
    border: 0;
    border-radius: var(--radius-surface);
    background: var(--surface);
    color: var(--ink);
    text-align: start;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .mode:hover {
    background: var(--surface-hover);
  }
  .mode:active {
    background: var(--line);
  }
  .mode.watch {
    background: var(--brand);
    color: var(--on-brand);
  }
  .mode.watch:hover {
    background: var(--brand-hover);
  }
  .mode.watch:active {
    background: var(--brand-pressed);
  }
  .disc {
    display: grid;
    place-items: center;
    flex: none;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-control);
    background: var(--raised);
    color: var(--brand);
  }
  .watch .disc {
    background: color-mix(in srgb, var(--on-brand) 16%, transparent);
    color: var(--on-brand);
  }
  .text {
    display: grid;
    flex: 1;
    gap: 1px;
    min-width: 0;
  }
  .text strong {
    font-size: 16px;
    font-weight: 600;
    line-height: 1.3;
  }
  .text small {
    font-size: 13px;
    line-height: 1.35;
    opacity: 0.78;
  }
  .mode :global(.go) {
    flex: none;
    opacity: 0.6;
    transition:
      translate var(--dur-standard) var(--ease-out),
      opacity var(--dur-standard) var(--ease-out);
  }
  .mode:hover :global(.go) {
    opacity: 1;
    translate: 3px 0;
  }
  .mode:dir(rtl):hover :global(.go) {
    translate: -3px 0;
  }
  .hints {
    display: flex;
    justify-content: center;
    font-size: 13px;
    color: var(--ink-muted);
  }

  /* Complete: a card like the line cards, so the prayer ends where it was followed. */
  .panel.card {
    container-type: inline-size;
    padding: calc(var(--space-5) * var(--fit)) clamp(18px, 4cqi, 48px);
    border-radius: var(--radius-container);
    background: var(--raised);
    box-shadow: var(--shadow-2);
  }
  .content.wide {
    max-width: 1000px;
    gap: calc(var(--space-4) * var(--fit));
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 6px 14px;
  }
  .head .tag {
    gap: 6px;
  }
  .foot {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 2px var(--space-4);
    font-size: 12px;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  /* Two columns split by a hairline; each one reads top-down: when, Arabic, saying, meaning. */
  .dhikr {
    display: grid;
    grid-template-columns: 1fr;
    width: 100%;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .dhikr li {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: calc(4px * var(--fit));
    padding: calc(var(--space-3) * var(--fit)) var(--space-2);
  }
  .dhikr li + li {
    border-top: 1px solid var(--line);
  }
  @container (min-width: 640px) {
    .dhikr {
      grid-template-columns: 1fr 1fr;
    }
    .dhikr li {
      padding: 0 clamp(16px, 3cqi, 40px);
    }
    .dhikr li + li {
      border-top: 0;
      border-inline-start: 1px solid var(--line);
    }
  }
  .count {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--ink-muted);
  }
  .arabic {
    font-size: max(24px, calc(clamp(26px, 2.5vw, 38px) * var(--fit)));
    line-height: 1.7;
    color: var(--ink);
    transition: color var(--dur-standard) var(--ease-out);
  }
  /* The one being recited as an example takes the brand ink. */
  .playing .arabic {
    color: var(--brand);
  }
  .say {
    max-width: 36ch;
    font-size: max(15px, calc(clamp(15px, 1.35vw, 19px) * var(--fit)));
    font-weight: 500;
    line-height: 1.35;
  }
  .meaning {
    max-width: 40ch;
    font-size: max(13px, calc(clamp(13px, 1.1vw, 16px) * var(--fit)));
    line-height: 1.45;
    color: var(--ink-muted);
  }
  @media (max-width: 479px) {
    .panel:not(.card) {
      padding-inline: 0;
    }
    h1 {
      font-size: calc(28px * var(--fit));
    }
    .mode {
      min-height: 60px;
    }
  }
</style>
