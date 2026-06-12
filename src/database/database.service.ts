import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { Database } from './types';

/**
 * Owns all pg connection pools and the Kysely instance the app queries through.
 *
 * Three pools (AgDR-0009):
 *   - privileged  (DATABASE_URL / arena role)  — queue writes, leaderboard, seed reset COPY
 *   - runner      (RUNNER_DATABASE_URL / arena_runner role) — contestant SQL execution
 *   - rw          (RW_DATABASE_URL / arena_rw role) — app schema reads/writes
 *
 * All lifecycle managed here; single teardown path via onModuleDestroy.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;
  private runnerPool!: Pool;
  private rwPool!: Pool;
  public db!: Kysely<Database>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — cannot connect to Postgres');
    }
    const runnerUrl = this.config.get<string>('RUNNER_DATABASE_URL');
    if (!runnerUrl) {
      throw new Error(
        'RUNNER_DATABASE_URL is not set — cannot connect as arena_runner',
      );
    }
    const rwUrl = this.config.get<string>('RW_DATABASE_URL');
    if (!rwUrl) {
      throw new Error(
        'RW_DATABASE_URL is not set — cannot connect as arena_rw',
      );
    }

    this.pool = new Pool({ connectionString });
    this.runnerPool = new Pool({ connectionString: runnerUrl });
    this.rwPool = new Pool({ connectionString: rwUrl });
    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
    this.logger.log('Kysely/pg pools initialised (privileged, runner, rw)');
  }

  /** Privileged pool (arena role) — used for seed reset COPY and admin ops. */
  getPrivilegedPool(): Pool {
    return this.pool;
  }

  /** Runner pool (arena_runner role) — used to execute contestant SQL. */
  getRunnerPool(): Pool {
    return this.runnerPool;
  }

  /** Read-write pool (arena_rw role) — used for app schema reads/writes. */
  getRwPool(): Pool {
    return this.rwPool;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.db?.destroy(),
      this.runnerPool?.end(),
      this.rwPool?.end(),
    ]);
  }

  /** Trivial round-trip used by the health route to confirm connectivity. */
  async ping(): Promise<boolean> {
    try {
      await sql`select 1`.execute(this.db);
      return true;
    } catch (err) {
      this.logger.error('Postgres ping failed', err as Error);
      return false;
    }
  }
}
