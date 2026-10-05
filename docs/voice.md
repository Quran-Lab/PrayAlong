# Voice follow (microphone engine)

PrayAlong can follow the prayer from the microphone alone, with the camera
off or unavailable, and can fuse with the camera when both are on. Audio never
leaves the device: the Quran Lab zipformer CTC model (v3.1, int8) runs in a
Web Worker as WebAssembly.

```
microphone ──▶ AudioWorklet (public/voice/capture-worklet.js)
                 │ 100 ms batches over a MessagePort (never touches the main thread)
                 ▼
               ASR worker (public/voice/asr-worker.js)
                 sherpa-onnx 1.13 WASM (non-pthread SIMD build), ORT, 1 thread
                 phonetic-script tokens + audio clock, energy gate, endpoints
                 ▼ tokens
               follower (src/voice/follower.ts)      constrained alignment against
                 │ word · lineStart · lineDone        the current line + next 3 only;
                 │ takbir · tasmi · salam · amin      keyword spotter for movement phrases
                 ▼
               driver (src/voice/driver.ts)          forward-only session moves,
                 │ begin · goTo · finish              speech-aware timer fallback
                 ▼
               useSession (begin / goTo / next)      + Evidence for camera fusion
```

Nothing is downloaded until listening is switched on: the worker fetches the
12.4 MB runtime and the 68 MB model on demand and keeps the model in the Cache
API (`prayalong-voice-<revision>`), SHA-256 verified on every start.

## Files

| Path | What |
| --- | --- |
| `src/voice/engine.ts` | `VoiceEngine`: getUserMedia, AudioWorklet, worker, status `idle / loading / listening / error` |
| `src/voice/follower.ts` | Constrained follower + keyword spotter (pure) |
| `src/voice/phonetic.ts` | Skeleton alphabet and costs |
| `src/voice/driver.ts` | Session policy (pure) |
| `src/voice/core.ts` | Decoder-to-session loop shared by the hook and the harness; `SessionSim` |
| `src/voice/use-voice.ts` | `useVoiceFollow()` React hook, `Evidence` |
| `src/voice/replay.ts`, `replay-run.ts` | Replay timeline, rendering, scoring; browser runner |
| `src/lab/VoiceLab.tsx` | `/?lab&voice` dev page (dev builds only) |
| `public/voice/` | Worker, worklet, sherpa-onnx runtime (Apache-2.0, see `runtime/LICENSE.sherpa-onnx`) |
| `public/voice/model/` | Model parts (gitignored; `node scripts/fetch-voice-model.mjs`) |
| `scripts/gen-phonemes.py` | Builds `src/content/phonemes.json` |
| `scripts/voice-replay.mjs` | Playwright replay harness |
| `scripts/voice-fixture.mjs` | Trims a harness run into a decoded-token fixture for `decoded.test.ts` |

## The model and where it is served from

Runtime: the non-pthread SIMD build from quran-lab-app
(`sherpa-onnx-wasm-main-asr.single`), with Quran Lab's patched
`sherpa-onnx-asr.js`. No SharedArrayBuffer is needed, so voice works with or
without cross-origin isolation; one ORT thread is what Quran Lab measured as
best (same speed as 4, a third of the memory).

Model: `v31-slim-int8-preopt-1` (67,972,550 bytes, sha256 `168a9430...`), the
same graph contribute.quranlab.ai ships, plus `tokens.txt` (blank id 250).

**The R2 route does not work today, so the default is same-origin.** Checked on
2026-10-05:

- `models.quranlab.ai` is NXDOMAIN at the authoritative Cloudflare nameservers
  (`julissa.ns.cloudflare.com`); the R2 custom domain is gone.
  `contribute.quranlab.ai` answers 503 "In maintenance".
- Even with the domain back, the bucket's CORS allowlist
  (`quran-lab-app/apps/quran-lab-landing/scripts/r2-cors.json`) only has
  contribute.quranlab.ai and two localhost ports. Under PrayAlong's
  `Cross-Origin-Embedder-Policy: credentialless`, a cross-origin `fetch()` is a
  CORS request and needs `Access-Control-Allow-Origin`, so it would fail.

