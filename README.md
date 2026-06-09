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

- **NestJS** (TypeScript) — API + static page serving
- **Kysely + pg** — typed SQL access to Postgres
- **Postgres** — seeded e-commerce dataset, reset to a known state per run
- **Docker Compose** — local dev + reproducible host environment

## Status

Early scaffold. See the design docs in the ApexYard ops repo:

- PRD: `projects/sql-arena/prds/sql-arena.md`
- Tech design: `projects/sql-arena/architecture/tech-design.md`
- Decisions: `projects/sql-arena/docs/agdr/`
