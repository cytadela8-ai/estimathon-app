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
    standings: [{ participantId: 'p', nickname: 'Ania', score: 10, place: 1 }],
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
  it.each(['closing', 'finishing'] as const)(
    'shows no answers or correct answer while %s',
    (phase) => {
      const value = snapshot();
      value.state.phase = phase;
      const html = show(value);
      expect(html).toContain('Zbieramy ostatnie odpowiedzi');
      expect(html).not.toContain('Wasze odpowiedzi');
      expect(html).not.toContain('40075');
      expect(html).not.toContain('Ania');
    },
  );
  it('reveals the distribution first, the answer next, and the leaderboard last', () => {
    const value = snapshot();
    expect(show(value)).toContain('Wasze odpowiedzi');
    expect(show(value)).not.toContain('Prawidłowa odpowiedź');
    expect(show(value)).not.toContain('Zakres odpowiedzi');
    expect(show(value)).not.toContain('chart-center');
    expect(show(value)).not.toContain('Klasyfikacja pytania');
    expect(show(value)).not.toContain('Klasyfikacja łączna');
    vi.setSystemTime(14000);
    expect(show(value)).toContain('Prawidłowa odpowiedź');
    expect(show(value)).toContain('Zakres odpowiedzi');
    expect(show(value)).not.toContain('Klasyfikacja łączna');
    vi.setSystemTime(18000);
    expect(show(value)).toContain('Klasyfikacja łączna');
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
    expect(html).toContain('Ponowne łączenie');
    expect(html).toContain('Prawidłowa odpowiedź');
    expect(html).toContain('Klasyfikacja łączna');
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
  it('includes zero-point participants in the complete final results', () => {
    const value = snapshot();
    value.state.phase = 'finished';
    value.standings.push({ participantId: 'none', nickname: 'Bez odpowiedzi', score: 0, place: 2 });
    expect(show(value)).not.toContain('scrolling-results');
    vi.setSystemTime(17000);
    const html = show(value);
    expect(html).toContain('Bez odpowiedzi');
    expect(html).toContain('0 pkt');
  });
});

it('groups all tied winners on the same podium step and skips second place', () => {
  const value = snapshot();
  value.state.phase = 'finished';
  value.standings = [
    { participantId: 'a', nickname: 'Ania', score: 1000, place: 1 },
    { participantId: 'b', nickname: 'Bartek', score: 1000, place: 1 },
    { participantId: 'c', nickname: 'Celina', score: 500, place: 3 },
  ];
  const html = show(value);
  expect(html).toContain('Ania');
  expect(html).toContain('Bartek');
  expect(html).toContain('Celina');
  expect(html).toContain('data-place="1"');
  expect(html).not.toContain('data-place="2"');
  expect(html).toContain('data-place="3"');
});
it('retains every participant tied at the fifth place instead of truncating the field', () => {
  const value = snapshot();
  value.state.resultsAt = 1000;
  value.standings = Array.from({ length: 8 }, (_, i) => ({
    participantId: String(i),
    nickname: `Tied ${i}`,
    score: 100,
    place: 5,
  }));
  const html = show(value);
  expect(html).toContain('Tied 0');
  expect(html).toContain('Tied 7');
  expect(html).toContain('8 ex aequo');
});

it('ranks question scores independently of overall standings and preserves ties and missing answers', () => {
  const value = snapshot();
  value.state.resultsAt = 1000;
  value.results = [
    { participantId: 'a', nickname: 'Ania', answer: '100', score: 1000 },
    { participantId: 'b', nickname: 'Bartek', answer: '100', score: 1000 },
    { participantId: 'c', nickname: 'Celina', answer: null, score: 0 },
  ];
  value.standings = [
    { participantId: 'c', nickname: 'Celina', score: 2000, place: 1 },
    { participantId: 'a', nickname: 'Ania', score: 1000, place: 2 },
    { participantId: 'b', nickname: 'Bartek', score: 1000, place: 2 },
  ];
  const html = show(value);
  const question = html.split('aria-label="Klasyfikacja pytania"')[1]!.split('</section>')[0]!;
  const overall = html.split('aria-label="Klasyfikacja łączna"')[1]!.split('</section>')[0]!;
  expect(question.indexOf('Ania')).toBeLessThan(question.indexOf('Celina'));
  expect(question).toContain('2 ex aequo');
  expect(question).toContain('03');
  expect(question).not.toContain('02');
  expect(question).toContain('0 pkt');
  expect(overall.indexOf('Celina')).toBeLessThan(overall.indexOf('Ania'));
});
