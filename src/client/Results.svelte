<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '#est-client/sync';
  import { difference, filterAudit, timestamp } from '#est-client/audit-view';
  import type { AuditEntry, QuestionResults, Standing, Participant } from '#est-shared/protocol';
  let { token }: { token: string } = $props();
  let data = $state<{
    participants: Participant[];
    questions: QuestionResults[];
    standings: Standing[];
    audit: AuditEntry[];
  }>({
    participants: [],
    questions: [],
    standings: [],
    audit: [],
  });
  let questionId = $state('');
  let participant = $state('');
  let value = $state('');
  let lateOnly = $state(true);
  let minimumSeconds = $state(3);
  let error = $state('');
  let selected = $state<AuditEntry | null>(null);
  let reason = $state('');
  let busy = $state(false);
  let auditPage = $state(1);
  const rows = $derived(
    filterAudit(data.audit, { questionId, participant, value, lateOnly, minimumSeconds }),
  );
  const matchingParticipants = $derived(
    new Set(
      data.participants
        .filter((person) =>
          `${person.firstName} ${person.lastName} ${person.nickname}`
            .toLocaleLowerCase('pl')
            .includes(participant.trim().toLocaleLowerCase('pl')),
        )
        .map((person) => person.id),
    ),
  );
  const pageCount = $derived(Math.max(1, Math.ceil(rows.length / 100)));
  const currentPage = $derived(Math.min(auditPage, pageCount));
  const visibleRows = $derived(rows.slice((currentPage - 1) * 100, currentPage * 100));
  const questions = $derived(
    data.questions.filter((q) => !questionId || q.question.id === questionId),
  );
  const statuses = {
    accepted: 'Przyjęta',
    stale: 'Starsza wersja',
    invalid: 'Nieprawidłowa',
    paused: 'Wstrzymana',
  };
  async function load() {
    try {
      data = await api('/api/admin/results', undefined, token, 'GET');
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }
  onMount(() => {
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  });
  async function review() {
    if (!selected) return;
    busy = true;
    try {
      await api(
        '/api/admin/review',
        {
          participantId: selected.participantId,
          operationId: selected.operationId,
          excluded: !selected.excluded,
          reason,
        },
        token,
      );
      selected = null;
      reason = '';
      await load();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card host-results">
  <h2>Klasyfikacja łączna</h2>
  <p>Wspólne miejsca przy remisie (1, 1, 3). Brak odpowiedzi: 0 pkt.</p>
  <div class="table-scroll">
    <table aria-label="Klasyfikacja łączna">
      <thead
        ><tr>
          <th>Miejsce</th><th>Uczestnik</th><th>Punkty</th>
        </tr></thead
      ><tbody
        >{#each data.standings.filter( (person) => matchingParticipants.has(person.participantId) ) as person}<tr
          >
            <td>{person.place}</td><td>{person.nickname}</td><td>{person.score}</td>
          </tr>{/each}</tbody
      >
    </table>
  </div>
</section>
<section class="card host-results">
  <h2>Wyniki pytań i monitoring odpowiedzi</h2>
  <div class="config-grid audit-filters">
    <label
      >Pytanie<select bind:value={questionId}
        ><option value="">Wszystkie pytania</option>
        {#each data.questions as q, i}<option value={q.question.id}
            >{i + 1}. {q.question.text}</option
          >{/each}
      </select></label
    >
    <label>Uczestnik — imię, nazwisko lub pseudonim<input bind:value={participant} /></label>
  </div>
  {#each questions as q}
    <h3>{data.questions.indexOf(q) + 1}. {q.question.text}</h3>
    <p>
      Prawidłowa odpowiedź: <strong>{q.question.correct}</strong> · Koniec odpowiadania (serwer,
      UTC): {timestamp(q.deadlineAt)} ·
      {q.revealed ? 'Wyniki ujawnione' : 'Punkty po ujawnieniu wyników'}
    </p>
    <div class="table-scroll">
      <table aria-label={`Wyniki pytania ${data.questions.indexOf(q) + 1}`}>
        <thead><tr><th>Uczestnik</th><th>Odpowiedź liczona</th><th>Punkty</th></tr></thead>
        <tbody
          >{#each q.results.filter( (result) => matchingParticipants.has(result.participantId) ) as result}<tr
            >
              <td>{result.nickname}</td><td>{result.answer ?? 'Brak odpowiedzi'}</td>
              <td>{q.revealed ? result.score : '—'}</td>
            </tr>{/each}</tbody
        >
      </table>
    </div>
  {/each}
  <h2>Historia dostarczenia odpowiedzi</h2>
  <p>
    Każda operacja ma jeden zapis pierwszego dotarcia, także przy ponowieniach. Czas telefonu jest
    deklaracją urządzenia i nie stanowi dowodu. Ujemna różnica oznacza czas przed końcem, dodatnia —
    po końcu odpowiadania.
  </p>
  <div class="config-grid audit-filters">
    <label class="checkbox"><input type="checkbox" bind:checked={lateOnly} />Tylko spóźnione</label>
    <label
      >Minimalne spóźnienie dotarcia (sekundy)<input
        type="number"
        min="0"
        step="0.1"
        bind:value={minimumSeconds}
      /></label
    >
    <label>Wpisana wartość zawiera<input bind:value inputmode="numeric" /></label>
  </div>
  <p aria-live="polite">Liczba operacji: {rows.length}</p>
  <div class="table-scroll audit-table">
    <table aria-label="Historia odpowiedzi">
      <thead
        ><tr
          ><th>Uczestnik / pytanie</th><th>Wartość / wersja</th><th>Dotarcie do serwera (UTC)</th>
          <th>Dotarcie − koniec (serwer)</th><th>Wpisanie (telefon, UTC)</th>
          <th>Koniec według telefonu (UTC)</th><th>Wpisanie − koniec (telefon)</th>
          <th>Przesunięcie zegara</th><th>Status / decyzje</th></tr
        ></thead
      >
      <tbody
        >{#each visibleRows as row}<tr
            data-operation={row.operationId}
            class:excluded={row.excluded}
          >
            <td
              >{row.firstName}
              {row.lastName}<br /><strong>{row.nickname}</strong><br />
              Pytanie {data.questions.findIndex((q) => q.question.id === row.questionId) + 1}</td
            >
            <td
              ><strong>{row.text}</strong><br />Wersja {row.revision}<br /><small
                >{row.operationId}</small
              ></td
            >
            <td
              >{timestamp(row.receivedAt)}<br /><small>Koniec: {timestamp(row.deadlineAt)}</small
              ></td
            >
            <td>{difference(row.serverLateMs)}</td>
            <td>{timestamp(row.timing?.inputAt)}</td><td>{timestamp(row.timing?.endsAt)}</td>
            <td>{difference(row.phoneLateMs)}</td><td>{difference(row.timing?.offsetMs ?? null)}</td
            >
            <td
              >{statuses[row.status]} · {row.excluded
                ? 'Wykluczona'
                : row.counted
                  ? 'Liczona'
                  : 'Nieliczona'}
              <button
                class="text-button"
                disabled={busy}
                aria-label={`${row.excluded ? 'Przywróć' : 'Wyklucz'} odpowiedź ${row.nickname} ${row.text}`}
                onclick={() => {
                  selected = row;
                  reason = '';
                }}>{row.excluded ? 'Przywróć' : 'Wyklucz'}</button
              >
              {#if row.reviews.length}<details>
                  <summary>Historia decyzji ({row.reviews.length})</summary>
                  {#each row.reviews as decision}<p>
                      {timestamp(decision.reviewedAt)} ·
                      {decision.excluded ? 'Wykluczono' : 'Przywrócono'}: {decision.reason}
                    </p>{/each}
                </details>{/if}
            </td>
          </tr>{/each}</tbody
      >
    </table>
  </div>
  {#if pageCount > 1}<nav class="actions" aria-label="Strony historii odpowiedzi">
      <button disabled={currentPage === 1} onclick={() => (auditPage = currentPage - 1)}
        >Poprzednie</button
      >
      <span>Strona {currentPage} / {pageCount} · do 100 operacji na stronie</span>
      <button disabled={currentPage === pageCount} onclick={() => (auditPage = currentPage + 1)}
        >Następne</button
      >
    </nav>{/if}
  {#if !rows.length}<p>Brak operacji spełniających filtry.</p>{/if}
  {#if selected}<form
      class="notice review-form"
      onsubmit={(e) => {
        e.preventDefault();
        void review();
      }}
    >
      <strong
        >{selected.excluded ? 'Przywróć' : 'Wyklucz'}: {selected.nickname} · {selected.text}</strong
      >
      <p>
        Wyniki zostaną przeliczone. Po wykluczeniu liczy się poprzednia niewykluczona wersja, a gdy
        jej nie ma — 0 pkt. Operacja i historia decyzji pozostaną w rejestrze.
      </p>
      <label>Powód decyzji<textarea bind:value={reason} maxlength="500" required></textarea></label>
      <div class="actions">
        <button class="primary" disabled={busy}>Zatwierdź decyzję</button>
        <button type="button" disabled={busy} onclick={() => (selected = null)}>Anuluj</button>
      </div>
    </form>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
