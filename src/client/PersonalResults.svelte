<script lang="ts">
  /** Final personal summary refreshes on authoritative state changes and reconnects. */
  import { client, api } from '#est-client/sync';
  import type { ParticipantResults } from '#est-shared/protocol';
  let results = $state<ParticipantResults | null>(null);
  let error = $state('');
  let expanded = $state<string[]>([]);
  const token = $derived($client.session?.token);
  const version = $derived($client.snapshot?.state.version);
  const connected = $derived($client.connected);
  $effect(() => {
    const sessionToken = token;
    if (!sessionToken || version === undefined || !connected) return;
    let cancelled = false;
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const response = await api<ParticipantResults>(
          '/api/results',
          undefined,
          sessionToken,
          'GET',
        );
        if (!cancelled) {
          results = response;
          error = '';
        }
      } catch (cause) {
        if (!cancelled) error = (cause as Error).message;
      } finally {
        loading = false;
      }
    }
    void load();
    const retry = setInterval(() => {
      if (error) void load();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(retry);
    };
  });
  function toggle(questionId: string) {
    expanded = expanded.includes(questionId)
      ? expanded.filter((id) => id !== questionId)
      : [...expanded, questionId];
  }
</script>

<section class="personal-results" aria-label="Twoje odpowiedzi i punkty">
  {#if results}<table aria-label="Twoje odpowiedzi i punkty">
      <thead><tr><th>Pytanie</th><th>Twoja odpowiedź</th><th>Punkty</th></tr></thead>
      <tbody>
        {#each results.questions as question (question.questionId)}
          {@const shown = expanded.includes(question.questionId)}
          <tr>
            <th scope="row">
              <strong>{question.number}</strong>
              <button
                class="text-button"
                aria-expanded={shown}
                aria-controls={`personal-question-${question.questionId}`}
                aria-label={`${shown ? 'Ukryj' : 'Pokaż'} treść pytania ${question.number}`}
                onclick={() => toggle(question.questionId)}
                >{shown ? 'Ukryj treść' : 'Pokaż treść'}</button
              >
            </th>
            <td>{question.answer ?? 'Brak odpowiedzi'}</td><td>{question.score}</td>
          </tr>
          <tr hidden={!shown}>
            <td
              colspan="3"
              id={`personal-question-${question.questionId}`}
              class="personal-question"
            >
              {question.text}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if !results.questions.length}<p>Brak rozegranych pytań.</p>{/if}
  {:else}<p role="status">
      {$client.connected ? 'Wczytywanie wyników…' : 'Czekamy na połączenie…'}
    </p>
  {/if}
  {#if error}<p class="error" role="alert">{error} Ponawiamy pobieranie wyników.</p>{/if}
</section>
