<script lang="ts">
  import { now } from '#est-client/clock';
  import { client } from '#est-client/sync';
  import Timer from '#est-client/Timer.svelte';
  import Podium from '#est-client/Podium.svelte';
  const s = $derived($client.snapshot);
  const phase = $derived(s?.state.phase ?? 'lobby');
  const questionNumber = $derived(String((s?.state.index ?? 0) + 1).padStart(2, '0'));
  const elapsed = $derived($now + $client.offset - (s?.state.resultsAt ?? $now));
  const submitted = $derived((s?.results ?? []).filter((r) => r.answer !== null));
  const maximum = $derived(Math.max(1, ...submitted.map((r) => Math.log10(Number(r.answer) + 1))));
  const ranked = $derived(s?.standings ?? []);
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
        <div class="final-stage" class:expanded={elapsed > 6000 && (s?.standings.length ?? 0) > 0}>
          {#if ranked.length}<Podium standings={ranked} />{:else}<div>
              <div class="orbit">✳</div>
              <p>Dziękujemy wszystkim {s?.participantCount} uczestnikom!</p>
              <p>Brak sklasyfikowanych wyników.</p>
            </div>{/if}
          {#if elapsed > 6000 && (s?.standings.length ?? 0) > 0}<div class="all-results">
              <div
                class="scrolling-results"
                style={`--scroll-duration:${Math.max(20, (s?.standings.length ?? 0) * 2)}s`}
              >
                {#each s?.standings ?? [] as person}<div class="leader-row">
                    <span>{person.place}</span><strong>{person.nickname}</strong>
                    <span>{person.score.toLocaleString('pl-PL')} pkt</span>
                  </div>{/each}
              </div>
            </div>{/if}
        </div>
      </div>
    {:else}<div class="screen-results">
        <div class="mini-label">PYTANIE {(s?.state.index ?? 0) + 1} · WYNIKI</div>
        <h1>Sprawdźmy <em>wyczucie.</em></h1>
        <p class="provisional">
          Spóźnione synchronizacje i decyzje prowadzącego aktualizują wyniki.
        </p>
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
            {#if ranked.length}<div class="top-list">
                {#each ranked.filter((person) => person.place <= 5) as person}<div
                    class="leader-row"
                  >
                    <span class="rank">{String(person.place).padStart(2, '0')}</span><strong
                      >{person.nickname}</strong
                    ><span>{person.score?.toLocaleString('pl-PL')} pkt</span>
                  </div>{/each}
              </div>{:else}<p>Brak sklasyfikowanych wyników.</p>{/if}
          </section>{/if}
      </div>{/if}
  </main>
  <footer>
    <span>LICZY SIĘ WYCZUCIE <span class="footer-cross">✳</span></span><span
      >{s?.totalQuestions ?? 0} PYTAŃ · JEDNA INTUICJA</span
    >
  </footer>
</div>
