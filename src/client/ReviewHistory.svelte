<!-- Long moderation histories load bounded pages only while expanded. -->
<script lang="ts">
  import { api } from '#est-client/sync';
  import { timestamp } from '#est-client/audit-view';
  import Pagination from '#est-client/Pagination.svelte';
  import type { Page } from '#est-shared/admin';
  import type { AuditEntry } from '#est-shared/protocol';
  let { row, token }: { row: AuditEntry; token: string } = $props();
  let expanded = $state(false);
  let page = $state(1);
  let data = $state<Page<AuditEntry['reviews'][number]> | null>(null);
  let loading = $state(false);
  let error = $state('');

  $effect(() => {
    const entry = row;
    if (!expanded || entry.reviewCount <= entry.reviews.length) return;
    const query = `?page=${page}`;
    const participantId = encodeURIComponent(entry.participantId);
    const operationId = encodeURIComponent(entry.operationId);
    const path = `/api/admin/reviews/${participantId}/${operationId}`;
    const auth = token;
    let active = true;
    loading = true;
    void api<Page<AuditEntry['reviews'][number]>>(path + query, undefined, auth, 'GET')
      .then((response) => {
        if (active) {
          data = response;
          error = '';
        }
      })
      .catch((e: Error) => {
        if (active) error = e.message;
      })
      .finally(() => {
        if (active) loading = false;
      });
    return () => {
      active = false;
    };
  });
</script>

<details ontoggle={(event) => (expanded = event.currentTarget.open)}>
  <summary>Historia decyzji ({row.reviewCount})</summary>
  {#each data?.items ?? row.reviews as decision}
    <p>
      {timestamp(decision.reviewedAt)} ·
      {decision.excluded ? 'Wykluczono' : 'Przywrócono'}: {decision.reason}
    </p>
  {/each}
  {#if data}
    <Pagination
      info={data}
      label="Strony historii decyzji"
      disabled={loading}
      onpage={(next) => (page = next)}
    />
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</details>
