import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ArenaService } from './arena.service';

// Minimal stub for DatabaseService
function makeDb(
  queryFn: (text: string, params?: unknown[]) => { rows: unknown[] },
) {
  const client = { query: queryFn, release: mock.fn() };
  return {
    getRwPool: () => ({ connect: async () => client }),
    _client: client,
  } as unknown as import('../database/database.service').DatabaseService;
}

describe('ArenaService', () => {
  describe('listQuestions', () => {
    it('returns code, title, prompt only', async () => {
      const rows = [
        { code: 'q1', title: 'Q1', prompt: 'Write a query' },
        { code: 'q2', title: 'Q2', prompt: 'Another query' },
      ];
      const db = makeDb(() => ({ rows }));
      const svc = new ArenaService(db);
      const result = await svc.listQuestions();
      assert.deepEqual(result, rows);
    });

    it('does not leak reference_query or golden_result', async () => {
      const rows = [{ code: 'q1', title: 'T', prompt: 'P' }];
      const db = makeDb(() => ({ rows }));
      const svc = new ArenaService(db);
      const result = await svc.listQuestions();
      for (const q of result) {
        assert.ok(
          !('reference_query' in q),
          'should not include reference_query',
        );
        assert.ok(!('golden_result' in q), 'should not include golden_result');
      }
    });
  });

  describe('enqueueSubmission', () => {
    it('inserts and returns submission_id + queued status', async () => {
      const db = makeDb(() => ({ rows: [{ id: 'abc-123' }] }));
      const svc = new ArenaService(db);
      const result = await svc.enqueueSubmission({
        question_code: 'q1',
        display_name: 'Alice',
        sql: 'SELECT 1',
      });
      assert.equal(result.submission_id, 'abc-123');
      assert.equal(result.status, 'queued');
    });
  });

  describe('getSubmission', () => {
    it('returns null when submission not found', async () => {
      const db = makeDb(() => ({ rows: [] }));
      const svc = new ArenaService(db);
      const result = await svc.getSubmission('does-not-exist');
      assert.equal(result, null);
    });

    it('includes position for queued submission', async () => {
      let call = 0;
      const db = makeDb(() => {
        if (call++ === 0) {
          return {
            rows: [
              {
                status: 'queued',
                question_code: 'q1',
                display_name: 'Alice',
                result: null,
                exec_ms: null,
                message: null,
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [{ position: '3' }] };
      });
      const svc = new ArenaService(db);
      const result = await svc.getSubmission('some-id');
      assert.ok(result !== null);
      assert.equal(result.status, 'queued');
      assert.equal(result.position, 3);
    });

    it('marks ranked=true when exec_ms matches leaderboard', async () => {
      let call = 0;
      const db = makeDb(() => {
        if (call++ === 0) {
          return {
            rows: [
              {
                status: 'done',
                question_code: 'q1',
                display_name: 'Alice',
                result: 'correct',
                exec_ms: '42.5',
                message: null,
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [{ exec_ms: '42.5' }] };
      });
      const svc = new ArenaService(db);
      const result = await svc.getSubmission('some-id');
      assert.ok(result !== null);
      assert.equal(result.ranked, true);
    });

    it('marks ranked=false when exec_ms differs from leaderboard', async () => {
      let call = 0;
      const db = makeDb(() => {
        if (call++ === 0) {
          return {
            rows: [
              {
                status: 'done',
                question_code: 'q1',
                display_name: 'Alice',
                result: 'correct',
                exec_ms: '99.0',
                message: null,
                created_at: new Date(),
              },
            ],
          };
        }
        return { rows: [{ exec_ms: '42.5' }] };
      });
      const svc = new ArenaService(db);
      const result = await svc.getSubmission('some-id');
      assert.ok(result !== null);
      assert.equal(result.ranked, false);
    });
  });

  describe('getLeaderboard', () => {
    it('returns ranked entries by ascending exec_ms', async () => {
      const db = makeDb(() => ({
        rows: [
          { display_name: 'Alice', exec_ms: '10.0' },
          { display_name: 'Bob', exec_ms: '20.5' },
        ],
      }));
      const svc = new ArenaService(db);
      const result = await svc.getLeaderboard('q1');
      assert.equal(result.length, 2);
      assert.equal(result[0].rank, 1);
      assert.equal(result[0].display_name, 'Alice');
      assert.equal(result[1].rank, 2);
      assert.equal(result[1].display_name, 'Bob');
    });

    it('returns empty array when no leaderboard entries', async () => {
      const db = makeDb(() => ({ rows: [] }));
      const svc = new ArenaService(db);
      const result = await svc.getLeaderboard('q-unknown');
      assert.deepEqual(result, []);
    });
  });
});
