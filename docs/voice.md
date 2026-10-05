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

Model: the zipformer v3.1 int8 CTC phoneme model (`tokens.txt`, blank id
250) in three streaming chunk sizes from the same export pipeline (the 480 ms
rebuild matches the shipped file byte for byte):

| folder | chunk | bytes | sha256 | PER pooled (512 clips) | WASM RTF, 4 E-cores |
| --- | --- | --- | --- | --- | --- |
| `voice/model/` | 480 ms | 67,972,550 | `168a9430...` | 5.35 | 0.131 |
| `voice/model/c16-1/` | 320 ms | 67,584,798 | `bd24ac1e...` | 5.42 | 0.166 |
| `voice/model/c8-1/` (default) | 160 ms | 67,193,407 | `e3007fcd...` | 5.68 | 0.225 |

Each folder holds four parts of at most 20 MiB plus `manifest.json`
(`{revision, files:[{name, bytes, sha256, parts}]}`); the worker stitches
and verifies them and keeps them in the Cache API. Production serves
`/voice/model/*` from the private R2 bucket `prayalong-models` through the
Worker (`worker/index.ts`): same origin, so no CORS under COEP. New variants
go to a new versioned prefix (`npx wrangler r2 object put
prayalong-models/voice/model/<rev>/<file> --file <f> --remote`); the live
files are never overwritten. `node scripts/fetch-voice-model.mjs [--chunk 16|8]`
stages the same layout under `public/voice/model/` for local runs.

**Microphone audio is resampled to 16 kHz in the worker** (windowed sinc,
7.5 kHz cut-off). Passing 48 kHz to the decoder and letting it resample
doubled the phoneme error rate on isolated "Allahu akbar" clips (480 ms model
4.6% at 16 kHz vs 8.5% fed 48 kHz; 160 ms 4.9% vs 9.4%; quiet takes 4.2% vs
16.7%); with the worker's resampler 48 kHz input gives 4.9% on both. Replays
that feed 16 kHz never saw this: `voice-real.mjs --rate 48000` exercises it.

**Prefetch.** `prefetchVoiceModelWhenIdle()` (App, on idle after page open
and again after listening stops) starts the worker and loads the model;
`VoiceEngine.start()` takes over that worker, even mid-load. Skipped with
Save-Data or under 2 GB of device memory.

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

**One aligner over a prayer graph** (`follower.ts`). Everything heard since
the anchor line started is aligned against the expected path from there (the
current step and the next 3; 12 when lost), built as a graph over target
columns: each column has one predecessor and an entry cost, and these moves
are edges:

