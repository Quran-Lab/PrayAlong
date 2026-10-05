import { POSE_OF } from '@/content/postures'
import { PRAYER_BY_ID } from '@/content/prayers'
import { getLine, surahFor, type RecitationId, type SurahId } from '@/content/recitations'
import type { CueId, GroupId, Posture, PrayerId, PrayerSequence, Step, StepTiming, Voice } from './types'

/**
 * Rough recitation time for a line: a calm, beginner-friendly pace with a
 * short breath between repetitions. Pace scaling happens at playback time.
 */
export function estimateTiming(recitationId: string, repeat = 1): StepTiming {
  const { transliteration } = getLine(recitationId)
  const syllables = Math.max(1, transliteration.replace(/[^aeiouāīū]/gi, '').length)
  const once = 650 + syllables * 330
  const expectedMs = Math.round((once * repeat + 400 * (repeat - 1)) / 50) * 50
  return { expectedMs, minMs: Math.min(expectedMs, 1200) }
}

interface Block {
  posture: Posture
  group: GroupId
  lines: readonly RecitationId[]
  repeat?: number
  voice?: Voice
  cue?: CueId
}

function rakahBlocks(prayer: PrayerId, rakah: number, surahs?: Partial<Record<number, SurahId>>): Block[] {
  const info = PRAYER_BY_ID[prayer]
  const last = rakah === info.rakahs
  const aloud: Voice = info.aloudRakahs.includes(rakah) ? 'aloud' : 'quiet'
  const blocks: Block[] = []

  if (rakah === 1) {
    blocks.push({ posture: 'takbir', group: 'openingTakbir', lines: ['takbir'], voice: 'aloud', cue: 'begin' })
    blocks.push({ posture: 'qiyam', group: 'opening', lines: ['thana-1', 'thana-2', 'taawwudh'], cue: 'fold' })
  }

  const surah = surahFor(rakah, surahs)
  blocks.push({
    posture: 'qiyam',
    group: 'fatiha',
    lines: ['fatiha-1', 'fatiha-2', 'fatiha-3', 'fatiha-4', 'fatiha-5', 'fatiha-6', 'fatiha-7'],
    voice: aloud,
    cue: rakah === 1 ? undefined : 'rise',
  })
  blocks.push({ posture: 'qiyam', group: 'amin', lines: ['amin'], voice: aloud })
  if (surah && rakah <= 2) blocks.push({ posture: 'qiyam', group: surah.group, lines: surah.lines, voice: aloud })

  blocks.push({ posture: 'ruku', group: 'ruku', lines: ['ruku'], repeat: 3, cue: 'bow' })
  blocks.push({ posture: 'itidal', group: 'itidal', lines: ['tasmi', 'tahmid'], cue: 'rising' })
  blocks.push({ posture: 'sujud', group: 'sujud', lines: ['sujud'], repeat: 3, cue: 'prostrate' })
  blocks.push({ posture: 'jalsah', group: 'jalsah', lines: ['jalsah'], repeat: 2, cue: 'sitUp' })
  blocks.push({ posture: 'sujud', group: 'sujud', lines: ['sujud'], repeat: 3, cue: 'prostrateAgain' })

  const middleSitting = rakah === 2 && info.rakahs > 2
  if (middleSitting || last) {
    blocks.push({
      posture: 'tashahhud',
      group: 'tashahhud',
      lines: ['tashahhud-1', 'tashahhud-2', 'tashahhud-3', 'tashahhud-4'],
      cue: 'sit',
    })
  }
  if (last) {
    blocks.push({ posture: 'tashahhud', group: 'salawat', lines: ['salawat-1', 'salawat-2', 'salawat-3', 'salawat-4'] })
    blocks.push({ posture: 'salam-right', group: 'salam', lines: ['salam'], voice: 'aloud', cue: 'right' })
    blocks.push({ posture: 'salam-left', group: 'salam', lines: ['salam'], voice: 'aloud', cue: 'left' })
  }
  return blocks
}

/**
 * The steps of one prayer. `surahs` replaces the planned short surah of a
 * rak'ah (1 and 2), e.g. when the worshipper recites another one.
 */
export function buildSequence(prayer: PrayerId, surahs?: Partial<Record<number, SurahId>>): PrayerSequence {
  const info = PRAYER_BY_ID[prayer]
  const steps: Step[] = []

  for (let rakah = 1; rakah <= info.rakahs; rakah++) {
    for (const block of rakahBlocks(prayer, rakah, surahs)) {
      const repeat = block.repeat ?? 1
      block.lines.forEach((recitationId, i) => {
        steps.push({
          id: `r${rakah}-${steps.length}-${recitationId}`,
          rakah,
          posture: block.posture,
          pose: POSE_OF[block.posture],
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

/**
 * The same prayer with another short surah in `rakah` (the worshipper chose or
 * started reciting a different one). The position moves with it: if the
 * session was on amin or anywhere in that rak'ah's surah, it lands on the new
 * surah's first line; anywhere else it stays on the same step.
 */
export function switchSurah(
  seq: PrayerSequence,
  surahs: Partial<Record<number, SurahId>>,
  rakah: number,
  surah: SurahId,
  index: number,
): { sequence: PrayerSequence; surahs: Partial<Record<number, SurahId>>; index: number } {
  const chosen = { ...surahs, [rakah]: surah }
  const next = buildSequence(seq.prayer, chosen)
  const isSurahGroup = (s: Step) => s.rakah === rakah && s.posture === 'qiyam' && s.group !== 'fatiha' && s.group !== 'amin' && s.group !== 'opening'
  const here = seq.steps[index]
  const firstNew = next.steps.findIndex(isSurahGroup)
  const oldStart = seq.steps.findIndex(isSurahGroup)
  const oldEnd = oldStart < 0 ? -1 : oldStart + seq.steps.filter(isSurahGroup).length
  let to = index
  if (here && here.rakah === rakah && (here.group === 'amin' || isSurahGroup(here)) && firstNew >= 0) to = Math.max(index, firstNew)
  else if (oldEnd >= 0 && index >= oldEnd) to = index + (next.steps.length - seq.steps.length)
  return { sequence: next, surahs: chosen, index: Math.min(to, next.steps.length - 1) }
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
