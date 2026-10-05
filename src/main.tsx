import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/figtree'
import '@fontsource-variable/source-serif-4'
import '@fontsource/amiri-quran/400.css'
import '@fontsource/amiri/400.css'
import '@fontsource/amiri/700.css'
// Arabic-script UI text (unicode-range: only downloaded when used).
import '@fontsource-variable/noto-sans-arabic'
import '@fontsource/noto-nastaliq-urdu/400.css'
import './index.css'
import { App } from './App'

// Dev-only pose tuning tool: /?lab&pose=sujud
const PoseLab = lazy(() => import('./lab/PoseLab').then((m) => ({ default: m.PoseLab })))
const lab = import.meta.env.DEV && new URLSearchParams(location.search).has('lab')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {lab ? (
      <Suspense>
        <PoseLab />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
