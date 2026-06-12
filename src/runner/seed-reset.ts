import { Pool } from 'pg';
import { loadSeed } from '../seed/load';

/**
 * seed-reset — restore the seed schema to a pristine baseline after a submission
 * that ran setup_sql (AgDR-0004 / AgDR-0007).
 *
 * Strategy: DROP SCHEMA seed CASCADE + rebuild (AgDR-0010).
 * CASCADE removes every object a contestant could have left behind (indexes, tables,
 * matviews, views, sequences). Simpler than catalog-diffing and matches the documented
 * intent in seed.sql / bootstrap.sql: "the per-submission reset re-executes it at runtime".
 *
 * Runs on the privileged pool (arena role) because:
 *   - DROP SCHEMA CASCADE requires ownership (arena_runner owns seed, but the privileged
 *     pool also works and additionally has pg_read_server_files for COPY in loadSeed).
 *   - loadSeed() needs pg_read_server_files for server-side COPY from /seed-data/.
 *
 * buildResetStatements() is exported as a pure function for unit testing.
 */

/**
 * The DDL statements that recreate the seed schema after DROP SCHEMA CASCADE.
 * Mirrors bootstrap.sql + seed.sql so they stay in sync by sharing this source.
 *
 * Returned as individual statements so callers can run them one by one (important
 * for SET ROLE / RESET ROLE which must be separate statements in pg).
 */
export function buildResetStatements(): string[] {
  return [
    'DROP SCHEMA IF EXISTS seed CASCADE',
    'CREATE SCHEMA seed AUTHORIZATION arena_runner',
    'REVOKE ALL ON SCHEMA seed FROM arena_rw, PUBLIC',

    // Set role to arena_runner so all tables are owned by that role
    // (matching bootstrap.sql behaviour — ownership enables contestant CREATE INDEX)
    'SET ROLE arena_runner',

    // seed.category
    `CREATE TABLE IF NOT EXISTS seed.category (
  category_id   integer PRIMARY KEY,
  category_name text NOT NULL
)`,

    // seed.product
    `CREATE TABLE IF NOT EXISTS seed.product (
  product_id     integer PRIMARY KEY,
  category_id    integer NOT NULL,
  name           text NOT NULL,
  description    text,
  price          numeric(12, 2) NOT NULL,
  stock_quantity integer NOT NULL
)`,

    // seed.customer
    `CREATE TABLE IF NOT EXISTS seed.customer (
  customer_id   integer PRIMARY KEY,
  first_name    text NOT NULL,
  last_name     text NOT NULL,
  email         text NOT NULL,
  password_hash text NOT NULL
)`,

    // seed.orders
    `CREATE TABLE IF NOT EXISTS seed.orders (
  order_id     bigint PRIMARY KEY,
  customer_id  integer NOT NULL,
  order_date   timestamptz NOT NULL,
  total_amount numeric(14, 2) NOT NULL
)`,

    // seed.order_details
    `CREATE TABLE IF NOT EXISTS seed.order_details (
  order_details_id bigint PRIMARY KEY,
  product_id       integer NOT NULL,
  order_id         bigint NOT NULL,
  quantity         integer NOT NULL,
  unit_price       numeric(12, 2) NOT NULL
)`,

    'RESET ROLE',
  ];
}

/**
 * Execute a full seed reset on the privileged pool:
 *   1. DROP SCHEMA seed CASCADE (removes all contestant objects)
 *   2. Recreate schema + tables (mirrors bootstrap.sql / seed.sql)
 *   3. loadSeed() — TRUNCATE (no-op on fresh tables) + server-side COPY from CSVs
 *
 * Only called when setup_sql ran (AgDR-0004 skip-reset optimisation).
 * A failed reset is logged and rethrown — the caller should surface it prominently
 * because the next contestant's run will be on a non-pristine schema.
 */
export async function resetSeed(privilegedPool: Pool): Promise<void> {
  const client = await privilegedPool.connect();
  try {
    for (const stmt of buildResetStatements()) {
      await client.query(stmt);
    }
  } finally {
    client.release();
  }

  // loadSeed uses its own client from the pool for TRUNCATE + COPY
  await loadSeed(privilegedPool);
}
