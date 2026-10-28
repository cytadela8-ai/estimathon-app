/** Browser-lifecycle cases are tested against a shared persistent storage boundary. */
import { describe, it, expect } from 'vitest';
import { Ledger } from '#est-client/ledger';
import type { Answer } from '#est-shared/protocol';
function setup() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
  return { storage, ledger: new Ledger(storage, 'person') };
}
function answer(revision: number, text = '42'): Answer {
  return {
    participantId: 'person',
    questionId: 'q',
    operationId: `server-operation-${revision}`,
    revision,
    text,
    acceptedAt: 1000,
  };
}
describe('storage-first reconciliation', () => {
  it('restores an unacknowledged edit after immediately closing the browser', () => {
    const { ledger, storage } = setup();
    ledger.edit('q', '123', 'local-operation');
    const reopened = new Ledger(storage, 'person');
    expect(reopened.read('q')?.operation.text).toBe('123');
    expect(reopened.read('q')?.pending).toBe(true);
  });
  it('protects offline edits from stale snapshots after reconnect', () => {
    const { ledger } = setup();
    ledger.edit('q', '456', 'local-operation', 4);
    ledger.remote(answer(3));
    expect(ledger.read('q')?.operation.text).toBe('456');
    expect(ledger.read('q')?.pending).toBe(true);
  });
  it('does not let a delayed acknowledgment clear a newer edit', () => {
    const { ledger } = setup();
    const old = ledger.edit('q', '12', 'old-operation');
    ledger.edit('q', '123', 'new-operation');
    ledger.receipt(
      {
        operationId: old.operation.operationId,
        status: 'accepted',
        answer: { ...answer(1), ...old.operation },
      },
      'q',
    );
    expect(ledger.read('q')?.pending).toBe(true);
    expect(ledger.read('q')?.operation.text).toBe('123');
  });
  it('converges across two tabs and increments the latest stored revision', () => {
    const { ledger, storage } = setup();
    const tab = new Ledger(storage, 'person');
    ledger.edit('q', '10', 'tab-one');
    tab.edit('q', '20', 'tab-two');
    expect(ledger.read('q')?.operation.revision).toBe(2);
    expect(ledger.read('q')?.operation.text).toBe('20');
  });
  it('preserves intermediate editing text including an empty field', () => {
    const { ledger } = setup();
    for (const text of ['0001', '', '1e', '-']) {
      ledger.edit('q', text, 'editing');
      expect(ledger.read('q')?.operation.text).toBe(text);
    }
  });
  it('retains rejected offline text and explains deadline rejection', () => {
    const { ledger } = setup();
    const draft = ledger.edit('q', '99', 'late-edit');
    ledger.receipt(
      { operationId: draft.operation.operationId, status: 'closed', answer: answer(0) },
      'q',
    );
    expect(ledger.read('q')?.operation.text).toBe('99');
    expect(ledger.read('q')?.error).toContain('Czas minął');
    expect(ledger.read('q')?.pending).toBe(false);
  });
  it('fails visibly instead of claiming a save when browser storage is full', () => {
    const ledger = new Ledger(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('Storage full');
        },
      },
      'p',
    );
    expect(() => ledger.edit('q', '42', 'op')).toThrow('Storage full');
  });
});
