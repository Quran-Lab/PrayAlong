import { afterEach, describe, expect, it, vi } from 'vitest'

describe('loadManifest', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tries again after a failed download instead of keeping the failure', async () => {
    vi.resetModules()
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ voices: {} }) })
    vi.stubGlobal('fetch', fetch)
    const { loadManifest, getManifest } = await import('./engine')
    expect(await loadManifest()).toBeNull()
    expect(await loadManifest()).toEqual({ voices: {} })
    expect(getManifest()).toEqual({ voices: {} })
    // Once loaded it is kept.
    await loadManifest()
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
