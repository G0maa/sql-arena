/**
 * Question loader (AgDR-0008): reads Q5–Q9 metadata from the committed
 * registry, joins each entry to its reference query from the gitignored
 * `secrets/reference_queries.sql`, runs each query against the `seed` schema,
 * normalises the result, and upserts into `app.questions`.
 *
 * Idempotent — re-running replaces all five rows without error.
 *
 * `loadQuestions(pool)` is exported so the Step-5 per-submission setup can
 * reuse the same path; this file's CLI wrapper calls it with a pool built
 * from `$DATABASE_URL`.
 *
 * Run:  npm run db:questions
 */
import * as fs from 'fs';
import * as path from 'path';

import { Pool } from 'pg';

import { normaliseRows } from '../grading/normalise';
import { QUESTIONS } from './questions';

const SECRETS_DIR = process.env.SECRETS_DIR ?? './secrets';
const REFERENCE_FILE = path.join(SECRETS_DIR, 'reference_queries.sql');

/**
 * Parse `secrets/reference_queries.sql` into a `code → query` map.
 * Sections are delimited by `-- Q<n>:` header lines; everything up to the next
 * header (or EOF) is the query body.
 */
function parseReferenceQueries(sql: string): Map<string, string> {
  const map = new Map<string, string>();
  const headerRe = /^--\s*(Q\d+)\s*:/im;
  const parts = sql.split(/^(?=--\s*Q\d+\s*:)/im);
  for (const part of parts) {
    const match = part.match(headerRe);
    if (!match) continue;
    const code = match[1].toUpperCase();
    // Strip the header comment line, collapse surrounding whitespace.
    const query = part.replace(/^--\s*Q\d+\s*:[^\n]*\n/i, '').trim();
    if (query) map.set(code, query);
  }
  return map;
}

export async function loadQuestions(pool: Pool): Promise<void> {
  if (!fs.existsSync(REFERENCE_FILE)) {
    console.error(
      `Reference queries file not found: ${REFERENCE_FILE}\n` +
        `Copy secrets/reference_queries.sql.example → secrets/reference_queries.sql ` +
        `and fill in the real queries before running db:questions.`,
    );
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(REFERENCE_FILE, 'utf8');
  const refQueries = parseReferenceQueries(raw);

  // Validate: every registered question must have a reference query.
  const missing = QUESTIONS.filter((q) => !refQueries.has(q.code)).map(
    (q) => q.code,
  );
  if (missing.length) {
    throw new Error(
      `Reference queries missing for: ${missing.join(', ')}. ` +
        `Check secrets/reference_queries.sql for -- ${missing[0]}: headers.`,
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const q of QUESTIONS) {
      const refQuery = refQueries.get(q.code)!;
      const result = await client.query(refQuery);
      const golden = normaliseRows(result.rows, result.fields, q.ordered);
      await client.query(
        `INSERT INTO app.questions
           (code, title, prompt, reference_query, ordered, golden_result)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (code) DO UPDATE SET
           title            = EXCLUDED.title,
           prompt           = EXCLUDED.prompt,
           reference_query  = EXCLUDED.reference_query,
           ordered          = EXCLUDED.ordered,
           golden_result    = EXCLUDED.golden_result`,
        [
          q.code,
          q.title,
          q.prompt,
          refQuery,
          q.ordered,
          JSON.stringify(golden),
        ],
      );
      console.log(`  ✓ ${q.code} — ${golden.length} row(s) stored`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set — cannot connect to Postgres');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  console.log(
    '→ Loading question registry + golden results into app.questions',
  );
  loadQuestions(pool)
    .then(() => console.log('✔ Question load complete.'))
    .catch((err) => {
      console.error('Question load failed:', err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
