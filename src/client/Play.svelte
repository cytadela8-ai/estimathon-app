<script lang="ts">
  import { now, remainingMilliseconds } from '#est-client/clock';
  import { client, edit, api, setSession } from '#est-client/sync';
  import { isPositiveInteger } from '#est-shared/protocol';
  import type { Session } from '#est-shared/protocol';
  import Timer from '#est-client/Timer.svelte';
  let firstName = $state('');
  let lastName = $state('');
  let nickname = $state('');
  const initialRecovery = new URLSearchParams(location.hash.slice(1)).get('recover') ?? '';
  let recovery = $state(initialRecovery);
  if (location.hash) history.replaceState(null, '', '/play');
  let error = $state('');
  let busy = $state(false);
  const snapshot = $derived($client.snapshot);
  const phase = $derived(snapshot?.state.phase ?? 'lobby');
  const editable = $derived(
    phase === 'active' && remainingMilliseconds(snapshot?.state, $now, $client.offset) > 0,
  );
  const ownResult = $derived(
    snapshot?.results.find((r) => r.participantId === $client.session?.participant.id),
  );
  const standing = $derived(
    snapshot?.standings.find((r) => r.participantId === $client.session?.participant.id),
  );
  const invalidDraft = $derived(!!$client.text && !isPositiveInteger($client.text));
  async function join(recover = false) {
    busy = true;
    error = '';
    try {
      setSession(
        await api<Session>(
          recover ? '/api/recover' : '/api/session',
          recover ? { code: recovery } : { firstName, lastName, nickname },
        ),
      );
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="play-shell">
  <header class="site-header">
    <span class="brand">estymator<span class="brand-dot">.</span></span>
    {#if $client.session}<details class="account" open={!!initialRecovery}>
        <summary>{$client.session.participant.nickname} · Konto</summary>
        <aside class="card account-panel">
          <strong>Kod odzyskiwania</strong>
          <p>Zachowaj go na wypadek zmiany urządzenia.</p>
          <code>{$client.session.recoveryCode}</code>
          <form
            class="recovery-form"
            onsubmit={(e) => {
              e.preventDefault();
              void join(true);
            }}
          >
            <label>Odzyskaj konto<input bind:value={recovery} required autocomplete="off" /></label>
            <button disabled={busy}>Przywróć konto</button>
          </form>
        </aside>
      </details>{/if}
  </header>
  <main class="play-main">
    {#if !$client.session}
      <section class="card join-card">
        <h1>Dołącz do <em>gry.</em></h1>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void join();
          }}
        >
          <div class="name-fields">
            <label
              >Imię<input
                bind:value={firstName}
                autocomplete="given-name"
                maxlength="80"
                required
              /></label
            >
            <label
              >Nazwisko<input
                bind:value={lastName}
                autocomplete="family-name"
                maxlength="80"
                required
              /></label
            >
          </div>
          <label
            >Pseudonim<input
              bind:value={nickname}
              autocomplete="nickname"
              maxlength="80"
              required
            /></label
          >
          <button class="primary" disabled={busy}>Dołącz do konkursu</button>
        </form>
        <details open={!!recovery}>
          <summary>Masz konto? Odzyskaj dostęp</summary>
          <form
            class="recovery-form"
            onsubmit={(e) => {
              e.preventDefault();
              void join(true);
            }}
          >
            <label
              >Kod odzyskiwania<input bind:value={recovery} required autocomplete="off" /></label
            >
            <button disabled={busy}>Przywróć konto</button>
          </form>
        </details>
      </section>
    {:else if phase === 'lobby'}
      <section class="waiting">
        <h1>Za chwilę <em>zaczynamy.</em></h1>
        <p>Poczekaj na pierwsze pytanie. Strona zaktualizuje się automatycznie.</p>
      </section>
    {:else if phase === 'active' || phase === 'paused'}
      <section class="question-card">
        <div class="question-meta">
          <span class="mini-label"
            >PYTANIE
            {(snapshot?.state.index ?? 0) + 1} / {snapshot?.totalQuestions}</span
          >
          <span class="time-label">{phase === 'paused' ? 'PRZERWA' : 'POZOSTAŁO'} <Timer /></span>
        </div>
        <h1 class="question-text">{snapshot?.question?.text}</h1>
        <div class="answer-area">
          <label for="estimate">Twoja estymacja</label>
          <div class="number-field">
            <input
              id="estimate"
              value={$client.text}
              oninput={(e) => edit(e.currentTarget.value)}
              inputmode="numeric"
              autocomplete="off"
              spellcheck="false"
              maxlength="100"
              disabled={!editable}
              placeholder="Wpisz liczbę"
            />
          </div>
          <div class="sync-status" aria-live="polite">
            <span class="live-dot" class:offline={!$client.connected || $client.pending}></span>
            {#if $client.error}{$client.error}
            {:else if !$client.connected}Brak połączenia · zapis lokalny, oczekiwanie na
              synchronizację
            {:else if $client.pending && (!$client.text || invalidDraft)}Zapisano szkic lokalnie ·
              wpisz poprawną liczbę
            {:else if $client.pending}Zapisano lokalnie · oczekiwanie na synchronizację
            {:else if $client.text}Zapisano na serwerze
            {:else}Odpowiedź zapisze się automatycznie{/if}
          </div>
          {#if invalidDraft}<p class="error">Wpisz dodatnią liczbę całkowitą.</p>{/if}
          {#if $client.confirmed}<p class="confirmed-answer">
              Na serwerze: <strong>{$client.confirmed}</strong>
            </p>{/if}
          {#if !$client.text && $client.confirmed}<p class="input-help">
              Puste pole nie usuwa zapisanej odpowiedzi.
            </p>{/if}
        </div>
      </section>
    {:else if phase === 'closing'}
      <section class="waiting">
        <div class="orbit spinning">✳</div>
        <h1>Chwila <em>prawdy.</em></h1>
        <p>Synchronizujemy odpowiedzi i przygotowujemy wyniki.</p>
      </section>
    {:else}
      <section class="waiting results-card">
        <h1>
          {phase === 'finished' ? 'Dziękujemy za' : 'Prawidłowa'}
          <em>{phase === 'finished' ? 'grę.' : 'odpowiedź.'}</em>
        </h1>
        {#if phase === 'results'}<div class="correct-value">{snapshot?.correct}</div>
          <p>Twoja odpowiedź: <strong>{$client.confirmed ?? 'Brak odpowiedzi'}</strong></p>
          <p>Punkty za pytanie: <strong>{ownResult?.score ?? 0} / 1000</strong></p>
          <p>Poczekaj na kolejne pytanie.</p>
        {/if}
        <p>
          Łącznie: <strong>{standing?.score ?? 0} pkt</strong>
          {#if standing}
            · Miejsce: <strong>{standing.place}</strong>{/if}
        </p>
        <small>Wyniki aktualizują się po synchronizacji odpowiedzi.</small>
      </section>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if $client.error && !['active', 'paused'].includes(phase)}<p class="error" role="alert">
        {$client.error}
      </p>{/if}
  </main>
</div>
