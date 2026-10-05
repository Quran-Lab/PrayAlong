// The wasm runtime writes informational lines (e.g. "Creating a resampler")
// to stderr, which browsers show as errors. Downgrade those to debug.
{
  const err = console.error.bind(console)
  console.error = (...args) => {
    const text = args.map(String).join(' ')
    if (/Creating a resampler|in_sample_rate|output_sample_rate/.test(text)) return console.debug('[voice runtime]', text)
    err(...args)
  }
}
/*
 * PrayAlong voice: on-device Quran ASR worker (classic worker).
 *
 * Adapted from Quran Lab's contribute ASR worker (quran-lab-app,
 * apps/quran-lab-landing/static/asr/asr-worker.js). Same runtime and model,
 * much less machinery: one runtime build (the non-pthread SIMD build, so it
 * needs no SharedArrayBuffer), one model revision, audio delivered over a
 * MessagePort straight from the AudioWorklet, and the model cached with the
 * Cache API instead of OPFS.
 *
 * Two lessons carried over verbatim because they cost real words when ignored:
 *  - The emscripten data package is satisfied with an EMPTY buffer and the real
 *    model bytes are written into MEMFS before the recognizer is built, so the
 *    model can come from anywhere (see quran-lab-app static/asr/README.md).
 *  - Endpoints are honoured only in real waveform silence >= 1.2 s. CTC is
 *    silent for the whole of a held madd, so the decoder's own trailing-blank
 *    count fires inside long vowels; cutting there drops the end of the word.
 *  - Flushing pushes ZERO SAMPLES (not features) before inputFinished(), or the
 *    last chunk never reaches the decoder.
 *
 * Protocol (main -> worker):
 *   {type:'init', modelBase?}            load runtime + model
 *   {type:'port', port}                  MessagePort carrying {samples, rate} from the worklet
 *   {type:'audio', samples, rate, id?}   feed audio directly (replay / tests); replies {type:'ack', id}
 *   {type:'gate', on}                    while on, audio is replaced by silence (companion speaking)
 *   {type:'finish', id?}                 flush the current utterance; replies {type:'finished', id}
 * Protocol (worker -> main):
 *   {type:'progress', loaded, total}     model download
 *   {type:'ready', revision, loadMs}
 *   {type:'tokens', tokens, at, segment, decodeMs}   NEW tokens of the current segment
 *   {type:'endpoint', at, segment}       a segment ended in real silence
 *   {type:'level', rms, speech, at}      ~10 Hz
 *   {type:'error', code, message}
 */
const SAMPLE_RATE = 16000;
const RULE2_SILENCE_S = 1.2;
const FLUSH_SILENCE_S = 1.05;
const FORCE_ENDPOINT_S = 90;
const MIN_SPEECH_RMS = 0.004;
const SPEECH_TO_NOISE = 2.8;

const base = new URL("./", self.location.href).href;
let recognizer = null;
let stream = null;
let initializing = null;
let gate = false;
let recording = null;
let audioSec = 0;
let segAudioSec = 0;
let segment = 0;
let published = [];
let lastLevelAt = -1;
let decodeTotalMs = 0;

// Energy gate (waveform silence), as in the Quran Lab worker.
let noiseRms = 0.002;
let voicedRun = 0;
let hangover = 0;
let trailingSilence = 0;
let levelSquares = 0;
let levelCount = 0;
let levelSpeech = false;

self.onmessage = (event) => {
  const m = event.data;
  switch (m.type) {
    case "init":
      if (!initializing) {
        initializing = initialize(m).catch((error) => {
          initializing = null;
          const message = error && error.message ? error.message : String(error);
          const code = /fetch|network|HTTP|manifest|sha256|cors/i.test(message) ? "model-unreachable" : "engine-failed";
          postMessage({ type: "error", code, message });
        });
      }
      break;
    case "port":
      m.port.onmessage = (e) => accept(e.data.samples, e.data.rate);
      break;
    case "audio":
      accept(m.samples, m.rate);
      if (m.id !== undefined) postMessage({ type: "ack", id: m.id });
      break;
    case "gate":
      gate = !!m.on;
      break;
    case "record":
      // Opt-in session recording: the raw microphone (before the companion
      // gate) at 16 kHz, kept in this worker until taken. Never uploaded.
      recording = m.on ? { chunks: [], resample: makeResampler(), startAt: audioSec } : recording;
      if (!m.on && recording) recording.stopped = true;
      break;
    case "take": {
      const r = recording;
      const total = r ? r.chunks.reduce((s, c) => s + c.length, 0) : 0;
      const pcm = new Int16Array(total);
      let off = 0;
      if (r) for (const c of r.chunks) pcm.set(c, (off += c.length) - c.length);
      postMessage({ type: "recording", id: m.id, pcm, sampleRate: SAMPLE_RATE, startAt: r ? r.startAt : 0 }, [pcm.buffer]);
      if (m.clear) recording = null;
      break;
    }
    case "finish":
      finish();
      // decodeMs: all decoding time so far, for the real-time factor (decodeMs / 1000 / audioSec).
      postMessage({ type: "finished", id: m.id, decodeMs: Math.round(decodeTotalMs), audioSec });
      break;
  }
};

