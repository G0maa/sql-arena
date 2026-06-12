/**
 * runner.service.spec.ts — unit tests for the submission runner orchestrator.
 *
 * All DB I/O and the runJob pipeline are stubbed so these tests run without Postgres.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import expect from 'expect';
import sinon from 'sinon';

// We import the class directly and bypass NestJS DI for unit tests
import { RunnerService } from './runner.service';
import { DatabaseService } from '../database/database.service';

// ---------------------------------------------------------------------------
// Stub helpers
// ---------------------------------------------------------------------------

function makeClient(rows: unknown[] = [], fields: { name: string }[] = []) {
  const stub = sinon.stub();
  stub.resolves({ rows, fields });
  return {
    query: stub,
    release: sinon.stub(),
  };
}

function makePool(client: ReturnType<typeof makeClient>) {
  return { connect: sinon.stub().resolves(client) };
}

/**
 * Build a DatabaseService stub with the three pool getters.
 */
function makeDbService() {
  const rwClient = makeClient();
  const rwPool = makePool(rwClient);

  const stub = {
    getPrivilegedPool: sinon.stub().returns({}),
    getRunnerPool: sinon.stub().returns({}),
    getRwPool: sinon.stub().returns(rwPool),
  } as unknown as DatabaseService;

  return { stub, rwClient, rwPool };
}

// A queued submission row returned by the claim query
const QUEUED_ROW = {
  id: '1',
  question_code: 'Q5',
  sql: 'SELECT customer_id, first_name FROM customer',
  setup_sql: null,
  display_name: 'Alice',
};

// A matching question row
const QUESTION_ROW = {
  code: 'Q5',
  ordered: false,
  golden_result: [['1', 'Alice']],
};

// ---------------------------------------------------------------------------

describe('RunnerService', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('writes result=error and status=done when runJob returns error', async () => {
    const { stub: db, rwClient } = makeDbService();

    // Claim returns a queued row; question lookup returns a question
    let callIdx = 0;
    rwClient.query.callsFake(() => {
      callIdx++;
      // BEGIN
      if (callIdx === 1) return Promise.resolve({ rows: [], fields: [] });
      // SELECT queued
      if (callIdx === 2)
        return Promise.resolve({ rows: [QUEUED_ROW], fields: [] });
      // UPDATE status=running + COMMIT
      if (callIdx <= 4) return Promise.resolve({ rows: [], fields: [] });
      // SELECT question
      if (callIdx === 5)
        return Promise.resolve({ rows: [QUESTION_ROW], fields: [] });
      // UPDATE status=done (verdict write)
      return Promise.resolve({ rows: [], fields: [] });
    });

    const runJobStub = sinon
      .stub()
      .resolves({ result: 'error', message: 'bad sql' });

    const svc = new RunnerService(db, runJobStub as never);
    // Run one iteration (not a real loop)
    await (svc as unknown as { runOnce(): Promise<void> }).runOnce();

    // Verify that the verdict UPDATE was called with result='error'
    const updateCall = rwClient.query.args.find(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].includes('status') &&
        args[0].includes('done') &&
        Array.isArray(args[1]) &&
        args[1].includes('error'),
    );
    expect(updateCall).toBeDefined();
  });

  it('does not upsert leaderboard for an incorrect verdict', async () => {
    const { stub: db, rwClient } = makeDbService();

    let callIdx = 0;
    rwClient.query.callsFake(() => {
      callIdx++;
      if (callIdx === 1) return Promise.resolve({ rows: [], fields: [] }); // BEGIN
      if (callIdx === 2)
        return Promise.resolve({ rows: [QUEUED_ROW], fields: [] }); // SELECT queued
      if (callIdx <= 4) return Promise.resolve({ rows: [], fields: [] }); // UPDATE + COMMIT
      if (callIdx === 5)
        return Promise.resolve({ rows: [QUESTION_ROW], fields: [] }); // question
      return Promise.resolve({ rows: [], fields: [] }); // verdict write
    });

    const runJobStub = sinon.stub().resolves({ result: 'incorrect' });
    const svc = new RunnerService(db, runJobStub as never);
    await (svc as unknown as { runOnce(): Promise<void> }).runOnce();

    const leaderboardCall = rwClient.query.args.find(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].toLowerCase().includes('leaderboard'),
    );
    expect(leaderboardCall).toBeUndefined();
  });

  it('upserts leaderboard when verdict is correct', async () => {
    const { stub: db, rwClient } = makeDbService();

    let callIdx = 0;
    rwClient.query.callsFake(() => {
      callIdx++;
      if (callIdx === 1) return Promise.resolve({ rows: [], fields: [] }); // BEGIN
      if (callIdx === 2)
        return Promise.resolve({ rows: [QUEUED_ROW], fields: [] }); // SELECT queued
      if (callIdx <= 4) return Promise.resolve({ rows: [], fields: [] }); // UPDATE + COMMIT
      if (callIdx === 5)
        return Promise.resolve({ rows: [QUESTION_ROW], fields: [] }); // question
      return Promise.resolve({ rows: [], fields: [] }); // verdict write or leaderboard upsert
    });

    const runJobStub = sinon
      .stub()
      .resolves({ result: 'correct', exec_ms: 7.3 });
    const svc = new RunnerService(db, runJobStub as never);
    await (svc as unknown as { runOnce(): Promise<void> }).runOnce();

    const leaderboardCall = rwClient.query.args.find(
      (args) =>
        typeof args[0] === 'string' &&
        args[0].toLowerCase().includes('leaderboard'),
    );
    expect(leaderboardCall).toBeDefined();
  });

  it('does not crash the loop when runJob throws unexpectedly', async () => {
    const { stub: db, rwClient } = makeDbService();

    let callIdx = 0;
    rwClient.query.callsFake(() => {
      callIdx++;
      if (callIdx === 1) return Promise.resolve({ rows: [], fields: [] }); // BEGIN
      if (callIdx === 2)
        return Promise.resolve({ rows: [QUEUED_ROW], fields: [] }); // SELECT
      if (callIdx <= 4) return Promise.resolve({ rows: [], fields: [] }); // UPDATE + COMMIT
      if (callIdx === 5)
        return Promise.resolve({ rows: [QUESTION_ROW], fields: [] }); // question
      return Promise.resolve({ rows: [], fields: [] });
    });

    const runJobStub = sinon.stub().rejects(new Error('unexpected crash'));
    const svc = new RunnerService(db, runJobStub as never);

    // runOnce should resolve (not throw) even when runJob crashes
    await expect(
      (svc as unknown as { runOnce(): Promise<void> }).runOnce(),
    ).resolves.toBeUndefined();
  });

  it('returns without processing when no queued row exists', async () => {
    const { stub: db, rwClient } = makeDbService();

    let callIdx = 0;
    rwClient.query.callsFake(() => {
      callIdx++;
      if (callIdx === 1) return Promise.resolve({ rows: [], fields: [] }); // BEGIN
      if (callIdx === 2) return Promise.resolve({ rows: [], fields: [] }); // no rows
      return Promise.resolve({ rows: [], fields: [] }); // COMMIT
    });

    const runJobStub = sinon.stub();
    const svc = new RunnerService(db, runJobStub as never);
    await (svc as unknown as { runOnce(): Promise<void> }).runOnce();

    expect(runJobStub.callCount).toBe(0);
  });
});
