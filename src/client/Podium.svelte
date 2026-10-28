<script lang="ts">
  import type { Standing } from '#est-shared/protocol';
  let { standings }: { standings: Standing[] } = $props();
</script>

<div class="podium">
  {#each [2, 1, 3] as place}
    {@const group = standings.filter((person) => person.place === place)}
    {#if group.length}<div
        class="podium-person"
        class:winner={place === 1}
        data-place={place}
        style={`--place:${place - 1}`}
      >
        <span class="medal">{place === 1 ? '✳' : '↗'}</span>
        <div class="podium-names" class:many={group.length > 3}>
          <div
            class:scrolling-results={group.length > 3}
            style={`--scroll-duration:${Math.max(20, group.length * 2)}s`}
          >
            {#each group as person}<h2>{person.nickname}</h2>{/each}
          </div>
        </div>
        <p>
          {group[0]!.score.toLocaleString('pl-PL')} pkt
          {#if group.length > 1}
            · {group.length} ex aequo{/if}
        </p>
        <div class="podium-block">{place}</div>
      </div>{/if}
  {/each}
</div>
