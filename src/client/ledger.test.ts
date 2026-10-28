/** Browser-lifecycle cases are tested against a shared persistent storage boundary. */
import { describe, it, expect } from 'vitest';
import { Ledger } from '#est-client/ledger';
import type { Answer } from '#est-shared/protocol';
function setup() {
  const data = new Map<string, string>();
  const storage = {
    removeItem: (key: string) => {
      data.delete(key);
    },
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
  it('retains invalid offline text and explains the validation failure', () => {
    const { ledger } = setup();
    const draft = ledger.edit('q', '99', 'late-edit');
    ledger.receipt(
      { operationId: draft.operation.operationId, status: 'invalid', answer: answer(0) },
      'q',
    );
    expect(ledger.read('q')?.operation.text).toBe('99');
    expect(ledger.read('q')?.error).toContain('Nieprawidłowa liczba');
    expect(ledger.read('q')?.pending).toBe(false);
  });
  it('fails visibly instead of claiming a save when browser storage is full', () => {
    const ledger = new Ledger(
      {
        getItem: () => null,
        removeItem: () => {
          throw new Error('Storage full');
        },
        setItem: () => {
          throw new Error('Storage full');
        },
      },
      'p',
    );
    expect(() => ledger.edit('q', '42', 'op')).toThrow('Storage full');
  });
});

describe('pending valid edits and intermediate drafts', () => {
  it.each(['', '-', '1e', '0'])(
    'retains a valid offline edit when the draft becomes %j',
    (text) => {
      const { ledger, storage } = setup();
      const valid = ledger.edit('q', '123', 'offline-valid-operation');
      ledger.edit('q', text, 'intermediate-operation');
      const reopened = new Ledger(storage, 'person');
      expect(reopened.read('q')?.operation.text).toBe(text);
      expect(reopened.pendingOperation('q')).toEqual(valid.operation);
    },
  );
  it('settles an earlier valid edit without replacing the current empty draft', () => {
    const { ledger } = setup();
    const valid = ledger.edit('q', '123', 'offline-valid-operation');
    ledger.edit('q', '', 'intermediate-operation');
    const accepted = { ...answer(1), ...valid.operation };
    ledger.receipt(
      { operationId: valid.operation.operationId, status: 'accepted', answer: accepted },
      'q',
    );
    expect(ledger.pendingOperation('q')).toBeNull();
    expect(ledger.read('q')?.operation.text).toBe('');
    ledger.remote(accepted);
    expect(ledger.read('q')?.operation.text).toBe('');
  });
  it('retries only the latest valid operation through repeated intermediate drafts', () => {
    const { ledger } = setup();
    ledger.edit('q', '1', 'first-valid-operation');
    ledger.edit('q', '', 'first-empty-operation');
    const latest = ledger.edit('q', '123', 'latest-valid-operation');
    ledger.edit('q', '-', 'invalid-operation');
    ledger.edit('q', '', 'last-empty-operation');
    expect(ledger.pendingOperation('q')).toEqual(latest.operation);
  });
  it('does not let an old acknowledgment clear a newer queued valid edit', () => {
    const { ledger } = setup();
    const old = ledger.edit('q', '1', 'old-valid-operation');
    ledger.edit('q', '', 'first-empty-operation');
    const latest = ledger.edit('q', '12', 'latest-valid-operation');
    ledger.edit('q', '', 'last-empty-operation');
    ledger.receipt(
      {
        operationId: old.operation.operationId,
        status: 'accepted',
        answer: { ...answer(1), ...old.operation },
      },
      'q',
    );
    expect(ledger.pendingOperation('q')).toEqual(latest.operation);
  });
  it('reports a rejected queued answer while keeping the intermediate draft intact', () => {
    const { ledger } = setup();
    const valid = ledger.edit('q', '123', 'offline-valid-operation');
    ledger.edit('q', '', 'intermediate-operation');
    ledger.receipt(
      { operationId: valid.operation.operationId, status: 'invalid', answer: null },
      'q',
    );
    expect(ledger.pendingOperation('q')).toBeNull();
    expect(ledger.read('q')?.operation.text).toBe('');
    expect(ledger.read('q')?.error).toContain('Nieprawidłowa liczba');
  });
});

it('keeps revision numbers increasing after moderation reverts or removes an answer', () => {
  const { ledger } = setup();
  ledger.edit('q', '123', 'first', 9);
  ledger.remote({ ...answer(10), text: '123' });
  ledger.authoritative('q', answer(1));
  expect(ledger.edit('q', '999', 'next').operation.revision).toBe(11);
  ledger.remote({ ...answer(11), text: '999' });
  ledger.authoritative('q', undefined);
  expect(ledger.edit('q', '100', 'after-removal').operation.revision).toBe(12);
});
