/**
 * MediaPipe's task libraries post usage logs (task type, platform, timings) to
 * Google (odml.pa.googleapis.com) once a minute, and offer no option to turn it
 * off. PrayAlong promises that nothing about the person leaves the device, so
 * those requests are answered here and never sent. Call before loading
 * @mediapipe/tasks-vision, in each thread (window or worker) that loads it.
 */
const BLOCKED = /^https:\/\/odml\.pa\.googleapis\.com\//

const urlOf = (input: RequestInfo | URL) => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)

export function blockMediapipeTelemetry(scope: typeof globalThis = globalThis) {
  const g = scope as typeof globalThis & { __prayalongNoTelemetry?: boolean }
  if (g.__prayalongNoTelemetry || typeof g.fetch !== 'function') return
  g.__prayalongNoTelemetry = true
  const send = g.fetch.bind(g)
  g.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    BLOCKED.test(urlOf(input)) ? Promise.resolve(new Response(null, { status: 200 })) : send(input, init)) as typeof fetch
}
