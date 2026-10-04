import * as THREE from 'three'

/**
 * A prayer rug painted once to a canvas: border bands, a pointed mihrab arch
 * at the qibla end and a faint eight-point star lattice. The top of the
 * canvas is the qibla end.
 */

const C = {
  field: '#1d3a2f',
  fieldLight: '#24493b',
  border: '#11231c',
  gold: '#c8a35e',
  goldSoft: 'rgba(200, 163, 94, 0.55)',
  cream: '#e8dcc4',
  teal: '#3b6f5e',
  shadow: 'rgba(0, 0, 0, 0.18)',
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8 - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.62
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  ctx.closePath()
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - h)
  ctx.lineTo(x + w, y)
  ctx.lineTo(x, y + h)
  ctx.lineTo(x - w, y)
  ctx.closePath()
}

/** Pointed (ogee-like) arch path from the spring line up to the apex. */
function archPath(ctx: CanvasRenderingContext2D, cx: number, spring: number, halfWidth: number, rise: number, bottom: number) {
  ctx.beginPath()
  ctx.moveTo(cx - halfWidth, bottom)
  ctx.lineTo(cx - halfWidth, spring)
  ctx.bezierCurveTo(cx - halfWidth, spring - rise * 0.55, cx - halfWidth * 0.25, spring - rise * 0.78, cx, spring - rise)
  ctx.bezierCurveTo(cx + halfWidth * 0.25, spring - rise * 0.78, cx + halfWidth, spring - rise * 0.55, cx + halfWidth, spring)
  ctx.lineTo(cx + halfWidth, bottom)
}

export function createMatTexture(width = 1024, height = 1700): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const W = width
  const Hh = height

  // Outer band
  ctx.fillStyle = C.border
  ctx.fillRect(0, 0, W, Hh)
  const b1 = W * 0.075
  ctx.fillStyle = C.gold
  for (let y = b1 * 0.9; y < Hh - b1 * 0.5; y += b1 * 0.62) {
    diamond(ctx, b1 * 0.5, y, b1 * 0.17, b1 * 0.26)
    ctx.fill()
    diamond(ctx, W - b1 * 0.5, y, b1 * 0.17, b1 * 0.26)
    ctx.fill()
  }
  for (let x = b1 * 1.4; x < W - b1; x += b1 * 0.62) {
    diamond(ctx, x, b1 * 0.5, b1 * 0.26, b1 * 0.17)
    ctx.fill()
    diamond(ctx, x, Hh - b1 * 0.5, b1 * 0.26, b1 * 0.17)
    ctx.fill()
  }

  // Gold rules and a slim teal inner band
  const rule = (inset: number, lw: number, color: string) => {
    ctx.strokeStyle = color
    ctx.lineWidth = lw
    ctx.strokeRect(inset, inset, W - inset * 2, Hh - inset * 2)
  }
  rule(b1, 5, C.gold)
  const b2 = b1 + W * 0.035
  ctx.fillStyle = C.teal
  ctx.fillRect(b1 + 3, b1 + 3, W - (b1 + 3) * 2, Hh - (b1 + 3) * 2)
  ctx.fillStyle = C.field
  ctx.fillRect(b2, b2, W - b2 * 2, Hh - b2 * 2)
  ctx.fillStyle = C.goldSoft
  for (let y = b2 + 20; y < Hh - b2; y += 34) {
    ctx.beginPath()
    ctx.arc((b1 + b2) / 2, y, 4, 0, Math.PI * 2)
    ctx.arc(W - (b1 + b2) / 2, y, 4, 0, Math.PI * 2)
    ctx.fill()
  }
  rule(b2, 3, C.gold)

  // Star lattice across the field, very low contrast
  ctx.save()
  ctx.beginPath()
  ctx.rect(b2, b2, W - b2 * 2, Hh - b2 * 2)
  ctx.clip()
  ctx.strokeStyle = 'rgba(232, 220, 196, 0.07)'
  ctx.lineWidth = 2
  const step = W * 0.13
  for (let y = b2; y < Hh; y += step) {
    for (let x = b2 + ((Math.round((y - b2) / step) % 2) * step) / 2; x < W; x += step) {
      star(ctx, x, y, step * 0.3)
      ctx.stroke()
    }
  }
  ctx.restore()

  // Mihrab at the qibla end
  const cx = W / 2
  const halfW = (W - b2 * 2) * 0.36
  const spring = Hh * 0.33
  const rise = Hh * 0.17
  const archBottom = Hh * 0.63
  ctx.save()
  archPath(ctx, cx, spring, halfW, rise, archBottom)
  ctx.closePath()
  ctx.fillStyle = C.fieldLight
  ctx.fill()
  ctx.clip()
  // soft inner glow
  const glow = ctx.createRadialGradient(cx, spring - rise * 0.2, 10, cx, spring, halfW * 1.6)
  glow.addColorStop(0, 'rgba(232, 220, 196, 0.10)')
  glow.addColorStop(1, 'rgba(232, 220, 196, 0)')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, Hh)
  ctx.restore()

  ctx.lineJoin = 'round'
  archPath(ctx, cx, spring, halfW, rise, archBottom)
  ctx.strokeStyle = C.gold
  ctx.lineWidth = 6
  ctx.stroke()
  archPath(ctx, cx, spring + 18, halfW - 18, rise - 10, archBottom - 18)
  ctx.strokeStyle = C.goldSoft
  ctx.lineWidth = 2.5
  ctx.stroke()

  // Hanging lamp
  const lampY = spring - rise * 0.38
  ctx.strokeStyle = C.goldSoft
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, spring - rise + 26)
  ctx.lineTo(cx, lampY - 28)
  ctx.stroke()
  ctx.fillStyle = C.gold
  ctx.beginPath()
  ctx.moveTo(cx - 26, lampY - 22)
  ctx.quadraticCurveTo(cx - 34, lampY + 12, cx - 10, lampY + 30)
  ctx.lineTo(cx + 10, lampY + 30)
  ctx.quadraticCurveTo(cx + 34, lampY + 12, cx + 26, lampY - 22)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = C.field
  star(ctx, cx, lampY + 2, 9)
  ctx.fill()

  // Feet-end panel with rosettes
  const panelTop = Hh * 0.8
  ctx.strokeStyle = C.goldSoft
  ctx.lineWidth = 2.5
  ctx.strokeRect(b2 + 34, panelTop, W - (b2 + 34) * 2, Hh - b2 - 34 - panelTop)
  ctx.fillStyle = C.gold
  for (let i = 0; i < 3; i++) {
    const x = b2 + 34 + ((W - (b2 + 34) * 2) * (i + 0.5)) / 3
    const y = (panelTop + Hh - b2 - 34) / 2
    star(ctx, x, y, 26)
    ctx.fill()
    ctx.fillStyle = C.field
    star(ctx, x, y, 12)
    ctx.fill()
    ctx.fillStyle = C.gold
  }

  // Fine woven grain
  const img = ctx.getImageData(0, 0, W, Hh)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 14
    d[i] = d[i]! + n
    d[i + 1] = d[i + 1]! + n
    d[i + 2] = d[i + 2]! + n
  }
  ctx.putImageData(img, 0, 0)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
