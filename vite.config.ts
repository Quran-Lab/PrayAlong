import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { fileURLToPath, URL } from 'node:url'

// Same as public/_headers: cross-origin isolation lets the pose models and the ASR run
// multi-threaded WebAssembly (everything is self-hosted).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  // Relative asset URLs: the same build runs at a domain root, a GitHub Pages
  // subpath or inside a claude.ai artifact.
  base: './',
  plugins: [svelte()],
  server: { headers: isolation },
  preview: { headers: isolation },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // onnxruntime-web ships its own wasm loader; let it resolve at runtime.
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
