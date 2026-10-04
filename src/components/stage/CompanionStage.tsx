import { Billboard, ContactShadows, Environment, Lightformer, PerformanceMonitor } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { EffectComposer, N8AO, Vignette } from '@react-three/postprocessing'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { oklchToHex } from '@/lib/color'
import type { CharacterInfo } from './characters'
import { createMatTexture } from './mat-texture'
import { loadHumanoid } from './rig/humanoid'
import { Performer, STAGE_HEIGHT } from './rig/performer'
import type { PoseName } from './rig/prayer-poses'

const BACKDROP = '#0a0d0c'

interface StageProps {
  posture: PoseName
  character: CharacterInfo
  /** Prayer-of-the-day tint for the glow and rim light. */
  ambient: string
  reducedMotion?: boolean
  /** Dev: force the camera azimuth (radians) to inspect a pose from the side. */
  azimuth?: number
  onLoaded?: () => void
  onError?: (error: Error) => void
}

export function CompanionStage(props: StageProps) {
  const ambient = useMemo(() => oklchToHex(props.ambient), [props.ambient])
  const coarse = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches, [])
  const [quality, setQuality] = useState<'high' | 'low'>(coarse ? 'low' : 'high')

  return (
    <Canvas
      shadows
      dpr={quality === 'high' ? [1, 2] : [1, 1.5]}
      gl={{ antialias: true, toneMapping: THREE.NeutralToneMapping, powerPreference: 'high-performance' }}
      camera={{ fov: 24, near: 0.1, far: 60, position: [1.6, 1.3, 5] }}
      aria-hidden
    >
      <color attach="background" args={[BACKDROP]} />
      <PerformanceMonitor onDecline={() => setQuality('low')} />
      <CameraRig posture={props.posture} reducedMotion={props.reducedMotion} azimuth={props.azimuth} />
      <Glow color={ambient} />
      <StageLights ambient={ambient} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={1.6} position={[0, 5, 3]} scale={[8, 3, 1]} color="#fff7ec" />
        <Lightformer form="rect" intensity={0.9} position={[-5, 2, 1]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} color="#f1efe9" />
        <Lightformer form="ring" intensity={1.4} position={[3, 2, -4]} scale={2} color={ambient} />
      </Environment>
      <PrayerMat />
      <Companion {...props} />
      <ContactShadows position={[0, 0.0135, 0.25]} scale={3.2} blur={2.2} far={1.4} opacity={0.62} resolution={512} color="#04110c" />
      {quality === 'high' && (
        <EffectComposer multisampling={4}>
          <N8AO halfRes aoRadius={0.35} intensity={2.2} distanceFalloff={0.6} color="#06140e" />
          <Vignette offset={0.32} darkness={0.55} />
        </EffectComposer>
      )}
    </Canvas>
  )
}

// ————————————————————————————————————————————————————————— character

function Companion({ posture, character, reducedMotion, onLoaded, onError }: StageProps) {
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
    if (reducedMotion) performer.jumpTo(posture)
    else performer.setPosture(posture)
  }, [performer, posture, reducedMotion])

  useFrame((_, dt) => {
    if (!performer) return
    performer.update(dt)
    // Fade the character in once on load.
    if (fade.current < 1) {
      fade.current = Math.min(1, fade.current + dt * 1.8)
      performer.root.scale.setScalar(0.96 + 0.04 * fade.current)
    }
  })

  return performer ? <primitive object={performer.root} /> : null
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

const MAT = { width: 0.78, length: 1.32, thickness: 0.012, center: 0.38 }

