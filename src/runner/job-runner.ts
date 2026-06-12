import { Pool } from 'pg';
import { normaliseRows } from '../grading/normalise';
import { assertSingleSelect } from './solution-guard';
import {
  buildExplainSql,
  parseExecutionMs,
  minExecutionMs,
} from './explain-timing';
import { compareGolden } from './golden-compare';

/** Postgres error code for statement_timeout cancellation */
const PG_QUERY_CANCELED = '57014';

export interface JobInput {
  id: string;
  question_code: string;
  sql: string;
  setup_sql: string | null;
}

export interface QuestionMeta {
  code: string;
  ordered: boolean;
  golden_result: unknown;
}

export type JobResult = 'correct' | 'incorrect' | 'error' | 'timeout';

export interface JobVerdict {
  result: JobResult;
  exec_ms?: number;
  message?: string;
}

/** Dependencies injected into runJob — makes it unit-testable without real pools. */
export interface JobDeps {
  runnerPool: Pool;
  /** Called (no args) only when setup_sql ran — the concrete impl binds the privileged pool. */
  resetSeed: () => Promise<void>;
}

/**
 * Execute one submission through the full pipeline:
 *   guard → setup → solution → normalise → compare → time (×3) → reset
 *
 * Returns a verdict object. Does NOT write to the DB — that's the caller's job.
 * resetSeed is only called when setup_sql ran (AgDR-0004 skip-reset optimisation).
 */
export async function runJob(
  deps: JobDeps,
  submission: JobInput,
  question: QuestionMeta,
): Promise<JobVerdict> {
  const { runnerPool, resetSeed } = deps;

  // 1. Solution guard — pure, no DB required
  try {
    assertSingleSelect(submission.sql);
  } catch (err) {
    return {
      result: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const client = await runnerPool.connect();
  let setupRan = false;
  try {
    await client.query('SET search_path TO seed');

    // 2. Optional setup phase (e.g. CREATE INDEX / ANALYZE)
    if (submission.setup_sql) {
      await client.query("SET statement_timeout='120s'");
      try {
        await client.query(submission.setup_sql);
        setupRan = true;
      } catch (err) {
        setupRan = true; // setup may have partially run → reset is needed
        return resultFor(err, 'Setup SQL failed');
      }
    }

    // 3. Solution — correctness check
    await client.query("SET statement_timeout='30s'");
    let solutionResult: {
      rows: Record<string, unknown>[];
      fields: { name: string }[];
    };
    try {
      solutionResult = (await client.query(
        submission.sql,
      )) as typeof solutionResult;
    } catch (err) {
      return resultFor(err, 'Solution SQL failed');
    }

    const normalised = normaliseRows(
      solutionResult.rows,
      solutionResult.fields,
      question.ordered,
    );

    if (!compareGolden(normalised, question.golden_result)) {
      return { result: 'incorrect' };
    }

    // 4. Timing — best-of-3 EXPLAIN ANALYZE (AgDR-0002)
    const times: number[] = [];
    const explainSql = buildExplainSql(submission.sql);
    for (let i = 0; i < 3; i++) {
      try {
        const er = (await client.query(explainSql)) as {
          rows: Record<string, unknown>[];
          fields: { name: string }[];
        };
        // pg returns FORMAT JSON column value as a pre-parsed JS object
        const planValue = er.rows[0]?.['QUERY PLAN'];
        times.push(parseExecutionMs(planValue));
      } catch (err) {
        return resultFor(err, 'EXPLAIN ANALYZE failed');
      }
    }

    return { result: 'correct', exec_ms: minExecutionMs(times) };
  } finally {
    await client.query('RESET statement_timeout').catch(() => undefined);
    client.release();

    // 5. Reset only when setup_sql ran (AgDR-0004 skip-reset optimisation)
    if (setupRan) {
      await resetSeed();
    }
  }
}

function resultFor(err: unknown, context: string): JobVerdict {
  if (
    err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === PG_QUERY_CANCELED
  ) {
    return { result: 'timeout', message: `${context}: statement timeout` };
  }
  return {
    result: 'error',
    message: `${context}: ${err instanceof Error ? err.message : String(err)}`,
  };
}
