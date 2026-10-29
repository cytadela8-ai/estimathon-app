<!-- Fetch only the selected server page while this tab is mounted. -->
<script lang="ts">
  import { api } from '#est-client/sync';
  import Pagination from '#est-client/Pagination.svelte';
  import { ADMIN_PAGE_SIZE, type AnswerPage } from '#est-shared/admin';
  import type { Participant, Question } from '#est-shared/protocol';
  let {
    token,
    participants,
    questions,
  }: {
    token: string;
    participants: Participant[];
    questions: Question[];
  } = $props();
  let page = $state(1);
  let data = $state<AnswerPage>({ items: [], page: 1, total: 0, pageSize: ADMIN_PAGE_SIZE });
  let loading = $state(false);
  let error = $state('');

  $effect(() => {
    const path = `/api/admin/answers?page=${page}`;
    const auth = token;
    let active = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      loading = true;
      try {
        const response = await api<AnswerPage>(path, undefined, auth, 'GET');
        if (active) {
          data = response;
          page = response.page;
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
</script>

<section class="card" aria-busy={loading}>
  <h2>Przyjęte odpowiedzi</h2>
  <p aria-live="polite">Liczba odpowiedzi: {data.total}</p>
  <div class="table-scroll">
    <table aria-label="Przyjęte odpowiedzi">
      <thead><tr><th>Uczestnik</th><th>Pytanie</th><th>Odpowiedź</th><th>Wersja</th></tr></thead>
      <tbody>
        {#each data.items as answer}
          <tr>
            <td>{participants.find((p) => p.id === answer.participantId)?.nickname}</td>
            <td>{questions.findIndex((q) => q.id === answer.questionId) + 1}</td>
            <td>{answer.text}</td><td>{answer.revision}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <Pagination
    info={data}
    label="Strony przyjętych odpowiedzi"
    disabled={loading}
    onpage={(next) => (page = next)}
  />
  {#if !data.total && !loading}<p>Brak przyjętych odpowiedzi.</p>{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
