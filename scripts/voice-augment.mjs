// Real-like takes from the companion recordings, for the replay harness.
//
// TTS lines are clean, fluent and always the same. People are not: they speed
// up and slow down, sit in echoey rooms, use laptop microphones, mumble and
// hold the last word. This renders several varied takes of every line with
// ffmpeg and writes a manifest whose word timings follow the changes.
//
//   import { augment } from './voice-augment.mjs'
//   const dir = await augment({ audioDir, preset: 'real', voices: ['aisha'], seed: 1 })
//
// Presets (per take, seeded):
//   clean    no change (baseline through the same path)
//   fast     tempo 1.25-1.5, pitch +-1 semitone
//   slow     tempo 0.7-0.85, last word held (stretched 2-3x)
//   room     reverb (small to large room) + laptop-mic EQ and compression
//   quiet    laptop EQ, -18 to -26 dB, darker (a soft voice far from the mic)
//   real     everything mixed: tempo 0.75-1.45, pitch +-2 semitones, room 60%,
//            laptop EQ 70%, level 0 to -20 dB, last word held in 25% of takes
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const LAPTOP = 'highpass=f=220,lowpass=f=6500,equalizer=f=2600:t=q:w=1.2:g=5,equalizer=f=180:t=q:w=1:g=-6,acompressor=threshold=-22dB:ratio=3:attack=5:release=80'
const ROOMS = [
  'aecho=0.8:0.55:19|37|61:0.30|0.20|0.12', // small room
  'aecho=0.8:0.6:31|67|113|167:0.35|0.26|0.18|0.10', // living room
  'aecho=0.85:0.7:47|103|181|263|359:0.40|0.32|0.24|0.16|0.10', // large, hard walls
]

/** One take's parameters. */
function draw(preset, rand) {
  const between = (a, b) => a + (b - a) * rand()
  const p = { tempo: 1, semitones: 0, room: null, laptop: false, gainDb: 0, holdLast: 1 }
  switch (preset) {
    case 'clean':
      break
    case 'fast':
      p.tempo = between(1.25, 1.5)
      p.semitones = between(-1, 1)
      break
    case 'slow':
      p.tempo = between(0.7, 0.85)
      p.holdLast = between(2, 3)
      break
    case 'room':
      p.room = ROOMS[Math.floor(rand() * ROOMS.length)]
      p.laptop = true
      break
    case 'quiet':
      p.laptop = true
      p.gainDb = between(-26, -18)
      p.semitones = between(-1, 0)
      break
    case 'real':
      p.tempo = between(0.75, 1.45)
      p.semitones = between(-2, 2)
      p.room = rand() < 0.6 ? ROOMS[Math.floor(rand() * ROOMS.length)] : null
      p.laptop = rand() < 0.7
      p.gainDb = between(-20, 0)
      p.holdLast = rand() < 0.25 ? between(1.8, 2.8) : 1
      break
    default:
      throw new Error(`unknown preset ${preset}`)
  }
  return p
}

/** atempo only takes 0.5-2 per stage. */
const atempo = (t) => {
  const parts = []
  while (t > 2) {
    parts.push('atempo=2')
    t /= 2
  }
  while (t < 0.5) {
    parts.push('atempo=0.5')
    t /= 0.5
  }
  parts.push(`atempo=${t.toFixed(4)}`)
  return parts.join(',')
}

async function renderTake(src, out, line, p) {
  const ratio = 2 ** (p.semitones / 12)
  const sr = 44100
  // Pitch by resampling, tempo corrected so the overall speed is p.tempo.
  const speed = `asetrate=${Math.round(sr * ratio)},aresample=${sr},${atempo(p.tempo / ratio)}`
  const post = [p.room, p.laptop ? LAPTOP : null, p.gainDb ? `volume=${p.gainDb.toFixed(1)}dB` : null].filter(Boolean).join(',')
  const words = line.words.map(([s, e]) => [s, e])
  let filter
  if (p.holdLast > 1 && words.length) {
    // Hold the last word: stretch from its start to the end of the clip.
    const cut = words.at(-1)[0]
    filter = `[0:a]aresample=${sr},asplit=2[a][b];[a]atrim=0:${cut},asetpts=PTS-STARTPTS[h];[b]atrim=${cut},asetpts=PTS-STARTPTS,${atempo(1 / p.holdLast)}[t];[h][t]concat=n=2:v=0:a=1,${speed}${post ? `,${post}` : ''}[o]`
    const last = words.at(-1)
    words[words.length - 1] = [last[0], last[0] + (last[1] - last[0]) * p.holdLast]
  } else {
    filter = `[0:a]aresample=${sr},${speed}${post ? `,${post}` : ''}[o]`
  }
  await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-filter_complex', filter, '-map', '[o]', '-ac', '1', '-ar', '16000', out])
  const tail = p.room ? 0.35 : 0
  const scale = 1 / p.tempo
  const dur = (p.holdLast > 1 ? line.dur + (line.words.at(-1)?.[1] - line.words.at(-1)?.[0]) * (p.holdLast - 1) : line.dur) * scale + tail
  return { dur: Math.round(dur * 1000) / 1000, words: words.map(([s, e]) => [Math.round(s * scale * 1000) / 1000, Math.round(e * scale * 1000) / 1000]) }
}

/**
 * Render `takes` variants of every line for each voice. Returns the output
 * directory, laid out like public/audio (manifest.json + voices/...), with
 * `variants` per line in the manifest.
 */
export async function augment({ audioDir, outDir, preset, voices, seed = 1, takes = 3, parallel = 8 }) {
  const manifest = JSON.parse(await readFile(join(audioDir, 'manifest.json'), 'utf8'))
  const dir = join(outDir, `${preset}-s${seed}`)
  const done = join(dir, 'manifest.json')
  if (existsSync(done)) return dir
  const rand = rng(seed * 7919 + preset.length)
  const out = { version: 1, preset, seed, voices: {} }
  const jobs = []
  for (const voice of voices) {
    const lines = manifest.voices[voice]?.lines
    if (!lines) throw new Error(`no voice ${voice}`)
    await mkdir(join(dir, 'voices', voice), { recursive: true })
    out.voices[voice] = { lines: {} }
    for (const [id, line] of Object.entries(lines)) {
      const variants = []
      for (let k = 0; k < takes; k++) {
        const p = draw(preset, rand)
        const rel = `voices/${voice}/${id}.${k}.wav`
        const slot = { src: rel, params: p }
        variants.push(slot)
        jobs.push(async () => Object.assign(slot, await renderTake(join(audioDir, line.src), join(dir, rel), line, p)))
      }
      out.voices[voice].lines[id] = { ...variants[0], variants }
    }
  }
  let next = 0
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < jobs.length) await jobs[next++]()
  }))
  for (const v of Object.values(out.voices)) for (const l of Object.values(v.lines)) Object.assign(l, { src: l.variants[0].src, dur: l.variants[0].dur, words: l.variants[0].words })
  await writeFile(done, JSON.stringify(out))
  return dir
}
