// The synthetic evaluation set: camera placements x characters, and a
// realistic two-rak'ah prayer timeline per video (seeded, reproducible).

export const CHARACTERS = ['yusuf', 'maryam', 'ahmad', 'aisha']
/** Held out from tuning: thresholds are tuned on the first two only. */
export const TEST_CHARACTERS = new Set(['ahmad', 'aisha'])
export const GAPS = [0, 0.3, 0.6]
export const YAWS = [0, 20, 30, 45]

function rng(seed) {
  let s = seed >>> 0 || 1
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32)
}

export function conditions() {
  const list = []
  let i = 0
  for (const yaw of YAWS)
    for (const gap of GAPS)
      for (const character of CHARACTERS) {
        const r = rng(1000 + i * 7919)
        const pick = (xs) => xs[Math.floor(r() * xs.length)]
        const height = pick([0.14, 0.22, 0.3])
        // The screen tilted back so the head fits when standing: lower
        // and closer cameras need more tilt.
        const pitch = Math.round(14 + (gap === 0 ? 10 : gap === 0.3 ? 6 : 2) + (0.3 - height) * 20 + (r() - 0.5) * 8)
        const lightLevel = pick(['bright', 'normal', 'dim'])
        const light = { bright: 1.15, normal: 0.75, dim: 0.32 }[lightLevel]
        const gain = { bright: 1, normal: 1.15, dim: 1.9 }[lightLevel]
        const noise = { bright: 0.015, normal: 0.025, dim: 0.06 }[lightLevel]
        const name = `${character}-g${Math.round(gap * 100)}-y${yaw}`
        list.push({
          name,
          seed: 77 + i,
          meta: { character, gap, yaw, height, pitch, lightLevel, split: TEST_CHARACTERS.has(character) ? 'test' : 'tune' },
          config: {
            character: `./avatars/${character}.glb`,
            width: 640,
            height: 480,
            gap,
            height_m: height,
            pitch,
            // Mirror the side to keep both corners covered.
            yaw: i % 2 ? yaw : -yaw,
            vfov: 46,
            light,
            noise,
            gain,
            room: i % 4,
            speed: 0.8 + r() * 0.45,
            jpegQuality: 0.82,
          },
          timing: {},
        })
        i++
      }
  return list
}

/**
 * A two-rak'ah prayer (like fajr) with realistic but compressed dwell
 * times: long recitations in qiyam and tashahhud are shortened, the short
 * postures keep their real lengths. Some videos raise the hands before
 * ruku and after rising (raf' al-yadayn), a common distractor.
 */
export function timeline(seed) {
  const r = rng(seed)
  const u = (a, b) => a + r() * (b - a)
  const raf = r() < 0.35
  const tl = []
  let t = 0
  const add = (posture, hold, distractor = false) => {
    tl.push({ t: +t.toFixed(3), posture, hold, distractor })
    t += hold
  }
  // Calibration: standing on the rug, looking at the screen.
  add('rest', u(3, 4.5))
  add('takbir', u(1.6, 2.6))
  for (let rakah = 1; rakah <= 2; rakah++) {
    add('qiyam', u(7, 12))
    if (raf) add('takbir', u(0.8, 1.2), true)
    add('ruku', u(3.2, 6))
    add('itidal', u(2.2, 4))
    if (raf) add('takbir', u(0.8, 1.2), true)
    // Back to qiyam pose (hands at sides) once the takbir is done.
    if (raf) add('itidal', u(0.6, 1), true)
    add('sujud', u(3.5, 6))
    add('jalsah', u(2, 3.5))
    add('sujud', u(3.5, 6))
  }
  add('tashahhud', u(10, 16))
  add('salam-right', u(1.8, 3))
  add('salam-left', u(1.8, 3))
  add('tashahhud', 2.5, true)
  return tl
}
