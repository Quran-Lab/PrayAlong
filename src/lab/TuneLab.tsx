import { useEffect, useState } from 'react'
import { CHARACTERS } from '@/components/stage/characters'
import { CompanionStage } from '@/components/stage/CompanionStage'
import type { PoseName } from '@/components/stage/rig/prayer-poses'
import { LOCAL_KEY, TUNING, ZERO, currentTuning, tuneFor, type Tune, type Tuning } from '@/components/stage/rig/tuning'

const POSES: PoseName[] = ['qiyam', 'ruku', 'itidal', 'kneel', 'sujud', 'jalsah', 'tashahhud', 'salam-right', 'salam-left']

type NumKey = 'sink' | 'handUp' | 'handFwd' | 'handIn' | 'handPitch' | 'handRoll' | 'handTurn' | 'legDrop'
const QUICK: { key: NumKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'sink', label: 'Whole body down into the rug', min: -0.02, max: 0.15, step: 0.002 },
  { key: 'legDrop', label: 'Legs down from the hips', min: 0, max: 0.2, step: 0.002 },
  { key: 'handUp', label: 'Hands up', min: -0.08, max: 0.15, step: 0.002 },
  { key: 'handFwd', label: 'Hands forward', min: -0.1, max: 0.1, step: 0.002 },
  { key: 'handIn', label: 'Hands inward / outward', min: -0.08, max: 0.08, step: 0.002 },
  { key: 'handPitch', label: 'Hand tilt: fingers up / down (°)', min: -90, max: 90, step: 1 },
  { key: 'handRoll', label: 'Hand roll: thumb up / down (°)', min: -90, max: 90, step: 1 },
  { key: 'handTurn', label: 'Hand turn: fingers in / out (°)', min: -90, max: 90, step: 1 },
]

/** Bones you can bend, grouped; "both" applies to left and right together (mirrored). */
const GROUPS: { title: string; bones: { id: string; label: string; pair?: [string, string] }[] }[] = [
  {
    title: 'Legs',
    bones: [
      { id: 'thighs', label: 'Thighs (both)', pair: ['leftUpperLeg', 'rightUpperLeg'] },
      { id: 'shins', label: 'Shins / knees (both)', pair: ['leftLowerLeg', 'rightLowerLeg'] },
      { id: 'feet', label: 'Feet (both)', pair: ['leftFoot', 'rightFoot'] },
      { id: 'toes', label: 'Toes (both)', pair: ['leftToes', 'rightToes'] },
      { id: 'leftUpperLeg', label: 'Left thigh' },
      { id: 'rightUpperLeg', label: 'Right thigh' },
      { id: 'leftLowerLeg', label: 'Left shin' },
      { id: 'rightLowerLeg', label: 'Right shin' },
      { id: 'leftFoot', label: 'Left foot' },
      { id: 'rightFoot', label: 'Right foot' },
      { id: 'leftToes', label: 'Left toes' },
      { id: 'rightToes', label: 'Right toes' },
    ],
  },
  {
    title: 'Body',
    bones: [
      { id: 'hips', label: 'Hips (whole body lean)' },
      { id: 'spine', label: 'Lower back' },
      { id: 'chest', label: 'Chest' },
      { id: 'upperChest', label: 'Upper chest' },
      { id: 'neck', label: 'Neck' },
      { id: 'head', label: 'Head' },
    ],
  },
  {
    title: 'Arms',
    bones: [
      { id: 'shoulders', label: 'Shoulders (both)', pair: ['leftShoulder', 'rightShoulder'] },
      { id: 'leftShoulder', label: 'Left shoulder' },
      { id: 'rightShoulder', label: 'Right shoulder' },
    ],
  },
]
const ALL = GROUPS.flatMap((g) => g.bones)

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex justify-between text-white/80">
        {label}
        <span className="tabular-nums text-white/50">{step >= 1 ? value.toFixed(0) : value.toFixed(3)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-white" />
    </label>
  )
}

/**
 * Tune screen (/?tune): set, by eye, how each character sits in each posture:
 * sink it into the rug, drop the legs, move the hands, move the body and bend
 * any bone. Edits are kept on this device; "Copy settings" puts the JSON on
 * the clipboard to save into tuning.json.
 */
