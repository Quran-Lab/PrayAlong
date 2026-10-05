import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { CharacterInfo } from './characters'
import { loadHumanoid } from './rig/humanoid'
import { Performer, STAGE_HEIGHT } from './rig/performer'
import type { PoseName } from './rig/prayer-poses'
import type { Palette } from '@/lib/brand'
import { createRug, RUG } from './rug'
import { rugColors } from './rug-texture'

type Shot = { azimuth: number; elevation: number; target: [number, number, number]; fit: [number, number] }

const SHOTS: Record<'standing' | 'bowing' | 'floor' | 'sitting', Shot> = {
  standing: { azimuth: 0.3, elevation: 0.16, target: [0, 0.8, 0.22], fit: [2.15, 1.6] },
  bowing: { azimuth: 0.9, elevation: 0.17, target: [0, 0.66, 0.24], fit: [2.0, 1.9] },
  floor: { azimuth: 0.95, elevation: 0.24, target: [0, 0.42, 0.4], fit: [1.7, 2.0] },
  sitting: { azimuth: 0.6, elevation: 0.2, target: [0, 0.5, 0.3], fit: [1.7, 1.7] },
}

function shotFor(posture: PoseName) {
  if (posture === 'ruku') return SHOTS.bowing
  if (posture === 'sujud' || posture === 'kneel') return SHOTS.floor
  if (posture === 'jalsah' || posture === 'tashahhud' || posture === 'tawarruk' || posture.startsWith('salam')) return SHOTS.sitting
  return SHOTS.standing
}

/** Frames per second while nothing is moving: breathing only. */
const IDLE_FPS = 20

/**
 * The 3D companion on its rug, drawn over the backdrop photograph (the
 * canvas is transparent). Plain three.js: no post-processing, shadows from
 * one light, and the frame rate drops when nothing is moving.
 */
export class CompanionStage {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(24, 1, 0.1, 60)
  private readonly mount = new THREE.Group()
  private readonly rug: ReturnType<typeof createRug>
  private palette: Palette
  private performer: Performer | null = null
  private characterUrl = ''
  private posture: PoseName = 'rest'
  private reducedMotion = false
  private azimuth: number | undefined
  private raf = 0
  private last = 0
  private lastDraw = 0
  private fade = 1
  private loadToken = 0
  private readonly view = { azimuth: 0.34, elevation: 0.12, distance: 5, target: new THREE.Vector3(0, 0.86, 0.12), first: true }
  private readonly resize: ResizeObserver
  private size = { w: 1, h: 1 }

  constructor(canvas: HTMLCanvasElement, palette: Palette) {
    this.palette = palette
    const coarse = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, coarse ? 1.5 : 2))
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap

    const pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.55
    pmrem.dispose()

    this.scene.add(new THREE.HemisphereLight('#fff4e6', '#3a3834', 0.95))
    const key = new THREE.DirectionalLight('#fff3e2', 2.5)
    key.position.set(-2.4, 4.6, 3.4)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    key.shadow.radius = 3
    Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 2.2, bottom: -1 })
    const fill = new THREE.DirectionalLight('#ffe9d2', 0.75)
    fill.position.set(3, 1.8, 2.2)
    const rim = new THREE.DirectionalLight('#dde1f5', 1.6)
    rim.position.set(1.4, 2.6, -3.2)
    this.rug = createRug(rugColors(this.palette))
    this.scene.add(key, fill, rim, this.rug.group, this.mount)
    this.mount.position.y = RUG.top + 0.002 // feet sink a touch into the plush rug

    this.resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      this.size = { w: Math.max(1, width), h: Math.max(1, height) }
      this.renderer.setSize(this.size.w, this.size.h, false)
      this.camera.aspect = this.size.w / this.size.h
      this.camera.updateProjectionMatrix()
      this.draw(0)
    })
    this.resize.observe(canvas)
    this.raf = requestAnimationFrame(this.tick)
  }

  /** Load a character; resolves once it stands on the rug. */
  async setCharacter(character: CharacterInfo) {
    if (character.url === this.characterUrl) return
    this.characterUrl = character.url
    const token = ++this.loadToken
    const humanoid = await loadHumanoid(character.url)
    if (token !== this.loadToken) return humanoid.dispose()
    const performer = new Performer(humanoid, character.id === 'sister' || /sister\.glb/.test(character.url))
    performer.jumpTo(this.posture)
    this.performer?.dispose()
    this.mount.clear()
    this.mount.add(performer.root)
    this.performer = performer
    this.fade = 0
  }

  setPosture(posture: PoseName) {
    this.posture = posture
    if (!this.performer) return
    if (this.reducedMotion) this.performer.jumpTo(posture)
    else this.performer.setPosture(posture)
  }

  /** Weave the rug in another brand palette. */
  setPalette(palette: Palette) {
    if (palette === this.palette) return
    this.palette = palette
    this.rug.recolor(rugColors(palette))
    this.draw(0)
  }

  setReducedMotion(on: boolean) {
    this.reducedMotion = on
  }

  /** Dev: force the camera azimuth (radians) to inspect a pose from the side. */
  setAzimuth(azimuth: number | undefined) {
    this.azimuth = azimuth
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(0.1, this.last ? (now - this.last) / 1000 : 0)
    this.last = now
    const busy = this.performer?.moving || this.fade < 1 || this.cameraMoving()
    // Idle: breathing only, so a low frame rate is enough (and saves battery).
    if (!busy && now - this.lastDraw < 1000 / IDLE_FPS) return
    this.draw(busy ? dt : (now - this.lastDraw) / 1000)
    this.lastDraw = now
  }

  private cameraMoving() {
    const shot = shotFor(this.posture)
    return Math.abs(this.view.azimuth - (this.azimuth ?? shot.azimuth)) > 0.002 || Math.abs(this.view.target.y - shot.target[1]) > 0.002
  }

  private draw(dt: number) {
    if (this.performer) {
      this.performer.update(this.reducedMotion ? 0 : dt)
      if (this.fade < 1) {
        this.fade = Math.min(1, this.fade + dt * 1.8)
        this.performer.root.scale.setScalar(0.96 + 0.04 * this.fade)
      }
    }
    this.frame(dt)
    this.renderer.render(this.scene, this.camera)
  }

  private frame(dt: number) {
    const shot = shotFor(this.posture)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    const aspect = this.size.w / this.size.h
    const [fitH, fitW] = shot.fit
    const distance = Math.max(fitH / 2 / tanHalf, fitW / 2 / (tanHalf * aspect)) * (STAGE_HEIGHT / 1.65)
    const s = this.view
    const lambda = s.first || this.reducedMotion ? 1000 : 1.6
    s.first = false
    const damp = THREE.MathUtils.damp
    s.azimuth = damp(s.azimuth, this.azimuth ?? shot.azimuth, lambda, dt)
    s.elevation = damp(s.elevation, shot.elevation, lambda, dt)
    s.distance = damp(s.distance, distance, lambda, dt)
    s.target.set(damp(s.target.x, shot.target[0], lambda, dt), damp(s.target.y, shot.target[1], lambda, dt), damp(s.target.z, shot.target[2], lambda, dt))
    this.camera.position.set(
      s.target.x + s.distance * Math.cos(s.elevation) * Math.sin(s.azimuth),
      s.target.y + s.distance * Math.sin(s.elevation),
      s.target.z + s.distance * Math.cos(s.elevation) * Math.cos(s.azimuth),
    )
    this.camera.lookAt(s.target)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.resize.disconnect()
    this.performer?.dispose()
    this.renderer.dispose()
  }
}
