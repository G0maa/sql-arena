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

- **NestJS** (Node 20 / TypeScript) — JSON API + static page serving, single process
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

## Secrets & seed data (not committed)

- **Reference queries / golden answers** live in `secrets/reference_queries.sql`
  (gitignored — see `secrets/reference_queries.sql.example`). They must never be
  committed: a mentee could read the correct answer. They exist only on the server
  and get loaded into the DB at setup.
- **Generated seed CSVs** (`*.csv`, `generated/`, `seed-data/`) are large, produced
  on the server via faker, and double as the reset baseline — never committed.

## Status

**Step 1 of 8 — repo scaffold.** Runnable skeleton: NestJS app + Kysely/pg wiring,
Docker Compose (postgres + app), a placeholder static page, and a `/health` route
that confirms the Postgres connection. Schema, seeding, the submission runner, the
API, and the UI land in subsequent steps.

Design docs (in the ApexYard ops repo):

- PRD: `projects/sql-arena/prds/sql-arena.md`
- Tech design: `projects/sql-arena/architecture/tech-design.md`
- Decisions: `projects/sql-arena/docs/agdr/`
