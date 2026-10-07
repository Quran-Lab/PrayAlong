import { ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { oklchToHex } from '@/lib/color'
import type { CharacterInfo } from './characters'
import { PrayerRug, RUG } from './PrayerRug'
import { loadHumanoid } from './rig/humanoid'
import { Performer, STAGE_HEIGHT } from './rig/performer'
import type { PoseName } from './rig/prayer-poses'
import { Scenery } from './Scenery'
import { currentTuning, tuneFor, type Tuning } from './rig/tuning'
import type { PrayerId } from '@/sequence/types'

interface StageProps {
  posture: PoseName
  character: CharacterInfo
  /** Prayer-of-the-day tint for the glow and rim light. */
  ambient: string
  /** Sets the window's sky and the light in the room. */
  prayer?: PrayerId
  /** Raise the hands going into ruku and rising from it. */
  raiseHands?: boolean
  /** Live fine-tuning (Tune screen); defaults to the saved tuning. */
  tuning?: Tuning
  /** Where the companion stands on the page (percent of the window width), so the page's window can sit behind it. */
  onAnchor?: (xPercent: number) => void
  /** Draw the room behind the companion (off when the page draws it). */
  scenery?: boolean
  reducedMotion?: boolean
  /** Dev: force the camera azimuth (radians) to inspect a pose from the side. */
  azimuth?: number
  onLoaded?: () => void
  onError?: (error: Error) => void
  /**
   * [voice] Draw at low power: about 20 frames a second, no shadows, DPR 1.
   * Set while the speech decoder is falling behind the microphone (CPU starved).
   */
  lowPower?: boolean
  /** Pixels of the canvas covered by the floating bars: the companion is framed in what is left between them. */
  inset?: { top: number; bottom: number }
}

/** When the stage last had something moving (performance.now() ms): it draws every frame until then. */
interface Pace {
  busyUntil: number
}
/** Standing still, only the breath and a slow camera drift move: a lower frame rate saves the CPU and battery for the microphone and camera. */
const IDLE_FPS = { fine: 30, coarse: 24 } as const
const BUSY_MS = 300

export function CompanionStage(props: StageProps) {
  const ambient = useMemo(() => oklchToHex(props.ambient), [props.ambient])
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, [])
  const [quality, setQuality] = useState<'high' | 'low'>(coarse ? 'low' : 'high')

  const prayer = props.prayer ?? 'dhuhr'
  // The room's window sits behind wherever the companion is drawn.
  const [localAnchor, setLocalAnchor] = useState(50)
  const pace = useRef<Pace>({ busyUntil: 0 }).current
  const inset = props.inset ?? NO_INSET
  return (
    <div className="absolute inset-0">
      {props.scenery !== false && <Scenery prayer={prayer} windowX={localAnchor} />}
    <Canvas
      shadows={!props.lowPower}
      frameloop="demand"
      dpr={props.lowPower ? 1 : quality === 'high' ? [1, 2] : [1, 1.5]}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.NeutralToneMapping, powerPreference: 'high-performance' }}
      camera={{ fov: 24, near: 0.1, far: 60, position: [1.6, 1.3, 5] }}
      aria-hidden
    >
      <PerformanceMonitor onDecline={() => setQuality('low')} />
      <FramePacer pace={pace} fps={props.lowPower ? 20 : null} idleFps={coarse ? IDLE_FPS.coarse : IDLE_FPS.fine} />
      <CameraRig posture={props.posture} reducedMotion={props.reducedMotion} azimuth={props.azimuth} inset={inset} pace={pace} />
      {props.onAnchor && <Anchor onAnchor={props.onAnchor} />}
      {props.scenery !== false && <Anchor inCanvas onAnchor={setLocalAnchor} />}

      <StageLights ambient={ambient} prayer={prayer} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={1.6} position={[0, 5, 3]} scale={[8, 3, 1]} color="#fff7ec" />
        <Lightformer form="rect" intensity={0.9} position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} color="#f1efe9" />
        <Lightformer form="ring" intensity={1.4} position={[3, 2, -4]} scale={2} color={ambient} />
      </Environment>
      <PrayerRug />
      <Companion {...props} pace={pace} />
      {!props.lowPower && <ContactShadows position={[0, RUG.top + 0.001, RUG.center]} scale={[RUG.width + 0.4, RUG.length + 0.4]} blur={2.4} far={1.4} opacity={0.55} resolution={512} color="#0b3328" />}
    </Canvas>
    </div>
  )
}

const NO_INSET = { top: 0, bottom: 0 }

/**
 * Draws on demand: every display frame while something moves (a change of posture, the
 * camera settling), `idleFps` while the companion only breathes, and never more than `fps`
 * when that is set (low power).
 */
function FramePacer({ pace, idleFps, fps }: { pace: Pace; idleFps: number; fps: number | null }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const rate = fps ?? (now < pace.busyUntil ? 0 : idleFps)
      // A couple of ms of slack so a 60 Hz display does not skip every other target frame.
      if (!rate || now - last >= 1000 / rate - 2) {
        last = now
        invalidate()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [pace, idleFps, fps, invalidate])
  return null
}

