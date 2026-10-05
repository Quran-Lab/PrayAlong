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

// Dev-only tools: /?lab&pose=sujud (pose tuning), /?lab&voice (microphone engine)
const PoseLab = lazy(() => import('./lab/PoseLab').then((m) => ({ default: m.PoseLab })))
// Tune screen, also on the live site: /?tune
const TuneLab = lazy(() => import('./lab/TuneLab').then((m) => ({ default: m.TuneLab })))
const tune = new URLSearchParams(location.search).has('tune')
const VoiceLab = lazy(() => import('./lab/VoiceLab').then((m) => ({ default: m.VoiceLab })))
const query = new URLSearchParams(location.search)
const lab = import.meta.env.DEV && query.has('lab')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {tune ? (
      <Suspense>
        <TuneLab />
      </Suspense>
    ) : lab ? (
      <Suspense>{query.has('voice') ? <VoiceLab /> : <PoseLab />}</Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
