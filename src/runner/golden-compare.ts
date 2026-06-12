/**
 * golden-compare — compare a contestant's normalised result to the stored golden.
 *
 * Both sides are (string | null)[][] — the canonical form produced by
 * normaliseRows() in src/grading/normalise.ts. The golden is stored as jsonb
 * and parsed by pg into a JS value; we JSON-stringify both sides and compare.
 *
 * Pure — no I/O. Unit-testable without Postgres.
 */

/**
 * Return true iff `normalised` matches the stored `golden_result`.
 * Returns false when `golden` is null (question not yet loaded).
 */
export function compareGolden(
  normalised: (string | null)[][],
  golden: unknown,
): boolean {
  if (golden === null || golden === undefined) {
    return false;
  }
  return JSON.stringify(normalised) === JSON.stringify(golden);
}
