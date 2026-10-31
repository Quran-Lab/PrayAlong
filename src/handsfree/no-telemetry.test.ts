import { describe, expect, it, vi } from 'vitest'
import { blockMediapipeTelemetry } from './no-telemetry'

describe('blockMediapipeTelemetry', () => {
  it('answers MediaPipe usage logs locally and lets everything else through', async () => {
    const real = vi.fn(async () => new Response('ok'))
    const scope = { fetch: real } as unknown as typeof globalThis
    blockMediapipeTelemetry(scope)
    blockMediapipeTelemetry(scope) // once only
    const log = await scope.fetch('https://odml.pa.googleapis.com/v1/log', { method: 'POST', body: 'x' })
    expect(log.status).toBe(200)
    expect(real).not.toHaveBeenCalled()
    await scope.fetch(new URL('https://prayalong.me/audio/manifest.json'))
    await scope.fetch('/models/face.tflite')
    expect(real).toHaveBeenCalledTimes(2)
  })
})
