/**
 * Shared normalisation — the single source of truth for the correctness rule.
 *
 * Per tech-design.md § "Submission Runner" and AgDR-0002: a correct submission
 * must return the same **values** as the reference query, column-order agnostic
 * (aliases are irrelevant), extra columns ⇒ mismatch.  For `ordered` questions
 * the row sequence must also match; for unordered questions rows are sorted
 * deterministically before comparison.
 *
 * This module is pure and dependency-free so Step-5 test infra can unit-test
 * it without spinning up Postgres.
 */

import type { QueryResultRow } from 'pg';

/**
 * Make a single column value comparison-stable across pg driver representations:
 * - null → explicit null (not undefined)
 * - Date → ISO 8601 string
 * - everything else → string (numeric stays string; driver already returns text
 *   for numeric/decimal columns, but we normalise regardless)
 */
export function canonicalValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Deterministic comparator for two canonical rows (arrays of string|null).
 * Sorts lexicographically left-to-right so equal result sets always produce
 * byte-identical JSON regardless of DB execution plan.
 */
function compareRows(a: (string | null)[], b: (string | null)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] ?? null;
    const bv = b[i] ?? null;
    if (av === bv) continue;
    if (av === null) return -1;
    if (bv === null) return 1;
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

/**
 * Normalise a pg query result into a stable, comparable representation.
 *
 * @param rows   - raw row objects from `client.query(...).rows`
 * @param fields - raw field descriptors from `client.query(...).fields`
 * @param ordered - when true the original row order is preserved; when false
 *                  rows are sorted deterministically.
 * @returns Array of arrays — each inner array is one row's column **values**
 *          in the order the columns appear in the result set.
 */
export function normaliseRows(
  rows: QueryResultRow[],
  fields: { name: string }[],
  ordered: boolean,
): (string | null)[][] {
  const columnNames = fields.map((f) => f.name);
  const canonical = rows.map((row) =>
    columnNames.map((col) => canonicalValue(row[col])),
  );
  if (!ordered) {
    canonical.sort(compareRows);
  }
  return canonical;
}
