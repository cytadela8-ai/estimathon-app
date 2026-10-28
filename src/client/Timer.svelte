<script lang="ts">
  import { now, remainingMilliseconds } from '#est-client/clock';
  import { client } from '#est-client/sync';
  const contestState = $derived($client.snapshot?.state);
  const remaining = $derived(remainingMilliseconds(contestState, $now, $client.offset));
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
