import { mount } from 'svelte'
import '@fontsource-variable/plus-jakarta-sans'
// Arabic-script interface text (unicode-range: only downloaded when used).
import '@fontsource-variable/noto-kufi-arabic'
import './app.css'
import App from './App.svelte'

const target = document.getElementById('app')!
const lab = import.meta.env.DEV && new URLSearchParams(location.search).has('lab')

// Urdu reads in Nastaliq; load it only for Urdu readers.
if (navigator.languages.some((l) => l.startsWith('ur')) || localStorage.getItem('prayalong:session')?.includes('"locale":"ur"'))
  import('@fontsource/noto-nastaliq-urdu/400.css')

if (lab) {
  // Dev-only pose tuning tool: /?lab&pose=sujud
  import('./lab/PoseLab.svelte').then(({ default: PoseLab }) => mount(PoseLab, { target }))
} else {
  mount(App, { target })
}