function PrayerMat() {
  const texture = useMemo(() => createMatTexture(), [])
  const fringe = useMemo(() => {
    const geo = new THREE.CylinderGeometry(0.0022, 0.0018, 0.05, 5)
    geo.rotateX(Math.PI / 2)
    const mat = new THREE.MeshStandardMaterial({ color: '#e5d9c0', roughness: 0.9 })
    const count = 44
    const mesh = new THREE.InstancedMesh(geo, mat, count * 2)
    const m = new THREE.Matrix4()
    for (let end = 0; end < 2; end++) {
      for (let i = 0; i < count; i++) {
        const x = -MAT.width / 2 + 0.02 + (i / (count - 1)) * (MAT.width - 0.04)
        const dir = end === 0 ? 1 : -1
        const z = MAT.center + dir * (MAT.length / 2 + 0.022)
        const wobble = Math.sin(i * 12.9898) * 0.08
        m.makeRotationY(wobble).setPosition(x, 0.004, z)
        mesh.setMatrixAt(end * count + i, m)
      }
    }
    mesh.receiveShadow = true
    return mesh
  }, [])

  return (
    <group>
      <mesh position={[0, MAT.thickness / 2, MAT.center]} receiveShadow castShadow>
        <boxGeometry args={[MAT.width, MAT.thickness, MAT.length]} />
        <meshStandardMaterial color="#11231c" roughness={0.95} />
      </mesh>
      {/* Canvas top is the qibla end, so it faces +Z. */}
      <mesh position={[0, MAT.thickness + 0.0005, MAT.center]} rotation={[-Math.PI / 2, 0, Math.PI]} receiveShadow>
        <planeGeometry args={[MAT.width, MAT.length]} />
        <meshPhysicalMaterial map={texture} roughness={0.92} sheen={0.5} sheenRoughness={0.8} sheenColor="#c9b98f" />
      </mesh>
      <primitive object={fringe} />
    </group>
  )
}

function Glow({ color }: { color: string }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    grad.addColorStop(0, 'rgba(255,255,255,0.55)')
    grad.addColorStop(0.35, 'rgba(255,255,255,0.18)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 256, 256)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  const ref = useRef<THREE.Group>(null)
  const { camera } = useThree()
  useFrame(() => {
    // Keep the glow just behind the companion from wherever the camera is.
    const dir = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0.8, 0.3), camera.position).normalize()
    ref.current?.position.set(0, 0.8, 0.3).addScaledVector(dir, 2.2)
  })
  return (
    <Billboard ref={ref}>
      <mesh>
        <planeGeometry args={[5.5, 5.5]} />
        <meshBasicMaterial map={texture} color={color} transparent opacity={0.32} depthWrite={false} toneMapped={false} />
      </mesh>
    </Billboard>
  )
}

function StageLights({ ambient }: { ambient: string }) {
  return (
    <>
      <hemisphereLight args={['#fff4e6', '#13241d', 0.55]} />
      <directionalLight
        position={[-2.4, 4.6, 3.4]}
        intensity={2.3}
        color="#fff3e2"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-1.6}
        shadow-camera-right={1.6}
        shadow-camera-top={2.2}
        shadow-camera-bottom={-1}
      />
      <directionalLight position={[3, 1.8, 2.2]} intensity={0.45} color="#ffe9d2" />
      <directionalLight position={[1.4, 2.6, -3.2]} intensity={3.2} color={ambient} />
    </>
  )
}

// ————————————————————————————————————————————————————————— camera

const SHOTS: Record<'standing' | 'bowing' | 'floor' | 'sitting', { azimuth: number; elevation: number; target: [number, number, number]; fit: [number, number] }> = {
  standing: { azimuth: 0.3, elevation: 0.16, target: [0, 0.8, 0.22], fit: [2.15, 1.6] },
  bowing: { azimuth: 0.9, elevation: 0.17, target: [0, 0.66, 0.24], fit: [2.0, 1.9] },
  floor: { azimuth: 0.95, elevation: 0.24, target: [0, 0.42, 0.4], fit: [1.7, 2.0] },
  sitting: { azimuth: 0.6, elevation: 0.2, target: [0, 0.5, 0.3], fit: [1.7, 1.7] },
}

function shotFor(posture: PoseName) {
  if (posture === 'ruku') return SHOTS.bowing
  if (posture === 'sujud' || posture === 'kneel') return SHOTS.floor
  if (posture === 'jalsah' || posture === 'tashahhud' || posture.startsWith('salam')) return SHOTS.sitting
  return SHOTS.standing
}

function CameraRig({ posture, reducedMotion, azimuth }: { posture: PoseName; reducedMotion?: boolean; azimuth?: number }) {
  const { camera, size } = useThree()
  const state = useRef({ azimuth: 0.34, elevation: 0.12, distance: 5, target: new THREE.Vector3(0, 0.86, 0.12), first: true })

  useFrame(({ clock }, dt) => {
    const shot = shotFor(posture)
    const cam = camera as THREE.PerspectiveCamera
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2))
    const aspect = size.width / Math.max(1, size.height)
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
