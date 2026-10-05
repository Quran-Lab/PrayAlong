import { advance, Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { PrayerRug, RUG } from '@/components/stage/PrayerRug'
import { loadHumanoid } from '@/components/stage/rig/humanoid'
import { Performer } from '@/components/stage/rig/performer'
import type { PoseName } from '@/components/stage/rig/prayer-poses'

/**
 * Dev tool: renders a companion praying, seen by a laptop webcam on the floor
 * at the front edge of the rug. Driven frame by frame from
 * scripts/synth/render.mjs, which turns the frames into test videos.
 *
 *   /?lab&synth
 *
 * window.__synth.init(config) loads a character and places the camera;
 * window.__synth.frame(t, posture?) advances to time t (seconds) and returns
 * a JPEG of what the webcam sees plus the performer's ground truth.
 */

export interface SynthConfig {
  character: string
  width: number
  height: number
  /** Camera distance in metres in front of the rug's front edge. */
  gap: number
  /** Camera height above the floor (lens), metres. */
  height_m: number
  /** Upward tilt of the camera, degrees. */
  pitch: number
  /** The camera's position around the worshipper, degrees off the rug's axis. */
  yaw: number
  /** Vertical field of view, degrees (laptop webcams: ~45-50). */
  vfov: number
  /** 0.25 (dim lamp) .. 1 (daylight). Scales every light. */
  light: number
  /** Sensor noise (0..1 of 255), applied after exposure. */
  noise: number
  /** Auto-exposure gain the webcam applies (dim rooms get brightened and noisy). */
  gain: number
  /** Room palette index. */
  room: number
  /** Movement speed factor (1 = the companion's own pace). */
  speed: number
  jpegQuality: number
}

const ROOMS = [
  { wall: '#d9d2c5', ceiling: '#eeeae2', floor: '#8a6a4b' },
  { wall: '#b9c4c9', ceiling: '#e9ecec', floor: '#a49a8c' },
  { wall: '#e8dcc9', ceiling: '#f4efe6', floor: '#5c4636' },
  { wall: '#c7b8a6', ceiling: '#ddd5ca', floor: '#7b7f74' },
]

interface Api {
  init: (c: SynthConfig) => Promise<Record<string, number>>
  frame: (t: number, posture?: PoseName) => Promise<{ jpeg: string; posture: PoseName; settled: boolean }>
}

declare global {
  interface Window {
    __synth?: Api
  }
}

export function SynthLab() {
  const [config, setConfig] = useState<SynthConfig | null>(null)
  const pending = useRef<{ resolve: (m: Record<string, number>) => void; reject: (e: unknown) => void } | null>(null)
  const sceneApi = useRef<{ frame: Api['frame'] } | null>(null)

  useEffect(() => {
    window.__synth = {
      init: (c) =>
        new Promise((resolve, reject) => {
          pending.current = { resolve, reject }
          setConfig(c)
        }),
      frame: (t, posture) => {
        if (!sceneApi.current) throw new Error('not ready')
        return sceneApi.current.frame(t, posture)
      },
    }
  }, [])

  if (!config) return <div id="synth-status">idle</div>
  return (
    <div style={{ width: config.width, height: config.height, position: 'fixed', left: 0, top: 0, background: '#000' }}>
      <Canvas
        key={JSON.stringify(config)}
        frameloop="never"
        dpr={1}
        shadows
        gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.NeutralToneMapping }}
        camera={{ fov: config.vfov, near: 0.03, far: 30 }}
        style={{ width: config.width, height: config.height }}
      >
        <SynthScene
          config={config}
          onReady={(api, metrics) => {
            sceneApi.current = api
            pending.current?.resolve(metrics)
          }}
          onError={(e) => pending.current?.reject(e)}
        />
      </Canvas>
    </div>
  )
}

