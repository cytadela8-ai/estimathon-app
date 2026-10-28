/** Server-relative countdowns must advance even when the transport is disconnected. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { now, remainingMilliseconds } from '#est-client/clock';
import type { State } from '#est-shared/protocol';
function state(phase: State['phase'] = 'active'): State {
  return {
    phase,
    index: 0,
    startedAt: 1000,
    endsAt: 5000,
    closesAt: 5000,
    remainingMs: 3000,
    resultsAt: null,
    version: 1,
  };
}
afterEach(() => {
  vi.useRealTimers();
});
describe('server-relative time', () => {
  it('ticks past the deadline without any network event', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let latest = 0;
    const unsubscribe = now.subscribe((value) => {
      latest = value;
    });
    try {
      expect(remainingMilliseconds(state(), latest, 500)).toBe(3500);
      vi.advanceTimersByTime(3500);
      expect(remainingMilliseconds(state(), latest, 500)).toBe(0);
    } finally {
      unsubscribe();
    }
  });
  it('uses paused remaining time regardless of clock offset', () => {
    expect(remainingMilliseconds(state('paused'), 999999, -10000)).toBe(3000);
  });
  it('shows zero for an absent deadline even when the device clock is ahead', () => {
    expect(remainingMilliseconds({ ...state('lobby'), endsAt: null }, 1000, -3600000)).toBe(0);
    expect(remainingMilliseconds(undefined, 1000, -3600000)).toBe(0);
  });
  it('starts with fresh local time when a later view subscribes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const unsubscribe = now.subscribe(() => {});
    unsubscribe();
    vi.setSystemTime(9000);
    let latest = 0;
    const stop = now.subscribe((value) => {
      latest = value;
    });
    try {
      expect(latest).toBe(9000);
    } finally {
      stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
});
