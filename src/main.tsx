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
// Hands-free evaluation (docs/hands-free.md): /?lab&synth renders synthetic webcam
// clips, /?lab&perceive runs the vision engines on them, /?lab&record records real ones.
const SynthLab = lazy(() => import('./lab/SynthLab').then((m) => ({ default: m.SynthLab })))
const PerceiveLab = lazy(() => import('./lab/PerceiveLab').then((m) => ({ default: m.PerceiveLab })))
const RecordLab = lazy(() => import('./lab/RecordLab').then((m) => ({ default: m.RecordLab })))
const query = new URLSearchParams(location.search)
// Recording and replay (for the evaluation set) also work in production builds.
const lab = query.has('lab') && (import.meta.env.DEV || query.has('record') || query.has('perceive'))
const LabPage = query.has('voice') ? VoiceLab : query.has('synth') ? SynthLab : query.has('perceive') ? PerceiveLab : query.has('record') ? RecordLab : PoseLab

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {tune ? (
      <Suspense>
        <TuneLab />
      </Suspense>
    ) : lab ? (
      <Suspense>
        <LabPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)
