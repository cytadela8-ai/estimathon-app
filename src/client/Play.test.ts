/** Participant results follow the projector's authoritative reveal timeline. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { client } from '#est-client/sync';
import Play from '#est-client/Play.svelte';
import type { Snapshot } from '#est-shared/protocol';

function show(elapsed: number, offset = 0, phase: Snapshot['state']['phase'] = 'results') {
  client.set({
    session: {
      token: 'token',
      recoveryCode: 'recovery',
      participant: { id: 'p', firstName: 'Anna', lastName: 'Nowak', nickname: 'Ania' },
    },
    snapshot: {
      serverNow: 10000,
      state: {
        phase,
        index: 0,
        startedAt: 0,
        endsAt: 1000,
        closesAt: 1000,
        remainingMs: 0,
        resultsAt: 10000 - elapsed,
        version: 2,
      },
      question: { id: 'q', text: 'Ile kilometrów?' },
      totalQuestions: 1,
      participantCount: 1,
      answerCount: 1,
      correct: '40075',
      results: [{ participantId: 'p', nickname: 'Ania', answer: '42000', score: 812 }],
      standings: [{ participantId: 'p', nickname: 'Ania', score: 1812, place: 2 }],
    },
    connected: true,
    text: '42000',
    pending: false,
    error: null,
    offset,
    confirmed: '42000',
  });
  return render(Play).body;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10000);
  vi.stubGlobal('location', { hash: '' });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('waits for the correct-answer stage and keeps scores hidden until the ranking stage', () => {
  for (const elapsed of [0, 3500]) {
    const html = show(elapsed);
    expect(html).toContain('reveal-loader');
    expect(html).not.toContain('40075');
    expect(html).not.toContain('Punkty za pytanie');
    expect(html).not.toContain('Łącznie:');
  }
  for (const elapsed of [3501, 7000]) {
    const html = show(elapsed);
    expect(html).toContain('40075');
    expect(html).toContain('42000');
    expect(html).not.toContain('Punkty za pytanie');
    expect(html).not.toContain('Łącznie:');
    expect(html).not.toContain('Miejsce:');
  }
  const html = show(7001);
  expect(html).toContain('812 / 1000');
  expect(html).toContain('1812 pkt');
  expect(html).toContain('Miejsce:');
});

it('restores the reveal stage using server clock offset rather than time since mount', () => {
  expect(show(3000, 1000)).toContain('40075');
  expect(show(8000, -6000)).not.toContain('40075');
  expect(show(1000, 7000)).toContain('1812 pkt');
});

it.each(['closing', 'finishing'] as const)('keeps results hidden while %s', (phase) => {
  const html = show(20000, 0, phase);
  expect(html).toContain('Zbieramy ostatnie odpowiedzi');
  expect(html).not.toContain('40075');
  expect(html).not.toContain('1812 pkt');
});

it('preserves the final personal results view', () => {
  const html = show(0, 0, 'finished');
  expect(html).toContain('Wyniki końcowe');
  expect(html).toContain('1812 pkt');
  expect(html).toContain('Twoje odpowiedzi i punkty');
});
