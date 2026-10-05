import { useEffect, useState } from 'react'
import { CHARACTERS } from '@/components/stage/characters'
import { CompanionStage } from '@/components/stage/CompanionStage'
import type { PoseName } from '@/components/stage/rig/prayer-poses'
import { LOCAL_KEY, TUNING, ZERO, currentTuning, tuneFor, type Tune, type Tuning } from '@/components/stage/rig/tuning'

const POSES: PoseName[] = ['qiyam', 'ruku', 'itidal', 'kneel', 'sujud', 'jalsah', 'tashahhud', 'salam-right', 'salam-left']

const SLIDERS: { key: keyof Tune; label: string; min: number; max: number; step: number }[] = [
  { key: 'sink', label: 'Lower into the rug', min: -0.02, max: 0.12, step: 0.002 },
  { key: 'handUp', label: 'Hands up', min: -0.06, max: 0.12, step: 0.002 },
  { key: 'handFwd', label: 'Hands forward', min: -0.08, max: 0.08, step: 0.002 },
]

/**
 * Tune screen (/?lab&tune): set, by eye, how far each character sits into the
 * rug and where its hands rest, per posture. Edits are kept on this device;
 * "Copy settings" puts the JSON on the clipboard to save into tuning.json.
 */
export function TuneLab() {
  const [character, setCharacter] = useState(CHARACTERS[0]!.id)
  const [pose, setPose] = useState<PoseName>('tashahhud')
  const [az, setAz] = useState(0.6)
  const [tuning, setTuning] = useState<Tuning>(() => currentTuning())
  const [copied, setCopied] = useState(false)
  const info = CHARACTERS.find((c) => c.id === character)!
  const t = tuneFor(tuning, character, pose)

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(tuning))
    } catch {
      /* no storage */
    }
  }, [tuning])

  const set = (key: keyof Tune, value: number) =>
    setTuning((all) => ({ ...all, [character]: { ...all[character], [pose]: { ...tuneFor(all, character, pose), [key]: value } } }))

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(tuning, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 bg-[#0b1418] text-white">
      <div className="absolute inset-y-0 start-0 end-[22rem]">
        <CompanionStage posture={pose} character={info} ambient="oklch(0.78 0.13 165)" azimuth={az} tuning={tuning} />
      </div>
      <aside className="absolute inset-y-0 end-0 flex w-[22rem] flex-col gap-5 overflow-y-auto border-s border-white/10 bg-black/40 p-5 text-sm">
        <h1 className="text-lg font-semibold">Tune the companions</h1>
        <div className="flex flex-wrap gap-1.5">
          {CHARACTERS.map((c) => (
            <button key={c.id} onClick={() => setCharacter(c.id)} className={`rounded-full px-3 py-1.5 ${c.id === character ? 'bg-white text-black' : 'bg-white/10'}`}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {POSES.map((p) => (
            <button key={p} onClick={() => setPose(p)} className={`rounded-md px-2.5 py-1 ${p === pose ? 'bg-white text-black' : 'bg-white/10'}`}>
              {p}
            </button>
          ))}
        </div>
        {SLIDERS.map((s) => (
          <label key={s.key} className="flex flex-col gap-1.5">
            <span className="flex justify-between text-white/80">
              {s.label}
              <span className="tabular-nums text-white/50">{t[s.key].toFixed(3)}</span>
            </span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={t[s.key]} onChange={(e) => set(s.key, Number(e.target.value))} className="accent-white" />
          </label>
        ))}
        <label className="flex flex-col gap-1.5">
          <span className="text-white/80">View angle</span>
          <input type="range" min={-1.6} max={1.6} step={0.05} value={az} onChange={(e) => setAz(Number(e.target.value))} className="accent-white" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setTuning((all) => ({ ...all, [character]: { ...all[character], [pose]: ZERO } }))} className="rounded-full bg-white/10 px-3 py-1.5">
            Reset this pose
          </button>
          <button onClick={() => setTuning(TUNING)} className="rounded-full bg-white/10 px-3 py-1.5">
            Back to saved
          </button>
        </div>
        <button onClick={copy} className="rounded-full bg-white px-4 py-2 font-semibold text-black">
          {copied ? 'Copied' : 'Copy settings'}
        </button>
        <p className="text-white/50">Changes show in the app on this device right away. Paste the copied settings to Claude to make them the default for everyone.</p>
      </aside>
    </div>
  )
}
