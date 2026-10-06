// Repaint a companion's robe in one even cloth colour: every robe triangle in
// the main texture and the whole skirt texture get the same colour, so the
// bodice, skirt and sleeves read as one clean garment. Geometry, skinning,
// morph targets (drapes) and everything else are untouched.
//   node clean_thobe.mjs in.glb out.glb
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import sharp from 'sharp'

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const doc = await io.read(process.argv[2])
const root = doc.getRoot()
const skin = root.listSkins()[0]
const joints = skin.listJoints().map((n) => n.getName())
// Skin, kufi and face live on these bones; everything else on Yusuf is robe.
const notRobe = (name) => /head|neck|hand|thumb|index|middle|ring|pinky|little|foot|toe/i.test(name)

const prims = root.listMeshes().flatMap((m) => m.listPrimitives())
const main = prims.find((p) => p.getMaterial()?.getName() === 'Material_0')
const skirt = prims.find((p) => p.getMaterial()?.getName() === 'skirt')
const tex = main.getMaterial().getBaseColorTexture()
const img = sharp(Buffer.from(tex.getImage()))
const { width: W, height: H } = await img.metadata()
const px = await img.ensureAlpha().raw().toBuffer()

const uv = main.getAttribute('TEXCOORD_0').getArray()
const J = main.getAttribute('JOINTS_0').getArray()
const Wt = main.getAttribute('WEIGHTS_0').getArray()
const idx = main.getIndices().getArray()
const dominant = (v) => {
  let b = 0
  for (let k = 1; k < 4; k++) if (Wt[v * 4 + k] > Wt[v * 4 + b]) b = k
  return joints[J[v * 4 + b]] ?? ''
}

// Rasterise triangles into UV masks: robe, and everything else (never painted over).
const robe = new Uint8Array(W * H), other = new Uint8Array(W * H)
function fill(mask, a, b, c, tol) {
  const P = [a, b, c].map((v) => [uv[v * 2] * W, uv[v * 2 + 1] * H])
  const minX = Math.max(0, Math.floor(Math.min(...P.map((p) => p[0])))), maxX = Math.min(W - 1, Math.ceil(Math.max(...P.map((p) => p[0]))))
  const minY = Math.max(0, Math.floor(Math.min(...P.map((p) => p[1])))), maxY = Math.min(H - 1, Math.ceil(Math.max(...P.map((p) => p[1]))))
  const [[x0, y0], [x1, y1], [x2, y2]] = P
  const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (Math.abs(d) < 1e-9) return
  for (let y = minY; y <= maxY; y++)
    for (let x = minX; x <= maxX; x++) {
      const px_ = x + 0.5, py = y + 0.5
      const w1 = ((x2 - x0) * (py - y0) - (px_ - x0) * (y2 - y0)) / -d
      const w2 = ((px_ - x0) * (y1 - y0) - (x1 - x0) * (py - y0)) / -d
      const w0 = 1 - w1 - w2
      if (w0 >= -tol && w1 >= -tol && w2 >= -tol) mask[y * W + x] = 1
    }
}
let robeTris = 0
const robeFaces = []
for (let t = 0; t < idx.length; t += 3) {
  const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]]
  // Robe = on a robe bone AND light cloth in the texture (not the brown skin at the ankles).
  // Sample the centre and the corners: only clearly dark (skin) triangles are left alone,
  // so pinkish stains on the cloth are painted over too.
  const sample = (u, v) => { const ti = (Math.min(H - 1, Math.max(0, Math.floor(v * H))) * W + Math.min(W - 1, Math.max(0, Math.floor(u * W)))) * 4; return px[ti] + px[ti + 1] + px[ti + 2] }
  const cu = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3, cv = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3
  const lums = [sample(cu, cv), ...[a, b, c].map((v) => sample(uv[v * 2], uv[v * 2 + 1]))]
  const light = lums.filter((l) => l > 520).length >= 3
  const isRobe = light && [a, b, c].filter((v) => !notRobe(dominant(v))).length >= 2
  if (isRobe) robeFaces.push([a, b, c])
  if (isRobe) robeTris++
  // Skin and kufi grow a little, so the robe paint never touches their edges.
  fill(isRobe ? robe : other, a, b, c, isRobe ? 0 : 0.15)
}

// The cloth colour: the median of the robe texels' brightest half (the
// cloth itself, not shadows or stains).
const lum = []
for (let i = 0; i < W * H; i++) if (robe[i] && !other[i]) lum.push([px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2], i])
lum.sort((p, q) => q[0] - p[0])
const top = lum.slice(0, Math.floor(lum.length / 2))
const med = (ch) => top.map(([, i]) => px[i * 4 + ch]).sort((p, q) => p - q)[Math.floor(top.length / 2)]
const cloth = [med(0), med(1), med(2)]

