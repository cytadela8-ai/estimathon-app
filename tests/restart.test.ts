/** Black-box durability check: kill a live server after acknowledgment and recover the same file. */
import { fork, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '#est-server/app';
import type {
  ClientEvents,
  ServerEvents,
  Hello,
  Session,
  Operation,
  Receipt,
} from '#est-shared/protocol';
const directories: string[] = [];
const children: ChildProcess[] = [];
let player: Socket<ServerEvents, ClientEvents> | undefined;
let restored: Awaited<ReturnType<typeof createApp>> | undefined;
async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGKILL');
  });
}
afterEach(async () => {
  player?.disconnect();
  for (const child of children.splice(0)) await terminate(child);
  if (restored) await restored.app.close();
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
async function startChild(path: string): Promise<{ child: ChildProcess; url: string }> {
  const child = fork(resolve('tests/fixtures/restart-child.ts'), [path], {
    execArgv: ['--import', 'tsx', '--conditions=development'],
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  let errors = '';
  child.stderr!.on('data', (chunk) => {
    errors += String(chunk);
  });
  const url = await new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Test server exited (${code}): ${errors}`)));
    child.once('message', (message) => resolve((message as { url: string }).url));
  });
  return { child, url };
}
it('retains an acknowledged answer, idempotency receipt, session and deadline after SIGKILL', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'estymator-crash-'));
  directories.push(directory);
  const databasePath = join(directory, 'contest.sqlite');
  const { child, url } = await startChild(databasePath);
  const response = await fetch(`${url}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ firstName: 'Jan', lastName: 'Restart', nickname: 'JR' }),
  });
  expect(response.ok).toBe(true);
  const session = (await response.json()) as Session;
  player = io(url, { auth: { token: session.token }, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    player!.once('connect', resolve);
    player!.once('connect_error', reject);
  });
  const before = await new Promise<Hello>((resolve) => player!.emit('snapshot', resolve));
  const operation: Operation = {
    questionId: before.snapshot.question!.id,
    operationId: randomUUID(),
    revision: 1,
    text: '123',
    timing: { inputAt: Date.now(), endsAt: before.snapshot.state.endsAt!, offsetMs: 0 },
  };
  const receipt = await new Promise<Receipt>((resolve) => player!.emit('save', operation, resolve));
  expect(receipt.status).toBe('accepted');
  await terminate(child);
  player.disconnect();
  restored = await createApp({ databasePath, password: 'restart-test-password' });
  await restored.app.listen({ host: '127.0.0.1', port: 0 });
  const address = restored.app.server.address();
  if (!address || typeof address === 'string') throw new Error('Restart listener is missing.');
  player = io(`http://127.0.0.1:${address.port}`, {
    auth: { token: session.token },
    reconnection: false,
  });
  await new Promise<void>((resolve, reject) => {
    player!.once('connect', resolve);
    player!.once('connect_error', reject);
  });
  const after = await new Promise<Hello>((resolve) => player!.emit('snapshot', resolve));
  expect(after.snapshot.state.endsAt).toBe(before.snapshot.state.endsAt);
  expect(after.snapshot.state.phase).toBe('active');
  expect(after.answers[0]?.text).toBe('123');
  const audit = restored.db.prepare('SELECT receivedAt,timing FROM submissions').get() as {
    receivedAt: number;
    timing: string;
  };
  expect(audit.receivedAt).toBe(receipt.answer?.acceptedAt);
  expect(JSON.parse(audit.timing)).toEqual(operation.timing);
  expect(after.revisions[operation.questionId]).toBe(1);
  const duplicate = await new Promise<Receipt>((resolve) =>
    player!.emit('save', operation, resolve),
  );
  expect(duplicate).toEqual(receipt);
  const deadline = before.snapshot.state.endsAt!;
  expect(restored.contest.snapshot(deadline).correct).toBeNull();
  expect(restored.contest.snapshot(deadline + 2000).correct).toBe('123');
}, 15000);