async function initialize(m) {
  const started = performance.now();
  const modelBase = new URL(m.modelBase || "model/", base).href;
  const manifestRes = await fetch(new URL("manifest.json", modelBase), { cache: "no-cache" });
  if (!manifestRes.ok) throw new Error(`model manifest: HTTP ${manifestRes.status}`);
  const manifest = await manifestRes.json();
  const total = manifest.files.reduce((s, f) => s + f.bytes, 0);
  let loaded = 0;
  const onBytes = (n) => {
    loaded += n;
    postMessage({ type: "progress", loaded, total });
  };

  // Start the runtime compile while the model downloads.
  const wasmUrl = `${base}runtime/sherpa-onnx-wasm-main-asr.single.wasm`;
  const compiled = WebAssembly.compileStreaming
    ? WebAssembly.compileStreaming(fetch(wasmUrl)).catch(() => null)
    : Promise.resolve(null);

  const files = {};
  for (const file of manifest.files) files[file.name] = await loadFile(modelBase, manifest.revision, file, onBytes);

  const module = await compiled;
  importScripts(`${base}runtime/sherpa-onnx-asr.js`);
  await new Promise((resolve, reject) => {
    self.Module = {
      getPreloadedPackage: () => new ArrayBuffer(0),
      locateFile: (path) => (path.endsWith(".wasm") ? wasmUrl : `${base}runtime/${path}`),
      ...(module
        ? {
            instantiateWasm: (imports, ok) => {
              WebAssembly.instantiate(module, imports).then((instance) => ok(instance, module), reject);
              return {};
            },
          }
        : {}),
      onRuntimeInitialized: resolve,
      onAbort: (reason) => reject(new Error(`wasm abort: ${reason}`)),
      print: () => {},
      printErr: () => {},
    };
    importScripts(`${base}runtime/sherpa-onnx-wasm-main-asr.single.js`);
  });

  for (const path of ["/zipformer2-ctc.onnx", "/tokens.txt"]) {
    try {
      self.Module.FS_unlink(path);
    } catch {
      // placeholder absent
    }
  }
  self.Module.FS_createDataFile("/", "zipformer2-ctc.onnx", files["zipformer2-ctc.onnx"], true, false, true);
  self.Module.FS_createDataFile("/", "tokens.txt", files["tokens.txt"], true, false, true);
  recognizer = createOnlineRecognizer(self.Module, recognizerConfig());
  try {
    self.Module.FS_unlink("/zipformer2-ctc.onnx");
    self.Module.FS_unlink("/tokens.txt");
  } catch {
    // older bundles
  }
  stream = recognizer.createStream();
  // Pay ORT's first-run costs now, not on the first word.
  stream.acceptWaveform(SAMPLE_RATE, new Float32Array(SAMPLE_RATE));
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  stream.free();
  stream = recognizer.createStream();
  postMessage({ type: "ready", revision: manifest.revision, loadMs: Math.round(performance.now() - started) });
}

