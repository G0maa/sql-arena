# AgDR-0009 — Role-Scoped Runner Connections

> In the context of sql-arena's submission runner (Step 5), facing the need to execute
> contestant SQL as `arena_runner` (owns `seed`, cannot read `app`) while writing queue/
> leaderboard state as `arena_rw` (owns `app`), I decided to add two new raw `pg.Pool`s
> to `DatabaseService` exposed via getters, driven by two new env vars
> (`RUNNER_DATABASE_URL` / `RW_DATABASE_URL`), to achieve role isolation without
> reimplementing connection lifecycle elsewhere, accepting that `DatabaseService` now owns
> three pools instead of one.

## Context

The isolation boundary (AgDR-0004, bootstrap.sql) is enforced at the Postgres level:
`arena_runner` owns `seed` and cannot reach `app`; `arena_rw` owns `app` and cannot
reach `seed`. The NestJS app previously connected with a single privileged `arena` pool
via `DATABASE_URL`. The runner must execute contestant SQL as `arena_runner` (so the
isolation boundary applies) and write queue/leaderboard state as `arena_rw`.

Three decisions were needed:
1. Where to build the two new pools.
2. How to surface them to the runner.
3. Which role runs the seed reset's COPY (requires `pg_read_server_files`).

## Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **3 pools in DatabaseService (chosen)** | Single lifecycle owner; `@Global`, so `RunnerService` injects it directly; single `onModuleDestroy` tears all three down; `loadSeed` pool is already the privileged one so no split needed | `DatabaseService` grows from 1 to 3 pools (slightly less single-purpose) |
| Pools in RunnerModule | Keeps `DatabaseService` focused | Duplicates env-parsing + lifecycle; a second instantiation (e.g. in tests) risks pool leak; no clean path for `loadSeed` which needs the privileged pool |
| One pool with `SET ROLE arena_runner` | No new pools | `SET ROLE` does not cross the schema REVOKE boundary cleanly; the role used for the connection determines what PG verifies at connect time, not at `SET ROLE` time for ownership checks |

## Decision

Chosen: **3 pools in DatabaseService**, because:
- Single lifecycle (`onModuleInit` / `onModuleDestroy`) is the established pattern.
- `DatabaseModule` is `@Global`; `RunnerService` gets the pools without re-importing.
- `loadSeed` (COPY) requires `pg_read_server_files`; the privileged `arena` user qualifies.
  The seed reset therefore runs on `getPrivilegedPool()` for COPY and the orchestrator
  binds this in `runner.service.ts` without leaking the pool reference into `job-runner.ts`.

New env vars:
- `RUNNER_DATABASE_URL` — connection string for `arena_runner` role.
- `RW_DATABASE_URL` — connection string for `arena_rw` role.
- Both default in `docker-compose.yml` to `${ARENA_RUNNER_PASSWORD:-runner}` /
  `${ARENA_RW_PASSWORD:-rw}` — matching the passwords already set at initdb time.

Getters added to `DatabaseService`:
- `getPrivilegedPool()` — for seed reset COPY and admin ops.
- `getRunnerPool()` — for contestant SQL execution (`arena_runner`).
- `getRwPool()` — for `app` schema reads/writes (`arena_rw`).

## Consequences

- `DatabaseService` owns 3 raw `pg.Pool`s. All torn down in `onModuleDestroy`.
- Unit tests for `RunnerService` stub `DatabaseService` using `sinon.stub()` on the
  three getter methods — no real DB needed.
- `resetSeed` in `JobDeps` is bound as `() => resetSeed(db.getPrivilegedPool())` in the
  orchestrator, keeping the `job-runner` module pool-agnostic and unit-testable.
- Apps that deploy without the two new env vars will fail fast on startup (explicit error
  thrown in `onModuleInit`), preventing silent wrong-role operation.

## Artifacts

- `src/database/database.service.ts` — 3 pools, 3 getters, updated teardown
- `src/runner/runner.service.ts` — pool binding for resetSeed
- `docker-compose.yml`, `.env.example` — new env vars
