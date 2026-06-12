/**
 * Kysely database schema (Step 2 — DB bootstrap, AgDR-0006).
 *
 * Table keys are schema-qualified (`'seed.category'`, `'app.submissions'`, …)
 * to match the two-schema layout created by `db/sql/bootstrap.sql`:
 *   - `seed`: the e-commerce dataset under study (PK-only, no secondary indexes).
 *   - `app`:  tool state (questions / submissions queue / leaderboard).
 *
 * This file is the typed mirror of the raw DDL and is kept in sync by hand —
 * `tsc` catches any query referencing a column that doesn't exist here.
 *
 * Column-type notes (node-postgres defaults):
 *   - `bigint`  is returned as a string by `pg`           → string.
 *   - `numeric` is returned as a string by `pg`           → string.
 *   - `timestamptz` is parsed to a JS Date by `pg`        → Timestamp.
 */
import type { ColumnType, Generated } from 'kysely';

/** timestamptz: selected as Date, inserted/updated as Date or ISO string. */
type Timestamp = ColumnType<Date, Date | string, Date | string>;

// --- seed schema -----------------------------------------------------------

export interface SeedCategoryTable {
  category_id: number;
  category_name: string;
}

export interface SeedProductTable {
  product_id: number;
  category_id: number;
  name: string;
  description: string | null;
  price: string;
  stock_quantity: number;
}

export interface SeedCustomerTable {
  customer_id: number;
  first_name: string;
  last_name: string;
  email: string;
  password_hash: string;
}

export interface SeedOrdersTable {
  order_id: string;
  customer_id: number;
  order_date: Timestamp;
  total_amount: string;
}

export interface SeedOrderDetailsTable {
  order_details_id: string;
  product_id: number;
  order_id: string;
  quantity: number;
  unit_price: string;
}

// --- app schema ------------------------------------------------------------

export interface AppQuestionsTable {
  code: string;
  title: string;
  prompt: string;
  reference_query: string;
  ordered: Generated<boolean>;
  golden_result: unknown | null;
}

export interface AppSubmissionsTable {
  id: Generated<string>;
  question_code: string;
  display_name: string;
  setup_sql: string | null;
  sql: string;
  status: Generated<'queued' | 'running' | 'done'>;
  result: 'correct' | 'incorrect' | 'error' | 'timeout' | null;
  exec_ms: string | null;
  message: string | null;
  created_at: Generated<Timestamp>;
  finished_at: Timestamp | null;
}

export interface AppLeaderboardTable {
  question_code: string;
  display_name: string;
  exec_ms: string;
  updated_at: Generated<Timestamp>;
}

// --- database --------------------------------------------------------------

export interface Database {
  'seed.category': SeedCategoryTable;
  'seed.product': SeedProductTable;
  'seed.customer': SeedCustomerTable;
  'seed.orders': SeedOrdersTable;
  'seed.order_details': SeedOrderDetailsTable;
  'app.questions': AppQuestionsTable;
  'app.submissions': AppSubmissionsTable;
  'app.leaderboard': AppLeaderboardTable;
}
