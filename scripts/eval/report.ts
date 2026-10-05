// Merges evaluate.ts --json outputs (e.g. the folds of a leave-one-
// character-out run) and prints one report.
//   node scripts/eval/run.mjs report .eval/res-fold-*.json
import { readFileSync } from 'node:fs'
import { perTransition, summarize } from './evaluate'

const files = process.argv.slice(2).filter((f) => f.endsWith('.json'))
type Results = Parameters<typeof summarize>[0]
const merged: Results = {}
for (const f of files) {
  const r = JSON.parse(readFileSync(f, 'utf8')) as Results
  for (const [engine, list] of Object.entries(r)) (merged[engine] ??= []).push(...list)
}
console.log(`${files.length} result files`)
console.log(summarize(merged))
for (const [engine, rs] of Object.entries(merged)) {
  console.log(`\n### per transition (${engine})\n\n| segment | detected | median latency from start (s) |\n|---|---|---|`)
  console.log(perTransition(rs))
  const fa = rs.flatMap((r) => r.falseAdvances.map((f) => `${r.clip} t=${f.t.toFixed(2)} -> seg ${f.seg} while in ${f.gt} [${f.reason}]`))
  console.log(`\nfalse advances (${engine}): ${fa.length}${fa.length ? '\n' + fa.join('\n') : ''}`)
}
