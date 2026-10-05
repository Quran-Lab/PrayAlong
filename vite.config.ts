import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // Relative asset URLs: the same build runs at a domain root, a GitHub Pages
  // subpath or inside a claude.ai artifact.
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // onnxruntime-web ships its own wasm loader; let it resolve at runtime.
    exclude: ['onnxruntime-web'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
