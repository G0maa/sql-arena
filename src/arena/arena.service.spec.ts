import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { ArenaService } from './arena.service';
import { QUESTIONS } from '../seed/questions';

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
    it('merges expected_columns and maps golden_result to count + sample_row', async () => {
      const rows = [
        {
          code: 'Q5',
          title: 'Products per category',
          prompt: 'P',
          ordered: false,
          golden_result: [
            ['Books', '12'],
            ['Toys', '7'],
          ],
        },
      ];
      const db = makeDb(() => ({ rows }));
      const svc = new ArenaService(db);
      const [q] = await svc.listQuestions();
      assert.equal(q.code, 'Q5');
      assert.equal(q.ordered, false);
      // expected_columns comes from the committed registry, not the DB row
      assert.deepEqual(q.expected_columns, ['category_name', 'product_count']);
      assert.equal(q.expected_row_count, 2);
      assert.deepEqual(q.sample_row, ['Books', '12']);
    });

    it('exposes ONLY the first golden row, never the full golden_result', async () => {
      const rows = [
        {
          code: 'Q5',
          title: 'T',
          prompt: 'P',
          ordered: false,
          golden_result: [
            ['Books', '12'],
            ['secret-second-row', '999'],
          ],
        },
      ];
      const db = makeDb(() => ({ rows }));
      const svc = new ArenaService(db);
      const result = await svc.listQuestions();
      for (const q of result) {
        assert.ok(!('golden_result' in q), 'should not include golden_result');
        assert.ok(
          !('reference_query' in q),
          'should not include reference_query',
        );
      }
      // The hidden rows must not appear anywhere in the serialised response.
      const serialised = JSON.stringify(result);
      assert.ok(
        !serialised.includes('secret-second-row'),
        'must not leak rows beyond the first',
      );
    });

    it('returns null sample_row and count 0 for an empty golden result', async () => {
      const rows = [
        {
          code: 'Q8',
          title: 'Low-stock',
          prompt: 'P',
          ordered: false,
          golden_result: [],
        },
      ];
      const db = makeDb(() => ({ rows }));
      const svc = new ArenaService(db);
      const [q] = await svc.listQuestions();
      assert.equal(q.expected_row_count, 0);
      assert.equal(q.sample_row, null);
    });
  });

  describe('question registry (drift guard)', () => {
    it('every question declares a non-empty, unique-coded expected_columns list', () => {
      const codes = new Set<string>();
      for (const q of QUESTIONS) {
        assert.ok(
          q.expected_columns.length > 0,
          `${q.code} must declare expected_columns`,
        );
        assert.ok(!codes.has(q.code), `duplicate question code ${q.code}`);
        codes.add(q.code);
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
