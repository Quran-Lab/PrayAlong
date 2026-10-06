/**
 * prayalong.me: static assets, plus the voice model streamed from a private
 * R2 bucket (too large for static assets, and kept out of the public repo).
 */
interface Env {
  ASSETS: Fetcher
  MODELS: R2Bucket
}

const MODEL_PREFIX = '/voice/model/'
const MEDIA_PREFIX = '/media/' // the demo video, also too large for static assets

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const media = url.pathname.startsWith(MEDIA_PREFIX)
    if ((url.pathname.startsWith(MODEL_PREFIX) || media) && (request.method === 'GET' || request.method === 'HEAD')) {
      const key = url.pathname.slice(1)
      const object = await env.MODELS.get(key, { range: request.headers, onlyIf: request.headers })
      if (!object) return new Response('Not found', { status: 404 })
      const headers = new Headers()
      object.writeHttpMetadata(headers)
      headers.set('etag', object.httpEtag)
      headers.set('cache-control', media ? 'public, max-age=3600' : key.endsWith('manifest.json') ? 'public, max-age=300' : 'public, max-age=31536000, immutable')
      headers.set('cross-origin-resource-policy', media ? 'cross-origin' : 'same-origin')
      headers.set('accept-ranges', 'bytes')
      const body = 'body' in object ? object.body : null
      const status = body ? (request.headers.has('range') ? 206 : 200) : 304
      return new Response(request.method === 'HEAD' ? null : body, { status, headers })
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
