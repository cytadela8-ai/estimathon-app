<script lang="ts">
  import { now, remainingMilliseconds } from '#est-client/clock';
  import { client, edit, api, setSession, clearBrowserData } from '#est-client/sync';
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
  let wipeRequested = $state(false);
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
    <span class="brand"><span class="brand-mark" aria-hidden="true">≈</span>estymathon</span>
    {#if $client.session}<details class="account" open={!!initialRecovery}>
        <summary>{$client.session.participant.nickname}</summary>
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
          {#if wipeRequested}<form
              class="wipe-confirmation"
              aria-label="Wyczyść dane przeglądarki"
              onsubmit={(event) => {
                event.preventDefault();
                try {
                  clearBrowserData();
                } catch (cause) {
                  error = (cause as Error).message;
                }
              }}
            >
              <strong>Wyczyścić dane i wylogować?</strong>
              <p>
                Usuniemy dane tej aplikacji z przeglądarki, w tym niewysłane odpowiedzi. Zapisane na
                serwerze odpowiedzi pozostaną. Zachowaj kod odzyskiwania, aby wrócić do konta.
              </p>
              <div class="actions">
                <button class="danger">Potwierdź usunięcie danych</button>
                <button type="button" onclick={() => (wipeRequested = false)}>Anuluj</button>
              </div>
            </form>{:else}<button class="text-button" onclick={() => (wipeRequested = true)}
              >Wyczyść dane i wyloguj</button
            >{/if}
        </aside>
      </details>{/if}
  </header>
  <main class="play-main">
    {#if !$client.session}
      <section class="card join-card">
        <h1>Dołącz do gry</h1>
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
        <h1>Czekamy na start</h1>
        <p>Pierwsze pytanie włączy prowadzący.</p>
      </section>
    {:else if phase === 'active' || phase === 'paused'}
      <section class="question-card">
        <div class="question-meta">
          <span class="mini-label"
            >Pytanie
            {(snapshot?.state.index ?? 0) + 1} / {snapshot?.totalQuestions}</span
          >
          <span class="time-label">{phase === 'paused' ? 'Przerwa' : ''} <Timer /></span>
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
            {:else if !$client.connected}Brak połączenia. Zapisano lokalnie.
            {:else if $client.pending && (!$client.text || invalidDraft)}Szkic zapisany lokalnie.
              Wpisz liczbę.
            {:else if $client.pending}Zapisano lokalnie. Synchronizacja…
            {:else if $client.text}Zapisano na serwerze
            {:else}Zapis automatyczny{/if}
          </div>
          {#if invalidDraft}<p class="error">Wpisz dodatnią liczbę całkowitą.</p>{/if}
          {#if $client.confirmed && ($client.pending || $client.confirmed !== $client.text)}<p
              class="confirmed-answer"
            >
              Na serwerze: <strong>{$client.confirmed}</strong>
            </p>{/if}
          {#if !$client.text && $client.confirmed}<p class="input-help">
              Puste pole nie usuwa zapisanej odpowiedzi.
            </p>{/if}
        </div>
      </section>
    {:else if phase === 'closing' || phase === 'finishing'}
      <section class="waiting">
        <div class="reveal-loader" aria-hidden="true">≈</div>
        <h1>Koniec czasu</h1>
        <p>Zbieramy ostatnie odpowiedzi…</p>
      </section>
    {:else}
      <section class="waiting results-card">
        <h1>{phase === 'finished' ? 'Wyniki końcowe' : 'Prawidłowa odpowiedź'}</h1>
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
      </section>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if $client.error && !['active', 'paused'].includes(phase)}<p class="error" role="alert">
        {$client.error}
      </p>{/if}
  </main>
</div>
