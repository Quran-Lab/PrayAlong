import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ResilientCamera, type CameraState } from './camera'

/** A fake video track that can end or go quiet. */
class FakeTrack extends EventTarget {
  muted = false
  stop = vi.fn()
  end() {
    this.dispatchEvent(new Event('ended'))
  }
  mute() {
    this.muted = true
    this.dispatchEvent(new Event('mute'))
  }
}

function fakeStream() {
  const track = new FakeTrack()
  return { track, stream: { getVideoTracks: () => [track], getTracks: () => [track] } as unknown as MediaStream }
}

describe('ResilientCamera', () => {
  let devices: EventTarget & { getUserMedia: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    vi.useFakeTimers()
    devices = Object.assign(new EventTarget(), { getUserMedia: vi.fn() })
    vi.stubGlobal('navigator', { mediaDevices: devices })
    vi.stubGlobal('window', globalThis)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries a dropped camera after 1 s, 3 s and 10 s, then gives up until a device appears', async () => {
    const first = fakeStream()
    devices.getUserMedia.mockResolvedValueOnce(first.stream)
    const states: CameraState[] = []
    const cam = new ResilientCamera({ facingMode: 'user', onStream: () => {}, onState: (s) => states.push(s) })
    await cam.start()
    expect(cam.state).toBe('live')

    devices.getUserMedia.mockRejectedValue(Object.assign(new Error('busy'), { name: 'NotReadableError' }))
    first.track.end()
    expect(cam.state).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(999)
    expect(devices.getUserMedia).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(devices.getUserMedia).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(3000)
    expect(devices.getUserMedia).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(devices.getUserMedia).toHaveBeenCalledTimes(4)
    expect(cam.state).toBe('lost')

    // Plugging a camera back in tries again right away.
    const second = fakeStream()
    devices.getUserMedia.mockResolvedValueOnce(second.stream)
    devices.dispatchEvent(new Event('devicechange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(cam.state).toBe('live')
    expect(states).toEqual(['live', 'reconnecting', 'lost', 'reconnecting', 'live'])
    cam.stop()
  })

  it('treats a track muted for a while as dropped', async () => {
    const first = fakeStream()
    const second = fakeStream()
    devices.getUserMedia.mockResolvedValueOnce(first.stream).mockResolvedValueOnce(second.stream)
    const cam = new ResilientCamera({ facingMode: 'user', onStream: () => {}, onState: () => {} })
    await cam.start()
    first.track.mute()
    await vi.advanceTimersByTimeAsync(2400)
    expect(cam.state).toBe('live')
    await vi.advanceTimersByTimeAsync(200)
    expect(cam.state).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000)
    expect(cam.state).toBe('live')
    expect(first.track.stop).toHaveBeenCalled()
    cam.stop()
  })

  it('reports a refused permission without retrying', async () => {
    devices.getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
    const cam = new ResilientCamera({ facingMode: 'user', onStream: () => {}, onState: () => {} })
    await cam.start()
    expect(cam.state).toBe('denied')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(devices.getUserMedia).toHaveBeenCalledTimes(1)
  })
})
