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
 * Owns the single `pg` connection pool and the Kysely instance the rest of the
 * app queries through. Created on module init, torn down on shutdown.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool!: Pool;
  public db!: Kysely<Database>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set — cannot connect to Postgres');
    }
    this.pool = new Pool({ connectionString });
    this.db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
    this.logger.log('Kysely/pg pool initialised');
  }

  async onModuleDestroy(): Promise<void> {
    await this.db?.destroy();
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