export function TuneLab() {
  const [character, setCharacter] = useState(CHARACTERS[0]!.id)
  const [pose, setPose] = useState<PoseName>('tashahhud')
  const [az, setAz] = useState(1.2)
  const [bone, setBone] = useState('thighs')
  const [tuning, setTuning] = useState<Tuning>(() => currentTuning())
  const [copied, setCopied] = useState(false)
  const info = CHARACTERS.find((c) => c.id === character)!
  const t = tuneFor(tuning, character, pose)
  const sel = ALL.find((b) => b.id === bone)!

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(tuning))
    } catch {
      /* no storage */
    }
  }, [tuning])

  const patch = (fn: (cur: Tune) => Partial<Tune>) =>
    setTuning((all) => {
      const cur = tuneFor(all, character, pose)
      return { ...all, [character]: { ...all[character], [pose]: { ...cur, ...fn(cur) } } }
    })

  // "Both" writes the left bone as is and the right one mirrored (twist and tilt flipped).
  const bv: [number, number, number] = t.bones[sel.pair ? sel.pair[0] : sel.id] ?? [0, 0, 0]
  const setAxis = (axis: 0 | 1 | 2, value: number) =>
    patch((cur) => {
      const bones = { ...cur.bones }
      const write = (id: string, mirror: boolean) => {
        const v = [...(bones[id] ?? [0, 0, 0])] as [number, number, number]
        v[axis] = mirror && axis > 0 ? -value : value
        bones[id] = v
      }
      if (sel.pair) {
        write(sel.pair[0], false)
        write(sel.pair[1], true)
      } else write(sel.id, false)
      return { bones }
    })
  const setMove = (axis: 0 | 1 | 2, value: number) =>
    patch((cur) => {
      const move = [...cur.move] as [number, number, number]
      move[axis] = value
      return { move }
    })

  const copy = async () => {
    await navigator.clipboard.writeText(JSON.stringify(tuning, null, 2))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fixed inset-0 bg-[#0b1418] text-white">
      <div className="absolute inset-y-0 start-0 end-[24rem]">
        <CompanionStage posture={pose} character={info} ambient="oklch(0.78 0.13 165)" azimuth={az} tuning={tuning} />
      </div>
      <aside className="absolute inset-y-0 end-0 flex w-[24rem] flex-col gap-4 overflow-y-auto border-s border-white/10 bg-black/40 p-5 text-sm">
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
        <Slider label="View angle" value={az} min={-1.6} max={1.6} step={0.05} onChange={setAz} />

        <section className="flex flex-col gap-3 rounded-xl bg-white/5 p-3">
          <h2 className="font-semibold">Quick</h2>
          {QUICK.map((s) => (
            <Slider key={s.key} label={s.label} value={t[s.key]} min={s.min} max={s.max} step={s.step} onChange={(v) => patch(() => ({ [s.key]: v }))} />
          ))}
        </section>

        <section className="flex flex-col gap-3 rounded-xl bg-white/5 p-3">
          <h2 className="font-semibold">Bend a bone</h2>
          <select value={bone} onChange={(e) => setBone(e.target.value)} className="rounded-md bg-white/10 px-2 py-1.5">
            {GROUPS.map((g) => (
              <optgroup key={g.title} label={g.title} className="text-black">
                {g.bones.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Slider label="Bend forward / back (X, °)" value={bv[0]} min={-90} max={90} step={1} onChange={(v) => setAxis(0, v)} />
          <Slider label="Twist (Y, °)" value={bv[1]} min={-90} max={90} step={1} onChange={(v) => setAxis(1, v)} />
          <Slider label="Tilt sideways (Z, °)" value={bv[2]} min={-90} max={90} step={1} onChange={(v) => setAxis(2, v)} />
        </section>

        <section className="flex flex-col gap-3 rounded-xl bg-white/5 p-3">
          <h2 className="font-semibold">Move the whole body</h2>
          <Slider label="Sideways" value={t.move[0]} min={-0.15} max={0.15} step={0.002} onChange={(v) => setMove(0, v)} />
          <Slider label="Up / down" value={t.move[1]} min={-0.15} max={0.15} step={0.002} onChange={(v) => setMove(1, v)} />
          <Slider label="Forward / back" value={t.move[2]} min={-0.15} max={0.15} step={0.002} onChange={(v) => setMove(2, v)} />
        </section>

        <div className="flex flex-wrap gap-2">
          <button onClick={() => patch(() => ZERO)} className="rounded-full bg-white/10 px-3 py-1.5">
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
