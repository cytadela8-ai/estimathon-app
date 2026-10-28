/** Every browser test owns a real Fastify server and temporary WAL database, with no test API. */
import { test as base, expect } from '@playwright/test';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type {
  AuditEntry,
  QuestionResults,
  Session,
  Snapshot,
  Standing,
} from '#est-shared/protocol';
export const password = 'browser-test-host-password';
export interface ResultsData {
  audit: AuditEntry[];
  questions: QuestionResults[];
  standings: Standing[];
}
export class Driver {
  token = '';
  constructor(
    readonly url: string,
    readonly restart: () => Promise<void>,
  ) {}
  async request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
    const response = await fetch(this.url + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
    return (await response.json()) as T;
  }
  async login(): Promise<void> {
    this.token = (await this.request<{ token: string }>('/api/login', { password })).token;
  }
  async configure(seconds = 180): Promise<void> {
    await this.request(
      '/api/admin/config',
      {
        config: { durationSeconds: seconds, revealDelaySeconds: 1, maxAnswer: '999999' },
        questions: [
          { id: '', text: 'Pierwsze pytanie', correct: '100', seconds },
          { id: '', text: 'Drugie pytanie', correct: '100', seconds: 180 },
        ],
      },
      'PUT',
    );
  }
  async command(command: string): Promise<void> {
    await this.request('/api/admin/command', { command });
  }
  state(): Promise<Snapshot> {
    return this.request('/api/state', undefined, 'GET');
  }
  results(): Promise<ResultsData> {
    return this.request('/api/admin/results', undefined, 'GET');
  }
  session(nickname: string): Promise<Session> {
    return this.request('/api/session', { firstName: nickname, lastName: 'Test', nickname });
  }
  async waitUntil(serverTime: number): Promise<void> {
    await expect
      .poll(async () => (await this.state()).serverNow, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(serverTime);
  }
}
async function startServer(
  databasePath: string,
  port = 0,
): Promise<{ child: ChildProcess; url: string }> {
  const child = fork(resolve('tests/e2e/server.ts'), [databasePath, String(port)], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, NODE_OPTIONS: '', NODE_ENV: 'test' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let errors = '';
  child.stderr!.on('data', (chunk) => {
    errors += String(chunk);
  });
  const url = await new Promise<string>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Browser server exited (${code}): ${errors}`)));
    child.once('message', (message) => resolve((message as { url: string }).url));
  });
  return { child, url };
}
async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
export const test = base.extend<{ contest: Driver }>({
  context: async ({ context }, use) => {
    const errors: string[] = [];
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    await use(context);
    expect(errors).toEqual([]);
  },
  contest: async ({ browserName }, use) => {
    const directory = await mkdtemp(join(tmpdir(), `estymator-${browserName}-`));
    let child: ChildProcess | undefined;
    try {
      const server = await startServer(join(directory, 'contest.sqlite'));
      child = server.child;
      const driver = new Driver(server.url, async () => {
        await stopServer(child!);
        const resumed = await startServer(
          join(directory, 'contest.sqlite'),
          Number(new URL(server.url).port),
        );
        child = resumed.child;
        await driver.login();
      });
      await driver.login();
      await use(driver);
    } finally {
      if (child) await stopServer(child);
      for (const file of await readdir(directory)) await unlink(join(directory, file));
      await rmdir(directory);
    }
  },
});
export { expect };
