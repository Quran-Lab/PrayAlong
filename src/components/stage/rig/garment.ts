import * as THREE from 'three'
import type { Humanoid, HumanBone } from './humanoid'

const smooth = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b)

/**
 * A pose-space drape for the long garments. A skirt is one cloth envelope,
 * not two trouser legs: linear shin weights fold its rear panel inside out
 * at a deep knee bend. Below the pelvis we blend into a continuous rounded
 * envelope around BOTH legs, keeping its hem above the mat. The sleeves and
 * upper body keep their authored skinning. This is a deterministic corrective,
 * not a cloth simulation, so scrubbing and reduced motion give the same result.
 */
export class GarmentDrape {
  private readonly garments: {
    skin: THREE.SkinnedMesh
    surface: THREE.Mesh
    rest: Float32Array
    hem: number
    waist: number
  }[] = []
  private readonly p = new THREE.Vector3()
  private readonly corrected = new THREE.Vector3()
  private readonly restHip = new THREE.Vector3()
  private readonly restHipRotation = new THREE.Quaternion()
  private readonly inverseRoot = new THREE.Matrix4()

  constructor(private readonly h: Humanoid, private readonly root: THREE.Group) {
    this.restHip.copy(this.point('hips'))
    this.h.raw.hips!.getWorldQuaternion(this.restHipRotation).invert()
    const waist = this.point('chest').y
    h.scene.traverse(o => {
      const skin = o as THREE.SkinnedMesh
      if (!skin.isSkinnedMesh || Array.isArray(skin.material) || !['Thobe', 'Abaya'].includes(skin.material.name)) return
      const geometry = skin.geometry.clone()
      const rest = new Float32Array(geometry.attributes.position!.count * 3)
      let hem = Infinity
      for (let i = 0; i < geometry.attributes.position!.count; i++) {
        skin.getVertexPosition(i, this.p)
        root.worldToLocal(skin.localToWorld(this.p))
        this.p.toArray(rest, i * 3)
        hem = Math.min(hem, this.p.y)
      }
      const surface = new THREE.Mesh(geometry, skin.material)
      surface.name = `${skin.material.name}Drape`
      surface.castShadow = surface.receiveShadow = true
      surface.frustumCulled = false
      root.add(surface)
      skin.visible = false
      this.garments.push({ skin, surface, rest, hem, waist })
    })
  }

  private point(bone: HumanBone) {
    return this.root.worldToLocal(this.h.raw[bone]!.getWorldPosition(new THREE.Vector3()))
  }

  update() {
    if (!this.garments.length) return
    this.root.updateMatrixWorld(true)
    this.inverseRoot.copy(this.root.matrixWorld).invert()
    const hips = this.point('hips')
    const hipRotation = this.h.raw.hips!.getWorldQuaternion(new THREE.Quaternion()).multiply(this.restHipRotation)
    const knees = this.point('leftLowerLeg').add(this.point('rightLowerLeg')).multiplyScalar(0.5)
    const ankles = this.point('leftFoot').add(this.point('rightFoot')).multiplyScalar(0.5)
    // Vertical shins = standing; horizontal shins = kneeling or sitting.
    const shin = ankles.clone().sub(knees).normalize()
    const folded = smooth(0.35, 0.85, 1 - Math.abs(shin.y))
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(hipRotation)
    const bent = Math.max(folded, smooth(0.2, 0.7, 1 + down.y))
    for (const { skin, surface, rest, hem, waist: highWaist } of this.garments) {
      const waist = THREE.MathUtils.lerp(this.restHip.y + 0.04, highWaist, smooth(0.2, 0.7, 1 + down.y))
      const positions = surface.geometry.attributes.position as THREE.BufferAttribute
      const skinToRoot = this.inverseRoot.clone().multiply(skin.matrixWorld)
      const width = skin.material instanceof THREE.Material && skin.material.name === 'Abaya' ? 0.238 : 0.216
      for (let i = 0; i < positions.count; i++) {
        skin.getVertexPosition(i, this.p).applyMatrix4(skinToRoot)
        const y = rest[i * 3 + 1]!
        const t = THREE.MathUtils.clamp((waist - y) / (waist - hem), 0, 1)
        if (t > 0 && bent > 0) {
          const x = rest[i * 3]!
          const z = rest[i * 3 + 2]!
          const angle = Math.atan2((z + 0.018) / 0.14, x / 0.195)
          const bottomY = THREE.MathUtils.lerp(hem, 0.012, folded)
          const bottomZ = THREE.MathUtils.lerp(ankles.z, (knees.z + ankles.z) * 0.5, folded)
          const p0 = new THREE.Vector3(0, waist - this.restHip.y, 0).applyQuaternion(hipRotation).add(hips)
          const p1 = p0.clone().addScaledVector(down, 0.16)
          const p3 = new THREE.Vector3(hips.x * (1 - folded), bottomY, bottomZ)
          const p2 = p3.clone().add(new THREE.Vector3(0, Math.max(0.12, (p0.y - bottomY) * 0.45), 0))
          const u = 1 - t
          this.corrected.copy(p0).multiplyScalar(u ** 3).addScaledVector(p1, 3 * u * u * t)
            .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t ** 3)
          const tangent = p1.clone().sub(p0).multiplyScalar(3 * u * u)
            .addScaledVector(p2.clone().sub(p1), 6 * u * t).addScaledVector(p3.clone().sub(p2), 3 * t * t).normalize()
          const forward = tangent.cross(new THREE.Vector3(1, 0, 0)).normalize()
          const radiusZ = THREE.MathUtils.lerp(0.14, THREE.MathUtils.lerp(0.15, Math.abs(knees.z - ankles.z) * 0.5 + 0.075, folded), t)
          const radiusX = THREE.MathUtils.lerp(0.185, THREE.MathUtils.lerp(0.198, width, folded), t)
          const fold = 1 + Math.cos(angle * 10 + t * 1.5) * 0.012 * t
          this.corrected.x += Math.cos(angle) * radiusX * fold
          this.corrected.addScaledVector(forward, Math.sin(angle) * radiusZ * fold)
          this.p.lerp(this.corrected, bent * smooth(0, 0.14, t))
        }
        // The fabric can rest on the mat, but never pass through it.
        this.p.y = Math.max(0.008, this.p.y)
        positions.setXYZ(i, this.p.x, this.p.y, this.p.z)
      }
      positions.needsUpdate = true
      surface.geometry.computeVertexNormals()
      surface.geometry.computeBoundingSphere()
    }
  }

  /** Rest the palms on the visible garment, rather than inside its leg rig. */
  support(x: number, z: number) {
    const origin = this.root.localToWorld(new THREE.Vector3(x, 3, z))
    const surfaces: THREE.Object3D[] = this.garments.map(g => g.surface)
    this.h.scene.traverse(o => {
      const mesh = o as THREE.SkinnedMesh
      if (mesh.isSkinnedMesh && !Array.isArray(mesh.material) && mesh.material.name === 'Khimar') {
        mesh.computeBoundingSphere()
        surfaces.push(mesh)
      }
    })
    const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObjects(surfaces, false)[0]
    return hit ? this.root.worldToLocal(hit.point).y : undefined
  }

  dispose() {
    for (const { surface, skin } of this.garments) {
      surface.geometry.dispose()
      surface.removeFromParent()
      skin.visible = true
    }
  }
}
