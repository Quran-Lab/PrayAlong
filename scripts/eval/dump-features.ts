// Dumps per-frame features + labels to CSV for analysis and fitting.
//   node scripts/eval/run.mjs dump-features [--source mp-first] [--tag x] > .eval/features.csv
//
// Columns: clip metadata; t; the posture at t (distractors included), its
// class and whether the body has arrived; gseg/gkind: the prayer segment the
// person is in (distractors belong to the segment around them; -1 before
// the takbir) and its class; then every feature and a few raw measures.
import { FEATURES } from '../../src/handsfree/features'
import { Perception, type BodySource } from '../../src/handsfree/pipeline'
import { classOf } from './common'
import { gtAt, loadClips } from './dataset'

const args = process.argv.slice(2)
const tag = args.includes('--tag') ? args[args.indexOf('--tag') + 1]! : ''
const source = (args.includes('--source') ? args[args.indexOf('--source') + 1]! : 'mp-first') as BodySource
const clips = loadClips({ synth: '.eval/synth', obs: '.eval/obs', recorded: '.eval/recorded' }, tag)
const cols = [
  'clip', 'split', 'character', 'gap', 'yaw', 'height', 'pitch', 'light', 't', 'posture', 'cls', 'settled', 'distractor', 'gseg', 'gkind',
  ...FEATURES, 'turn', 'earBias', 'faceYaw',
]
const out: string[] = [cols.join(',')]
for (const clip of clips) {
  const p = new Perception(null, source)
  const real = clip.segments.filter((s) => !s.distractor && s.posture !== 'rest')
  const first = real[0]?.onset ?? 3
  for (const f of clip.frames) {
    const t = f.t / 1000
    if (!f.obs) continue
    const gt = gtAt(clip, t)
    let gseg = -1
    real.forEach((s, i) => s.onset <= t + 1e-6 && (gseg = i))
    const r = p.push(f.obs, { calibrating: t < first - 0.3 })
    if (!r.features) continue
    const m = r.measures
    const row = [
      clip.name, clip.meta.split, clip.meta.character, clip.meta.gap, clip.meta.yaw, clip.meta.height, clip.meta.pitch, clip.meta.lightLevel,
      t.toFixed(3), gt.posture, classOf(gt.posture), gt.settled ? 1 : 0, clip.segments[gt.k]?.distractor ? 1 : 0, gseg, gseg < 0 ? 'standing' : classOf(real[gseg]!.posture),
      ...FEATURES.map((k) => (Number.isFinite(r.features![k]) ? r.features![k].toFixed(4) : '')),
      Number.isFinite(m.turn) ? m.turn.toFixed(4) : '', m.earBias.toFixed(3), Number.isFinite(m.faceYaw) ? m.faceYaw : '',
    ]
    out.push(row.join(','))
  }
}
process.stdout.write(out.join('\n') + '\n')
console.error(`${clips.length} clips, ${out.length - 1} rows`)
