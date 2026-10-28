/** Render public projector states to verify staged disclosure and empty final standings. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { client } from '#est-client/sync';
import Screen from '#est-client/Screen.svelte';
import type { Snapshot } from '#est-shared/protocol';
function snapshot(): Snapshot {
  return {
    serverNow: 10000,
    state: {
      phase: 'results',
      index: 0,
      startedAt: 0,
      endsAt: 1000,
      closesAt: 1000,
      remainingMs: 0,
      resultsAt: 10000,
      version: 2,
    },
    question: { id: 'q', text: 'Ile kilometrów?' },
    totalQuestions: 1,
    participantCount: 1,
    answerCount: 1,
    correct: '40075',
    results: [{ participantId: 'p', nickname: 'Ania', answer: '42000', score: 10 }],
    standings: [{ participantId: 'p', nickname: 'Ania', score: 10 }],
  };
}
function show(value: Snapshot): string {
  client.set({
    session: null,
    snapshot: value,
    connected: true,
    text: '',
    pending: false,
    error: null,
    offset: 0,
    confirmed: null,
  });
  return render(Screen).body;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal('location', { host: 'contest.local' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('projector presentation', () => {
  it('shows no answer distribution or correct answer during acceptance closing', () => {
    const value = snapshot();
    value.state.phase = 'closing';
    const html = show(value);
    expect(html).toContain('Synchronizujemy ostatnie odpowiedzi');
    expect(html).not.toContain('Wasze odpowiedzi');
    expect(html).not.toContain('40075');
    expect(html).not.toContain('Ania');
  });
  it('reveals the distribution first, the answer next, and the leaderboard last', () => {
    const value = snapshot();
    expect(show(value)).toContain('Wasze odpowiedzi');
    expect(show(value)).not.toContain('PRAWIDŁOWA ODPOWIEDŹ');
    expect(show(value)).not.toContain('Czołówka konkursu');
    vi.setSystemTime(14000);
    expect(show(value)).toContain('PRAWIDŁOWA ODPOWIEDŹ');
    expect(show(value)).not.toContain('Czołówka konkursu');
    vi.setSystemTime(18000);
    expect(show(value)).toContain('Czołówka konkursu');
    expect(show(value)).toContain('Ania');
  });
  it('restores the appropriate reveal stage from server time and clock offset', () => {
    const value = snapshot();
    value.state.resultsAt = 1000;
    client.set({
      session: null,
      snapshot: value,
      connected: false,
      text: '',
      pending: false,
      error: null,
      offset: 500,
      confirmed: null,
    });
    const html = render(Screen).body;
    expect(html).toContain('PONOWNE ŁĄCZENIE');
    expect(html).toContain('PRAWIDŁOWA ODPOWIEDŹ');
    expect(html).toContain('Czołówka konkursu');
  });
  it('reveals the podium before the complete final standings', () => {
    const value = snapshot();
    value.state.phase = 'finished';
    expect(show(value)).toContain('podium-person');
    expect(show(value)).not.toContain('scrolling-results');
    vi.setSystemTime(17000);
    expect(show(value)).toContain('scrolling-results');
  });
  it('explains empty rankings without claiming that scoring is unconfigured', () => {
    const value = snapshot();
    value.state.phase = 'finished';
    value.standings = [];
    value.results = [];
    value.answerCount = 0;
    const html = show(value);
    expect(html).toContain('Brak sklasyfikowanych wyników.');
    expect(html).not.toContain('Punktacja oczekuje');
    value.state.phase = 'results';
    value.state.resultsAt = 1000;
    expect(show(value)).toContain('Brak sklasyfikowanych wyników.');
    expect(show(value)).not.toContain('Punktacja oczekuje');
  });
  it('includes unranked participants in the complete final results', () => {
    const value = snapshot();
    value.state.phase = 'finished';
    value.standings.push({ participantId: 'none', nickname: 'Bez odpowiedzi', score: null });
    expect(show(value)).not.toContain('Bez odpowiedzi');
    vi.setSystemTime(17000);
    const html = show(value);
    expect(html).toContain('Bez odpowiedzi');
    expect(html).toContain('Bez klasyfikacji');
  });
});
