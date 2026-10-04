// Self-host MediaPipe's wasm runtime (copied from node_modules on install).
import { cp, mkdir } from 'node:fs/promises'

await mkdir('public/mediapipe', { recursive: true })
await cp('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', { recursive: true })
console.log('copied MediaPipe wasm → public/mediapipe')
