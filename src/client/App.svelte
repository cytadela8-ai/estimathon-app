<script lang="ts">
  import { onMount } from 'svelte';
  import { initialize } from '#est-client/sync';
  import Play from '#est-client/Play.svelte';
  import Screen from '#est-client/Screen.svelte';
  import Admin from '#est-client/Admin.svelte';
  const path = window.location.pathname;
  onMount(initialize);
</script>

<svelte:head><meta name="description" content="Estymator — konkurs estymacji." /></svelte:head>
{#if path === '/screen'}<Screen />{:else if path === '/admin'}<Admin />{:else}<Play />{/if}
