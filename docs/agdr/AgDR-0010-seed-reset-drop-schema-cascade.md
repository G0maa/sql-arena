# AgDR-0010 — Seed Reset via DROP SCHEMA seed CASCADE + Rebuild

> In the context of the post-submission seed reset (AgDR-0004), facing the need to restore
> the `seed` schema to a pristine baseline after a contestant's `setup_sql` may have left
> arbitrary objects (indexes, tables, matviews) behind, I decided to `DROP SCHEMA seed
> CASCADE` then rebuild the schema from the committed DDL + `loadSeed()` COPY, to achieve
> complete object-level cleanup without catalog bookkeeping, accepting that the reset replays
> DDL on every setup-bearing job.

## Context

AgDR-0004 established "reset after run" as the isolation model. AgDR-0007 established that
`loadSeed()` (TRUNCATE + server-side COPY) is the data-reload mechanism. Neither specified
how to reverse non-data mutations: a contestant who runs `setup_sql` can `CREATE INDEX`,
`CREATE TABLE`, `CREATE MATERIALIZED VIEW`, or `ALTER` columns — all in the `seed` schema,
which `arena_runner` owns.

TRUNCATE + COPY reverses data. It does NOT drop contestant-created indexes or other objects.
The next contestant would inherit those objects, violating the fairness invariant.

## Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **DROP SCHEMA CASCADE + rebuild (chosen)** | `CASCADE` removes every object type; no bookkeeping; matches documented intent in `seed.sql` / `bootstrap.sql` ("the per-submission reset re-executes it at runtime"); simple code | DDL replay on each setup-bearing job (fast in practice: 5 tables, PK-only) |
| Catalog-diff (pg_class baseline snapshot) | Surgical — only drops new objects | Requires boot-time snapshot + post-run diff query; misses object types not included in the snapshot; more moving parts |
| Index-only diff (pg_indexes baseline) | Simplest diff code | Leaves non-index mutations (new tables, matviews, views) from `setup_sql` intact |
| DROP SCHEMA CASCADE + pg_restore -j | Fastest reset for large schemas | Requires a pre-baked dump file; not justified until COPY-based reset is measured too slow; AgDR-0007 deferred this as a speed lever |

## Decision

Chosen: **DROP SCHEMA seed CASCADE + rebuild** because:
- `CASCADE` is the only approach that removes every object type unconditionally.
- The `seed.sql` and `bootstrap.sql` comments explicitly document that the per-submission
  reset re-executes the DDL — this decision aligns code with documented intent.
- The rebuild DDL (5 tables, PK-only) is extracted into `buildResetStatements()` — a pure
  function tested without Postgres, and the single source of truth that bootstrap.sql also
  mirrors. No DDL drift.
- TRUNCATE + COPY follows immediately via the existing `loadSeed()` call — no second
  implementation of the data load path (AgDR-0007).

Reset is only triggered when `setup_sql` ran (AgDR-0004 skip-reset optimisation):
- No `setup_sql` → solution was read-only → seed is unchanged → skip reset.
- `setup_sql` present → DROP CASCADE + rebuild + COPY → pristine for next job.

The reset runs on the privileged pool (`arena` role) because `pg_read_server_files` (needed
for COPY) is held by the `arena` superuser, not by `arena_runner`. See AgDR-0009.

## Consequences

- `src/runner/seed-reset.ts` exports `buildResetStatements()` (pure, unit-tested) and
  `resetSeed(privilegedPool)` (I/O wrapper).
- Integration tests (env-gated `RUN_DB_TESTS=1`) verify the headline AC: after a setup-bearing
  job the contestant index is gone and row counts equal the baseline before the next job.
- Accepted residual: if a contestant `setup_sql` leaves objects in `seed` AND the job
  errors before finishing, the reset still runs (the `finally` block in `job-runner.ts` calls
  `resetSeed` whenever `setupRan = true`, regardless of the verdict). This prevents
  schema-pollution carry-over even on errored jobs.
- Speed levers documented and deferred: `CREATE DATABASE seed TEMPLATE seed_pristine` or
  `pg_restore -j` if reset latency is measured to be a problem at scale.

## Artifacts

- `src/runner/seed-reset.ts` — implementation
- `src/runner/seed-reset.spec.ts` — unit tests for `buildResetStatements()`
- `projects/sql-arena/docs/agdr/AgDR-0010-seed-reset-drop-schema-cascade.md` — this file