// ————————————————————————————————————————————————————————— character

function Companion({ posture, character, reducedMotion, raiseHands, tuning, onLoaded, onError, pace }: StageProps & { pace: Pace }) {
  const [performer, setPerformer] = useState<Performer | null>(null)
  const fade = useRef(0)

  useEffect(() => {
    let cancelled = false
    let created: Performer | null = null
    loadHumanoid(character.url)
      .then((humanoid) => {
        if (cancelled) return humanoid.dispose()
        if (character.clay) applyClay(humanoid.scene)
        created = new Performer(humanoid)
        created.jumpTo(posture)
        fade.current = 0
        setPerformer(created)
        onLoaded?.()
      })
      .catch((err: Error) => !cancelled && onError?.(err))
    return () => {
      cancelled = true
      created?.dispose()
    }
    // Load once per character; posture changes are animated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [character.url])

  useEffect(() => {
    if (!performer) return
    performer.raiseHands = Boolean(raiseHands)
    performer.tune = (pose) => tuneFor(tuning ?? currentTuning(), character.id, pose)
    if (reducedMotion) performer.jumpTo(posture)
    else performer.setPosture(posture)
    pace.busyUntil = performance.now() + BUSY_MS
  }, [performer, posture, reducedMotion, raiseHands, tuning, pace])

  useFrame((_, dt) => {
    if (!performer) return
    performer.update(dt)
    if (performer.moving || fade.current < 1) pace.busyUntil = performance.now() + BUSY_MS
    // Fade the character in once on load.
    if (fade.current < 1) {
      fade.current = Math.min(1, fade.current + dt * 1.8)
      performer.root.scale.setScalar(0.96 + 0.04 * fade.current)
    }
  })

  // Feet sink a touch into the plush rug.
  return performer ? (
    <group position-y={RUG.top - 0.006}>
      <primitive object={performer.root} />
    </group>
  ) : null
}

/** PrayAlong's soft clay finish, for placeholder characters. */
function applyClay(scene: THREE.Object3D) {
  const body = new THREE.MeshPhysicalMaterial({
    color: '#ece6dc',
    roughness: 0.62,
    sheen: 0.6,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#ffffff'),
  })
  const joints = new THREE.MeshPhysicalMaterial({ color: '#41594e', roughness: 0.5, clearcoat: 0.3 })
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? ''
    mesh.material = /joint/i.test(name) ? joints : body
  })
}

// ————————————————————————————————————————————————————————— set dressing

/** Reports where the companion's chest lands on the page, horizontally. */
function Anchor({ onAnchor, inCanvas = false }: { onAnchor: (xPercent: number) => void; /** Report as a percent of the canvas instead of the page. */ inCanvas?: boolean }) {
  const { camera, gl } = useThree()
  const last = useRef(-1)
  const p = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    p.set(0, 0.95, 0.2).project(camera)
    const r = gl.domElement.getBoundingClientRect()
    const x = inCanvas ? ((p.x + 1) / 2) * 100 : ((r.left + ((p.x + 1) / 2) * r.width) / window.innerWidth) * 100
    if (Math.abs(x - last.current) > 0.25) {
      last.current = x
      onAnchor(x)
    }
  })
  return null
}

/** The light of each prayer's hour: sky fill, a sun or moon key, and the window behind. */
const LIGHT: Record<PrayerId, { sky: string; ground: string; hemi: number; key: string; keyI: number; keyPos: [number, number, number]; back: string; backI: number; fill: string; fillI: number }> = {
  fajr: { sky: '#cfc8ff', ground: '#2a2440', hemi: 0.95, key: '#ffd6c6', keyI: 1.9, keyPos: [-3, 2.4, 3.2], back: '#ffb4a2', backI: 2.4, fill: '#ece6ff', fillI: 0.9 },
  dhuhr: { sky: '#eef6ff', ground: '#36463f', hemi: 1.1, key: '#fffaf0', keyI: 2.7, keyPos: [-2.4, 4.6, 3.4], back: '#c4e6ff', backI: 2.4, fill: '#fff6ec', fillI: 0.9 },
  asr: { sky: '#fff1d8', ground: '#3a3020', hemi: 1.0, key: '#ffdca4', keyI: 2.6, keyPos: [-3.2, 2.8, 2.6], back: '#ffcb78', backI: 2.6, fill: '#fff2e2', fillI: 0.85 },
  maghrib: { sky: '#ffd6c8', ground: '#2c1b22', hemi: 0.9, key: '#ffb084', keyI: 2.2, keyPos: [-3.4, 1.8, 2.4], back: '#ff8f62', backI: 3, fill: '#ffe4d6', fillI: 0.85 },
  isha: { sky: '#bcc8ff', ground: '#151a30', hemi: 0.75, key: '#dfe6ff', keyI: 1.5, keyPos: [-2.2, 4, 3], back: '#a3b3ff', backI: 2.1, fill: '#ffdcb6', fillI: 1.1 },
}

