<!-- Page bounds come from server counts, including clamping after data is removed. -->
<script lang="ts">
  import type { PageInfo } from '#est-shared/admin';
  let {
    info,
    label,
    disabled = false,
    onpage,
  }: {
    info: PageInfo;
    label: string;
    disabled?: boolean;
    onpage: (page: number) => void;
  } = $props();
  const pageCount = $derived(Math.max(1, Math.ceil(info.total / info.pageSize)));
</script>

{#if pageCount > 1}
  <nav class="actions" aria-label={label}>
    <button disabled={disabled || info.page === 1} onclick={() => onpage(info.page - 1)}
      >Poprzednie</button
    >
    <span>Strona {info.page} / {pageCount} · do {info.pageSize} wpisów na stronie</span>
    <button disabled={disabled || info.page === pageCount} onclick={() => onpage(info.page + 1)}
      >Następne</button
    >
  </nav>
{/if}