So `scripts/fetch-voice-model.mjs` stages the model as four parts of at most
20 MiB (Workers static assets cap one file at 25 MiB) plus `manifest.json`
under `public/voice/model/`; Vite copies them into `dist/`, and the worker
stitches and verifies them. Sources, first that exists: `VOICE_MODEL_SRC` /
`VOICE_TOKENS_SRC`, the quran-lab-app checkouts next to this repo, or
`VOICE_MODEL_URL` (a base URL, fetched by Node, so no CORS involved).

Production options (pick one; the client only needs `VITE_VOICE_MODEL_URL`):

1. **Same origin, staged at build time** (default). Workers Builds clones git,
   so it needs a source: set `VOICE_MODEL_URL` in the build environment to any
   URL serving the two files (an R2 public bucket URL works; no CORS needed
   server side) and run `node scripts/fetch-voice-model.mjs` before
   `npm run build`. Adds 68 MB to the deploy.
2. **Quran Lab's R2 bucket**: restore the `models.quranlab.ai` custom domain,
   add `https://prayalong.me` and `https://www.prayalong.me` to
   `r2-cors.json` (`wrangler r2 bucket cors set quran-lab-models`), then build
   with `VITE_VOICE_MODEL_URL=https://models.quranlab.ai/asr/<rev>/`. The
   bucket must also publish a `manifest.json` in this repo's format
   (`{revision, files:[{name, bytes, sha256, parts}]}`); its own manifest has a
   different schema.
3. **A Worker route** with an R2 binding (`/voice/model/*` served from the
   bucket): same origin, no CORS, no deploy size; needs a `main` script in
   `wrangler.jsonc`.

Without the model the engine reports `error / model-unreachable` and the app
carries on with its normal timers.

## Phoneme targets

`python scripts/gen-phonemes.py` (needs a quran-g2p checkout; found next to any
parent directory or via `QURAN_G2P`) writes `src/content/phonemes.json`: per
line id, the phoneme string of each displayed word in the model's own
phonetic script (quran_transcript's repeat-encoded alphabet, via quran-g2p's
`oracle.expand`). Quran lines use quran-g2p's pinned Tanzil Uthmani text for
the same verses (kawthar-1 and ikhlas-1 get the basmala first, as displayed).
Adhkar are converted from the vowelled text in `recitations.ts` (hamzat
al-wasl to alef wasla, madda alef to hamza plus alef) and phonemized the same
way. Each line is one breath group: ibtida at the start, waqf at the end. The
script fails if any line's word count differs from the displayed text. Rerun
it after editing `recitations.ts`.

## The follower

Everything is compared on a reduced **skeleton** alphabet: madd letters become
their short vowel, nasal and softened variants become their base letter,
qalqalah and sakt marks go, and runs collapse to one symbol. Madd length and
gemination say nothing about where in the prayer someone is, and they vary
most between people. Substitutions of accent-level pairs (s/emphatic s, t/
emphatic t, h/pharyngeal h, k/q, hamza/ain, ...) are cheap; a different short
vowel is cheap in cost but does not count as "heard".

**Line tracker.** An edit-distance alignment of everything heard since the
anchor line against `[anchor line x repeat, next line, ..., 4 steps]`, with two
extra moves: SKIP a whole line (cost 5; a remaining tasbih repetition costs
0.8) and RESTART the current line (cost 2.5: false start, hesitation, extra
repetition). Junk between lines (a cough, a movement takbir) is absorbed at the
line boundaries. The cheapest end column is where the person is.

- `word(step, lineId, wordIndex, rep)` when the cursor passes a word that was
  heard (>= 34% of it matched), or that lies before a well matched word.
- `lineStart(step)` once a step is confidently entered (>= 6 symbols and 60%
  of its first word).
- `lineDone(step)` when the line's last repetition is reached with >= 50% (aloud)
  or 35% (quiet) matched; when a later line has clearly started; or after
  1 s of silence with the cursor inside the last word (noise ate its end).
