<script lang="ts">
  import { CHARACTERS, type CharacterInfo } from '@/components/stage/characters'
  import { POSE_NAMES, type PoseName } from '@/components/stage/rig/prayer-poses'
  import Stage from '@/components/stage/Stage.svelte'
  import type { PrayerId } from '@/sequence/types'

  /** Dev tool for tuning poses on any character: /?lab&pose=sujud&character=/avatars/x.glb&prayer=maghrib */
  const params = new URLSearchParams(location.search)
  let pose = $state<PoseName>((params.get('pose') as PoseName) ?? 'qiyam')
  const url = params.get('character')
  const character: CharacterInfo = url
    ? { id: 'custom', nameKey: 'companion.brother', url, credit: '', thumbnail: '' }
    : (CHARACTERS.find((c) => c.id === params.get('id')) ?? CHARACTERS[0]!)
  const prayer = (params.get('prayer') as PrayerId) ?? 'dhuhr'
</script>

<div class="lab">
  <Stage {prayer} posture={pose} {character} reducedMotion={params.has('still')} azimuth={params.has('az') ? Number(params.get('az')) : undefined} />
  <div class="poses" id="lab-status">
    {#each POSE_NAMES as p (p)}
      <button type="button" class="btn sm" aria-pressed={p === pose} onclick={() => (pose = p)}>{p}</button>
    {/each}
  </div>
</div>

<style>
  .lab {
    position: fixed;
    inset: 0;
    padding: 12px;
  }
  .poses {
    position: absolute;
    top: 24px;
    left: 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
</style>
