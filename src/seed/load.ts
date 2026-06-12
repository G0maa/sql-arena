/**
 * Seed loader (AgDR-0007): server-side `COPY … FROM file` via the existing `pg`
 * client. The generated CSVs live on the Postgres host (mounted into the
 * container at `/seed-data`), so each table loads with a single plain-SQL
 * statement — no client-side streaming, no extra dependency.
 *
 * `loadSeed(pool)` is exported so the Step-5 per-submission reset
 * (AgDR-0004) reuses the identical TRUNCATE + COPY path; this file's CLI wrapper
 * just calls it with a pool built from `$DATABASE_URL`.
 *
 * Run:  npm run db:seed:load
 *
 * The connecting role must be able to read server files (`pg_read_server_files`
 * or superuser — the dev `arena` user qualifies).
 */
import { Pool } from 'pg';

/** Directory, on the DB host, where the CSVs live. Container path by default. */
const SEED_DATA_DIR = process.env.SEED_DATA_DIR ?? '/seed-data';

/** FK-safe load order. Table names are a fixed allowlist (never user input). */
const LOAD_ORDER = [
  'category',
  'product',
  'customer',
  'orders',
  'order_details',
] as const;

/**
 * TRUNCATE the seed tables and re-COPY every CSV in FK order, in one
 * transaction. Idempotent: re-running replaces the data wholesale.
 */
export async function loadSeed(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // No FK constraints on seed (AgDR-0005), so a single TRUNCATE is fine.
    await client.query(
      'TRUNCATE seed.order_details, seed.orders, seed.product, seed.customer, seed.category',
    );
    for (const table of LOAD_ORDER) {
      const path = `${SEED_DATA_DIR}/${table}.csv`;
      const started = Date.now();
      await client.query(
        `COPY seed.${table} FROM '${path}' WITH (FORMAT csv, HEADER)`,
      );
      console.log(
        `  ✓ seed.${table} loaded in ${((Date.now() - started) / 1000).toFixed(1)}s`,
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** CLI entry point — only runs when invoked directly, not when imported. */
if (require.main === module) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set — cannot connect to Postgres');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  console.log(`→ Loading seed CSVs from ${SEED_DATA_DIR} (server-side COPY)`);
  loadSeed(pool)
    .then(() => console.log('✔ Seed load complete.'))
    .catch((err) => {
      console.error('Seed load failed:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
