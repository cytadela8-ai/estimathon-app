/** Wire types. Public state contains results only after the server closes acceptance. */
export type Phase = 'lobby' | 'active' | 'paused' | 'closing' | 'results' | 'finished';
export interface Config {
  durationSeconds: number;
  graceSeconds: number;
  latePolicy: 'strict' | 'grace';
  resultsSeconds: number | null;
  maxAnswer: string;
}
export interface Question {
  id: string;
  text: string;
  correct: string;
  seconds: number;
}
export interface State {
  phase: Phase;
  index: number;
  startedAt: number | null;
  endsAt: number | null;
  closesAt: number | null;
  remainingMs: number;
  resultsAt: number | null;
  version: number;
}
export interface Operation {
  questionId: string;
  operationId: string;
  revision: number;
  text: string;
}
export interface Answer extends Operation {
  participantId: string;
  acceptedAt: number;
}
export interface Participant {
  id: string;
  firstName: string;
  lastName: string;
  nickname: string;
}
export interface Session {
  token: string;
  recoveryCode: string;
  participant: Participant;
}
export interface Result {
  participantId: string;
  nickname: string;
  answer: string | null;
  score: number | null;
}
export interface Standing {
  participantId: string;
  nickname: string;
  score: number | null;
}
export interface Snapshot {
  serverNow: number;
  state: State;
  question: { id: string; text: string } | null;
  totalQuestions: number;
  participantCount: number;
  answerCount: number;
  correct: string | null;
  results: Result[];
  standings: Standing[];
  scoringConfigured: boolean;
}
export interface Receipt {
  operationId: string;
  status: 'accepted' | 'stale' | 'closed' | 'invalid' | 'paused';
  answer: Answer | null;
}
export interface Hello {
  snapshot: Snapshot;
  answers: Answer[];
}
export interface ServerEvents {
  state: (snapshot: Snapshot) => void;
  answer: (answer: Answer) => void;
}
export interface ClientEvents {
  snapshot: (ack: (hello: Hello) => void) => void;
  save: (operation: Operation, ack: (receipt: Receipt) => void) => void;
}
export type Command = 'start' | 'pause' | 'resume' | 'next' | 'extend' | 'finish';
/** A total ordering resolves simultaneous revisions independently of arrival order. */
export function compareOperations(a: Operation, b: Operation): number {
  if (a.revision !== b.revision) return a.revision - b.revision;
  return a.operationId < b.operationId ? -1 : Number(a.operationId > b.operationId);
}
/** Preserve editing text but validate the normalized integer with arbitrary precision. */
export function validNumber(text: string, maximum: string): boolean {
  return /^\d{1,100}$/.test(text) && BigInt(text) > 0n && BigInt(text) <= BigInt(maximum);
}