async function loadFile(modelBase, revision, file, onBytes) {
  const out = new Uint8Array(file.bytes);
  let offset = 0;
  const cache = self.caches ? await self.caches.open(`prayalong-voice-${revision}`).catch(() => null) : null;
  for (const part of file.parts) {
    const url = new URL(part, modelBase).href;
    let res = cache ? await cache.match(url).catch(() => undefined) : undefined;
    const fromCache = !!res;
    if (!res) {
      res = await fetch(url);
      if (!res.ok) throw new Error(`${part}: HTTP ${res.status}`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (cache && !fromCache) await cache.put(url, new Response(bytes)).catch(() => {});
    out.set(bytes, offset);
    offset += bytes.length;
    onBytes(bytes.length);
  }
  if (offset !== file.bytes) throw new Error(`${file.name}: ${offset} bytes, manifest says ${file.bytes}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", out));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== file.sha256) {
    if (cache) for (const part of file.parts) await cache.delete(new URL(part, modelBase).href).catch(() => {});
    throw new Error(`${file.name}: sha256 mismatch`);
  }
  return out;
}

function recognizerConfig() {
  return {
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: "", decoder: "", joiner: "" },
      paraformer: { encoder: "", decoder: "" },
      zipformer2Ctc: { model: "/zipformer2-ctc.onnx" },
      nemoCtc: { model: "" },
      toneCtc: { model: "" },
      tokens: "/tokens.txt",
      numThreads: 1,
      provider: "cpu",
      debug: 0,
      modelType: "",
      modelingUnit: "cjkchar",
      bpeVocab: "",
    },
    decodingMethod: "greedy_search",
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: RULE2_SILENCE_S,
    rule3MinUtteranceLength: 20,
    hotwordsFile: "",
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: { graph: "", maxActive: 3000 },
    ruleFsts: "",
    ruleFars: "",
  };
}

function observe(samples, rate) {
  let sq = 0;
  for (let i = 0; i < samples.length; i++) sq += samples[i] * samples[i];
  const rms = samples.length ? Math.sqrt(sq / samples.length) : 0;
  const voiced = rms >= Math.max(MIN_SPEECH_RMS, noiseRms * SPEECH_TO_NOISE);
  if (voiced) voicedRun++;
  else {
    voicedRun = 0;
    noiseRms += (rms - noiseRms) * (rms < noiseRms ? 0.18 : 0.035);
  }
  if (voicedRun >= 2) hangover = 0.15;
  else hangover = Math.max(0, hangover - samples.length / rate);
  const speech = voicedRun >= 2 || hangover > 0;
  trailingSilence = speech ? 0 : trailingSilence + samples.length / rate;
  levelSquares += sq;
  levelCount += samples.length;
  levelSpeech = levelSpeech || speech;
}

/** The session recording, at 16 kHz through the same resampler as the decoder. */
function keepRecording(input, rate) {
  const r = recording;
  if (!r || r.stopped) return;
  const pcm = r.resample(input, rate);
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767)));
  r.chunks.push(out);
}

/**
 * Streaming windowed-sinc resampler to 16 kHz. The decoder's own resampler
 * (fed 48 kHz microphone audio) roughly doubled the phoneme error rate on
 * short utterances, so the stream always gets 16 kHz from here.
 */
function makeResampler() {
  let rs = null;
  return (input, rate) => resample(input, rate, rs && rs.rate === rate ? rs : (rs = newResampler(rate)));
}
function newResampler(rate) {
  const step = rate / SAMPLE_RATE; // input samples per output sample
  const fc = (0.47 * SAMPLE_RATE) / rate; // cut-off, cycles per input sample (7.5 kHz)
  const half = Math.ceil(12 / (2 * fc)); // taps each side: 12 zero crossings
  return { rate, step, fc, half, buf: new Float32Array(0), pos: half };
}
const to16k = makeResampler();
function resample(input, rate, rs) {
  if (rate === SAMPLE_RATE) return input;
  {
  }
  const { step, fc, half } = rs;
  const buf = new Float32Array(rs.buf.length + input.length);
  buf.set(rs.buf);
  buf.set(input, rs.buf.length);
  const out = [];
  let pos = rs.pos; // next output position, in buf samples
  while (pos + half < buf.length) {
    const c = Math.floor(pos);
    let acc = 0;
    let norm = 0;
    for (let k = c - half + 1; k <= c + half; k++) {
      const d = pos - k;
      const x = 2 * fc * d;
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
      const w = 0.5 + 0.5 * Math.cos((Math.PI * d) / (half + 1));
      const h = sinc * w;
      acc += (buf[k] || 0) * h;
      norm += h;
    }
    out.push(acc / norm);
    pos += step;
  }
  // Keep what the next call still needs (the window left of the next output).
  const keepFrom = Math.max(0, Math.floor(pos) - half);
  rs.buf = buf.slice(keepFrom);
  rs.pos = pos - keepFrom;
  return Float32Array.from(out);
}

function accept(input, rate) {
  if (!input || !input.length) return;
  keepRecording(input, rate);
  const samples = gate ? new Float32Array(input.length) : input;
  const dur = samples.length / rate;
  observe(samples, rate);
  audioSec += dur;
  if (audioSec - lastLevelAt >= 0.1) {
    postMessage({ type: "level", rms: Math.sqrt(levelSquares / Math.max(1, levelCount)), speech: levelSpeech, at: audioSec });
    levelSquares = 0;
    levelCount = 0;
    levelSpeech = false;
    lastLevelAt = audioSec;
  }
  if (!recognizer || !stream) return;
  segAudioSec += dur;
  stream.acceptWaveform(SAMPLE_RATE, to16k(samples, rate));
  decode(false);
}

function decode(final) {
  const t0 = performance.now();
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  decodeTotalMs += performance.now() - t0;
  const result = recognizer.getResult(stream);
  const tokens = Array.isArray(result && result.tokens) ? result.tokens.map(String) : [];
  let common = 0;
  while (common < tokens.length && common < published.length && tokens[common] === published[common]) common++;
  if (tokens.length > common) {
    postMessage({ type: "tokens", tokens: tokens.slice(common), at: audioSec, segment, decodeMs: Math.round((performance.now() - t0) * 10) / 10, final });
  }
  published = tokens;
  const safe = !tokens.length || trailingSilence >= RULE2_SILENCE_S || segAudioSec >= FORCE_ENDPOINT_S;
  if (!final && recognizer.isEndpoint(stream) && safe) {
    recognizer.reset(stream);
    if (tokens.length) postMessage({ type: "endpoint", at: audioSec, segment });
    segment++;
    published = [];
    segAudioSec = 0;
  }
}

function finish() {
  if (!recognizer || !stream) return;
  stream.acceptWaveform(SAMPLE_RATE, new Float32Array(Math.round(SAMPLE_RATE * FLUSH_SILENCE_S)));
  stream.inputFinished();
  decode(true);
  if (published.length) postMessage({ type: "endpoint", at: audioSec, segment });
  stream.free();
  stream = recognizer.createStream();
  segment++;
  published = [];
  segAudioSec = 0;
}
