/**
 * Storage-first draft ledger independent of Svelte and transport.
 * Text drafts and the latest unacknowledged valid edit have separate storage keys.
 */
import type { Answer, Operation, Receipt, InputTiming } from '#est-shared/protocol';
import { compareOperations, isPositiveInteger } from '#est-shared/protocol';
export interface Draft {
  operation: Operation;
  pending: boolean;
  error: string | null;
}
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export class Ledger {
  constructor(
    readonly storage: StoragePort,
    readonly participantId: string,
  ) {}
  key(questionId: string): string {
    return `estymator.answer.${this.participantId}.${questionId}`;
  }
  private queueKey(questionId: string): string {
    return `estymator.pending.${this.participantId}.${questionId}`;
  }
  read(questionId: string): Draft | null {
    return this.readStored(this.key(questionId), questionId);
  }
  private readStored(key: string, questionId: string): Draft | null {
    const text = this.storage.getItem(key);
    if (!text) return null;
    try {
      const value = JSON.parse(text) as Draft;
      if (
        !value.operation ||
        value.operation.questionId !== questionId ||
        typeof value.operation.text !== 'string' ||
        !Number.isSafeInteger(value.operation.revision)
      ) {
        throw new Error('Nieprawidłowy zapis');
      }
      return value;
    } catch {
      throw new Error(
        'Nie można odczytać lokalnej odpowiedzi. Odzyskaj konto lub sprawdź pamięć przeglądarki.',
      );
    }
  }
  write(draft: Draft): void {
    this.observeRevision(draft.operation.questionId, draft.operation.revision);
    this.storage.setItem(this.key(draft.operation.questionId), JSON.stringify(draft));
  }
  /** Remember the highest observed revision even when a host reverts the counted answer. */
  observeRevision(questionId: string, revision: number): void {
    const key = `estymator.revision.${this.participantId}.${questionId}`;
    const previous = Number(this.storage.getItem(key) ?? 0);
    if (revision > previous) this.storage.setItem(key, String(revision));
  }
  private highestRevision(questionId: string): number {
    return Number(
      this.storage.getItem(`estymator.revision.${this.participantId}.${questionId}`) ?? 0,
    );
  }
  private stash(draft: Draft): void {
    if (!draft.pending || !isPositiveInteger(draft.operation.text)) return;
    const key = this.queueKey(draft.operation.questionId);
    const queued = this.readStored(key, draft.operation.questionId);
    if (queued && compareOperations(queued.operation, draft.operation) >= 0) return;
    // Retain the previous valid edit before replacing its visible draft with intermediate text.
    this.storage.setItem(key, JSON.stringify(draft));
  }
  edit(
    questionId: string,
    text: string,
    operationId: string,
    knownRevision = 0,
    timing?: InputTiming,
  ): Draft {
    const previous = this.read(questionId);
    if (previous) this.stash(previous);
    const draft: Draft = {
      operation: {
        questionId,
        text,
        operationId,
        revision:
          Math.max(
            previous?.operation.revision ?? 0,
            knownRevision,
            this.highestRevision(questionId),
          ) + 1,
        ...(timing ? { timing } : {}),
      },
      pending: true,
      error: null,
    };
    this.write(draft);
    return draft;
  }
  /** Return the latest valid edit to retry while preserving the participant's editing text. */
  pendingOperation(questionId: string): Operation | null {
    const draft = this.read(questionId);
    const queued = this.readStored(this.queueKey(questionId), questionId);
    if (!draft?.pending || !isPositiveInteger(draft.operation.text))
      return queued?.operation ?? null;
    if (queued && compareOperations(queued.operation, draft.operation) > 0) return queued.operation;
    return draft.operation;
  }
  remote(answer: Answer): void {
    const queued = this.readStored(this.queueKey(answer.questionId), answer.questionId);
    if (queued && compareOperations(queued.operation, answer) <= 0) {
      this.storage.removeItem(this.queueKey(answer.questionId));
    }
    const current = this.read(answer.questionId);
    if (current && compareOperations(current.operation, answer) > 0) return;
    this.write({ operation: answer, pending: false, error: null });
  }
  /** Apply an authoritative snapshot, allowing moderation to remove or revert confirmed answers. */
  authoritative(questionId: string, answer: Answer | undefined): void {
    const current = this.read(questionId);
    if (current) this.observeRevision(questionId, current.operation.revision);
    if (current?.pending || current?.error) {
      if (answer) this.remote(answer);
      return;
    }
    if (answer) this.write({ operation: answer, pending: false, error: null });
    else this.storage.removeItem(this.key(questionId));
  }
  receipt(receipt: Receipt, questionId: string): void {
    if (receipt.status === 'paused') return;
    const pending = this.pendingOperation(questionId);
    this.clearQueuedReceipt(receipt, questionId);
    const draft = this.read(questionId);
    if (!draft) return;
    if (['accepted', 'stale'].includes(receipt.status)) {
      if (receipt.answer) this.remote(receipt.answer);
      return;
    }
    const relevant =
      draft.operation.operationId === receipt.operationId ||
      pending?.operationId === receipt.operationId;
    if (!relevant) return;
    this.reject(draft);
  }
  private reject(draft: Draft): void {
    this.write({
      ...draft,
      pending: false,
      error: 'Nieprawidłowa liczba. Ostatnia poprawna odpowiedź pozostaje na serwerze.',
    });
  }
  private clearQueuedReceipt(receipt: Receipt, questionId: string): void {
    const key = this.queueKey(questionId);
    const queued = this.readStored(key, questionId);
    if (queued?.operation.operationId === receipt.operationId) this.storage.removeItem(key);
  }
}
