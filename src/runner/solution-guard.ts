/**
 * solution-guard — validates that a contestant submission is a single SELECT/WITH.
 *
 * Rationale: AgDR-0004. The runner accepts free-form setup_sql but the timed
 * solution must be a read-only query. This guard keeps the ranked artefact a query.
 *
 * Pure function — no I/O, no side effects. Unit-testable without Postgres.
 */

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuardError';
  }
}

/**
 * Strip SQL line comments (-- to end-of-line) and block comments (/* ... *\/).
 * Does not handle comment markers inside string literals — acceptable for a
 * trusted cohort (AgDR-0004 residual-risk acceptance).
 */
function stripComments(sql: string): string {
  // Block comments first (non-greedy, DOTALL via [\s\S])
  let stripped = sql.replace(/\/\*[\s\S]*?\*\//g, ' ');
  // Line comments
  stripped = stripped.replace(/--[^\n]*/g, ' ');
  return stripped;
}

/**
 * Assert that `sql` is a single SELECT or WITH statement.
 * Throws GuardError with a user-facing message on any violation.
 */
export function assertSingleSelect(sql: string): void {
  const stripped = stripComments(sql).trim();

  if (!stripped) {
    throw new GuardError('Solution must be a non-empty SELECT or WITH query.');
  }

  // Remove a single optional trailing semicolon, then reject any remaining ones
  const withoutTrailingSemi = stripped.endsWith(';')
    ? stripped.slice(0, -1).trimEnd()
    : stripped;

  if (withoutTrailingSemi.includes(';')) {
    throw new GuardError(
      'Solution must be a single statement. Multiple statements separated by ";" are not allowed.',
    );
  }

  // Check leading keyword (case-insensitive)
  const firstToken = withoutTrailingSemi.split(/\s+/)[0].toUpperCase();
  if (firstToken !== 'SELECT' && firstToken !== 'WITH') {
    throw new GuardError(
      `Solution must start with SELECT or WITH. Got: ${firstToken}.`,
    );
  }
}
