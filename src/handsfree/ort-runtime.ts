/**
 * The onnxruntime WebGPU runtime is ~28 MB — over Cloudflare's 25 MiB
 * per-file limit — so production builds ship it in parts
 * (scripts/split-large-assets.mjs) and workers stitch it back together here.
 * Still fully self-hosted; the parts are cached after the first download.
 */
export async function stitchedRuntime(): Promise<ArrayBuffer | undefined> {
  if (!import.meta.env.PROD) return undefined
  try {
    const manifestUrl = new URL('../ort/manifest.json', self.location.href)
    const res = await fetch(manifestUrl)
    if (!res.ok) return undefined
    const manifest = (await res.json()) as { files: { name: string; parts: string[] }[] }
    const entry = manifest.files.find((f) => f.name.includes('jsep')) ?? manifest.files[0]
    if (!entry) return undefined
    const parts = await Promise.all(entry.parts.map((p) => fetch(new URL(p, manifestUrl)).then((r) => r.arrayBuffer())))
    const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0))
    let offset = 0
    for (const p of parts) {
      out.set(new Uint8Array(p), offset)
      offset += p.byteLength
    }
    return out.buffer
  } catch {
    return undefined
  }
}