function StageLights({ ambient, prayer }: { ambient: string; prayer: PrayerId }) {
  const L = LIGHT[prayer]
  return (
    <>
      <hemisphereLight args={[L.sky, L.ground, L.hemi]} />
      <directionalLight
        position={L.keyPos}
        intensity={L.keyI}
        color={L.key}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-1.6}
        shadow-camera-right={1.6}
        shadow-camera-top={2.2}
        shadow-camera-bottom={-1}
      />
      {/* Soft front fill: faces sit inside caps and hijabs and need light from the viewer's side. */}
      <directionalLight position={[0.6, 1.5, 4]} intensity={L.fillI} color={L.fill} />
      {/* The window behind the companion: a rim of the sky's light. */}
      <directionalLight position={[1.4, 2.6, -3.2]} intensity={L.backI} color={L.back} />
      <directionalLight position={[-1.6, 2.2, -3]} intensity={L.backI * 0.35} color={ambient} />
    </>
  )
}

// ————————————————————————————————————————————————————————— camera

const SHOTS: Record<'standing' | 'bowing' | 'floor' | 'sitting', { azimuth: number; elevation: number; target: [number, number, number]; fit: [number, number] }> = {
  standing: { azimuth: 0.3, elevation: 0.16, target: [0, 0.72, 0.26], fit: [2.45, 1.75] },
  bowing: { azimuth: 0.9, elevation: 0.17, target: [0, 0.6, 0.28], fit: [2.2, 2.05] },
  floor: { azimuth: 0.95, elevation: 0.24, target: [0, 0.36, 0.42], fit: [1.85, 2.2] },
  sitting: { azimuth: 0.6, elevation: 0.2, target: [0, 0.44, 0.34], fit: [1.85, 1.9] },
}

function shotFor(posture: PoseName) {
  if (posture === 'ruku') return SHOTS.bowing
  if (posture === 'sujud' || posture === 'kneel') return SHOTS.floor
  if (posture === 'jalsah' || posture === 'tashahhud' || posture.startsWith('salam')) return SHOTS.sitting
  return SHOTS.standing
}

function CameraRig({ posture, reducedMotion, azimuth, inset, pace }: { posture: PoseName; reducedMotion?: boolean; azimuth?: number; inset: { top: number; bottom: number }; pace: Pace }) {
  const { camera, size } = useThree()
  const offsetKey = useRef('')
  const state = useRef({ azimuth: 0.34, elevation: 0.12, distance: 5, target: new THREE.Vector3(0, 0.86, 0.12), first: true })

  useFrame(({ clock }, dt) => {
    const shot = shotFor(posture)
    const cam = camera as THREE.PerspectiveCamera
    // Frame the companion in the part of the canvas the bars leave open, and centre it there.
    const top = Math.min(inset.top, size.height * 0.35)
    const bottom = Math.min(inset.bottom, size.height * 0.35)
    const open = Math.max(1, size.height - top - bottom)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * (open / Math.max(1, size.height))
    const aspect = size.width / open
    const shift = Math.round((top - bottom) / 2)
    const key = `${size.width}x${size.height}:${shift}`
    if (key !== offsetKey.current) {
      offsetKey.current = key
      if (shift) cam.setViewOffset(size.width, size.height, 0, -shift, size.width, size.height)
      else cam.clearViewOffset()
    }
    const [fitH, fitW] = shot.fit
    const distance = Math.max(fitH / 2 / tanHalf, fitW / 2 / (tanHalf * aspect)) * (STAGE_HEIGHT / 1.65)
    const s = state.current
    const lambda = s.first || reducedMotion ? 1000 : 1.6
    s.first = false
    s.azimuth = THREE.MathUtils.damp(s.azimuth, azimuth ?? shot.azimuth, lambda, dt)
    s.elevation = THREE.MathUtils.damp(s.elevation, shot.elevation, lambda, dt)
    s.distance = THREE.MathUtils.damp(s.distance, distance, lambda, dt)
    s.target.x = THREE.MathUtils.damp(s.target.x, shot.target[0], lambda, dt)
    s.target.y = THREE.MathUtils.damp(s.target.y, shot.target[1], lambda, dt)
    s.target.z = THREE.MathUtils.damp(s.target.z, shot.target[2], lambda, dt)
    if (Math.abs(s.distance - distance) > 0.002 || Math.abs(s.azimuth - (azimuth ?? shot.azimuth)) > 0.001 || Math.abs(s.target.y - shot.target[1]) > 0.001)
      pace.busyUntil = performance.now() + BUSY_MS
    // A barely-there drift keeps the frame alive.
    const drift = reducedMotion ? 0 : Math.sin(clock.elapsedTime * 0.12) * 0.03
    const az = s.azimuth + drift
    camera.position.set(
      s.target.x + s.distance * Math.cos(s.elevation) * Math.sin(az),
      s.target.y + s.distance * Math.sin(s.elevation),
      s.target.z + s.distance * Math.cos(s.elevation) * Math.cos(az),
    )
    camera.lookAt(s.target)
  })
  return null
}
