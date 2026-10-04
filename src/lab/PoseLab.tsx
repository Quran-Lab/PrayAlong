import { useState } from 'react'
import { CHARACTERS, type CharacterInfo } from '@/components/stage/characters'
import { CompanionStage } from '@/components/stage/CompanionStage'
import { PRAYER_POSES, type PoseName } from '@/components/stage/rig/prayer-poses'

/**
 * Dev tool for tuning poses on any character: /?lab&pose=sujud&character=/avatars/x.glb
 */
export function PoseLab() {
  const params = new URLSearchParams(location.search)
  const [pose, setPose] = useState<PoseName>((params.get('pose') as PoseName) ?? 'qiyam')
  const url = params.get('character')
  const character: CharacterInfo = url ? { id: 'custom', name: 'Custom', url, credit: '' } : CHARACTERS[0]!
  const [status, setStatus] = useState('loading')

  return (
    <div className="fixed inset-0 bg-[#0a0d0c] text-white">
      <CompanionStage
        posture={pose}
        character={character}
        ambient="oklch(0.78 0.13 165)"
        reducedMotion={params.has('still')}
        azimuth={params.has('az') ? Number(params.get('az')) : undefined}
        onLoaded={() => setStatus('ready')}
        onError={(e) => setStatus(`error: ${e.message}`)}
      />
      <div className="absolute top-3 left-3 flex flex-wrap gap-1.5 text-xs" data-status={status} id="lab-status">
        {(Object.keys(PRAYER_POSES) as PoseName[]).map((p) => (
          <button
            key={p}
            onClick={() => setPose(p)}
            className={`rounded-md px-2 py-1 ${p === pose ? 'bg-white text-black' : 'bg-white/10'}`}
          >
            {p}
          </button>
        ))}
        <span className="px-2 py-1 text-white/50">{status}</span>
      </div>
    </div>
  )
}
