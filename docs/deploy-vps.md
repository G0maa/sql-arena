# Deploy sql-arena to a VPS

Production deployment runbook for a single shared host (e.g. Hetzner CPX, 2 vCPU / 4 GB).
Topology + rationale: [AgDR-0013](agdr/AgDR-0013-vps-deploy-topology.md). The stack is
`docker-compose.prod.yml` (Caddy TLS → app → resource-limited Postgres).

Prereqs on the box: a public IP, a DNS **A record** for your domain → that IP, and ports
**80/443** reachable. Example below uses `sql-arena.gomaa.ovh`.

## 1. Provision

```bash
# Docker engine + compose plugin
curl -fsSL https://get.docker.com | sh

# Node 22 (for the seed generator/loaders — they run host-side via tsx)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs git

# Firewall: SSH + HTTP/HTTPS only. Postgres (loopback bind) and the app
# (internal-only) are never published, so they need no rule.
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

## 2. Clone + configure

```bash
git clone https://github.com/G0maa/sql-arena /opt/sql-arena
cd /opt/sql-arena

# Secrets — copy the template and fill with strong values (openssl rand -base64 24).
cp .env.production.example .env && $EDITOR .env     # POSTGRES_PASSWORD, ARENA_RUNNER_PASSWORD, ARENA_RW_PASSWORD

# Golden source (gitignored) — upload from a trusted machine, do NOT commit:
#   scp secrets/reference_queries.sql root@<host>:/opt/sql-arena/secrets/
```

Set the domain in `Caddyfile` if not `sql-arena.gomaa.ovh`.

## 3. Bring up the stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps          # all healthy?
docker stats --no-stream                              # confirm postgres ≤ 2 GB / 2 vCPU
```

A fresh `pgdata` volume auto-runs `db/00-bootstrap.sh` (schema + roles, using the real `.env`
passwords). Caddy obtains the Let's Encrypt cert on first request (give it a few seconds).

## 4. Seed the full-scale dataset (on the server)

```bash
npm ci                                                # dev deps for tsx
# Defaults are already full scale (~3M order_details). Loaders connect over the loopback bind:
export DATABASE_URL=postgres://arena:$(grep ^POSTGRES_PASSWORD .env | cut -d= -f2)@127.0.0.1:5432/sql_arena
npm run db:seed:generate                              # → ./generated/*.csv (mounted as /seed-data)
npm run db:seed:load                                  # server-side COPY into the seed schema
npm run db:questions                                  # loads Q5–Q9 golden from secrets/reference_queries.sql
```

## 5. Verify

```bash
curl -fsS https://sql-arena.gomaa.ovh/health          # green, valid cert
curl -fsS https://sql-arena.gomaa.ovh/api/questions | head
# loopback psql sanity:
psql "$DATABASE_URL" -c "SELECT code, jsonb_array_length(golden_result) FROM app.questions ORDER BY code;"
```

Open `https://sql-arena.gomaa.ovh/` in a browser and walk the loop.

## 6. Smoke test the headline mechanic

1. Submit a **naive** solution for a question whose naive form finishes within the runner's 30s
   solution timeout → expect `correct` + an `exec_ms`, appearing on the leaderboard.
2. Submit the **same** query with a `setup_sql` `CREATE INDEX …` → expect a smaller `exec_ms`,
   ranked **above** the naive run.
3. Confirm the seed is pristine afterwards (the post-run reset dropped the contestant index):
   ```bash
   psql "$DATABASE_URL" -c "\di seed.*"               # only *_pkey indexes remain
   ```

## Operate

```bash
docker compose -f docker-compose.prod.yml logs -f app          # app / runner logs
docker compose -f docker-compose.prod.yml restart app          # restart app only
docker compose -f docker-compose.prod.yml down                 # stop (keeps volumes/certs)
docker compose -f docker-compose.prod.yml down -v              # ⚠ also drops DB + certs
```

**Rollback:** `git -C /opt/sql-arena checkout <prev-sha> && docker compose -f docker-compose.prod.yml up -d --build`.
The `pgdata` volume persists across redeploys, so the seed/questions survive an app rebuild.
