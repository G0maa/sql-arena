/**
 * job-runner.spec.ts — unit tests for the per-submission pipeline.
 *
 * All DB I/O is stubbed with sinon so these tests run without Postgres.
 * Integration tests (real DB) are in job-runner.int.spec.ts (env-gated).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import expect from 'expect';
import sinon from 'sinon';
import { runJob, type JobDeps, type JobInput } from './job-runner';

// ---------------------------------------------------------------------------
// Helpers for building stubs
// ---------------------------------------------------------------------------

function makeFakeClient(overrides: Record<string, unknown> = {}) {
  return {
    query: sinon.stub().resolves({ rows: [], fields: [] }),
    release: sinon.stub(),
    ...overrides,
  };
}

function makeFakePool(client: ReturnType<typeof makeFakeClient>) {
  return {
    connect: sinon.stub().resolves(client),
  };
}

const BASE_QUESTION = {
  code: 'Q5',
  ordered: false,
  golden_result: JSON.parse(JSON.stringify([['1', 'Alice']])),
};

const BASE_SUBMISSION: JobInput = {
  id: '42',
  question_code: 'Q5',
  sql: 'SELECT customer_id, first_name FROM customer',
  setup_sql: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runJob', () => {
  let sandbox: sinon.SinonSandbox;
  let runnerClient: ReturnType<typeof makeFakeClient>;
  let deps: JobDeps;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    runnerClient = makeFakeClient();
    // Default: solution query returns a row matching golden
    runnerClient.query.callsFake((sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('EXPLAIN')) {
        return Promise.resolve({
          rows: [{ 'QUERY PLAN': [{ Plan: {}, 'Execution Time': 5.0 }] }],
          fields: [{ name: 'QUERY PLAN' }],
        });
      }
      if (
        typeof sql === 'string' &&
        (sql.startsWith('SET') || sql.startsWith('RESET'))
      ) {
        return Promise.resolve({ rows: [], fields: [] });
      }
      // Solution result — matches golden [['1', 'Alice']]
      return Promise.resolve({
        rows: [{ customer_id: '1', first_name: 'Alice' }],
        fields: [{ name: 'customer_id' }, { name: 'first_name' }],
      });
    });

    deps = {
      runnerPool: makeFakePool(runnerClient) as unknown as import('pg').Pool,
      resetSeed: sinon.stub().resolves(),
    };
  });

  afterEach(() => {
    sandbox.restore();
  });

  // -------------------------------------------------------------------------
  // Solution guard
  // -------------------------------------------------------------------------

  it('returns error verdict for a non-SELECT statement without running it', async () => {
    const verdict = await runJob(
      deps,
      { ...BASE_SUBMISSION, sql: 'DROP TABLE orders' },
      BASE_QUESTION,
    );
    expect(verdict.result).toBe('error');
    expect(verdict.message).toMatch(/SELECT|WITH/i);
    // Only SET search_path should have been called — the solution query must NOT run
    const queryCalls = (runnerClient.query as sinon.SinonStub).args.filter(
      (args) =>
        !String(args[0]).startsWith('SET') &&
        !String(args[0]).startsWith('RESET'),
    );
    expect(queryCalls.length).toBe(0);
  });

  it('returns error verdict for a multi-statement injection', async () => {
    const verdict = await runJob(
      deps,
      { ...BASE_SUBMISSION, sql: 'SELECT 1; DROP TABLE orders' },
      BASE_QUESTION,
    );
    expect(verdict.result).toBe('error');
  });

  // -------------------------------------------------------------------------
  // Correct solution
  // -------------------------------------------------------------------------

  it('returns correct verdict when normalised rows match golden', async () => {
    const verdict = await runJob(deps, BASE_SUBMISSION, BASE_QUESTION);
    expect(verdict.result).toBe('correct');
  });

  it('returns exec_ms equal to the minimum of 3 EXPLAIN times', async () => {
    let explainCall = 0;
    runnerClient.query.callsFake((sql: string) => {
      if (typeof sql === 'string' && sql.startsWith('EXPLAIN')) {
        explainCall++;
        const times = [12.0, 8.5, 10.0];
        return Promise.resolve({
          rows: [
            {
              'QUERY PLAN': [
                { Plan: {}, 'Execution Time': times[explainCall - 1] },
              ],
            },
          ],
          fields: [{ name: 'QUERY PLAN' }],
        });
      }
      if (
        typeof sql === 'string' &&
        (sql.startsWith('SET') || sql.startsWith('RESET'))
      ) {
        return Promise.resolve({ rows: [], fields: [] });
      }
      return Promise.resolve({
        rows: [{ customer_id: '1', first_name: 'Alice' }],
        fields: [{ name: 'customer_id' }, { name: 'first_name' }],
      });
    });

    const verdict = await runJob(deps, BASE_SUBMISSION, BASE_QUESTION);
    expect(verdict.result).toBe('correct');
    expect(verdict.exec_ms).toBe(8.5);
  });

  // -------------------------------------------------------------------------
  // Incorrect solution
  // -------------------------------------------------------------------------

  it('returns incorrect verdict when rows do not match golden', async () => {
    runnerClient.query.callsFake((sql: string) => {
      if (
        typeof sql === 'string' &&
        (sql.startsWith('SET') || sql.startsWith('RESET'))
      ) {
        return Promise.resolve({ rows: [], fields: [] });
      }
      return Promise.resolve({
        rows: [{ customer_id: '99', first_name: 'Wrong' }],
        fields: [{ name: 'customer_id' }, { name: 'first_name' }],
      });
    });
    const verdict = await runJob(deps, BASE_SUBMISSION, BASE_QUESTION);
    expect(verdict.result).toBe('incorrect');
    expect(verdict.exec_ms).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Timeout
  // -------------------------------------------------------------------------

  it('returns timeout verdict when pg raises query_canceled', async () => {
    runnerClient.query.callsFake((sql: string) => {
      if (
        typeof sql === 'string' &&
        (sql.startsWith('SET') || sql.startsWith('RESET'))
      ) {
        return Promise.resolve({ rows: [], fields: [] });
      }
      const err = Object.assign(
        new Error('canceling statement due to statement timeout'),
        {
          code: '57014',
        },
      );
      return Promise.reject(err);
    });
    const verdict = await runJob(deps, BASE_SUBMISSION, BASE_QUESTION);
    expect(verdict.result).toBe('timeout');
  });

  // -------------------------------------------------------------------------
  // Reset behaviour
  // -------------------------------------------------------------------------

  it('does NOT call resetSeed when setup_sql is null', async () => {
    await runJob(deps, { ...BASE_SUBMISSION, setup_sql: null }, BASE_QUESTION);
    expect((deps.resetSeed as sinon.SinonStub).callCount).toBe(0);
  });

  it('calls resetSeed when setup_sql is present', async () => {
    runnerClient.query.callsFake((sql: string) => {
      if (
        typeof sql === 'string' &&
        (sql.startsWith('SET') || sql.startsWith('RESET'))
      ) {
        return Promise.resolve({ rows: [], fields: [] });
      }
      if (typeof sql === 'string' && sql.includes('EXPLAIN')) {
        return Promise.resolve({
          rows: [{ 'QUERY PLAN': [{ Plan: {}, 'Execution Time': 5.0 }] }],
          fields: [{ name: 'QUERY PLAN' }],
        });
      }
      return Promise.resolve({
        rows: [{ customer_id: '1', first_name: 'Alice' }],
        fields: [{ name: 'customer_id' }, { name: 'first_name' }],
      });
    });

    await runJob(
      deps,
      {
        ...BASE_SUBMISSION,
        setup_sql: 'CREATE INDEX i ON orders (customer_id)',
      },
      BASE_QUESTION,
    );
    expect((deps.resetSeed as sinon.SinonStub).callCount).toBe(1);
  });

  it('does NOT call resetSeed when guard rejects (nothing ran)', async () => {
    await runJob(
      deps,
      { ...BASE_SUBMISSION, sql: 'DROP TABLE orders' },
      BASE_QUESTION,
    );
    expect((deps.resetSeed as sinon.SinonStub).callCount).toBe(0);
  });
});
