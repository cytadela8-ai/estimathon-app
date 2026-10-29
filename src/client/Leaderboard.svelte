<script lang="ts">
  import type { Standing } from '#est-shared/protocol';
  let {
    title,
    standings,
  }: { title: string; standings: (Standing & { answer?: string | null })[] } = $props();
  const places = $derived([
    ...new Set(standings.filter((person) => person.place <= 5).map((person) => person.place)),
  ]);
</script>

<section class="screen-leaderboard" aria-label={title}>
  <h2>{title}</h2>
  {#if standings.length}<div class="top-list">
      {#each places as place}
        {@const group = standings.filter((person) => person.place === place)}
        <div class="leader-row">
          <span class="rank">{String(place).padStart(2, '0')}</span>
          <div class="podium-names" class:many={group.length > 3}>
            <div
              class:scrolling-results={group.length > 3}
              style={`--scroll-duration:${Math.max(20, group.length * 2)}s`}
            >
              {#each group as person}<strong class:has-answer={person.answer !== undefined}>
                  <span>{person.nickname}</span>
                  {#if person.answer !== undefined}<span
                      class="leader-answer"
                      aria-label={`Odpowiedź: ${person.answer ?? 'Brak odpowiedzi'}`}
                      >{person.answer ?? 'Brak odpowiedzi'}</span
                    >{/if}
                </strong>{/each}
            </div>
          </div>
          <span
            >{group[0]!.score.toLocaleString('pl-PL')} pkt
            {#if group.length > 1}
              · {group.length} ex aequo{/if}</span
          >
        </div>
      {/each}
    </div>{:else}<p>Brak sklasyfikowanych wyników.</p>{/if}
</section>
