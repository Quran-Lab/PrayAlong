/**
 * Loads evaluation clips. Two sources, one shape:
 *  - synthetic: scripts/synth/render.mjs labels (<name>.json) + the
 *    observations scripts/eval/perceive.mjs saved (<name>.obs.json);
 *  - recorded: files saved by the app's `?lab&record` mode (real people),
 *    which carry the observations and the manual labels together.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { bodyFromCoco, type Observation } from '../../src/handsfree/observation'
import type { Keypoint } from '../../src/handsfree/types'
import type { Posture } from '../../src/sequence/types'

export type GtPosture = Posture | 'rest'

export interface Segment {
  posture: GtPosture
  /** Seconds: when the movement into this posture starts. */
  onset: number
  /** Seconds: when the body has arrived (null if unknown; recordings use onset + 1 s). */
  settled: number | null
  /** Not a step of the prayer (e.g. hands raised before ruku). */
  distractor: boolean
}

export interface Clip {
  name: string
  source: 'synthetic' | 'recorded'
  meta: Record<string, string | number>
  frames: { t: number; obs: Observation | null; lite?: Keypoint[] | null; detrpose?: Keypoint[] | null }[]
  segments: Segment[]
}

/** The format `?lab&record` saves (see src/lab/RecordLab.tsx). */
export interface Recording {
  format: 'prayalong-recording/1'
  name: string
  meta?: Record<string, string | number>
  frames: { t: number; obs: Observation | null }[]
  /** Manual marks: the posture the person started moving into, at time t (ms). */
  marks: { t: number; posture: GtPosture; distractor?: boolean }[]
}

export function loadClips(dirs: { synth?: string; obs?: string; recorded?: string }, tag = ''): Clip[] {
  const clips: Clip[] = []
  if (dirs.synth && dirs.obs && existsSync(dirs.obs)) {
    for (const f of readdirSync(dirs.obs).sort()) {
      const suffix = `${tag ? '.' + tag : ''}.obs.json`
      if (!f.endsWith(suffix)) continue
      const name = f.slice(0, -suffix.length)
      if (name.includes('.')) continue
      const labelsPath = join(dirs.synth, `${name}.json`)
      if (!existsSync(labelsPath)) continue
      const labels = JSON.parse(readFileSync(labelsPath, 'utf8'))
      const obs = JSON.parse(readFileSync(join(dirs.obs, f), 'utf8'))
      // The second body engine (DETRPose) rides along on the observation.
      for (const f of obs.frames) if (f.obs && f.detrpose) f.obs.detr = bodyFromCoco(f.detrpose)
      clips.push({
        name,
        source: 'synthetic',
        meta: labels.meta,
        frames: obs.frames,
        segments: labels.segments.map((s: { posture: GtPosture; onset: number; settled: number | null; distractor: boolean }) => ({ ...s })),
      })
    }
  }
  if (dirs.recorded && existsSync(dirs.recorded)) {
    for (const f of readdirSync(dirs.recorded).sort()) {
      if (!f.endsWith('.json')) continue
      const rec = JSON.parse(readFileSync(join(dirs.recorded, f), 'utf8')) as Recording
      if (rec.format !== 'prayalong-recording/1') continue
      const t0 = rec.frames[0]?.t ?? 0
      clips.push({
        name: rec.name,
        source: 'recorded',
        meta: { ...(rec.meta ?? {}), split: 'recorded' },
        frames: rec.frames.map((fr) => ({ t: fr.t - t0, obs: fr.obs ? { ...fr.obs, t: fr.t - t0 } : null })),
        segments: rec.marks.map((m) => ({ posture: m.posture, onset: (m.t - t0) / 1000, settled: (m.t - t0) / 1000 + 1, distractor: !!m.distractor })),
      })
    }
  }
  return clips
}

/** Ground truth at time t (seconds): the segment index and whether the body has arrived. */
export function gtAt(clip: Clip, t: number) {
  let k = -1
  for (let i = 0; i < clip.segments.length; i++) if (clip.segments[i]!.onset <= t + 1e-9) k = i
  const s = clip.segments[k]
  return { k, posture: s?.posture ?? 'rest', settled: !!s && s.settled !== null && t >= s.settled }
}
