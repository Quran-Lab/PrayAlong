<script lang="ts">
  let { stream, mirror = true, class: cls = '' }: { stream: MediaStream | null; mirror?: boolean; class?: string } = $props()
  let video: HTMLVideoElement
  $effect(() => {
    video.srcObject = stream
  })
</script>

<video bind:this={video} autoplay muted playsinline class={cls} class:mirror></video>

<style>
  video {
    display: block;
    width: 100%;
    object-fit: cover;
    background: var(--media);
  }
  .mirror {
    transform: scaleX(-1);
  }
</style>
