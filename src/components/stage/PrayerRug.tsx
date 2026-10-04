import { useMemo } from 'react'
import * as THREE from 'three'
import { createRugTexture, RUG_COLORS } from './rug-texture'

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
 * modern pattern on top and pompom tassels at both ends.
 */
export function PrayerRug() {
  const { geometry, materials, pompoms, floor } = useMemo(() => {
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
      bevelSegments: 6,
      curveSegments: 16,
    })
    geometry.rotateX(-Math.PI / 2) // lie flat, extrusion becomes height
    geometry.rotateY(Math.PI) // canvas top (the arch) faces the qibla (+Z)
    geometry.translate(0, BEVEL, RUG.center)

    const texture = createRugTexture()
    texture.repeat.set(1 / w, 1 / l)
    texture.offset.set(0.5, 0.5)
    const top = new THREE.MeshPhysicalMaterial({ map: texture, roughness: 0.9, sheen: 0.45, sheenRoughness: 0.6, sheenColor: new THREE.Color('#bfeedd') })
    const side = new THREE.MeshPhysicalMaterial({ color: RUG_COLORS.edge, roughness: 0.92, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color('#9fd6c2') })

    // Pompom tassels along both short ends
    const count = 9
    const ball = new THREE.SphereGeometry(0.019, 18, 12)
    const pompoms = new THREE.InstancedMesh(ball, new THREE.MeshPhysicalMaterial({ color: RUG_COLORS.cream, roughness: 1, sheen: 1, sheenColor: new THREE.Color('#ffffff') }), count * 2)
    const m = new THREE.Matrix4()
    let i = 0
    for (const end of [-1, 1]) {
      for (let k = 0; k < count; k++) {
        const x = -RUG.width / 2 + 0.08 + (k / (count - 1)) * (RUG.width - 0.16)
        m.makeScale(1, 0.85, 1).setPosition(x, 0.017, RUG.center + end * (RUG.length / 2 + 0.014))
        pompoms.setMatrixAt(i++, m)
      }
    }
    pompoms.castShadow = true

    // A soft round "stage" under the rug, with the rug's blurred shadow baked in.
    const c = document.createElement('canvas')
    c.width = c.height = 512
    const g = c.getContext('2d')!
    const radial = g.createRadialGradient(256, 256, 0, 256, 256, 256)
    radial.addColorStop(0, 'rgba(120, 210, 175, 0.16)')
    radial.addColorStop(0.65, 'rgba(120, 210, 175, 0.05)')
    radial.addColorStop(1, 'rgba(120, 210, 175, 0)')
    g.fillStyle = radial
    g.fillRect(0, 0, 512, 512)
    g.filter = 'blur(18px)'
    g.fillStyle = 'rgba(0, 8, 5, 0.75)'
    const sx = (RUG.width / 3.6) * 512
    const sz = (RUG.length / 3.6) * 512
    g.beginPath()
    g.roundRect(256 - sx / 2, 256 - sz / 2, sx, sz, 30)
    g.fill()
    const floorTexture = new THREE.CanvasTexture(c)
    floorTexture.colorSpace = THREE.SRGBColorSpace
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 3.6).rotateX(-Math.PI / 2).translate(0, -0.001, RUG.center),
      new THREE.MeshBasicMaterial({ map: floorTexture, transparent: true, depthWrite: false, toneMapped: false }),
    )

    return { geometry, materials: [top, side], pompoms, floor }
  }, [])

  return (
    <group>
      <primitive object={floor} />
      <mesh geometry={geometry} material={materials} castShadow receiveShadow />
      <primitive object={pompoms} />
    </group>
  )
}
