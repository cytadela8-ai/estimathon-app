/** Persisted contest state machine; timestamps, acceptance and result disclosure are server-owned. */
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type {
  Config,
  Question,
  State,
  Command,
  Snapshot,
  Result,
  Standing,
} from '#est-shared/protocol';
import { validNumber } from '#est-shared/protocol';
import type { Scorer } from '#est-server/scoring';
import { unconfiguredScorer } from '#est-server/scoring';
interface Stored {
  config: Config;
  questions: Question[];
  state: State;
}
const defaults: Config = {
  durationSeconds: 180,
  graceSeconds: 5,
  latePolicy: 'strict',
  resultsSeconds: null,
  maxAnswer: '999999999999999999999999999999',
};
export class Contest {
  data: Stored;
  constructor(
    readonly db: Database.Database,
    readonly score: Scorer = unconfiguredScorer,
  ) {
    const row = db.prepare('SELECT data FROM contest WHERE id=1').get() as
      | { data: string }
      | undefined;
    this.data = row
      ? (JSON.parse(row.data) as Stored)
      : {
          config: defaults,
          questions: [],
          state: {
            phase: 'lobby',
            index: -1,
            startedAt: null,
            endsAt: null,
            closesAt: null,
            remainingMs: 0,
            resultsAt: null,
            version: 0,
          },
        };
    this.persist();
  }
  persist(): void {
    this.db.prepare('INSERT OR REPLACE INTO contest VALUES(1,?)').run(JSON.stringify(this.data));
  }
  get state(): State {
    return this.data.state;
  }
  get question(): Question | undefined {
    return this.data.questions[this.state.index];
  }
  configure(config: Config, questions: Question[]): void {
    if (this.state.phase !== 'lobby') throw new Error('Konfigurację można zmienić przed startem.');
    validateConfiguration(config, questions);
    this.data.config = config;
    this.data.questions = questions.map((q) => ({ ...q, id: randomUUID() }));
    this.state.version++;
    this.persist();
  }
  command(command: Command, now = Date.now()): void {
    this.tick(now);
    const state = this.state;
    switch (command) {
      case 'start':
        if (state.phase !== 'lobby' || !this.data.questions.length)
          throw new Error('Dodaj pytania przed startem.');
        this.begin(0, now);
        break;
      case 'pause':
        if (state.phase !== 'active') throw new Error('Pytanie nie jest aktywne.');
        state.remainingMs = Math.max(0, (state.endsAt ?? now) - now);
        state.phase = 'paused';
        state.endsAt = null;
        state.closesAt = null;
        break;
      case 'resume':
        if (state.phase !== 'paused') throw new Error('Konkurs nie jest wstrzymany.');
        state.phase = 'active';
        this.setDeadline(now + state.remainingMs);
        break;
      case 'extend':
        if (state.phase === 'paused') state.remainingMs += 30_000;
        else if (state.phase === 'active') this.setDeadline((state.endsAt ?? now) + 30_000);
        else throw new Error('Czas można dodać podczas pytania.');
        break;
      case 'next':
        if (state.phase === 'active' || state.phase === 'paused') {
          state.phase = 'closing';
          this.setDeadline(now);
        } else if (state.phase === 'results') this.begin(state.index + 1, now);
        else throw new Error('Poczekaj na zamknięcie odpowiedzi.');
        break;
      case 'finish':
        if (state.phase !== 'results') throw new Error('Zakończ po ujawnieniu wyników pytania.');
        state.phase = 'finished';
        break;
      default:
        throw new Error('Nieznane polecenie.');
    }
    state.version++;
    this.persist();
    this.tick(now);
  }
  private setDeadline(end: number): void {
    this.state.endsAt = end;
    const grace =
      this.data.config.latePolicy === 'grace' ? this.data.config.graceSeconds * 1000 : 0;
    // A separate two-second reveal delay also applies with strict acceptance.
    this.state.closesAt = end + grace;
  }
  private begin(index: number, now: number): void {
    if (index >= this.data.questions.length) {
      this.state.phase = 'finished';
      return;
    }
    Object.assign(this.state, { index, phase: 'active', startedAt: now, resultsAt: null });
    this.setDeadline(now + (this.question?.seconds ?? this.data.config.durationSeconds) * 1000);
  }
  tick(now = Date.now()): boolean {
    const previous = this.state.version;
    const state = this.state;
    if (state.phase === 'active' && now >= (state.endsAt ?? Infinity)) {
      state.phase = 'closing';
      state.version++;
    }
    if (state.phase === 'closing' && now >= (state.closesAt ?? Infinity) + 2000) {
      this.db.transaction(() => {
        this.finalize();
        state.phase = 'results';
        state.resultsAt = now;
        state.version++;
        this.persist();
      })();
    }
    const duration = this.data.config.resultsSeconds;
    if (
      state.phase === 'results' &&
      duration !== null &&
      now >= (state.resultsAt ?? now) + duration * 1000
    ) {
      this.begin(state.index + 1, now);
      state.version++;
    }
    if (state.version !== previous) this.persist();
    return state.version !== previous;
  }
  private finalize(): void {
    const question = this.question;
    if (!question) return;
    const answers = this.db
      .prepare('SELECT participantId,text FROM answers WHERE questionId=?')
      .all(question.id) as { participantId: string; text: string }[];
    const save = this.db.prepare('INSERT OR REPLACE INTO scores VALUES(?,?,?)');
    for (const answer of answers) {
      const points = this.score(BigInt(answer.text), BigInt(question.correct));
      if (points !== null && !Number.isFinite(points))
        throw new Error('Scorer returned a non-finite score');
      save.run(answer.participantId, question.id, points);
    }
  }
  snapshot(now = Date.now()): Snapshot {
    this.tick(now);
    const revealed = this.state.phase === 'results' || this.state.phase === 'finished';
    const id = this.question?.id ?? '';
    const participants = this.db.prepare('SELECT count(*) AS n FROM participants').get() as {
      n: number;
    };
    const answers = this.db
      .prepare('SELECT count(*) AS n FROM answers WHERE questionId=?')
      .get(id) as { n: number };
    return {
      serverNow: now,
      state: { ...this.state },
      question: this.question ? { id, text: this.question.text } : null,
      totalQuestions: this.data.questions.length,
      participantCount: participants.n,
      answerCount: answers.n,
      correct: revealed ? (this.question?.correct ?? null) : null,
      results: revealed ? this.results(id) : [],
      standings: revealed ? this.standings() : [],
      scoringConfigured: this.score !== unconfiguredScorer,
    };
  }
  private results(id: string): Result[] {
    return this.db
      .prepare(`SELECT p.id AS participantId,p.nickname,a.text AS answer,s.score
      FROM participants p LEFT JOIN answers a ON a.participantId=p.id AND a.questionId=?
      LEFT JOIN scores s ON s.participantId=p.id AND s.questionId=? ORDER BY p.nickname,p.id`)
      .all(id, id) as Result[];
  }
  private standings(): Standing[] {
    return this.db
      .prepare(`SELECT p.id AS participantId,p.nickname,SUM(s.score) AS score
      FROM participants p LEFT JOIN scores s ON s.participantId=p.id
      GROUP BY p.id ORDER BY score DESC,p.nickname,p.id`)
      .all() as Standing[];
  }
}
function validateConfiguration(config: Config, questions: Question[]): void {
  const integer = (n: number, min: number, max: number) =>
    Number.isInteger(n) && n >= min && n <= max;
  if (
    !config ||
    !integer(config.durationSeconds, 1, 86400) ||
    !integer(config.graceSeconds, 0, 60) ||
    !['strict', 'grace'].includes(config.latePolicy) ||
    (config.resultsSeconds !== null && !integer(config.resultsSeconds, 15, 86400)) ||
    typeof config.maxAnswer !== 'string' ||
    !/^\d{1,100}$/.test(config.maxAnswer) ||
    BigInt(config.maxAnswer) < 1n
  )
    throw new Error('Nieprawidłowa konfiguracja konkursu.');
  if (!Array.isArray(questions) || questions.length > 100)
    throw new Error('Maksymalnie 100 pytań.');
  for (const q of questions) {
    if (
      !q ||
      typeof q.text !== 'string' ||
      !q.text.trim() ||
      q.text.length > 2000 ||
      typeof q.correct !== 'string' ||
      !validNumber(q.correct, config.maxAnswer) ||
      !integer(q.seconds, 1, 86400)
    )
      throw new Error('Sprawdź treść, odpowiedź i czas pytania.');
  }
}
