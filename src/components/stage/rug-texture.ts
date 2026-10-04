import * as THREE from 'three'

/**
 * The rug's top, painted once to a canvas in a flat, modern style: a rounded
 * frame with a scalloped trim, one big soft arch pointing to the qibla, a
 * crescent and a few dots. Crisp shapes, no noise. The top of the canvas is
 * the qibla end.
 */

export const RUG_COLORS = {
  field: '#1f7560',
  fieldDeep: '#17604f',
  arch: '#2c8d73',
  cream: '#f6eedc',
  sun: '#f4c56b',
  blush: '#f2a38a',
  edge: '#15503f',
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** A soft "onion" arch: straight sides, a rounded crown rising to a gentle point. */
function arch(ctx: CanvasRenderingContext2D, cx: number, top: number, halfW: number, shoulder: number, bottom: number) {
  ctx.beginPath()
  ctx.moveTo(cx - halfW, bottom)
  ctx.lineTo(cx - halfW, shoulder)
  ctx.bezierCurveTo(cx - halfW, shoulder - halfW * 0.95, cx - halfW * 0.18, top + halfW * 0.28, cx, top)
  ctx.bezierCurveTo(cx + halfW * 0.18, top + halfW * 0.28, cx + halfW, shoulder - halfW * 0.95, cx + halfW, shoulder)
  ctx.lineTo(cx + halfW, bottom)
  ctx.closePath()
}

function crescent(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, cut: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = cut
  ctx.beginPath()
  ctx.arc(x + r * 0.42, y - r * 0.22, r * 0.86, 0, Math.PI * 2)
  ctx.fill()
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.quadraticCurveTo(x, y, x, y + r)
  ctx.quadraticCurveTo(x, y, x - r, y)
  ctx.quadraticCurveTo(x, y, x, y - r)
  ctx.fill()
}

export function createRugTexture(width = 1024, height = 1740): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  const W = width
  const H = height
  const C = RUG_COLORS

  ctx.fillStyle = C.field
  ctx.fillRect(0, 0, W, H)

  // Cream frame with a scalloped inner edge
  const inset = W * 0.07
  const frame = W * 0.028
  roundRect(ctx, inset, inset, W - inset * 2, H - inset * 2, W * 0.09)
  ctx.lineWidth = frame
  ctx.strokeStyle = C.cream
  ctx.stroke()

  const inner = inset + frame / 2
  const scallop = W * 0.022
  ctx.fillStyle = C.cream
  const runX = (y: number) => {
    for (let x = inner + W * 0.11; x <= W - inner - W * 0.1; x += scallop * 2.6) {
      ctx.beginPath()
      ctx.arc(x, y, scallop, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  const runY = (x: number) => {
    for (let y = inner + W * 0.11; y <= H - inner - W * 0.1; y += scallop * 2.6) {
      ctx.beginPath()
      ctx.arc(x, y, scallop, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  runX(inner)
  runX(H - inner)
  runY(inner)
  runY(W - inner)

  // The arch — the one bold shape, pointing to the qibla
  const cx = W / 2
  const halfW = W * 0.3
  const top = H * 0.12
  const shoulder = H * 0.36
  const bottom = H * 0.7
  arch(ctx, cx, top, halfW, shoulder, bottom)
  ctx.fillStyle = C.arch
  ctx.fill()
  ctx.lineWidth = W * 0.016
  ctx.strokeStyle = C.cream
  ctx.stroke()
  arch(ctx, cx, top + W * 0.05, halfW - W * 0.045, shoulder + W * 0.01, bottom - W * 0.045)
  ctx.setLineDash([W * 0.012, W * 0.022])
  ctx.lineCap = 'round'
  ctx.lineWidth = W * 0.007
  ctx.strokeStyle = 'rgba(246, 238, 220, 0.55)'
  ctx.stroke()
  ctx.setLineDash([])

  // Crescent and sparkles inside the crown
  crescent(ctx, cx, top + H * 0.11, W * 0.06, C.sun, C.arch)
  ctx.fillStyle = C.cream
  sparkle(ctx, cx + W * 0.1, top + H * 0.075, W * 0.02)
  sparkle(ctx, cx - W * 0.11, top + H * 0.16, W * 0.014)

  // Three soft dots under the arch
  for (let i = -1; i <= 1; i++) {
    ctx.fillStyle = i === 0 ? C.sun : C.blush
    ctx.beginPath()
    ctx.arc(cx + i * W * 0.075, bottom + H * 0.055, W * (i === 0 ? 0.02 : 0.015), 0, Math.PI * 2)
    ctx.fill()
  }

  // Feet-end band: a calm row of little rounded diamonds
  const bandY = H * 0.86
  ctx.fillStyle = C.fieldDeep
  roundRect(ctx, inset + W * 0.1, bandY - H * 0.035, W - (inset + W * 0.1) * 2, H * 0.07, H * 0.035)
  ctx.fill()
  for (let i = 0; i < 5; i++) {
    const x = inset + W * 0.18 + (i * (W - (inset + W * 0.18) * 2)) / 4
    ctx.fillStyle = i % 2 ? C.blush : C.cream
    ctx.save()
    ctx.translate(x, bandY)
    ctx.rotate(Math.PI / 4)
    roundRect(ctx, -W * 0.018, -W * 0.018, W * 0.036, W * 0.036, W * 0.01)
    ctx.fill()
    ctx.restore()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}
