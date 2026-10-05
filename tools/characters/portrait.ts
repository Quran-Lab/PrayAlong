// The picker portrait of a companion, rendered by the app's own rig and lights (standing at rest,
// in its baked clothes) on Quran Lab paper. Run through tools/characters/portrait.mjs.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { loadHumanoid } from '@/components/stage/rig/humanoid'
import { Performer } from '@/components/stage/rig/performer'

async function render(id: string) {
  const canvas = document.querySelector('canvas')!
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setClearColor('#f1efea')
  renderer.toneMapping = THREE.NeutralToneMapping
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.55
  scene.add(new THREE.HemisphereLight('#fff4e6', '#d8d2c6', 1.1))
  const key = new THREE.DirectionalLight('#fff3e2', 2.4)
  key.position.set(-2.4, 4.6, 3.4)
  const fill = new THREE.DirectionalLight('#ffe9d2', 0.8)
  fill.position.set(3, 1.8, 2.2)
  const rim = new THREE.DirectionalLight('#dde1f5', 1.4)
  rim.position.set(1.4, 2.6, -3.2)
  scene.add(key, fill, rim)
  const performer = new Performer(await loadHumanoid(`/avatars/${id}.glb`))
  performer.jumpTo('rest')
  scene.add(performer.root)
  // Head and shoulders to the waist, a little from the side, as before.
  const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 20)
  const az = THREE.MathUtils.degToRad(16)
  const target = new THREE.Vector3(0, 1.12, 0)
  camera.position.set(Math.sin(az) * 3.2, 1.28, Math.cos(az) * 3.2)
  camera.lookAt(target)
  renderer.render(scene, camera)
  return canvas.toDataURL('image/png')
}

;(window as unknown as { __portrait: Promise<string> }).__portrait = render(new URLSearchParams(location.search).get('char') ?? 'brother')
