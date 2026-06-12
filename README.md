# SQL Arena

A tiny hosted tool for a mentorship cohort practicing SQL optimization: everyone
runs their queries against **the same** seeded database on **the same** host. The
system verifies correctness, times execution, and ranks correct submissions on a
per-question leaderboard.

## Why

Today each mentee runs queries on their own machine against their own seed data and
self-reports timings — results are non-comparable (different data volumes, different
hardware) and there's no shared signal about who found the fastest approach. SQL Arena
gives the cohort one source of truth for "what's the fastest correct query for QN?"

## Stack

- **NestJS** (Node 22 / TypeScript) — JSON API + static page serving, single process
  (no clustering — the submission queue must have exactly one consumer)
- **Kysely + `pg`** — typed SQL access to Postgres
- **PostgreSQL** — seeded e-commerce dataset, reset to a pristine baseline per run
- **Docker Compose** — local dev + reproducible host environment

## Quick start (Docker Compose)

```bash
docker compose up --build
```

This starts Postgres and the app. Once up:

- App / static page: <http://localhost:3000/>
- Health check: <http://localhost:3000/health> → `{ "status": "ok", "db": "up", ... }`

`docker compose down` stops everything; add `-v` to also drop the Postgres volume.

## Local development (app on host, Postgres in Docker)

```bash
# 1. Start just Postgres
docker compose up postgres -d

# 2. Configure the connection string
cp .env.example .env        # defaults point at localhost:5432

# 3. Install + run with hot reload
npm install
npm run start:dev
```

Useful scripts:

| Script | Does |
|--------|------|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start` | Run the compiled app |
| `npm run start:dev` | Run with watch/hot-reload |
| `npm run typecheck` | Type-check without emitting |
| `npm run lint` | ESLint over `src/` |
| `npm run db:bootstrap` | (Re)apply the schema/roles to an existing DB (see below) |

## Database bootstrap

The DB structure lives as idempotent SQL under `db/` (AgDR-0006), not in a migration
tool — the seed DDL is re-executed verbatim by the per-submission reset (AgDR-0004), so
it has to be a standalone, re-runnable artefact.

- **Fresh volume** — `db/00-bootstrap.sh` is mounted into the Postgres container's
  `docker-entrypoint-initdb.d`, so `docker compose up` on an empty volume bootstraps the
  schema automatically. (Only the top-level `.sh` is auto-run; the `db/sql/*.sql` it
  includes are not run standalone by the entrypoint.)
- **Existing DB** — `npm run db:bootstrap` re-applies the same SQL over `$DATABASE_URL`.
  It is idempotent, so it's safe to re-run while iterating. (Requires a local `psql`
  client; if you don't have one, run the script inside the container instead:
  `docker compose exec postgres /docker-entrypoint-initdb.d/00-bootstrap.sh`.)

What it creates:

- **`seed` schema** — the e-commerce dataset under study: `category`, `product`,
  `customer`, `orders`, `order_details`. **PK-only, no secondary indexes** — the
  missing-index slowness is the whole point of the exercise.
- **`app` schema** — tool state: `questions`, `submissions`, `leaderboard`.
- **Two roles** — `arena_runner` (**owns** the `seed` tables so contestants can
  `CREATE INDEX`; cannot reach `app`) and `arena_rw` (read/write on `app`; cannot reach
  `seed`). The schema-level grants make the golden answers + board unreachable from
  contestant submission SQL. Passwords are env-driven (`ARENA_RUNNER_PASSWORD` /
  `ARENA_RW_PASSWORD`; dev defaults in `.env.example`).

> **Postgres 18 note:** `CREATE INDEX` requires *table ownership* on PG 16/17/18 (the
> PG17 `MAINTAIN` privilege does not cover it), which is why the seed tables are owned by
> `arena_runner` rather than merely granted to it. A PG16 data volume won't start under
> PG18 — use `docker compose down -v` when upgrading an existing local volume.

## Secrets & seed data (not committed)

- **Reference queries / golden answers** live in `secrets/reference_queries.sql`
  (gitignored — see `secrets/reference_queries.sql.example`). They must never be
  committed: a mentee could read the correct answer. They exist only on the server
  and get loaded into the DB at setup.
- **Generated seed CSVs** (`*.csv`, `generated/`, `seed-data/`) are large, produced
  on the server via faker, and double as the reset baseline — never committed.

## Status

**Step 2 of 8 — DB bootstrap.** On top of the Step 1 scaffold (NestJS + Kysely/pg,
Docker Compose, `/health`): the `seed` + `app` schemas, the two roles with the
isolation boundary between them, and the typed Kysely schema (`src/database/types.ts`).
Seeding, the submission runner, the API, and the UI land in subsequent steps.

Design docs (in the ApexYard ops repo):

- PRD: `projects/sql-arena/prds/sql-arena.md`
- Tech design: `projects/sql-arena/architecture/tech-design.md`
- Decisions: `projects/sql-arena/docs/agdr/`
