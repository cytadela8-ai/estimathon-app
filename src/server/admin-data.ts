/** Host answer and question-result reads share a fixed row budget, enforced by SQL LIMIT. */
import type { Contest } from '#est-server/contest';
import { pageInfo } from '#est-server/pagination';
import type { AdminQuery, AnswerPage } from '#est-shared/admin';
import type { Answer, QuestionResults } from '#est-shared/protocol';

export function countedAnswers(contest: Contest, query: AdminQuery): AnswerPage {
  const { total } = contest.db.prepare('SELECT COUNT(*) AS total FROM answers').get() as {
    total: number;
  };
  const pagination = pageInfo(total, query.page);
  const items = contest.db
    .prepare(`SELECT * FROM answers
    ORDER BY acceptedAt DESC,operationId,participantId,questionId LIMIT ? OFFSET ?`)
    .all(pagination.pageSize, (pagination.page - 1) * pagination.pageSize) as Answer[];
  return { ...pagination, items };
}

/** Page across question/participant pairs while preserving ranks from the entire field. */
export function questionResults(contest: Contest, query: AdminQuery) {
  const questions: QuestionResults[] = contest
    .questionSummaries()
    .map((question) => ({ ...question, results: [] }));
  const selected = questions.filter((q) => !query.questionId || q.question.id === query.questionId);
  const { total } = contest.db
    .prepare(`SELECT COUNT(*) AS total FROM participants p
    WHERE instr(polish_lower(p.firstName || ' ' || p.lastName || ' ' || p.nickname),?)>0`)
    .get(query.participant) as { total: number };
  const resultsPagination = pageInfo(total * selected.length, query.resultsPage);
  let offset = (resultsPagination.page - 1) * resultsPagination.pageSize;
  let remaining = resultsPagination.pageSize;
  for (const question of selected) {
    if (offset >= total) {
      offset -= total;
      continue;
    }
    question.results = rankedResults(contest, {
      questionId: question.question.id,
      participant: query.participant,
      limit: remaining,
      offset,
    });
    remaining -= question.results.length;
    offset = 0;
    if (!remaining) break;
  }
  return { questions, resultsPagination };
}

function rankedResults(
  contest: Contest,
  params: { questionId: string; participant: string; limit: number; offset: number },
): QuestionResults['results'] {
  return contest.db
    .prepare(`SELECT participantId,nickname,answer,score,place FROM (
    SELECT p.id AS participantId,p.nickname,p.firstName,p.lastName,a.text AS answer,
      COALESCE(s.score,0) AS score,RANK() OVER (ORDER BY COALESCE(s.score,0) DESC) AS place
    FROM participants p LEFT JOIN answers a ON a.participantId=p.id AND a.questionId=@questionId
    LEFT JOIN scores s ON s.participantId=p.id AND s.questionId=@questionId
    ) WHERE instr(polish_lower(firstName || ' ' || lastName || ' ' || nickname),@participant)>0
    ORDER BY score DESC,nickname,participantId LIMIT @limit OFFSET @offset`)
    .all(params) as QuestionResults['results'];
}
