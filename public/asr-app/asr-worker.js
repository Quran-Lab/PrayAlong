/* PrayAlong ASR worker, adapted from the Quran Lab ATQAN quran-asr-worker.js:
 * sherpa-onnx WASM + the Zipformer v3.1 Arabic phoneme CTC (int8), 16 kHz, streaming.
 * In:  {type:'init', base} | {type:'audio', samples} | {type:'reset'} | {type:'stop'}
 * Out: {type:'state', progress} | {type:'ready'} | {type:'error', message}
 *      {type:'activity', speech, rms} | {type:'transcript', tokens, final}
 * `base` is the absolute URL of the folder with the sherpa-onnx files. The 73 MB model package may
 * be split into parts (Cloudflare serves files up to 25 MiB): see <base>/manifest.json. */
let recognizer = null
let stream = null
let initializing = null
let lastSig = ''
let noiseRms = 0.002
let voicedRun = 0
let hangover = 0
let seenSpeech = false
let trailingSilence = 0

const MIN_RMS = 0.004, SNR = 2.8, ATTACK = 2, HANGOVER = 2400, WAQAF = 11200

self.onmessage = (e) => {
  const m = e.data
  if (m?.type === 'init') {
    initializing ??= init(m.base).catch((err) => {
      postMessage({ type: 'error', message: String(err?.message ?? err) })
      initializing = null
    })
  } else if (m?.type === 'audio' && recognizer && stream) {
    const s = new Float32Array(m.samples)
    const act = energy(s)
    postMessage({ type: 'activity', speech: act.speech, rms: act.rms })
    stream.acceptWaveform(16000, s)
    decode(false)
    if (waqaf(act, s.length)) {
      decode(true)
      recognizer.reset(stream)
      lastSig = ''
    }
  } else if (m?.type === 'reset' && recognizer && stream) {
    recognizer.reset(stream)
    lastSig = ''
    seenSpeech = false
    trailingSilence = 0
  } else if (m?.type === 'stop') {
    try {
      stream?.free()
      recognizer?.free()
    } catch {}
    close()
  }
}

// Adaptive energy gate (from ATQAN): only marks that someone is speaking, never a phoneme.
function energy(s) {
  let sq = 0
  for (let i = 0; i < s.length; i++) sq += s[i] * s[i]
  const rms = Math.sqrt(sq / Math.max(1, s.length))
  const voiced = rms >= Math.max(MIN_RMS, noiseRms * SNR)
  if (voiced) voicedRun++
  else {
    voicedRun = 0
    noiseRms += (rms - noiseRms) * (rms < noiseRms ? 0.18 : 0.035)
  }
  hangover = voicedRun >= ATTACK ? HANGOVER : Math.max(0, hangover - s.length)
  return { rms, speech: voicedRun >= ATTACK || hangover > 0 }
}

// A pause long enough to be a waqf ends the utterance.
function waqaf(act, n) {
  if (act.speech) {
    seenSpeech = true
    trailingSilence = 0
    return false
  }
  if (!seenSpeech) return false
  trailingSilence += n
  if (trailingSilence < WAQAF) return false
  seenSpeech = false
  trailingSilence = 0
  return true
}

async function fetchBytes(urls, from, to) {
  const sizes = []
  const parts = []
  let got = 0
  for (const url of urls) {
    const res = await fetch(url)
    if (!res.ok || !res.body) throw new Error(`Could not load ${url}`)
    sizes.push(Number(res.headers.get('content-length')) || 0)
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      got += value.byteLength
      const total = urls.length === 1 ? sizes[0] : 0
      if (total) postMessage({ type: 'state', progress: Math.round(from + (got / total) * (to - from)) })
    }
    if (urls.length > 1) postMessage({ type: 'state', progress: Math.round(from + (sizes.length / urls.length) * (to - from)) })
  }
  const buf = new Uint8Array(got)
  let o = 0
  for (const p of parts) {
    buf.set(p, o)
    o += p.byteLength
  }
  return buf.buffer
}

async function partsOf(base, name) {
  try {
    const res = await fetch(`${base}/manifest.json`)
    if (res.ok) {
      const entry = (await res.json()).files?.find((f) => f.name === name)
      if (entry) return entry.parts.map((p) => `${base}/${p}`)
    }
  } catch {}
  return [`${base}/${name}`]
}

async function init(base) {
  postMessage({ type: 'state', progress: 0 })
  let data = await fetchBytes(await partsOf(base, 'sherpa-onnx-wasm-main-asr.data'), 0, 88)
  let wasm = await fetchBytes(await partsOf(base, 'sherpa-onnx-wasm-main-asr.wasm'), 88, 99)
  const src = (await (await fetch(`${base}/sherpa-onnx-wasm-main-asr.js`)).text()).replace('pthreadPoolSize=4', 'pthreadPoolSize=3')
  const runtimeUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  importScripts(`${base}/sherpa-onnx-asr.js`)
  await new Promise((resolve, reject) => {
    self.Module = {
      wasmBinary: wasm,
      mainScriptUrlOrBlob: runtimeUrl,
      getPreloadedPackage: () => data,
      locateFile: (p) => (p.endsWith('.wasm') ? `${base}/sherpa-onnx-wasm-main-asr.wasm` : p),
      onRuntimeInitialized: resolve,
      onAbort: (r) => reject(new Error(String(r))),
      print: () => {},
      printErr: (msg) => console.error(msg),
    }
    importScripts(runtimeUrl)
  })
  self.Module.getPreloadedPackage = null
  self.Module.wasmBinary = null
  data = null
  wasm = null
  const cores = navigator.hardwareConcurrency || 4
  recognizer = createOnlineRecognizer(self.Module, {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: '', decoder: '', joiner: '' },
      paraformer: { encoder: '', decoder: '' },
      zipformer2Ctc: { model: '/zipformer2-ctc.onnx' },
      nemoCtc: { model: '' },
      toneCtc: { model: '' },
      tokens: '/tokens.txt',
      numThreads: cores < 4 ? 2 : 3,
      provider: 'cpu',
      debug: 0,
      modelType: '',
      modelingUnit: 'cjkchar',
      bpeVocab: '',
    },
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 1.4,
    rule2MinTrailingSilence: 0.6,
    rule3MinUtteranceLength: 20,
    hotwordsFile: '',
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: { graph: '', maxActive: 3000 },
    ruleFsts: '',
    ruleFars: '',
  })
  try {
    self.Module.FS_unlink('/zipformer2-ctc.onnx')
    self.Module.FS_unlink('/tokens.txt')
  } catch {}
  stream = recognizer.createStream()
  postMessage({ type: 'ready' })
}

function decode(final) {
  while (recognizer.isReady(stream)) recognizer.decode(stream)
  const r = recognizer.getResult(stream)
  const tokens = Array.isArray(r?.tokens) ? r.tokens.map(String) : []
  const sig = tokens.join('\u001f')
  if (tokens.length && (sig !== lastSig || final)) {
    lastSig = sig
    postMessage({ type: 'transcript', tokens, final })
  }
  if (recognizer.isEndpoint(stream)) {
    if (tokens.length) postMessage({ type: 'transcript', tokens, final: true })
    recognizer.reset(stream)
    lastSig = ''
  }
}
