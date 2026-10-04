import { POSTURES } from '@/content/postures'
import { PRAYER_BY_ID } from '@/content/prayers'
import { getRecitation, surahsByRakah, type RecitationId } from '@/content/recitations'
import type { Posture, PrayerId, PrayerSequence, Step, StepTiming, Voice } from './types'

/**
 * Rough recitation time for a line: a calm, beginner-friendly pace with a
 * short breath between repetitions. Pace scaling happens at playback time.
 */
export function estimateTiming(recitationId: string, repeat = 1): StepTiming {
  const { transliteration } = getRecitation(recitationId)
  const syllables = Math.max(1, transliteration.replace(/[^aeiouāīū]/gi, '').length)
  const once = 650 + syllables * 330
  const expectedMs = Math.round((once * repeat + 400 * (repeat - 1)) / 50) * 50
  return { expectedMs, minMs: Math.min(expectedMs, 1200) }
}

interface Block {
  posture: Posture
  group: string
  lines: readonly RecitationId[]
  repeat?: number
  voice?: Voice
  cue?: string
}

const ordinal = (n: number) => ['first', 'second', 'third', 'fourth'][n - 1] ?? `${n}th`

function rakahBlocks(prayer: PrayerId, rakah: number): Block[] {
  const info = PRAYER_BY_ID[prayer]
  const last = rakah === info.rakahs
  const aloud: Voice = info.aloudRakahs.includes(rakah) ? 'aloud' : 'quiet'
  const blocks: Block[] = []

  if (rakah === 1) {
    blocks.push({ posture: 'takbir', group: 'Opening takbir', lines: ['takbir'], voice: 'aloud', cue: 'Raise your hands and begin' })
    blocks.push({ posture: 'qiyam', group: 'Opening', lines: ['thana-1', 'thana-2', 'taawwudh'], cue: 'Fold your hands' })
  }

  const surah = surahsByRakah[rakah]
  blocks.push({
    posture: 'qiyam',
    group: 'Al-Fatiha',
    lines: ['fatiha-1', 'fatiha-2', 'fatiha-3', 'fatiha-4', 'fatiha-5', 'fatiha-6', 'fatiha-7'],
    voice: aloud,
    cue: rakah === 1 ? undefined : `Allāhu Akbar · rise for the ${ordinal(rakah)} rak‘ah`,
  })
  blocks.push({ posture: 'qiyam', group: 'Amin', lines: ['amin'], voice: aloud })
  if (surah && rakah <= 2) blocks.push({ posture: 'qiyam', group: surah.name, lines: surah.lines, voice: aloud })

  blocks.push({ posture: 'ruku', group: 'Ruku', lines: ['ruku'], repeat: 3, cue: 'Allāhu Akbar · bow' })
  blocks.push({ posture: 'itidal', group: "I'tidal", lines: ['tasmi', 'tahmid'], cue: 'Rise from bowing' })
  blocks.push({ posture: 'sujud', group: 'Sujud', lines: ['sujud'], repeat: 3, cue: 'Allāhu Akbar · prostrate' })
  blocks.push({ posture: 'jalsah', group: 'Jalsah', lines: ['jalsah'], repeat: 2, cue: 'Allāhu Akbar · sit up' })
  blocks.push({ posture: 'sujud', group: 'Sujud', lines: ['sujud'], repeat: 3, cue: 'Allāhu Akbar · prostrate again' })

  const middleSitting = rakah === 2 && info.rakahs > 2
  if (middleSitting || last) {
    blocks.push({
      posture: 'tashahhud',
      group: 'Tashahhud',
      lines: ['tashahhud-1', 'tashahhud-2', 'tashahhud-3', 'tashahhud-4'],
      cue: 'Allāhu Akbar · sit for tashahhud',
    })
  }
  if (last) {
    blocks.push({ posture: 'tashahhud', group: 'Salawat', lines: ['salawat-1', 'salawat-2', 'salawat-3', 'salawat-4'] })
    blocks.push({ posture: 'salam-right', group: 'Salam', lines: ['salam'], voice: 'aloud', cue: 'Turn to your right' })
    blocks.push({ posture: 'salam-left', group: 'Salam', lines: ['salam'], voice: 'aloud', cue: 'Turn to your left' })
  }
  return blocks
}

export function buildSequence(prayer: PrayerId): PrayerSequence {
  const info = PRAYER_BY_ID[prayer]
  const steps: Step[] = []

  for (let rakah = 1; rakah <= info.rakahs; rakah++) {
    for (const block of rakahBlocks(prayer, rakah)) {
      const repeat = block.repeat ?? 1
      block.lines.forEach((recitationId, i) => {
        steps.push({
          id: `r${rakah}-${steps.length}-${recitationId}`,
          rakah,
          posture: block.posture,
          pose: POSTURES[block.posture].pose,
          recitationId,
          group: block.group,
          groupIndex: i,
          groupSize: block.lines.length,
          repeat,
          voice: block.voice ?? 'quiet',
          cue: i === 0 ? block.cue : undefined,
          timing: estimateTiming(recitationId, repeat),
        })
      })
    }
  }

  return { version: 1, prayer, rakahs: info.rakahs, steps }
}

/** A run of consecutive steps that share a posture — one item in the dock. */
export interface PostureSegment {
  posture: Posture
  rakah: number
  start: number
  end: number // exclusive
}

/** Both salams read as one movement in the dock. */
const segmentKey = (posture: Posture) => (posture.startsWith('salam') ? 'salam' : posture)

export function postureSegments(steps: readonly Step[]): PostureSegment[] {
  const segments: PostureSegment[] = []
  steps.forEach((step, i) => {
    const prev = segments.at(-1)
    if (prev && segmentKey(prev.posture) === segmentKey(step.posture) && prev.rakah === step.rakah) prev.end = i + 1
    else segments.push({ posture: step.posture, rakah: step.rakah, start: i, end: i + 1 })
  })
  return segments
}

/**
 * Index of the first step after `from` whose pose differs — i.e. where the
 * worshipper's body has to move next. Hands-free uses this to know which
 * pose change to listen for.
 */
export function nextPoseChange(steps: readonly Step[], from: number): number {
  const pose = steps[from]?.pose
  for (let i = from + 1; i < steps.length; i++) if (steps[i]!.pose !== pose) return i
  return -1
}