- At most one `lineDone` per evaluation, strictly in order; word reports only
  ever increase. When the session moves on by itself (timer, camera, tap) the
  follower re-anchors and keeps only the last second of audio that no earlier
  line already explains.

**Keyword spotter.** Approximate substring matching (Sellers) of the takbir,
tasmi, salam and amin lines against the stream, firing as soon as the cost
drops below a per-keyword threshold (0.12 to 0.26 per symbol). A keyword is
dropped when the tracker already explains those same sounds as a different
expected line: "Allahumma barik" is phonetically within a few edits of
"Allahu akbar", but on the salawat line the tracker has matched it.

## The driver (mic-only mode)

- Ready: the opening takbir begins the prayer.
- A finished line moves to the next line of the same posture.
- Hearing the start of the NEXT line moves there (one step, any posture).
- A movement phrase moves to the next posture change, like the camera seeing
  the body move, but only if it is the phrase that movement is announced with
  (`announcedBy`: takbir into ruku/sujud/jalsah/sitting/standing, tasmi into
  i'tidal, salam into each salam), after 1.2 s on the current step, never when
  the current line IS that phrase (the salam line itself), and not while an
  aloud passage with more than one line left is being followed.
- Timers as fallback: a line moves on after its expected time if nobody is
  talking and no word was matched for 1.5 s (1.8x the time while a line is
  being followed but not finished); posture changes wait 3 s longer (1.5 s if
  the line was heard finishing). Decoder output counts as speech even when the
  energy gate misses it (very quiet or noisy rooms).
- Forward only. No event can move the session backwards, and no single event
  moves it more than one step except a movement phrase, which moves exactly as
  far as a camera pose change would (the next posture change).

## Modes and the fusion API

```ts
const voice = useVoiceFollow({
  enabled,                         // lazy: nothing loads until true
  mode: following ? 'lines' : 'full',
  companionSpeaking,               // the app's own recitation is playing
  ignoreCompanion: true,           // silence the mic while it plays
  onEvidence: (e) => fuse(e),      // {source:'voice', kind, confidence, at, step?, lineId?, wordIndex?}
})
voice.status   // 'idle' | 'loading' | 'listening' | 'error'
voice.error    // 'unsupported' | 'mic-denied' | 'mic-missing' | 'model-unreachable' | 'engine-failed'
voice.progress // model download 0..1
voice.cursor   // {step, wordIndex}: highlight the word being said
voice.speaking
```

- `full` (camera off): voice leads lines and postures.
- `lines` (camera following): voice moves lines within a posture; postures stay
  with the camera (`onPose`). Keywords are still reported as evidence.
- `evidence`: listen and report only.

`Evidence` has the same shape for both senses (`source: 'voice' | 'camera'`),
so a fuser can, for example, accept a camera pose change sooner when a takbir
was heard within 2 s, or treat a heard `lineStart` of the next posture's first
line as confirming a pose the camera is unsure about.

While voice is listening, the App's own step timer is off (the driver keeps
speech-aware timers); if voice fails, the App timer is back automatically.

## The companion's own voice

The app recites each line through the speakers, and the microphone hears it.
Two defences, both on by default in the hook:

- **Echo cancellation**: `getUserMedia({audio: {echoCancellation: true,
  noiseSuppression: false, autoGainControl: true}})`. Browser AEC removes what
  this tab plays from its own speakers. It cannot be measured headless (no
  speaker-to-microphone path); expect it to work on laptops and phones and to
  fail with external speakers far from the device. Noise suppression is off
  because it eats quiet and whispered recitation.
- **The gate** (`ignoreCompanion`): while `companionSpeaking`, the worker
  replaces the microphone with silence (plus a 350 ms tail). Whatever the
  worshipper says on top of the companion is lost, so the companion should lead
  and the worshipper follow, which is how the app is used.

In both cases the driver's timers hold while the companion speaks and start
counting when it stops; without that, every line timed out during the
companion's recitation (measured, below).

## Testing

