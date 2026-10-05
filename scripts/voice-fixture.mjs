// Trim a replay result (test-results/voice/<run>.json) into a small fixture of
// REAL decoder output for src/voice/decoded.test.ts: the tokens the worker
// emitted (with audio times and segments), the speech spans, and the timeline
// the score is computed against. No audio, no model needed to run the test.
//
//   node scripts/voice-fixture.mjs test-results/voice/fajr-aisha-clean-g1.json src/voice/fixtures/fajr-aisha.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const [, , src, out] = process.argv
const r = JSON.parse(readFileSync(src, 'utf8'))
const round = (v) => Math.round(v * 1000) / 1000
const fixture = {
  source: src.replace(/\\/g, '/'),
  params: r.params,
  tokens: r.log.tokens.map((x) => [round(x.at), x.segment, x.tokens.join(' ')]),
  timeline: {
    duration: round(r.timeline.duration),
    keywords: r.timeline.keywords.map((k) => ({ ...k, start: round(k.start), end: round(k.end) })),
    clips: r.timeline.clips.map((c) => ({ ...c, start: round(c.start), dur: round(c.dur), words: c.words.map(([a, b]) => [round(a), round(b)]) })),
  },
  metrics: r.metrics,
}
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(fixture))
console.log(`${out}: ${fixture.tokens.length} token batches, ${(JSON.stringify(fixture).length / 1024).toFixed(0)} KB`)
