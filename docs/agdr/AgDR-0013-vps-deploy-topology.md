# AgDR-0013 — VPS deployment topology (Caddy TLS + resource-limited Postgres)

**Status**: Accepted
**Date**: 2026-06-13
**Author**: Adel (Platform Engineer)

> In the context of deploying sql-arena to a single shared Hetzner VPS (2 vCPU / 4 GB) for the
> cohort (#12), facing the need for public HTTPS, fair/comparable submission timings, and
> protection of the host from arbitrary contestant SQL, I decided to run the stack via a
> dedicated `docker-compose.prod.yml` — Caddy terminating TLS with automatic Let's Encrypt, the
> app reachable only through Caddy, and Postgres resource-limited (2 vCPU / 2 GB) and tuned to
> that envelope with seeding done host-side over a loopback bind — to achieve a simple,
> reproducible, reasonably-safe deployment, accepting hand-run seeding and disk-bound query
> timings.

## Context

Final pre-launch step (tech-design Step 8). One box, shared by the whole cohort, running
arbitrary contestant `SELECT`s over a ~3M-row seed. Requirements: public HTTPS on
`sql-arena.gomaa.ovh`, real secrets (no dev defaults), full-scale seed generated **on the
server**, and a proven end-to-end loop including an index-optimized run beating a naive one.

## Options Considered

| Axis | Chosen | Alternatives (rejected) |
|------|--------|-------------------------|
| TLS / reverse proxy | **Caddy** — automatic LE issue+renew, 3-line Caddyfile | Traefik (marsa uses it, but in k8s/Helm — labels/cert-resolver overkill for one compose service); nginx + certbot (manual renewal plumbing) |
| Postgres resources | **Limit 2 vCPU / 2 GB**, tuned (`shared_buffers=512MB`, `effective_cache_size=1536MB`, `work_mem=16MB`, `max_connections=20`) | Unbounded (a pathological query OOMs the box / starves the runner; timings vary with host load) |
| App exposure | **Internal only**, via Caddy on the compose network | Publish :3000 (bypasses TLS, widens attack surface) |
| Seeding | **Host-side** `npm` (tsx) over a `127.0.0.1:5432` loopback bind | Seeder container off the build stage (more compose surface); uploading CSVs (the ACs require generating on the server) |

## Decision

A separate **`docker-compose.prod.yml`** (the dev compose keeps published ports + dev
passwords for local work):

- **caddy** publishes 80/443, reverse-proxies to `app:3000`, persists certs in a volume.
- **app** is `expose`-only (no host port); connection strings built from `.env` passwords.
- **postgres** binds `127.0.0.1:5432` only (loopback — lets host seeders connect, stays off the
  public interface), carries `deploy.resources.limits` (2 vCPU / 2 GB) + the tuning flags, and
  auto-bootstraps schema/roles on a fresh volume from the real `.env` passwords.
- Secrets live in a gitignored `.env` on the server (template: `.env.production.example`); the
  golden source `secrets/reference_queries.sql` is uploaded, not committed.

## Consequences

- Simple, restartable stack (`restart: unless-stopped`); certs survive restarts via `caddy_data`.
- **Disk-bound timings**: a 2 GB memory cap bounds PG's page cache for a ~3M-row dataset, so
  absolute `exec_ms` is slowish — but this *widens* the naive-vs-indexed gap, which is the point.
  Relative ordering (what ranks) holds.
- **30s solution `statement_timeout` risk**: a naive scan over the full seed under the cap may
  approach/exceed 30s and return `timeout` instead of `correct`. Mitigation at smoke-test time:
  pick a question whose naive form completes in budget; if none do, tune the limits up or the
  timeout (a follow-up code change with its own ticket/AgDR — out of #12 scope).
- **Heavy per-submission reset**: a setup-SQL-bearing run triggers DROP SCHEMA seed CASCADE +
  rebuild + COPY ~3M rows (AgDR-0004/0010) → a long "running" state on this box. Acceptable for
  launch; revisit if it hurts throughput.
- Seeding is a **manual host-side step** (needs Node + dev deps on the box); documented in the
  runbook. Not automated in compose.
- `deploy.resources.limits` is honored by `docker compose up` on Compose v2.20+; verify with
  `docker stats` and fall back to `mem_limit`/`cpus` if an older Compose ignores it.

## Artifacts

- `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`, `docs/deploy-vps.md`.
- PR for G0maa/sql-arena#12.
