<script lang="ts">
  import { onMount } from 'svelte';
  import { client } from '#est-client/sync';
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(timer);
  });
  const contestState = $derived($client.snapshot?.state);
  const remaining = $derived(
    contestState?.phase === 'paused'
      ? contestState.remainingMs
      : Math.max(0, (contestState?.endsAt ?? now) - now - $client.offset),
  );
  const seconds = $derived(Math.ceil(remaining / 1000));
</script>

<span
  class:urgent={seconds <= 15 && contestState?.phase === 'active'}
  class="timer"
  role="timer"
  aria-label="Pozostały czas"
>
  {String(Math.floor(seconds / 60)).padStart(2, '0')}<span class="colon">:</span>{String(
    seconds % 60,
  ).padStart(2, '0')}
</span>
