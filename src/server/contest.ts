/**
 * Persisted contest state machine; timestamps, acceptance and result disclosure are server-owned.
 */
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
import { scoreQuestion } from '#est-server/scoring';
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
  constructor(readonly db: Database.Database) {
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
    this.rebuildScores();
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
        this.start(now);
        break;
      case 'pause':
        this.pause(now);
        break;
      case 'resume':
        this.resume(now);
        break;
      case 'extend':
        this.extend(now);
        break;
      case 'next':
        this.next(now);
        break;
      case 'finish':
        this.finish(now);
        break;
      default:
        throw new Error('Nieznane polecenie.');
    }
    state.version++;
    this.persist();
    this.tick(now);
  }
  private start(now: number): void {
    if (this.state.phase !== 'lobby' || !this.data.questions.length)
      throw new Error('Dodaj pytania przed startem.');
    this.begin(0, now);
  }
  private pause(now: number): void {
    if (this.state.phase !== 'active') throw new Error('Pytanie nie jest aktywne.');
    this.state.remainingMs = Math.max(0, (this.state.endsAt ?? now) - now);
    this.state.phase = 'paused';
    this.state.endsAt = null;
    this.state.closesAt = null;
  }
  private resume(now: number): void {
    if (this.state.phase !== 'paused') throw new Error('Konkurs nie jest wstrzymany.');
    this.state.phase = 'active';
    this.setDeadline(now + this.state.remainingMs);
  }
  private extend(now: number): void {
    if (this.state.phase === 'paused') this.state.remainingMs += 30_000;
    else if (this.state.phase === 'active') this.setDeadline((this.state.endsAt ?? now) + 30_000);
    else throw new Error('Czas można dodać podczas pytania.');
  }
  private next(now: number): void {
    if (this.state.phase === 'active' || this.state.phase === 'paused') {
      this.state.phase = 'closing';
      this.setDeadline(now);
    } else if (this.state.phase === 'results') this.begin(this.state.index + 1, now);
    else throw new Error('Poczekaj na zamknięcie odpowiedzi.');
  }
  private finish(now: number): void {
    if (this.state.phase !== 'results') throw new Error('Zakończ po ujawnieniu wyników pytania.');
    this.state.phase = 'finished';
    this.state.resultsAt = now;
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
      this.state.resultsAt = now;
      return;
    }
    Object.assign(this.state, { index, phase: 'active', startedAt: now, resultsAt: null });
    this.setDeadline(now + (this.question?.seconds ?? this.data.config.durationSeconds) * 1000);
  }
  tick(now = Date.now()): boolean {
    const previous = this.state.version;
    const state = this.state;
    if (state.phase === 'active' && deadlineReached(state.endsAt, now)) {
      state.phase = 'closing';
      state.version++;
    }
    if (state.phase === 'closing' && deadlineReached(state.closesAt, now - 2000)) {
      this.db.transaction(() => {
        this.finalize();
        state.phase = 'results';
        state.resultsAt = now;
        state.version++;
        this.persist();
      })();
    }
    this.advanceResults(now);
    if (state.version !== previous) this.persist();
    return state.version !== previous;
  }
  private advanceResults(now: number): void {
    const duration = this.data.config.resultsSeconds;
    if (this.state.phase !== 'results' || duration === null) return;
    if (!deadlineReached(this.state.resultsAt, now - duration * 1000)) return;
    this.begin(this.state.index + 1, now);
    this.state.version++;
  }
  private finalize(question = this.question): void {
    if (!question) return;
    const answers = this.db
      .prepare('SELECT participantId,text FROM answers WHERE questionId=?')
      .all(question.id) as { participantId: string; text: string }[];
    const save = this.db.prepare('INSERT OR REPLACE INTO scores VALUES(?,?,?)');
    for (const result of scoreQuestion(answers, question.correct)) {
      save.run(result.participantId, question.id, result.score);
    }
  }
  private rebuildScores(): void {
    const currentFinalized = ['results', 'finished'].includes(this.state.phase);
    const count = Math.max(0, this.state.index + Number(currentFinalized));
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM scores').run();
      for (const question of this.data.questions.slice(0, count)) this.finalize(question);
    })();
  }

  snapshot(now = Date.now()): Snapshot {
    this.tick(now);
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
      ...this.presentation(id),
      totalQuestions: this.data.questions.length,
      participantCount: participants.n,
      answerCount: answers.n,
    };
  }
  private presentation(
    id: string,
  ): Pick<Snapshot, 'question' | 'correct' | 'results' | 'standings'> {
    const question = this.question;
    const hidden = {
      question: question ? { id, text: question.text } : null,
      correct: null,
      results: [],
      standings: [],
    };
    if (this.state.phase !== 'results' && this.state.phase !== 'finished') return hidden;
    return {
      ...hidden,
      correct: question?.correct ?? null,
      results: this.results(id),
      standings: this.standings(),
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
function deadlineReached(deadline: number | null, now: number): boolean {
  return deadline !== null && now >= deadline;
}
function integer(n: number, min: number, max: number): boolean {
  return Number.isInteger(n) && n >= min && n <= max;
}
function validateConfiguration(config: Config, questions: Question[]): void {
  if (!config) throw new Error('Brak konfiguracji konkursu.');
  validateTiming(config);
  if (
    typeof config.maxAnswer !== 'string' ||
    !/^\d{1,100}$/.test(config.maxAnswer) ||
    BigInt(config.maxAnswer) < 1n
  )
    throw new Error('Nieprawidłowy zakres odpowiedzi.');
  if (!Array.isArray(questions) || questions.length > 100)
    throw new Error('Maksymalnie 100 pytań.');
  for (const question of questions) validateQuestion(question, config.maxAnswer);
}
function validateTiming(config: Config): void {
  if (
    !integer(config.durationSeconds, 1, 86400) ||
    !integer(config.graceSeconds, 0, 60) ||
    !['strict', 'grace'].includes(config.latePolicy)
  )
    throw new Error('Nieprawidłowy czas konkursu.');
  if (config.resultsSeconds !== null && !integer(config.resultsSeconds, 15, 86400)) {
    throw new Error('Wyniki muszą być widoczne przez co najmniej 15 sekund.');
  }
}
function validateQuestion(q: Question, maximum: string): void {
  if (!q || typeof q.text !== 'string' || !q.text.trim() || q.text.length > 2000)
    throw new Error('Sprawdź treść pytania.');
  if (
    typeof q.correct !== 'string' ||
    !validNumber(q.correct, maximum) ||
    !integer(q.seconds, 1, 86400)
  )
    throw new Error('Sprawdź odpowiedź i czas pytania.');
}
