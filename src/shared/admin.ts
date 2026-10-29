/** Host lists use fixed-size server pages; filters apply before pagination. */
import type {
  Answer,
  AuditEntry,
  Participant,
  QuestionResults,
  Standing,
} from '#est-shared/protocol';

export const ADMIN_PAGE_SIZE = 100;
export const REVIEW_PREVIEW_SIZE = 20;

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
}

export interface Page<T> extends PageInfo {
  items: T[];
}

export interface AdminFilter {
  questionId: string;
  participant: string;
  value: string;
  lateOnly: boolean;
  minimumSeconds: number;
}

export interface AdminQuery extends AdminFilter {
  page: number;
  auditPage: number;
  resultsPage: number;
}

export interface AdminResults {
  participants: Participant[];
  questions: QuestionResults[];
  standings: Standing[];
  audit: AuditEntry[];
  auditPagination: PageInfo;
  resultsPagination: PageInfo;
}

export type AnswerPage = Page<Answer>;
