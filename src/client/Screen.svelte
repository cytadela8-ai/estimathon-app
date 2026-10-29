<script lang="ts">
  import { now } from '#est-client/clock';
  import { client } from '#est-client/sync';
  import Timer from '#est-client/Timer.svelte';
  import Leaderboard from '#est-client/Leaderboard.svelte';
  import { answerDistribution, formatAxis } from '#est-client/distribution';
  import { competitionPlaces } from '#est-shared/ranking';
  import Podium from '#est-client/Podium.svelte';
  const s = $derived($client.snapshot);
  const phase = $derived(s?.state.phase ?? 'lobby');
  const questionNumber = $derived(String((s?.state.index ?? 0) + 1).padStart(2, '0'));
  const elapsed = $derived($now + $client.offset - (s?.state.resultsAt ?? $now));
  const submitted = $derived((s?.results ?? []).filter((r) => r.answer !== null));
  const distribution = $derived(
    answerDistribution(
      submitted.map((result) => result.answer!),
      s?.correct ?? '1',
    ),
  );
  const highest = $derived(Math.max(1, ...distribution.bins));
  const ranked = $derived(s?.standings ?? []);
  const questionRanked = $derived(
    competitionPlaces(
      [...(s?.results ?? [])].sort(
        (a, b) => b.score - a.score || a.nickname.localeCompare(b.nickname, 'pl'),
      ),
    ),
  );
</script>

<div class="screen-shell">
  <header class="site-header">
    <a class="brand" href="/play"><span class="brand-mark" aria-hidden="true">≈</span>estymathon</a>
    <div class="connection-status">
      <span class="live-dot" class:offline={!$client.connected}></span>{$client.connected
        ? 'Połączono'
        : 'Ponowne łączenie'}
    </div>
  </header>
  <main class="screen-main">
    {#if phase === 'lobby'}<div class="screen-welcome">
        <h1>Dołącz do gry</h1>
        <p class="join-address">{location.host}/play</p>
        <p class="participant-count">Dołączyło: <strong>{s?.participantCount ?? 0}</strong></p>
      </div>
    {:else if phase === 'active' || phase === 'paused'}<div class="screen-question">
        <div class="mini-label">
          Pytanie {questionNumber} / {s?.totalQuestions}{phase === 'paused' ? ' · Przerwa' : ''}
        </div>
        <h1>{s?.question?.text}</h1>
        <div class="screen-timer"><Timer /></div>
        <div class="screen-bottom">
          <span
            ><strong>{s?.answerCount}</strong> / {s?.participantCount} odpowiedzi zapisanych</span
          >
        </div>
      </div>
    {:else if phase === 'closing' || phase === 'finishing'}<div class="screen-closing">
        <div class="reveal-loader" aria-hidden="true">≈</div>
        <h1>Koniec czasu</h1>
        <p>Zbieramy ostatnie odpowiedzi…</p>
      </div>
    {:else if phase === 'finished'}<div class="final-results">
        <h1>Wyniki końcowe</h1>
        <div class="final-stage" class:expanded={elapsed > 6000 && (s?.standings.length ?? 0) > 0}>
          {#if ranked.length}<Podium standings={ranked} />{:else}<div>
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
        <h1>Wyniki pytania {(s?.state.index ?? 0) + 1}</h1>
        <div class="reveal-grid">
          <section class="distribution">
            <h2>Wasze odpowiedzi <span>{submitted.length}</span></h2>
            <div class="chart">
              {#each distribution.bins as count, i}<div
                  class="chart-column"
                  class:overflow-bin={i === 0 || i === 13}
                  style={`--height:${(count / highest) * 100}%;--delay:${i * 45}ms`}
                >
                  <span>{count || ''}</span>
                  <div></div>
                </div>{/each}
              {#if elapsed > 3500}<div class="chart-center" aria-hidden="true"></div>{/if}
            </div>
            <div class="chart-labels">
              <span>← &lt; −3M</span><span>Skala logarytmiczna</span><span>&gt; +3M →</span>
            </div>
            {#if elapsed > 3500}<div class="chart-axis" aria-label="Zakres odpowiedzi">
                {#each distribution.ticks as tick}<span>{formatAxis(tick)}</span>{/each}
              </div>
              <p class="chart-scale">
                M = {distribution.scale.toLocaleString('pl-PL', {
                  maximumSignificantDigits: 3,
                })} · mediana błędu logarytmicznego (minimum 0,05)
              </p>{/if}
            {#if !submitted.length}<p>Brak przyjętych odpowiedzi.</p>{/if}
          </section>
          {#if elapsed > 3500}<section class="correct-reveal">
              <div class="mini-label">Prawidłowa odpowiedź</div>
              <div class="correct-value">{BigInt(s?.correct ?? '0').toLocaleString('pl-PL')}</div>
            </section>{/if}
        </div>
        {#if elapsed > 7000}<div class="question-leaderboards">
            <Leaderboard title="Klasyfikacja pytania" standings={questionRanked} />
            <Leaderboard title="Klasyfikacja łączna" standings={ranked} />
          </div>{/if}
      </div>{/if}
  </main>
</div>