| edge | cost | what it models |
| --- | --- | --- |
| skip a line | 5 (2 when lost) | a forgotten line |
| skip a remaining repetition | 0.8 | tasbih said once instead of three times |
| restart a line | 2.5 | false start, hesitation |
| one more repetition | 0.8 | tasbih said 4 or 5 times (never read as the next posture's identical line) |
| leave out the basmala | 0.6 | the basmala before a surah is optional |
| leave out the takbir node | 0.3 | "Allahu akbar" before a posture, often whispered or unheard |
| enter another short surah | 1 | branch to the opening of al-Asr, al-Kawthar, al-Kafirun, an-Nasr, al-Masad, al-Ikhlas, al-Falaq or an-Nas |

The cheapest end column is where the person is. Repeated lines are loops: a
repetition said to its end (final phoneme decoded, then 0.15 s of quiet or the
next repetition begun) is committed, its phonemes and unit leave the window,
and the next utterance can only be the next repetition.

- `word(step, lineId, wordIndex, rep)` when the cursor passes a word that was
  heard (>= 34% of it matched), or that lies before a well matched word.
- `lineStart(step)` once a step is confidently entered (>= 6 symbols and 60%
  of its first word).
- `lineDone(step, reps)` only when the line was said to its end: its last
  word's final phoneme decoded (or 70% of it with one of the last two), at
  least 40% (aloud) or 30% (quiet) of the line heard, then 0.15 s of quiet or
  the next line starting. A later line clearly started also finishes it; a
  partly heard last word only after 1 s of real silence with 60% of it heard
  and at most one consonant missing (never on the onset of the word).
- `takbir` when the best path goes through a takbir node with 55% of it
  heard. There is no takbir node inside a posture, so nothing there (for
  example "Allahumma barik") can be taken for one.
- `surah(surah, step)` when the best path is in a branch, with 8 or more of its
  phonemes heard, 2 cheaper than the planned surah and 1 cheaper than every
  other branch (al-Falaq and an-Nas share their first three words).
- At most one `lineDone` per evaluation, strictly in order; word reports and
  repetition counts only ever increase (counts survive re-anchors and
  endpoints; only a new prayer clears them).

The cursor (`voice.cursor`) is `{ step, wordIndex, rep, fill, repsDone }`:
the word in progress, how far through it in phoneme positions (0..1), the
repetition in progress (0-based) and the repetitions finished. A finished
line shows its last word at fill 1 until the next line starts. The UI should
keep a finished line visible at fill 1 for about 250 ms as it moves on (a
visual hold; the follower does not delay the session for it).

## The driver (mic-only mode)

Every move is forward and exactly one step, with one exception (the resync
after a late start, last bullet).

- Ready: the opening takbir line begins the prayer.
- A finished line moves to the next line of the same posture.
- Hearing the next line moves there: its `lineStart`, or one of its words
  heard clearly (confidence >= 0.5; the sujud tasbih after i'tidal moves to
  sujud on its first words even with no takbir heard). Not while a repeated
  line is short of its count.
- The takbir moves into the posture it announces, only from the line right
  before it and after 1.2 s on the current step.
- A short surah other than the planned one: the session switches to it
  (`switchSurah`) from the end of al-Fatiha until the planned surah's second
  line.
- Catching up (the session is behind the voice): a later line finished moves
  one step, if that line was heard (not merely inferred as skipped) or words
  of a later line were heard clearly in the last 10 s.
- Timers, so nothing stalls: a line moves on after its expected time if nobody
  is talking and no word matched for 1.5 s (1.8x the time while it is being
  followed; 2x on an aloud line nobody has started). After the last line before
  a movement is done and no phrase is heard: 3 s. A repeated line short of its
  count never times out while repetitions are heard, except after 6 s of
  silence. Timers hold while the companion speaks. Decoder output counts as
  speech even when the energy gate misses it, but never as a speech onset
  (the last phonemes of al-Fatiha are decoded after the session reached amin).
  An aloud line nobody has started waits at least 8 s.
- Resync after a late start (`VoiceCore.armResync`, called when listening
  starts): the follower looks 12 steps ahead for 60 s of audio, with cheap line
  skips, and timers count from listening start. The driver may jump ONCE,
  forward, several steps, on the first line heard clearly and in full
  (lineDone confidence >= 0.85, ended by silence or the next line, at least 18
  phonetic characters, not a line also said earlier on the way, never al-Fatiha
  1, which is the basmala of every later surah). A clear line in step disarms
  it; it expires after 90 s.

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
voice.cursor   // {step, wordIndex, rep, fill, repsDone} (see the follower)
voice.speaking
voice.recording, voice.saveRecording()  // with record: true (below)
```

**Recording (opt-in).** `useVoiceFollow({ record: true })` keeps the raw
microphone (before the companion gate) at 16 kHz in the worker and logs
everything the engine does on the worker's audio clock: tokens, speech
levels, endpoints, follower events, session moves and changes, the companion
gate. `voice.saveRecording()` downloads `prayalong-<prayer>-<date>.wav` and
`.json`; nothing is uploaded. The voice lab has Record, Save and "Replay a
recording", which runs a saved WAV through the real worker, follower and
driver, so a real failing session becomes a fixture.

**Console log (beta).** `[voice] heard <phonemes in Latin letters> |
expected <line> xN | cursor <line>#<word> "<that word's phonemes>" rep, done,
fill, cost`, `[voice] event ...`, `[voice] move ...` and `[voice] timer
advance ...`. Turn off with `localStorage.setItem('prayalong:voiceDebug', '0')`.

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

## Wiring it as the primary "Listen" mode

What `src/App.tsx` does on this branch (between `[voice]` markers), and what
the main thread should change when the toggle UI lands:

1. Replace the `?voice` flag with the Listen toggle state (persist it in the
   session settings if wanted): `useVoiceFollow({ enabled: listen, mode:
   following ? 'lines' : 'full', ignoreCompanion: true, companionSpeaking })`.
   Enable it from the click so the AudioContext may start (the engine also
   resumes it on the first interaction if it was started without one).
2. `companionSpeaking`: the companion audio engine (`src/audio/engine.ts` on
   the main branch) should expose a `speaking` boolean (true from the start of
   a line's playback to its end) and pass it here. That both gates the
   microphone and holds the timers, which is what makes repeat-after-me work.
3. The visible progress slider: while voice is listening the App's own step
   timer is off and `timedMs` comes from `voice.timerMs` (the driver's fallback
   for that step: the line's time, plus 3 s before a posture change). It moves
   on when nobody has spoken for 0.7 s and no word matched for 1.5 s, so the
   prayer never stalls in quiet rak'ahs; as soon as speech is followed again,
   the follower leads, catching up one step per event.
4. Show `voice.status` / `voice.error` / `voice.progress` on the toggle (a first
   start downloads about 80 MB), and optionally `voice.cursor` to underline the
   word being said.
5. Camera on as well: `mode: 'lines'` (camera leads postures, voice lines) or
   keep `'full'` and feed camera poses through `session.onPose` as now; both
   only move forward, so they cannot fight. `onEvidence` gives every voice
   event for a fuser.

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
node scripts/voice-replay.mjs --real       # real-like takes (below): tempo, pitch, room, laptop mic, quiet, held last word
node scripts/voice-replay.mjs --model voice/model-c8/   # another model folder (fetch-voice-model.mjs --chunk 8)
python scripts/voice-real-set.py           # once: real recordings from local data (stay on this machine)
node scripts/voice-real.mjs                # real voices: short surahs, adults and children, phone audio
node scripts/voice-real.mjs --rate 48000   # same, fed at the microphone rate (the worker resamples)
node scripts/voice-replay.mjs --amin       # amin left out, after a 4-6 s pause, joined to the last verse
node scripts/voice-replay.mjs --lateset    # model ready 10/25/40 s into the prayer (resync); --noresync to compare
node scripts/voice-app.mjs --set std|real|amin   # the real App, every layer, fake microphone, real time
```

**Live-App replay** (`scripts/voice-app.mjs`): the App itself (`?voice`), with
the phoneme follower, driver, speech-burst follow and the stuck and posture
fallbacks, hears the rendered prayer through Chromium's fake microphone after
15 s of silence (the model loads meanwhile). Every session move is scored
against the timeline: early (more than 0.3 s before the person finished what
comes before), late (more than 3 s after), skipped, and repeated lines left
before their last repetition ended. Each run also reports when the model was
ready and how far the decoder ran behind the microphone: run nothing else
alongside it, or the decoder falls behind and the run measures the machine.

**Real-like takes** (`scripts/voice-augment.mjs`, ffmpeg): several takes of
every companion line per preset, one picked per occurrence: `fast` (tempo
1.25-1.5, pitch +-1 semitone), `slow` (0.7-0.85, last word held 2-3x),
`room` (reverb plus laptop-mic EQ and compression), `quiet` (laptop EQ,
-18 to -26 dB), `real` (all of these mixed per take). The timeline can put
tasbih repetitions back to back (`--tight`) and ayat in one breath
(`--joined`).

**Real voices** (`scripts/voice-real-set.py`, `scripts/voice-real.mjs`):
whole short surahs from el-mohafez (app recordings by learners, adults and
children, AMR phone audio) and single verses from TLOG (Tarteel app logs; the
file name is the verse the app asked for, which is not always what was said,
so these numbers are lower bounds). Each recording starts the session on amin
of the rak'ah whose planned surah is al-Kawthar (al-Ikhlas for al-Ikhlas), or
on the verse itself; scored: lines finished by voice, words shown, the surah
named right, and the lag from the end of the voice to the last line's
completion.

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
| fajr yusuf, SNR 10 dB, fake mic, real time | 4.46 | 1.00 | 0.55 | 1.13 | 49/49 | 0 | 11/11 | 0 | 0 | 0 | 0.33 / 2.03 | 0 | yes |
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
  events** and **zero premature moves** in 15 of 16 runs (about 85 minutes of
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

The table above is the first version (480 ms model, before the prayer-graph
aligner). Later measurements, same harness:

**Chunk size** (current code, 160 ms is the default since ca580e4). Line
completion; latency medians over the standard runs; RTF on four E-cores:

| | 480 ms | 320 ms | 160 ms |
| --- | --- | --- | --- |
| standard set, 491 lines | 99.4% | 99.0% | 98.8% |
| real-like set, 516 lines | 94.6% | 92.2% | 91.1% |
| real voices, 549 lines (adults) | 63.6% (76.2%) | 60.1% (73.0%) | 60.8% (73.4%) |
| surah named right / wrong switches | 90/109, 0 | 90/109, 0 | 89/109, 0 |
| word lag p50 | 0.52 s | 0.46 s | 0.38 s |
| line-end lag p95 | 0.59 s | 0.45 s | 0.33 s |
| WASM RTF | 0.131 | 0.166 | 0.225 |

Real voices, paired per clip against 480 ms: 160 ms makes +0.40 skeleton
errors per clip (95% CI [0.11, 0.68]), 320 ms +0.31 ([0.05, 0.59]); on short
single-verse clips +0.18 and +0.20 (both CIs include 0). Isolated "Allahu
akbar" (60 clips): 4.6 / 4.6 / 4.9% PER, the takbir completed in 60/60 for
every model.

**Amin** (`--amin`, premature moves before / after 6c04c5c): amin after a
4-6 s pause 2 and 6 / 0 and 1 (the 1 is a quiet amin in rak'ah 3 whose timer
runs out); amin left out and amin joined to the last verse 0 / 0.

**Late start** (`--lateset`, seconds until the session caught up with the
person, fajr / maghrib, before / after the resync work): model ready 10 s in
8.4, 7.5 / 6.8, 6.0; 25 s in 8.1, 9.3 / 5.8, 5.8; 40 s in 35.3, 26.6 / 14.9,
15.2.

**Live App** (`voice-app.mjs`): see the 2026-10-05 evening batch below.

## Limits

- Latency is mostly the model: with 160 ms chunks a word is reported about
  0.38 s after it ends (p50) and a line completes 0.2 to 0.35 s after its last
  word in clean audio; noise roughly doubles the p95.
- The 3D stage competes with the decoder for CPU. The decoder-lag guard draws
  the stage at low power while decoding is more than 1.5 s behind; a machine
  that is still too slow falls back to the timers.
- The test voices are TTS renders of the same lines (clean, fluent, standard
  tajweed). Real worshippers mumble, rush and whisper more; the perturbation
  runs and the -20 dB runs are the closest proxies. Whispering is not voiced
  speech and this model was not trained on it: quiet lines may well fall back
  to the timers. Collect real recordings and add them as fixtures.
- Echo cancellation was not measurable here (see above).
- Repetition counts beyond the sequence's (tasbih x5) are absorbed as
  restarts; fewer (x1) finish the line when the next phrase starts.
- The model and runtime are about 80 MB on first use; cached afterwards.
