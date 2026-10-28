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
  let showRecovery = $state(!!initialRecovery);
  const snapshot = $derived($client.snapshot);
  const phase = $derived(snapshot?.state.phase ?? 'lobby');
  const editable = $derived(
    phase === 'active' && remainingMilliseconds(snapshot?.state, $now, $client.offset) > 0,
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
    <a class="brand" href="/play"
      ><span class="brand-icon">e<span>↗</span></span>estymator<span class="brand-dot">.</span></a
    ><a class="quiet-link" href="/screen">Ekran konkursu ↗</a>
  </header>
  <main class="play-main">
    <div class="eyebrow">
      <span class="live-dot" class:offline={!$client.connected}></span> KONKURS NA ŻYWO
    </div>
    {#if !$client.session}
      <section class="intro">
        <div class="mini-label">MAŁA LICZBA. WIELKIE PYTANIE.</div>
        <h1>Jak blisko<br />potrafisz <em>trafić?</em></h1>
        <p>
          Nie musisz znać odpowiedzi. Wystarczy dobre wyczucie.<br />Dołącz do konkursu i sprawdź
          swoją intuicję.
        </p>
      </section>
      <section class="card join-card">
        <div class="card-heading">
          <span class="step-mark">01</span>
          <div>
            <h2>Zajmij swoje miejsce</h2>
            <p>Przedstaw się, zanim zaczniemy.</p>
          </div>
        </div>
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
                placeholder="Jan"
              /></label
            ><label
              >Nazwisko<input
                bind:value={lastName}
                autocomplete="family-name"
                maxlength="80"
                required
                placeholder="Kowalski"
              /></label
            >
          </div>
          <label
            >Pseudonim<input
              bind:value={nickname}
              autocomplete="nickname"
              maxlength="80"
              required
              placeholder="Tak zobaczą Cię inni"
            /></label
          ><button class="primary" disabled={busy}>Dołącz do konkursu <span>→</span></button>
        </form>
        <div class="divider"></div>
        <details open={!!recovery}>
          <summary>Masz już konto? Odzyskaj dostęp</summary>
          <form
            class="recovery-form"
            onsubmit={(e) => {
              e.preventDefault();
              void join(true);
            }}
          >
            <label
              >Kod odzyskiwania<input
                bind:value={recovery}
                required
                autocomplete="off"
                placeholder="Wpisz swój kod"
              /></label
            ><button disabled={busy}>Przywróć konto →</button>
          </form>
        </details>
      </section>
    {:else}
      <div class="participant-line">
        <span>Cześć, <strong>{$client.session.participant.nickname}</strong> 👋</span><button
          class="text-button"
          onclick={() => (showRecovery = !showRecovery)}>Twoje konto ↗</button
        >
      </div>
      {#if showRecovery}<aside class="notice">
          <strong>Zachowaj kod odzyskiwania</strong>
          <p>To Twój klucz do konta na innym urządzeniu. Nie udostępniaj go innym.</p>
          <code>{$client.session.recoveryCode}</code>
          <form
            class="recovery-form"
            onsubmit={(e) => {
              e.preventDefault();
              void join(true);
            }}
          >
            <label
              >Odzyskaj inne konto<input
                bind:value={recovery}
                required
                autocomplete="off"
                placeholder="Kod odzyskiwania"
              /></label
            >
            <button disabled={busy}>Przywróć konto →</button>
          </form>
        </aside>{/if}
      {#if phase === 'lobby'}
        <section class="waiting">
          <div class="orbit">≈</div>
          <div class="mini-label">JESTEŚ NA LIŚCIE</div>
          <h1>Wyczucie gotowe?<br /><em>Zaraz zaczynamy.</em></h1>
          <p>
            Prowadzący uruchomi pierwsze pytanie.<br />Ta strona zaktualizuje się automatycznie.
          </p>
          <div class="people-pill">
            <span class="live-dot"></span>{snapshot?.participantCount ?? 0} osób w konkursie
          </div>
        </section>
      {:else if phase === 'active' || phase === 'paused'}
        <section class="question-card">
          <div class="question-meta">
            <span class="mini-label"
              >PYTANIE {String((snapshot?.state.index ?? 0) + 1).padStart(2, '0')}
              <span class="muted">/ {snapshot?.totalQuestions}</span></span
            ><span class="time-label">{phase === 'paused' ? 'PRZERWA' : 'POZOSTAŁO'} <Timer /></span
            >
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
              /><span>↗</span>
            </div>
            <p class="input-help">
              Wpisz dodatnią liczbę całkowitą. Możesz zmieniać ją do końca czasu.
            </p>
            <div class="sync-status" aria-live="polite">
              <span class="live-dot" class:offline={!$client.connected || $client.pending}
              ></span>{#if $client.error}{$client.error}{:else if !$client.connected}Brak połączenia
                · oczekiwanie na synchronizację{:else if $client.pending && (!$client.text || invalidDraft)}Zapisano
                szkic lokalnie · wpisz poprawną liczbę{:else if $client.pending}Zapisano lokalnie ·
                oczekiwanie na synchronizację{:else if $client.text}Zapisano na serwerze{:else}Twoja
                odpowiedź zapisze się automatycznie{/if}
            </div>
            {#if invalidDraft}<p class="error">
                Wpisz dodatnią liczbę całkowitą. Poprzednia poprawna odpowiedź pozostaje na
                serwerze.
              </p>{/if}
            {#if !$client.text && $client.confirmed}<p class="input-help">
                Puste pole nie usuwa odpowiedzi przyjętej przez serwer. Wpisz nową dodatnią liczbę,
                aby ją zmienić.
              </p>{/if}
            {#if $client.confirmed}<p class="confirmed-answer">
                Ostatnia odpowiedź przyjęta przez serwer: <strong>{$client.confirmed}</strong>
              </p>{/if}
          </div>
        </section>
      {:else if phase === 'closing'}
        <section class="waiting">
          <div class="orbit spinning">✳</div>
          <div class="mini-label">CZAS MINĄŁ</div>
          <h1>Wszystko się<br /><em>zaraz wyjaśni.</em></h1>
          <p>Domykamy zapisy i przygotowujemy wyniki.</p>
        </section>
      {:else}
        <section class="waiting results-card">
          <div class="mini-label">
            {phase === 'finished'
              ? 'DZIĘKUJEMY ZA GRĘ'
              : `PYTANIE ${(snapshot?.state.index ?? 0) + 1} · WYNIKI`}
          </div>
          <h1>
            {phase === 'finished' ? 'To było dobre' : 'Prawidłowa'}<br /><em
              >{phase === 'finished' ? 'wyczucie.' : 'odpowiedź.'}</em
            >
          </h1>
          <div class="correct-value">{snapshot?.correct}</div>
          <p>Twoja przyjęta odpowiedź: <strong>{$client.confirmed ?? 'Brak odpowiedzi'}</strong></p>
          {#if !snapshot?.scoringConfigured}<p>
              Punktacja oczekuje na ustalenie zasad przez organizatora.
            </p>{/if}<a class="button" href="/screen">Zobacz wyniki ↗</a>
        </section>
      {/if}
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if $client.error && !['active', 'paused'].includes(phase)}
      <p class="error" role="alert">{$client.error}</p>
    {/if}
    <div class="feature-strip">
      <div>
        <span>↻</span>
        <p><strong>Bez przycisku „wyślij”</strong><small>Odpowiedzi zapisują się same</small></p>
      </div>
      <div>
        <span>⌁</span>
        <p>
          <strong>Liczy się Twój ostatni strzał</strong><small
            >Zmieniaj zdanie, dopóki jest czas</small
          >
        </p>
      </div>
    </div>
  </main>
  <footer>
    <span>ESTYMATOR <span class="footer-cross">✳</span> LICZY SIĘ WYCZUCIE</span><a href="/admin"
      >Panel prowadzącego ↗</a
    >
  </footer>
</div>
