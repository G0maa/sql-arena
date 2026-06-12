/**
 * explain-timing — helpers for EXPLAIN ANALYZE execution-time extraction.
 *
 * Rationale: AgDR-0002. The score = minimum Execution Time across 3
 * EXPLAIN (ANALYZE, FORMAT JSON, TIMING ON) runs.
 *
 * Pure functions — no I/O. Unit-testable without Postgres.
 */

/**
 * Wrap a contestant SQL statement in the EXPLAIN clause used for timing.
 * Strips any trailing semicolon first (EXPLAIN does not accept one).
 */
export function buildExplainSql(sql: string): string {
  const clean = sql.trimEnd().replace(/;$/, '').trimEnd();
  return `EXPLAIN (ANALYZE, FORMAT JSON, TIMING ON) ${clean}`;
}

/**
 * Extract "Execution Time" (ms) from a pg EXPLAIN FORMAT JSON result.
 *
 * pg returns the column value as an already-parsed JS array when
 * the query is `EXPLAIN (..., FORMAT JSON)`. This function also
 * accepts a JSON string as a defensive fallback.
 *
 * Shape: [{ "Plan": {...}, "Execution Time": <number>, ... }]
 */
export function parseExecutionMs(row: unknown): number {
  const parsed = typeof row === 'string' ? (JSON.parse(row) as unknown) : row;

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(
      'parseExecutionMs: expected a non-empty array from EXPLAIN FORMAT JSON',
    );
  }

  const ms = (parsed[0] as Record<string, unknown>)['Execution Time'];

  if (typeof ms !== 'number' || !isFinite(ms)) {
    throw new Error(
      `parseExecutionMs: "Execution Time" is missing or not a finite number (got ${String(ms)})`,
    );
  }

  return ms;
}

/**
 * Return the minimum of an array of execution times.
 * Throws on an empty array.
 */
export function minExecutionMs(times: number[]): number {
  if (times.length === 0) {
    throw new Error(
      'minExecutionMs: received an empty array of execution times',
    );
  }
  return Math.min(...times);
}
