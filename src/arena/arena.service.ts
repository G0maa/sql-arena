import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { QUESTIONS } from '../seed/questions';

// code → expected output columns, sourced from the committed question registry.
// Surfaced as an output-format hint; see AgDR-0012.
const EXPECTED_COLUMNS: Record<string, string[]> = Object.fromEntries(
  QUESTIONS.map((q) => [q.code, q.expected_columns]),
);

export interface QuestionSummary {
  code: string;
  title: string;
  prompt: string;
  /** Whether row order is part of the grading contract. */
  ordered: boolean;
  /** Expected output columns, in order (a format hint for contestants). */
  expected_columns: string[];
  /** Number of rows the correct answer has (an empty result can be correct). */
  expected_row_count: number;
  /**
   * First row of the golden result as a format hint, or null when the answer
   * is empty. Deliberately ONLY the first row — never the full golden result,
   * which stays secret behind the isolation boundary.
   */
  sample_row: (string | null)[] | null;
}

export interface SubmitInput {
  question_code: string;
  display_name: string;
  setup_sql?: string | null;
  sql: string;
}

export interface SubmitResult {
  submission_id: string;
  status: 'queued';
}

export interface SubmissionStatus {
  status: 'queued' | 'running' | 'done';
  position?: number;
  result?: string | null;
  exec_ms?: string | null;
  ranked?: boolean;
  message?: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  display_name: string;
  exec_ms: string;
}

@Injectable()
export class ArenaService {
  constructor(private readonly db: DatabaseService) {}

  async listQuestions(): Promise<QuestionSummary[]> {
    const client = await this.db.getRwPool().connect();
    try {
      // Derive the row count and the single sample row in SQL — never fetch the
      // full golden_result into Node. Q6's golden alone is ~632k rows; pulling
      // and parsing the whole array just to read .length and [0] made every
      // page load sluggish (#18). jsonb_array_length / ->0 give exactly the two
      // values the output-format hint needs, and ->0 also enforces the no-leak
      // invariant at the source (only the first row ever leaves the DB).
      const res = await client.query<{
        code: string;
        title: string;
        prompt: string;
        ordered: boolean;
        expected_row_count: number | null;
        sample_row: (string | null)[] | null;
      }>(
        `SELECT code, title, prompt, ordered,
                jsonb_array_length(golden_result) AS expected_row_count,
                golden_result->0               AS sample_row
           FROM app.questions
          ORDER BY code`,
      );
      // Both derived fields are null when golden_result is NULL (question not
      // loaded); an empty golden ([]) yields count 0 + a null sample row.
      return res.rows.map((r) => ({
        code: r.code,
        title: r.title,
        prompt: r.prompt,
        ordered: r.ordered,
        expected_columns: EXPECTED_COLUMNS[r.code] ?? [],
        expected_row_count: r.expected_row_count ?? 0,
        sample_row: r.sample_row ?? null,
      }));
    } finally {
      client.release();
    }
  }

  async enqueueSubmission(input: SubmitInput): Promise<SubmitResult> {
    const client = await this.db.getRwPool().connect();
    try {
      const res = await client.query<{ id: string }>(
        `INSERT INTO app.submissions (question_code, display_name, setup_sql, sql)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [
          input.question_code,
          input.display_name,
          input.setup_sql ?? null,
          input.sql,
        ],
      );
      return { submission_id: res.rows[0].id, status: 'queued' };
    } finally {
      client.release();
    }
  }

  async getSubmission(id: string): Promise<SubmissionStatus | null> {
    const client = await this.db.getRwPool().connect();
    try {
      const subRes = await client.query<{
        status: 'queued' | 'running' | 'done';
        question_code: string;
        display_name: string;
        result: string | null;
        exec_ms: string | null;
        message: string | null;
        created_at: Date;
      }>(
        `SELECT status, question_code, display_name, result, exec_ms, message, created_at
           FROM app.submissions
          WHERE id = $1`,
        [id],
      );

      if (subRes.rows.length === 0) return null;

      const sub = subRes.rows[0];
      const out: SubmissionStatus = {
        status: sub.status,
        result: sub.result,
        exec_ms: sub.exec_ms,
        message: sub.message,
      };

      if (sub.status === 'queued') {
        const posRes = await client.query<{ position: string }>(
          `SELECT COUNT(*) AS position
             FROM app.submissions
            WHERE status = 'queued'
              AND created_at < $1`,
          [sub.created_at],
        );
        out.position = Number(posRes.rows[0].position);
      }

      if (
        sub.status === 'done' &&
        sub.result === 'correct' &&
        sub.exec_ms != null
      ) {
        const lbRes = await client.query<{ exec_ms: string }>(
          `SELECT exec_ms FROM app.leaderboard
            WHERE question_code = $1 AND display_name = $2`,
          [sub.question_code, sub.display_name],
        );
        out.ranked =
          lbRes.rows.length > 0 && lbRes.rows[0].exec_ms === sub.exec_ms;
      } else {
        out.ranked = false;
      }

      return out;
    } finally {
      client.release();
    }
  }

  async getLeaderboard(code: string): Promise<LeaderboardEntry[]> {
    const client = await this.db.getRwPool().connect();
    try {
      const res = await client.query<{ display_name: string; exec_ms: string }>(
        `SELECT display_name, exec_ms
           FROM app.leaderboard
          WHERE question_code = $1
          ORDER BY exec_ms::numeric ASC`,
        [code],
      );
      return res.rows.map((row, i) => ({
        rank: i + 1,
        display_name: row.display_name,
        exec_ms: row.exec_ms,
      }));
    } finally {
      client.release();
    }
  }
}
