/** Organizer-owned scoring policy. Null means rules have not yet been configured. */
export type Scorer = (estimate: bigint, correct: bigint) => number | null;
export const unconfiguredScorer: Scorer = () => null;
