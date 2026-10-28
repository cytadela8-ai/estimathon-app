/** Storage-first draft ledger independent of Svelte and transport. One key per question isolates tabs. */
import type { Answer, Operation, Receipt } from '#est-shared/protocol';
import { compareOperations } from '#est-shared/protocol';
export interface Draft {
  operation: Operation;
  pending: boolean;
  error: string | null;
}
export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export class Ledger {
  constructor(
    readonly storage: StoragePort,
    readonly participantId: string,
  ) {}
  key(questionId: string): string {
    return `estymator.answer.${this.participantId}.${questionId}`;
  }
  read(questionId: string): Draft | null {
    const text = this.storage.getItem(this.key(questionId));
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
    this.storage.setItem(this.key(draft.operation.questionId), JSON.stringify(draft));
  }
  edit(questionId: string, text: string, operationId: string, knownRevision = 0): Draft {
    const previous = this.read(questionId);
    const draft: Draft = {
      operation: {
        questionId,
        text,
        operationId,
        revision: Math.max(previous?.operation.revision ?? 0, knownRevision) + 1,
      },
      pending: true,
      error: null,
    };
    this.write(draft);
    return draft;
  }
  remote(answer: Answer): void {
    const current = this.read(answer.questionId);
    if (current && compareOperations(current.operation, answer) > 0) return;
    this.write({ operation: answer, pending: false, error: null });
  }
  receipt(receipt: Receipt, questionId: string): void {
    const draft = this.read(questionId);
    if (!draft || draft.operation.operationId !== receipt.operationId) return;
    if (receipt.status === 'paused') return;
    if (['accepted', 'stale'].includes(receipt.status)) {
      if (receipt.answer) this.remote(receipt.answer);
      return;
    }
    this.write({
      ...draft,
      pending: false,
      error:
        receipt.status === 'closed'
          ? 'Czas minął. Ta zmiana nie została przyjęta; obowiązuje ostatnia odpowiedź z serwera.'
          : 'Nieprawidłowa liczba. Ostatnia poprawna odpowiedź pozostaje na serwerze.',
    });
  }
}
