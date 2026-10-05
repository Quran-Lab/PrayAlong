import * as THREE from 'three'
import { createRugTexture, type RugColors } from './rug-texture'

/** Rug footprint (metres for a 1.65 m companion) and where it sits. */
export const RUG = {
  width: 0.84,
  length: 1.5,
  /** Centre along Z: the toes stand near the back, the forehead lands near the front. */
  center: 0.42,
  /** Height of the plush top surface. */
  top: 0.034,
}

const BEVEL = 0.012
const DEPTH = RUG.top - BEVEL * 2

/**
 * A soft, puffy rug: a rounded slab with pillowy bevelled edges, a flat
 * modern pattern on top and pompom tassels at both ends, over a baked
 * contact shadow so it sits on the photograph behind it. `recolor` weaves it
 * again in another palette.
 */
export function createRug(colors: RugColors): { group: THREE.Group; recolor: (colors: RugColors) => void } {
  const group = new THREE.Group()
  const w = RUG.width - BEVEL * 2
  const l = RUG.length - BEVEL * 2
  const r = 0.07
  const shape = new THREE.Shape()
  shape.moveTo(-w / 2 + r, -l / 2)
  shape.lineTo(w / 2 - r, -l / 2)
  shape.quadraticCurveTo(w / 2, -l / 2, w / 2, -l / 2 + r)
  shape.lineTo(w / 2, l / 2 - r)
  shape.quadraticCurveTo(w / 2, l / 2, w / 2 - r, l / 2)
  shape.lineTo(-w / 2 + r, l / 2)
  shape.quadraticCurveTo(-w / 2, l / 2, -w / 2, l / 2 - r)
  shape.lineTo(-w / 2, -l / 2 + r)
  shape.quadraticCurveTo(-w / 2, -l / 2, -w / 2 + r, -l / 2)

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: DEPTH,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 5,
    curveSegments: 12,
  })
  geometry.rotateX(-Math.PI / 2) // lie flat, extrusion becomes height
  geometry.rotateY(Math.PI) // canvas top (the arch) faces the qibla (+Z)
  geometry.translate(0, BEVEL, RUG.center)

  const weave = (c: RugColors) => {
    const texture = createRugTexture(c)
    texture.repeat.set(1 / w, 1 / l)
    texture.offset.set(0.5, 0.5)
    return texture
  }
  const top = new THREE.MeshStandardMaterial({ map: weave(colors), roughness: 0.92 })
  const side = new THREE.MeshStandardMaterial({ color: colors.edge, roughness: 0.95 })
  const slab = new THREE.Mesh(geometry, [top, side])
  slab.castShadow = true
  slab.receiveShadow = true

  // Pompom tassels along both short ends
  const count = 9
  const ball = new THREE.SphereGeometry(0.019, 12, 8)
  const pompoms = new THREE.InstancedMesh(ball, new THREE.MeshStandardMaterial({ color: colors.cream, roughness: 1 }), count * 2)
  const m = new THREE.Matrix4()
  let i = 0
  for (const end of [-1, 1]) {
    for (let k = 0; k < count; k++) {
      const x = -RUG.width / 2 + 0.08 + (k / (count - 1)) * (RUG.width - 0.16)
      m.makeScale(1, 0.85, 1).setPosition(x, 0.017, RUG.center + end * (RUG.length / 2 + 0.014))
      pompoms.setMatrixAt(i++, m)
    }
  }

  // The rug's soft contact shadow, baked once.
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.filter = 'blur(10px)'
  g.fillStyle = 'rgba(10, 12, 20, 0.55)'
  const sx = (RUG.width / 3) * 256
  const sz = (RUG.length / 3) * 256
  g.beginPath()
  g.roundRect(128 - sx / 2, 128 - sz / 2, sx, sz, 16)
  g.fill()
  const shadowTexture = new THREE.CanvasTexture(c)
  shadowTexture.colorSpace = THREE.SRGBColorSpace
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2).translate(0, -0.001, RUG.center),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }),
  )

  group.add(contact, slab, pompoms)
  const recolor = (c: RugColors) => {
    top.map?.dispose()
    top.map = weave(c)
    side.color.set(c.edge)
  }
  return { group, recolor }
}
