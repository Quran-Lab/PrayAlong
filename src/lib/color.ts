/** OKLCH (CSS syntax) → sRGB hex, for libraries like three.js that don't parse OKLCH. */
export function oklchToHex(input: string): string {
  const m = input.match(/oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/i)
  if (!m) return input
  let l = Number(m[1])
  if (input.includes('%')) l /= 100
  const c = Number(m[2])
  const h = (Number(m[3]) * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  const toSrgb = (x: number) => {
    const v = Math.min(1, Math.max(0, x))
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055
  }
  return '#' + lin.map((x) => Math.round(toSrgb(x) * 255).toString(16).padStart(2, '0')).join('')
}