function SynthScene({
  config,
  onReady,
  onError,
}: {
  config: SynthConfig
  onReady: (api: { frame: Api['frame'] }, metrics: Record<string, number>) => void
  onError: (e: unknown) => void
}) {
  const { camera, gl, scene } = useThree()
  const performerRef = useRef<Performer | null>(null)
  const [performer, setPerformer] = useState<Performer | null>(null)
  const clock = useRef({ last: 0 })
  const room = ROOMS[config.room % ROOMS.length]!

  useEffect(() => {
    let cancelled = false
    loadHumanoid(config.character)
      .then((h) => {
        if (cancelled) return h.dispose()
        const p = new Performer(h)
        p.jumpTo('rest')
        performerRef.current = p
        setPerformer(p)
      })
      .catch(onError)
    return () => {
      cancelled = true
      performerRef.current?.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.character])

  useFrame((_, dt) => {
    performerRef.current?.update(dt * config.speed)
  })

  useEffect(() => {
    if (!performer) return
    // Where the worshipper stands: measure the standing body once.
    performer.jumpTo('qiyam')
    performer.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(performer.root, true)
    const standZ = (box.min.z + box.max.z) / 2
    performer.jumpTo('sujud')
    performer.root.updateMatrixWorld(true)
    const sbox = new THREE.Box3().setFromObject(performer.root, true)
    performer.jumpTo('rest')

    // The laptop sits `gap` in front of the rug's front edge, on a circle
    // around the worshipper, turned `yaw` off the rug's axis.
    const front = RUG.center + RUG.length / 2
    const radius = front + config.gap - standZ
    const yaw = THREE.MathUtils.degToRad(config.yaw)
    const cam = camera as THREE.PerspectiveCamera
    cam.position.set(Math.sin(yaw) * radius, config.height_m, standZ + Math.cos(yaw) * radius)
    // Look back at the worshipper, tilted up by `pitch`.
    const look = new THREE.Vector3(0, config.height_m, standZ)
    cam.lookAt(look)
    cam.rotateX(THREE.MathUtils.degToRad(config.pitch))
    cam.fov = config.vfov
    cam.aspect = config.width / config.height
    cam.updateProjectionMatrix()
    gl.setSize(config.width, config.height, false)
    scene.background = new THREE.Color(room.wall)

    const api = {
      frame: async (t: number, posture?: PoseName) => {
        const p = performerRef.current!
        if (posture) p.setPosture(posture)
        advance(t * 1000, true)
        clock.current.last = t
        const jpeg = degrade(gl.domElement, config)
        const priv = p as unknown as { t: number; queue: PoseName[] }
        return { jpeg, posture: p.posture, settled: priv.t >= 1 && priv.queue.length === 0 }
      },
    }
    advance(0, true)
    onReady(api, {
      standZ,
      headTop: box.max.y,
      sujudFrontZ: sbox.max.z,
      rugFront: front,
      cameraZ: cam.position.z,
      cameraX: cam.position.x,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [performer])

  const L = config.light
  return (
    <>
      <hemisphereLight args={['#f4f1ea', '#3a3229', 0.9 * L]} />
      {/* Ceiling lamp and a window to one side. */}
      <directionalLight position={[0.4, 2.5, 0.8]} intensity={1.6 * L} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[-2.5, 1.6, 1.5]} intensity={0.9 * L} color="#fff4e2" />
      <pointLight position={[0, 2.4, 0.5]} intensity={2.2 * L} distance={6} />
      <PrayerRug />
      {performer && (
        <group position-y={RUG.top - 0.006}>
          <primitive object={performer.root} />
        </group>
      )}
      <Room room={room} />
    </>
  )
}

function Room({ room }: { room: (typeof ROOMS)[number] }) {
  const W = 4.2
  const H = 2.6
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 0.5]} receiveShadow>
        <planeGeometry args={[W, 6]} />
        <meshStandardMaterial color={room.floor} roughness={0.8} />
      </mesh>
      <mesh rotation-x={Math.PI / 2} position={[0, H, 0.5]}>
        <planeGeometry args={[W, 6]} />
        <meshStandardMaterial color={room.ceiling} roughness={1} />
      </mesh>
      {/* Back wall behind the worshipper, side walls. */}
      <mesh position={[0, H / 2, -1.6]}>
        <planeGeometry args={[W, H]} />
        <meshStandardMaterial color={room.wall} roughness={1} />
      </mesh>
      <mesh position={[-W / 2, H / 2, 0.5]} rotation-y={Math.PI / 2}>
        <planeGeometry args={[6, H]} />
        <meshStandardMaterial color={room.wall} roughness={1} />
      </mesh>
      <mesh position={[W / 2, H / 2, 0.5]} rotation-y={-Math.PI / 2}>
        <planeGeometry args={[6, H]} />
        <meshStandardMaterial color={room.wall} roughness={1} />
      </mesh>
      {/* A shelf and a picture frame, so the room isn't featureless. */}
      <mesh position={[0.9, 1.3, -1.58]}>
        <boxGeometry args={[0.6, 0.45, 0.03]} />
        <meshStandardMaterial color="#5d4a3a" />
      </mesh>
      <mesh position={[-1.2, 0.45, -1.4]}>
        <boxGeometry args={[0.8, 0.9, 0.35]} />
        <meshStandardMaterial color="#6f5b48" />
      </mesh>
      <mesh position={[0, H - 0.01, 0.4]} rotation-x={Math.PI / 2}>
        <circleGeometry args={[0.18, 24]} />
        <meshBasicMaterial color="#fffdf5" />
      </mesh>
    </group>
  )
}

// A webcam's look: exposure gain, a little blur, sensor noise, JPEG.
const work = typeof document !== 'undefined' ? document.createElement('canvas') : null
let seed = 1
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

function degrade(src: HTMLCanvasElement, c: SynthConfig) {
  const w = work!
  w.width = c.width
  w.height = c.height
  const ctx = w.getContext('2d', { willReadFrequently: true })!
  ctx.filter = 'blur(0.5px)'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  ctx.filter = 'none'
  const img = ctx.getImageData(0, 0, c.width, c.height)
  const d = img.data
  const sigma = c.noise * 255
  for (let i = 0; i < d.length; i += 4) {
    // Luma-correlated noise like a small sensor (Box-Muller is overkill).
    const n = (rand() + rand() + rand() - 1.5) * sigma * 1.4
    d[i] = d[i]! * c.gain + n
    d[i + 1] = d[i + 1]! * c.gain + n
    d[i + 2] = d[i + 2]! * c.gain + n
  }
  ctx.putImageData(img, 0, 0)
  return w.toDataURL('image/jpeg', c.jpegQuality)
}
