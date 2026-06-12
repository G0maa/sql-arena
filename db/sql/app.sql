-- app.sql — tool state: questions, the submissions queue, the leaderboard.
--
-- Included by bootstrap.sql via `\ir`, executed under `SET ROLE arena_rw` so
-- these tables are OWNED BY arena_rw. This schema holds the golden answers and
-- the board; bootstrap.sql REVOKEs it from arena_runner + PUBLIC so it is
-- unreachable from contestant submission SQL (the isolation boundary).
--
-- `IF NOT EXISTS` keeps this file re-runnable.

-- One row per challenge. `reference_query` + `golden_result` are the secret
-- the isolation boundary protects.
CREATE TABLE IF NOT EXISTS app.questions (
  code            text PRIMARY KEY,
  title           text NOT NULL,
  prompt          text NOT NULL,
  reference_query text NOT NULL,
  ordered         boolean NOT NULL DEFAULT false,  -- is result row-order significant?
  golden_result   jsonb
);

-- The submissions queue. A single serial worker (AgDR-0003) drains it.
-- `status`  tracks queue lifecycle; `result` is the graded verdict (NULL until done).
CREATE TABLE IF NOT EXISTS app.submissions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  question_code text NOT NULL,
  display_name  text NOT NULL,
  setup_sql     text,                              -- optional, free-form (AgDR-0004)
  sql           text NOT NULL,                     -- the timed solution (single SELECT/WITH)
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued', 'running', 'done')),
  result        text
                  CHECK (result IN ('correct', 'incorrect', 'error', 'timeout')),
  exec_ms       numeric,                           -- min solution Execution Time (AgDR-0002)
  message       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);

-- Best (lowest) execution time per (question, contestant). One row per pair.
CREATE TABLE IF NOT EXISTS app.leaderboard (
  question_code text NOT NULL,
  display_name  text NOT NULL,
  exec_ms       numeric NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (question_code, display_name)
);