```bash
npm test                                   # follower, driver, whole-prayer sims, decoded fixtures
node scripts/fetch-voice-model.mjs         # once, stage the model
npm run dev    # then open /?lab&voice      # live microphone: transcript, cursor, events
node scripts/voice-replay.mjs              # replay matrix (3 speakers, noise, -20 dB, whispered)
node scripts/voice-replay.mjs --stress     # false starts, skipped lines, tasbih x1/x5, companion
node scripts/voice-replay.mjs --mic --prayer fajr --speaker aisha   # through fake audio capture, real time
```

The harness builds each prayer from the companion recordings in
`public/audio/voices/<speaker>/` (or `PRAYALONG_AUDIO_DIR`): every step's line
(x repeat), a spoken "Allahu akbar" before each posture announced by it, and
seeded pauses. Ground truth is the per-word timing in `public/audio/manifest.json`.
It runs the real worker, follower and driver in Chromium under the production
COOP/COEP headers, and scores:

- **word lag**: time the word event is emitted (decoder audio clock plus the
  decode time of that batch) minus the end of that word in the audio;
- **lineDone**: on time if it fires between 0.4 s before and 3 s after the line's
  last word (a movement phrase that finishes the line first also counts);
- **arrival lag**: when the session reaches a step minus when the person was
  ready for it (end of the previous line, or of the takbir announcing it);
  premature if more than 0.3 s early;
- **takbir recall** and **false keyword events** (any keyword not within a
  spoken one).

## Measured (2026-10-05)

All runs in Chromium (Playwright) under COOP same-origin + COEP
credentialless (`crossOriginIsolated` true), real worker, follower and driver,
mic-only (`full`) mode, default thresholds. Speakers are the companion voices
(aisha, yusuf, ahmad). `g0.1` = whole mix at -20 dB; `snrN` = pink noise at N dB
speech-to-noise; `q0.2` = every quiet line at -14 dB (a silent prayer said
under the breath); `perturbN` = false starts (12% of lines), a forgotten
quiet line (10%), tasbih said once (20%) or five times (12%); `companion` =
another voice recites each line first at -6 dB (speaker bleed), gate open or
closed; `mic` = through `--use-file-for-fake-audio-capture`, in real time
(the rest feed the worker directly, as fast as it decodes).

| run | min | word recall | lag p50 (s) | lag p95 (s) | lineDone on time | early | takbir | false kw | premature | late | arrival p50 / p95 (s) | timer moves | completed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fajr aisha | 4.42 | 1.00 | 0.56 | 0.91 | 49/49 | 0 | 11/11 | 0 | 0 | 0 | 0.37 / 1.69 | 0 | yes |
| fajr aisha, fake mic, real time | 4.42 | 1.00 | 0.59 | 1.05 | 49/49 | 0 | 11/11 | 0 | 0 | 0 | 0.44 / 1.75 | 0 | yes |
| fajr yusuf | 4.46 | 0.98 | 0.53 | 0.94 | 48/49 | 0 | 11/11 | 0 | 0 | 0 | 0.34 / 1.69 | 1 | yes |
| fajr ahmad | 4.52 | 1.00 | 0.56 | 0.94 | 49/49 | 0 | 11/11 | 0 | 0 | 0 | 0.30 / 1.70 | 0 | yes |
| maghrib yusuf | 6.23 | 1.00 | 0.53 | 0.92 | 67/67 | 0 | 17/17 | 0 | 0 | 0 | 0.31 / 1.68 | 0 | yes |
| dhuhr ahmad, quiet lines -14 dB | 7.57 | 1.00 | 0.50 | 0.91 | 81/81 | 0 | 22/22 | 0 | 0 | 0 | 0.27 / 1.63 | 0 | yes |
| fajr aisha, -20 dB | 4.42 | 0.98 | 0.54 | 1.03 | 48/49 | 0 | 11/11 | 0 | 0 | 0 | 0.36 / 1.66 | 1 | yes |
| fajr aisha, SNR 10 dB | 4.42 | 1.00 | 0.59 | 1.33 | 48/49 | 0 | 11/11 | 0 | 0 | 0 | 0.50 / 2.02 | 0 | yes |
| fajr aisha, SNR 10 dB and -20 dB | 4.42 | 0.97 | 0.58 | 1.60 | 47/49 | 0 | 11/11 | 0 | 0 | 0 | 0.50 / 1.99 | 2 | yes |
| fajr aisha, SNR 5 dB | 4.42 | 0.99 | 0.60 | 1.79 | 48/49 | 0 | 10/11 | 0 | 0 | 0 | 0.55 / 2.19 | 0 | yes |
| fajr aisha, perturbed | 4.43 | 1.00 | 0.53 | 0.90 | 48/49 | 0 | 11/11 | 0 | 0 | 0 | 0.29 / 1.59 | 0 | yes |
| maghrib ahmad, perturbed | 6.09 | 1.00 | 0.54 | 0.99 | 64/64 | 0 | 17/17 | 0 | 0 | 1 | 0.29 / 1.68 | 1 | yes |
| isha yusuf, perturbed, SNR 10 dB | 7.08 | 1.00 | 0.57 | 1.35 | 73/77 | 1 | 22/22 | 0 | 0 | 0 | 0.32 / 1.88 | 0 | yes |
| fajr aisha + companion, gate closed | 7.48 | 1.00 | 0.56 | 0.97 | 48/49 | 0 | 11/11 | 0 | 0 | 3 | 0.34 / 3.55 | 0 | yes |
| fajr aisha + companion, gate open | 7.48 | 0.72 | -109 | -4.6 | 0/49 | 33 | 11/11 | 6 | 32 | 0 | -119 / -3.9 | 0 | yes |

