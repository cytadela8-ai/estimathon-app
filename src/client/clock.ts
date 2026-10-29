/** One browser clock drives countdowns, answer editing and projector reveal stages. */
import { readable } from 'svelte/store';
import type { State } from '#est-shared/protocol';
/** Reveal offsets after resultsAt, shared by participant and projector views. */
export const CORRECT_REVEAL_MS = 3500;
export const RANKING_REVEAL_MS = 7000;
export const now = readable(Date.now(), (set) => {
  set(Date.now());
  const timer = setInterval(() => set(Date.now()), 100);
  return () => clearInterval(timer);
});
/** Calculate remaining time using the server offset, including paused and absent deadlines. */
export function remainingMilliseconds(
  state: State | undefined,
  localNow: number,
  offset: number,
): number {
  if (!state) return 0;
  if (state.phase === 'paused') return state.remainingMs;
  if (state.endsAt === null) return 0;
  return Math.max(0, state.endsAt - localNow - offset);
}
