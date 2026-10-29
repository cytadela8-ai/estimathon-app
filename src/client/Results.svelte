<script lang="ts">
  import { api } from '#est-client/sync';
  import { difference, timestamp } from '#est-client/audit-view';
  import Pagination from '#est-client/Pagination.svelte';
  import ReviewHistory from '#est-client/ReviewHistory.svelte';
  import { ADMIN_PAGE_SIZE, type AdminResults } from '#est-shared/admin';
  import type { AuditEntry } from '#est-shared/protocol';
  let { token }: { token: string } = $props();
  let data = $state<AdminResults>({
    participants: [],
    questions: [],
    standings: [],
    audit: [],
    auditPagination: { page: 1, pageSize: ADMIN_PAGE_SIZE, total: 0 },
    resultsPagination: { page: 1, pageSize: ADMIN_PAGE_SIZE, total: 0 },
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
  let resultsPage = $state(1);
  let loading = $state(false);
  let refreshVersion = $state(0);
  const filters = $derived({
    questionId,
    participant,
    value,
    lateOnly,
    minimumSeconds: Math.max(0, minimumSeconds || 0),
  });
  let previousFilters = '';
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
  const questions = $derived(
    data.questions.filter(
      (q) =>
        q.results.length ||
        (!data.resultsPagination.total && (!questionId || q.question.id === questionId)),
    ),
  );
  const statuses = {
    accepted: 'Przyjęta',
    stale: 'Starsza wersja',
    invalid: 'Nieprawidłowa',
    paused: 'Wstrzymana',
  };
  $effect(() => {
    const filterKey = JSON.stringify(filters);
    if (previousFilters !== filterKey) {
      previousFilters = filterKey;
      auditPage = 1;
      resultsPage = 1;
    }
    const query = new URLSearchParams({
      questionId: filters.questionId,
      participant: filters.participant,
      value: filters.value,
      lateOnly: String(filters.lateOnly),
      minimumSeconds: String(filters.minimumSeconds),
      auditPage: String(auditPage),
      resultsPage: String(resultsPage),
    });
    const auth = token;
    void refreshVersion;
    let active = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      loading = true;
      try {
        const response = await api<AdminResults>(
          `/api/admin/results?${query}`,
          undefined,
          auth,
          'GET',
        );
        if (active) {
          data = response;
          auditPage = response.auditPagination.page;
          resultsPage = response.resultsPagination.page;
          error = '';
        }
      } catch (e) {
        if (active) error = (e as Error).message;
      } finally {
        pending = false;
        if (active) loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
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
      refreshVersion++;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card host-results">
  <h2>Klasyfikacja łączna</h2>
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
      Prawidłowa odpowiedź: <strong>{q.question.correct}</strong><br />Koniec (serwer, UTC):
      {timestamp(q.deadlineAt)}{#if !q.revealed}<br />Punkty po ujawnieniu wyników{/if}
    </p>
    <div class="table-scroll">
      <table aria-label={`Wyniki pytania ${data.questions.indexOf(q) + 1}`}>
        <thead
          ><tr><th>Miejsce</th><th>Uczestnik</th><th>Odpowiedź liczona</th><th>Punkty</th></tr
          ></thead
        >
        <tbody
          >{#each q.results as result}<tr>
              <td>{q.revealed ? result.place : '—'}</td><td>{result.nickname}</td><td
                >{result.answer ?? 'Brak odpowiedzi'}</td
              >
              <td>{q.revealed ? result.score : '—'}</td>
            </tr>{/each}</tbody
        >
      </table>
    </div>
  {/each}
  <Pagination
    info={data.resultsPagination}
    label="Strony wyników pytań"
    disabled={loading}
    onpage={(next) => (resultsPage = next)}
  />
  <h2>Historia dostarczenia odpowiedzi</h2>
  <p>
    Pierwsze dotarcie każdej zmiany. Różnica „+” oznacza spóźnienie, „−” — czas przed końcem. Czas
    telefonu jest deklarowany przez urządzenie i może być zmieniony.
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
  <p aria-live="polite">Liczba operacji: {data.auditPagination.total}</p>
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
        >{#each data.audit as row (`${row.participantId}/${row.operationId}`)}<tr
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
                disabled={busy || loading}
                aria-label={`${row.excluded ? 'Przywróć' : 'Wyklucz'} odpowiedź ${row.nickname} ${row.text}`}
                onclick={() => {
                  selected = row;
                  reason = '';
                }}>{row.excluded ? 'Przywróć' : 'Wyklucz'}</button
              >
              {#if row.reviewCount}<ReviewHistory {row} {token} />{/if}
            </td>
          </tr>{/each}</tbody
      >
    </table>
  </div>
  <Pagination
    info={data.auditPagination}
    label="Strony historii odpowiedzi"
    disabled={loading}
    onpage={(next) => (auditPage = next)}
  />
  {#if !data.audit.length && !loading}<p>Brak operacji spełniających filtry.</p>{/if}
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
        Po wykluczeniu liczy się poprzednia niewykluczona wersja lub 0 pkt, jeśli jej nie ma.
        Decyzja zostanie zapisana, a wyniki przeliczone.
      </p>
      <label>Powód decyzji<textarea bind:value={reason} maxlength="500" required></textarea></label>
      <div class="actions">
        <button class="primary" disabled={busy}>Zatwierdź decyzję</button>
        <button type="button" disabled={busy} onclick={() => (selected = null)}>Anuluj</button>
      </div>
    </form>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
