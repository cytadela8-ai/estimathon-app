/** Browser entrypoint. */
import { mount } from 'svelte';
import App from '#est-client/App.svelte';
import '#est-client/style.css';
mount(App, { target: document.getElementById('app')! });
