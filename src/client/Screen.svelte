<script lang="ts">
  import { onMount } from 'svelte';
  import { client } from '#est-client/sync';
  import Timer from '#est-client/Timer.svelte';
  let now = $state(Date.now());
  onMount(() => {
    const t = setInterval(() => (now = Date.now()), 100);
    return () => clearInterval(t);
  });
  const s = $derived($client.snapshot);
  const phase = $derived(s?.state.phase ?? 'lobby');
  const questionNumber = $derived(String((s?.state.index ?? 0) + 1).padStart(2, '0'));
  const elapsed = $derived(now + $client.offset - (s?.state.resultsAt ?? now));
  const submitted = $derived((s?.results ?? []).filter((r) => r.answer !== null));
  const maximum = $derived(Math.max(1, ...submitted.map((r) => Math.log10(Number(r.answer) + 1))));
  const ranked = $derived((s?.standings ?? []).filter((r) => r.score !== null));
  const bins = $derived(
    Array.from(
      { length: 20 },
      (_, i) =>
        submitted.filter(
          (r) => Math.min(19, Math.floor((Math.log10(Number(r.answer) + 1) / maximum) * 20)) === i,
        ).length,
    ),
  );
  const highest = $derived(Math.max(1, ...bins));
</script>

<div class="screen-shell">
  <header class="site-header">
    <a class="brand" href="/play"
      ><span class="brand-icon">e<span>↗</span></span>estymator<span class="brand-dot">.</span></a
    >
    <div class="eyebrow">
      <span class="live-dot" class:offline={!$client.connected}></span>{$client.connected
        ? 'NA ŻYWO'
        : 'PONOWNE ŁĄCZENIE'}
    </div>
  </header>
  <main class="screen-main">
    {#if phase === 'lobby'}<div class="screen-welcome">
        <div class="mini-label">KONKURS ESTYMACJI</div>
        <h1>Nie wiesz?<br /><em>Oszacuj.</em></h1>
        <p>Wejdź na <strong>{location.host}/play</strong> i dołącz do gry.</p>
        <div class="people-pill">{s?.participantCount ?? 0} osób gotowych na wyzwanie</div>
        <div class="decorative-number">≈</div>
      </div>
    {:else if phase === 'active' || phase === 'paused'}<div class="screen-question">
        <div class="mini-label">
          PYTANIE {questionNumber} / {s?.totalQuestions}{phase === 'paused' ? ' · PRZERWA' : ''}
        </div>
        <h1>{s?.question?.text}</h1>
        <div class="screen-timer"><Timer /></div>
        <div class="screen-bottom">
          <span
            ><strong>{s?.answerCount}</strong> / {s?.participantCount} odpowiedzi zapisanych</span
          ><span>Jak blisko potrafisz trafić? ↗</span>
        </div>
      </div>
    {:else if phase === 'closing'}<div class="screen-closing">
        <div class="orbit spinning">✳</div>
        <div class="mini-label">KONIEC CZASU</div>
        <h1>Chwila prawdy<br /><em>już za moment.</em></h1>
        <p>Synchronizujemy ostatnie odpowiedzi<span class="loading-dots">...</span></p>
      </div>
    {:else if phase === 'finished'}<div class="final-results">
        <div class="mini-label">WIELKI FINAŁ · ESTYMATOR</div>
        <h1>Najlepsze <em>wyczucie.</em></h1>
        {#if ranked.length}<div class="podium">
            {#each [1, 0, 2] as index}{@const person = ranked[index]}{#if person}<div
                  class="podium-person"
                  class:winner={index === 0}
                  style={`--place:${index}`}
                >
                  <span class="medal">{index === 0 ? '✳' : '↗'}</span>
                  <h2>{person.nickname}</h2>
                  <p>{person.score?.toLocaleString('pl-PL')} pkt</p>
                  <div class="podium-block">{index + 1}</div>
                </div>{/if}{/each}
          </div>
          {#if elapsed > 6000}<div class="all-results">
              <div class="scrolling-results">
                {#each ranked as person, i}<div class="leader-row">
                    <span>{i + 1}</span><strong>{person.nickname}</strong><span
                      >{person.score?.toLocaleString('pl-PL')} pkt</span
                    >
                  </div>{/each}
              </div>
            </div>{/if}{:else}<div class="orbit">✳</div>
          <p>Dziękujemy wszystkim {s?.participantCount} uczestnikom!</p>
          <p>Punktacja oczekuje na ustalenie zasad organizatora.</p>{/if}
      </div>
    {:else}<div class="screen-results">
        <div class="mini-label">PYTANIE {(s?.state.index ?? 0) + 1} · WYNIKI</div>
        <h1>Sprawdźmy <em>wyczucie.</em></h1>
        <div class="reveal-grid">
          <section class="distribution">
            <h2>Wasze odpowiedzi <span>{submitted.length} estymacji</span></h2>
            <div class="chart">
              {#each bins as count, i}<div
                  class="chart-column"
                  style={`--height:${(count / highest) * 100}%;--delay:${i * 45}ms`}
                >
                  <span>{count || ''}</span>
                  <div></div>
                </div>{/each}
            </div>
            <div class="chart-labels">
              <span>1</span><span>Skala logarytmiczna</span><span
                >{Math.max(1, ...submitted.map((r) => Number(r.answer))).toLocaleString(
                  'pl-PL',
                )}</span
              >
            </div>
            {#if !submitted.length}<p>Brak przyjętych odpowiedzi.</p>{/if}
          </section>
          {#if elapsed > 3500}<section class="correct-reveal">
              <div class="mini-label">PRAWIDŁOWA ODPOWIEDŹ</div>
              <div class="correct-value">{BigInt(s?.correct ?? '0').toLocaleString('pl-PL')}</div>
              <span>Teraz już wiemy. ↗</span>
            </section>{/if}
        </div>
        {#if elapsed > 7000}<section class="screen-leaderboard">
            <h2>Czołówka konkursu <span>Klasyfikacja łączna</span></h2>
            {#if s?.scoringConfigured}<div class="top-list">
                {#each ranked.slice(0, 5) as person, i}<div class="leader-row">
                    <span class="rank">{String(i + 1).padStart(2, '0')}</span><strong
                      >{person.nickname}</strong
                    ><span>{person.score?.toLocaleString('pl-PL')} pkt</span>
                  </div>{/each}
              </div>{:else}<p>Punktacja oczekuje na ustalenie zasad przez organizatora.</p>{/if}
          </section>{/if}
      </div>{/if}
  </main>
  <footer>
    <span>LICZY SIĘ WYCZUCIE <span class="footer-cross">✳</span></span><span
      >{s?.totalQuestions ?? 0} PYTAŃ · JEDNA INTUICJA</span
    >
  </footer>
</div>
