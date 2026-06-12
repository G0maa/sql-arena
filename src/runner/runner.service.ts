import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { runJob, type JobInput, type QuestionMeta } from './job-runner';
import { resetSeed } from './seed-reset';

type RunJobFn = typeof runJob;

/**
 * RunnerService — single background worker that drains app.submissions.
 *
 * Architecture (AgDR-0003): one worker, runs are strictly sequential. The
 * worker starts on ApplicationBootstrap (all pools ready) and stops cleanly
 * on ApplicationShutdown before DatabaseService tears down its pools.
 */
@Injectable()
export class RunnerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RunnerService.name);
  private running = false;
  private loopPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: DatabaseService,
    // Injected for unit-testability; production code uses the real runJob
    private readonly _runJob: RunJobFn = runJob,
  ) {}

  onApplicationBootstrap(): void {
    this.running = true;
    this.loopPromise = this.loop();
    this.logger.log('Submission runner started');
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    await this.loopPromise;
    this.logger.log('Submission runner stopped');
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private async loop(): Promise<void> {
    while (this.running) {
      await this.runOnce();
      if (this.running) {
        await sleep(500);
      }
    }
  }

  /**
   * One iteration of the worker loop: claim one queued row (if any), run it,
   * persist the verdict, and optionally upsert the leaderboard.
   *
   * Exposed as `runOnce` (not private) so unit tests can call it directly
   * without starting the infinite loop.
   */
  async runOnce(): Promise<void> {
    const rwPool = this.db.getRwPool();
    const client = await rwPool.connect();

    let submissionId: string | undefined;
    try {
      // 1. Claim one queued row (FOR UPDATE SKIP LOCKED)
      await client.query('BEGIN');
      const claimRes = await client.query<JobInput & { display_name: string }>(
        `SELECT id, question_code, sql, setup_sql, display_name
           FROM app.submissions
          WHERE status = 'queued'
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
      );

      if (claimRes.rows.length === 0) {
        await client.query('COMMIT');
        return;
      }

      const submission = claimRes.rows[0];
      submissionId = submission.id;

      // 2. Mark running
      await client.query(
        `UPDATE app.submissions SET status = 'running' WHERE id = $1`,
        [submission.id],
      );
      await client.query('COMMIT');
      client.release();

      // 3. Load the question (golden_result + ordered flag)
      const qRes = await rwPool.connect().then(async (c) => {
        try {
          return await c.query<QuestionMeta>(
            `SELECT code, ordered, golden_result
               FROM app.questions
              WHERE code = $1`,
            [submission.question_code],
          );
        } finally {
          c.release();
        }
      });

      if (qRes.rows.length === 0) {
        await this.persistVerdict(rwPool, submission.id, {
          result: 'error',
          message: `Question not found: ${submission.question_code}`,
        });
        return;
      }

      const question = qRes.rows[0];

      // 4. Run the job pipeline
      let verdict: Awaited<ReturnType<RunJobFn>>;
      try {
        verdict = await this._runJob(
          {
            runnerPool: this.db.getRunnerPool(),
            resetSeed: () => resetSeed(this.db.getPrivilegedPool()),
          },
          submission,
          question,
        );
      } catch (err) {
        this.logger.error('Unexpected error in runJob', err as Error);
        verdict = {
          result: 'error',
          message: err instanceof Error ? err.message : String(err),
        };
      }

      // 5. Persist verdict
      await this.persistVerdict(rwPool, submission.id, verdict);

      // 6. Upsert leaderboard on correct
      if (verdict.result === 'correct' && verdict.exec_ms !== undefined) {
        await this.upsertLeaderboard(
          rwPool,
          submission.question_code,
          submission.display_name,
          verdict.exec_ms,
        );
      }
    } catch (err) {
      this.logger.error('Runner iteration failed', err as Error);
      // Attempt to mark the submission as errored so it doesn't block the queue
      if (submissionId) {
        try {
          await client.query('ROLLBACK').catch(() => undefined);
          await this.persistVerdict(this.db.getRwPool(), submissionId, {
            result: 'error',
            message: `Runner error: ${err instanceof Error ? err.message : String(err)}`,
          });
        } catch {
          // Best-effort
        }
      }
    } finally {
      try {
        client.release();
      } catch {
        // May already be released
      }
    }
  }

  private async persistVerdict(
    pool: import('pg').Pool,
    id: string,
    verdict: { result: string; exec_ms?: number; message?: string },
  ): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query(
        `UPDATE app.submissions
            SET status = 'done',
                result = $2,
                exec_ms = $3,
                message = $4,
                finished_at = now()
          WHERE id = $1`,
        [id, verdict.result, verdict.exec_ms ?? null, verdict.message ?? null],
      );
    } finally {
      c.release();
    }
  }

  private async upsertLeaderboard(
    pool: import('pg').Pool,
    questionCode: string,
    displayName: string,
    execMs: number,
  ): Promise<void> {
    const c = await pool.connect();
    try {
      await c.query(
        `INSERT INTO app.leaderboard (question_code, display_name, exec_ms, updated_at)
              VALUES ($1, $2, $3, now())
         ON CONFLICT (question_code, display_name)
         DO UPDATE
            SET exec_ms = EXCLUDED.exec_ms,
                updated_at = now()
          WHERE app.leaderboard.exec_ms > EXCLUDED.exec_ms`,
        [questionCode, displayName, String(execMs)],
      );
    } finally {
      c.release();
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
