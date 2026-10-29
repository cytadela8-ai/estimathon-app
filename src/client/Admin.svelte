<script lang="ts">
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import { api, client } from '#est-client/sync';
  import Timer from '#est-client/Timer.svelte';
  import Results from '#est-client/Results.svelte';
  import type { Config, Question, Participant, Answer, Command } from '#est-shared/protocol';
  interface Overview {
    config: Config;
    questions: Question[];
    participants: (Participant & { recoveryCode: string; connections: number })[];
    answers: Answer[];
  }
  let token = $state(sessionStorage.getItem('estymator.admin') ?? '');
  let password = $state('');
  let error = $state('');
  let notice = $state('');
  let overview = $state<Overview | null>(null);
  let config = $state<Config | null>(null);
  let questions = $state<Question[]>([]);
  let busy = $state(false);
  let tab = $state('contest');
  let qr = $state('');
  let qrName = $state('');
  const phase = $derived($client.snapshot?.state.phase ?? 'lobby');
  const sections = [
    ['contest', 'Przebieg konkursu'],
    ['questions', 'Pytania i ustawienia'],
    ['people', 'Uczestnicy'],
    ['answers', 'Odpowiedzi'],
    ['results', 'Wyniki i monitoring'],
  ];
  const labels: Record<string, string> = {
    lobby: 'Oczekiwanie',
    active: 'Pytanie trwa',
    paused: 'Wstrzymano',
    closing: 'Zamykanie odpowiedzi',
    results: 'Wyniki pytania',
    finished: 'Konkurs zakończony',
  };
  function isUnauthorized(error: unknown): boolean {
    return error instanceof Error && 'status' in error && error.status === 401;
  }
  async function load(initial = false) {
    if (!token) return;
    try {
      overview = await api<Overview>('/api/admin/overview', undefined, token, 'GET');
      if (initial || !config) {
        config = { ...overview.config };
        questions = overview.questions.map((question) => ({ ...question }));
      }
    } catch (e) {
      if (isUnauthorized(e)) {
        token = '';
        sessionStorage.removeItem('estymator.admin');
      }
      error = (e as Error).message;
    }
  }
  onMount(() => {
    void load(true);
    const t = setInterval(() => void load(), 2500);
    return () => clearInterval(t);
  });
  async function login() {
    try {
      const result = await api<{ token: string }>('/api/login', { password });
      token = result.token;
      sessionStorage.setItem('estymator.admin', token);
      password = '';
      error = '';
      await load(true);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  async function command(command: Command) {
    busy = true;
    error = '';
    notice = '';
    try {
      await api('/api/admin/command', { command }, token);
      await load();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function save() {
    busy = true;
    error = '';
    try {
      await api('/api/admin/config', { config, questions }, token, 'PUT');
      notice = 'Konfiguracja została zapisana.';
      await load(true);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  async function showQR(person: Participant & { recoveryCode: string }) {
    qrName = person.nickname;
    qr = await QRCode.toDataURL(`${location.origin}/play#recover=${person.recoveryCode}`, {
      width: 280,
      margin: 2,
    });
  }
  async function importQuestions(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error('Plik musi zawierać tablicę pytań.');
      questions = data.map((q) => {
        if (!q || typeof q.correct !== 'string' || typeof q.text !== 'string') {
          throw new Error('Każde pytanie wymaga tekstowych pól text i correct.');
        }
        return {
          id: '',
          text: q.text,
          correct: q.correct,
          seconds: q.seconds ?? config?.durationSeconds ?? 180,
        };
      });
      notice = 'Wczytano pytania. Zapisz konfigurację, aby je zatwierdzić.';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  function exportQuestions() {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(questions, null, 2)], { type: 'application/json' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'estymator-pytania.json';
    link.click();
    URL.revokeObjectURL(url);
  }
  async function logout() {
    try {
      await api('/api/admin/logout', {}, token);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      sessionStorage.removeItem('estymator.admin');
      token = '';
      overview = null;
    }
  }
</script>

<div class="admin-shell">
  <header class="site-header">
    <a class="brand" href="/play"><span class="brand-mark" aria-hidden="true">≈</span>estymator</a>
    <div class="header-links">
      <a href="/screen" target="_blank" rel="noreferrer">Ekran projektora</a>{#if token}<button
          class="text-button"
          onclick={logout}>Wyloguj</button
        >{/if}
    </div>
  </header>
  <main class="admin-main">
    <h1>Panel prowadzącego</h1>
    {#if !token}<section class="card login-card">
        <h2>Zaloguj się</h2>
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void login();
          }}
        >
          <label
            >Hasło prowadzącego<input
              type="password"
              bind:value={password}
              autocomplete="current-password"
              required
            /></label
          ><button class="primary">Zaloguj się</button>
        </form>
      </section>
    {:else}
      <div class="admin-stats">
        <div><small>Konkurs</small><strong>{labels[phase]}</strong></div>
        <div>
          <small>Uczestnicy</small><strong
            >{overview?.participants.length ?? 0}<span>
              / {overview?.participants.filter((p) => p.connections > 0).length ?? 0} online</span
            ></strong
          >
        </div>
        <div>
          <small>Odpowiedzi</small><strong
            >{$client.snapshot?.answerCount ?? 0}<span> w tym pytaniu</span></strong
          >
        </div>
        <div><small>Pozostały czas</small><Timer /></div>
      </div>
      <nav class="tabs" aria-label="Sekcje panelu">
        {#each sections as item}<button
            class:chosen={tab === item[0]}
            onclick={() => (tab = item[0]!)}>{item[1]}</button
          >{/each}
      </nav>
      {#if tab === 'contest'}<section class="card control-card">
          <div class="mini-label">
            Pytanie {Math.max(0, ($client.snapshot?.state.index ?? -1) + 1)} / {$client.snapshot
              ?.totalQuestions ?? 0}
          </div>
          <h2>{$client.snapshot?.question?.text ?? 'Konkurs nie rozpoczął się'}</h2>
          {#if phase === 'lobby' && !questions.length}<p>Dodaj pytania w ustawieniach.</p>{/if}
          <div class="actions">
            <button
              class="primary"
              disabled={busy || phase !== 'lobby' || !questions.length}
              onclick={() => command('start')}>Rozpocznij konkurs</button
            ><button disabled={busy || phase !== 'active'} onclick={() => command('pause')}
              >Wstrzymaj</button
            ><button disabled={busy || phase !== 'paused'} onclick={() => command('resume')}
              >Wznów</button
            ><button
              disabled={busy || !['active', 'paused'].includes(phase)}
              onclick={() => command('extend')}>+30 sekund</button
            ><button
              disabled={busy || !['active', 'paused', 'results'].includes(phase)}
              onclick={() => command('next')}
              >{phase === 'results' ? 'Następne pytanie' : 'Zamknij pytanie'}</button
            ><button
              class="danger"
              disabled={busy || phase !== 'results'}
              onclick={() => command('finish')}>Zakończ konkurs</button
            >
          </div>
        </section>
      {:else if tab === 'questions' && config}<section class="card">
          <h2>Ustawienia konkursu</h2>
          <fieldset disabled={phase !== 'lobby' || busy}>
            <div class="config-grid">
              <label
                >Domyślny czas pytania (sekundy)<input
                  type="number"
                  min="1"
                  max="86400"
                  bind:value={config.durationSeconds}
                /></label
              ><label
                >Największa dozwolona liczba<input
                  bind:value={config.maxAnswer}
                  inputmode="numeric"
                /></label
              ><label
                >Oczekiwanie przed ujawnieniem wyników (sekundy)<input
                  type="number"
                  min="1"
                  max="60"
                  bind:value={config.revealDelaySeconds}
                /></label
              >
            </div>
            <p class="input-help">
              Kolejne pytania włączasz ręcznie. Spóźnione odpowiedzi liczą się automatycznie; możesz
              je wykluczyć w monitoringu.
            </p>
            <div class="section-heading">
              <h2>Pytania <span>({questions.length})</span></h2>
              <div class="actions">
                <label class="button file-button"
                  >Importuj JSON<input
                    type="file"
                    accept="application/json"
                    onchange={importQuestions}
                  /></label
                ><button type="button" onclick={exportQuestions}>Eksportuj JSON</button>
              </div>
            </div>
            {#each questions as question, i}<div class="question-editor">
                <div class="question-editor-title">
                  <strong>Pytanie {i + 1}</strong><button
                    class="text-button danger"
                    onclick={() => (questions = questions.filter((_, j) => j !== i))}>Usuń</button
                  >
                </div>
                <label
                  >Treść pytania<textarea bind:value={question.text} maxlength="2000" rows="2"
                  ></textarea></label
                >
                <div class="name-fields">
                  <label
                    >Prawidłowa odpowiedź<input
                      bind:value={question.correct}
                      inputmode="numeric"
                    /></label
                  ><label
                    >Czas (sekundy)<input
                      type="number"
                      min="1"
                      max="86400"
                      bind:value={question.seconds}
                    /></label
                  >
                </div>
              </div>{/each}
            <div class="actions">
              <button
                onclick={() =>
                  questions.push({
                    id: '',
                    text: '',
                    correct: '',
                    seconds: config!.durationSeconds,
                  })}>+ Dodaj pytanie</button
              ><button class="primary" onclick={save}>Zapisz konfigurację</button>
            </div>
          </fieldset>
        </section>
      {:else if tab === 'people'}<section class="card">
          <h2>Uczestnicy i odzyskiwanie kont</h2>
          <p>Kody umożliwiają dostęp do konta. Pokazuj je wyłącznie właścicielowi konta.</p>
          <div class="table-scroll">
            <table>
              <thead
                ><tr
                  ><th>Uczestnik</th><th>Pseudonim</th><th>Połączenie</th><th>Kod odzyskiwania</th
                  ></tr
                ></thead
              ><tbody
                >{#each overview?.participants ?? [] as person}<tr
                    ><td>{person.firstName} {person.lastName}</td><td>{person.nickname}</td><td
                      ><span class="live-dot" class:offline={!person.connections}
                      ></span>{person.connections
                        ? `Online (${person.connections})`
                        : 'Offline'}</td
                    ><td
                      ><code>{person.recoveryCode}</code><button
                        class="text-button"
                        onclick={() => showQR(person)}>Kod QR</button
                      ></td
                    ></tr
                  >{/each}</tbody
              >
            </table>
          </div>
          {#if !overview?.participants.length}<p>Nikt jeszcze nie dołączył.</p>{/if}
        </section>
      {:else if tab === 'results'}<Results {token} />
      {:else if tab === 'answers'}<section class="card">
          <h2>Przyjęte odpowiedzi</h2>
          <div class="table-scroll">
            <table>
              <thead
                ><tr><th>Uczestnik</th><th>Pytanie</th><th>Odpowiedź</th><th>Wersja</th></tr></thead
              ><tbody
                >{#each overview?.answers ?? [] as answer}<tr
                    ><td
                      >{overview?.participants.find((p) => p.id === answer.participantId)
                        ?.nickname}</td
                    ><td
                      >{(overview?.questions.findIndex((q) => q.id === answer.questionId) ?? -1) +
                        1}</td
                    ><td>{answer.text}</td><td>{answer.revision}</td></tr
                  >{/each}</tbody
              >
            </table>
          </div>
        </section>{/if}
    {/if}
    {#if error}<div class="error notice" role="alert">{error}</div>{/if}{#if notice}<div
        class="notice"
        role="status"
      >
        {notice}
      </div>{/if}
  </main>
</div>
{#if qr}<div class="modal-backdrop" role="presentation">
    <div
      class="card qr-modal"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-label="Kod odzyskiwania"
    >
      <h2>{qrName}</h2>
      <p>Zeskanuj kod, aby przywrócić swoje konto.</p>
      <img src={qr} alt="Kod QR do odzyskania konta" width="280" height="280" /><button
        onclick={() => (qr = '')}>Zamknij</button
      >
    </div>
  </div>{/if}