// Paint robe texels (grown 3 px into unused texels, so island edges never bleed old colour).
let grown = robe.slice()
for (let pass = 0; pass < 3; pass++) {
  const next = grown.slice()
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (grown[i] || other[i]) continue
      if (grown[i - 1] || grown[i + 1] || grown[i - W] || grown[i + W]) next[i] = 1
    }
  grown = next
}
let painted = 0
for (let i = 0; i < W * H; i++)
  if (grown[i] && !other[i]) {
    px[i * 4] = cloth[0]; px[i * 4 + 1] = cloth[1]; px[i * 4 + 2] = cloth[2]
    painted++
  }
tex.setImage(new Uint8Array(await sharp(px, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer())).setMimeType('image/png')

// The skirt texture: the same colour throughout.
const st = skirt.getMaterial().getBaseColorTexture()
const smeta = await sharp(Buffer.from(st.getImage())).metadata()
const solid = await sharp({ create: { width: smeta.width, height: smeta.height, channels: 4, background: { r: cloth[0], g: cloth[1], b: cloth[2], alpha: 1 } } }).png().toBuffer()
st.setImage(new Uint8Array(solid)).setMimeType('image/png')

// Shading: rebuild the robe's normals from its real shape, welded across the
// bodice and skirt pieces (coincident points share one normal), so the robe
// shades as one surface with no band or patch at the waist.
const key = (P, v) => `${Math.round(P[v * 3] * 2000)},${Math.round(P[v * 3 + 1] * 2000)},${Math.round(P[v * 3 + 2] * 2000)}`
const sets = process.env.NORMALS ? [
  { prim: main, faces: robeFaces },
  { prim: skirt, faces: (() => { const ix = skirt.getIndices().getArray(), f = []; for (let t = 0; t < ix.length; t += 3) f.push([ix[t], ix[t + 1], ix[t + 2]]); return f })() },
] : []
const acc = new Map()
for (const { prim, faces } of sets) {
  const P = prim.getAttribute('POSITION').getArray()
  for (const [a, b, c] of faces) {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2]
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2]
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
    for (const v of [a, b, c]) {
      const k = key(P, v)
      const s = acc.get(k) ?? [0, 0, 0]
      s[0] += n[0]; s[1] += n[1]; s[2] += n[2]
      acc.set(k, s)
    }
  }
}
let renormed = 0
for (const { prim, faces } of sets) {
  const P = prim.getAttribute('POSITION').getArray()
  const N = prim.getAttribute('NORMAL')
  const arr = N.getArray()
  const verts = new Set(faces.flat())
  for (const v of verts) {
    const s = acc.get(key(P, v))
    const l = Math.hypot(s[0], s[1], s[2])
    if (!l) continue
    // Keep each vertex facing the way it did (winding can differ between pieces).
    const sign = s[0] * arr[v * 3] + s[1] * arr[v * 3 + 1] + s[2] * arr[v * 3 + 2] < 0 ? -1 : 1
    arr[v * 3] = (sign * s[0]) / l; arr[v * 3 + 1] = (sign * s[1]) / l; arr[v * 3 + 2] = (sign * s[2]) / l
    renormed++
  }
  N.setArray(arr)
}
console.log('normals rebuilt for', renormed, 'robe vertices')

// Bowing (sujud, kneel): the bodice hem lifts off the skirt top and shows a dark
// gap. In those drape shapes only, lengthen the bodice hem down over the skirt.
{
  const names = doc.getRoot().listMeshes()[0].getExtras().targetNames
  const SP = skirt.getAttribute('POSITION').getArray()
  let top = -Infinity
  for (let i = 1; i < SP.length; i += 3) top = Math.max(top, SP[i])
  const MP = main.getAttribute('POSITION').getArray()
  const robeVerts = new Set(robeFaces.flat())
  const DROP = 0.08, BAND = 0.09, HEM_DROP = 0
  let moved = 0
  main.listTargets().forEach((t, ti) => {
    if (!/^drape_(sujud|kneel)$/.test(names[ti])) return
    const acc = t.getAttribute('POSITION')
    const d = acc.getArray()
    for (const v of robeVerts) {
      const h = MP[v * 3 + 1] - top
      if (h < -0.02 || h > BAND) continue
      const w = 1 - Math.max(0, h) / BAND
      d[v * 3 + 1] -= HEM_DROP * w
      moved++
    }
    acc.setArray(d)
  })
  // And the skirt's top edge rises up under the bodice, so its open top never shows.
  skirt.listTargets().forEach((t, ti) => {
    if (!/^drape_(sujud|kneel)$/.test(names[ti])) return
    const acc = t.getAttribute('POSITION')
    const d = acc.getArray()
    for (let v = 0; v < SP.length / 3; v++) {
      const h = top - SP[v * 3 + 1]
      if (h > BAND) continue
      d[v * 3 + 1] += DROP * (1 - h / BAND)
      moved++
    }
    acc.setArray(d)
  })
  console.log('hem lengthened in bowing shapes:', moved, 'vertex moves, skirt top', top.toFixed(3))
}

await io.write(process.argv[3], doc)
console.log(JSON.stringify({ robeTris, painted, cloth, texture: [W, H] }))
