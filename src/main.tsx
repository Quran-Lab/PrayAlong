import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource/amiri/400.css'
import '@fontsource/amiri/700.css'
import './index.css'
import { App } from './App'
import { PoseLab } from './lab/PoseLab'

const lab = import.meta.env.DEV && new URLSearchParams(location.search).has('lab')

createRoot(document.getElementById('root')!).render(<StrictMode>{lab ? <PoseLab /> : <App />}</StrictMode>)