Reading it:

- **Lag**: word events arrive 0.50 to 0.60 s (p50) after the word ends in every
  condition; p95 is 0.90 to 1.05 s in clean or quiet audio and rises to 1.3 to
  1.8 s in noise (the decoder emits the last phonemes of a word later or not at
  all; the silence rule then closes the line). Real-time capture adds 0.03 s at
  p50 and 0.14 s at p95 over direct feeding.
- **Lines**: 95 to 100% of lines finish on time in every run but the open-gate
  one; the misses are mostly a tasbih said once (it can only finish when the
  next phrase starts, often more than 3 s later) and one or two lines per noisy
  run. One early lineDone in 15 runs (perturbed isha).
- **Takbir recall** 100% except 10/11 at SNR 5 dB; **zero false keyword
  events** and **zero premature moves** in 14 of 15 runs (about 80 minutes of
  prayer audio).
- **Arrival** (session reaches the step the person is on) p50 0.27 to 0.55 s,
  p95 1.6 to 2.2 s; posture changes dominate the p95 because a move waits for
  the end of "Allahu akbar" plus the decoder's chunk.
- **Companion**: with the gate open the follower follows the app's own voice:
  every line finishes early (33 early, 32 premature moves) and the session runs
  ahead by up to two minutes. With the gate closed and the timers held while it
  speaks, the numbers match the solo runs. The 3 late arrivals there are a
  timeline artifact: in this synthetic timeline the companion says tasmi before
  the worshipper does, and the session (correctly) waits for the worshipper's.
- Before the "hold timers while the companion speaks" fix, the gated run had
  word recall 0.34 and 27 timer moves; before the idle rule, SNR 5 dB had 43/49
  lines and a 3.47 s word-lag p95.

Decode speed: the 4.4 minute fajr decodes in about 25 s on one thread when
nothing else runs (real-time factor about 0.1 on a 14900KF).

## Limits

- Latency is mostly the model: the export decodes 480 ms chunks, so a word is
  reported about 0.5 s after it ends (p50) and under 1 s (p95) in clean audio.
- The test voices are TTS renders of the same lines (clean, fluent, standard
  tajweed). Real worshippers mumble, rush and whisper more; the perturbation
  runs and the -20 dB runs are the closest proxies. Whispering is not voiced
  speech and this model was not trained on it: quiet lines may well fall back
  to the timers. Collect real recordings and add them as fixtures.
- Echo cancellation was not measurable here (see above).
- Repetition counts beyond the sequence's (tasbih x5) are absorbed as
  restarts; fewer (x1) finish the line when the next phrase starts.
- The model and runtime are about 80 MB on first use; cached afterwards.
