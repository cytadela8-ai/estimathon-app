/** Wire types. Public results appear only after the reveal delay; delayed sync stays open. */
export type Phase =
  | 'lobby'
  | 'active'
  | 'paused'
  | 'closing'
  | 'finishing'
  | 'results'
  | 'finished';
export interface Config {
  durationSeconds: number;
  revealDelaySeconds: number;
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
export interface InputTiming {
  inputAt: number;
  endsAt: number;
  offsetMs: number;
}
export interface Operation {
  questionId: string;
  operationId: string;
  revision: number;
  text: string;
  timing?: InputTiming;
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
  score: number;
}
export interface Standing {
  place: number;
  participantId: string;
  nickname: string;
  score: number;
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
}
export interface Receipt {
  operationId: string;
  status: 'accepted' | 'stale' | 'invalid' | 'paused';
  answer: Answer | null;
}
export interface AnswerState {
  answers: Answer[];
  revisions: Record<string, number>;
}
export interface Hello extends AnswerState {
  snapshot: Snapshot;
}
export interface ServerEvents {
  answers: (state: AnswerState) => void;
  state: (snapshot: Snapshot) => void;
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
/** Check an editable number without converting its textual representation. */
export function isPositiveInteger(text: string): boolean {
  return /^\d{1,100}$/.test(text) && BigInt(text) > 0n;
}
/** Preserve editing text but validate the normalized integer with arbitrary precision. */
export function validNumber(text: string, maximum: string): boolean {
  return isPositiveInteger(text) && BigInt(text) <= BigInt(maximum);
}

export interface Review {
  participantId: string;
  operationId: string;
  excluded: boolean;
  reason: string;
}
export interface AuditEntry extends Operation {
  participantId: string;
  nickname: string;
  firstName: string;
  lastName: string;
  receivedAt: number;
  deadlineAt: number | null;
  serverLateMs: number | null;
  phoneLateMs: number | null;
  status: Receipt['status'];
  excluded: boolean;
  counted: boolean;
  reviews: { excluded: boolean; reason: string; reviewedAt: number }[];
}
export interface QuestionResults {
  question: Question;
  deadlineAt: number | null;
  revealed: boolean;
  results: Result[];
}

/** Private final summary: played questions and this participant's counted answers only. */
export interface ParticipantQuestionResult {
  questionId: string;
  number: number;
  text: string;
  answer: string | null;
  score: number;
}
export interface ParticipantResults {
  version: number;
  questions: ParticipantQuestionResult[];
}
