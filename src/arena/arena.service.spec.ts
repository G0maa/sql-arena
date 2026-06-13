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
    // The service derives the count + sample row in SQL (jsonb_array_length /
    // ->0), so the stubbed DB rows carry those columns — NOT the full
    // golden_result, which is never fetched into Node (#18).
    it('merges expected_columns and maps the SQL-derived count + sample_row', async () => {
      const rows = [
        {
          code: 'Q5',
          title: 'Products per category',
          prompt: 'P',
          ordered: false,
          expected_row_count: 2,
          sample_row: ['Books', '12'],
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

    it('derives count + sample in SQL — never SELECTs the full golden_result', async () => {
      let sql = '';
      const db = makeDb((text) => {
        sql = text;
        return { rows: [] };
      });
      const svc = new ArenaService(db);
      await svc.listQuestions();
      const compact = sql.replace(/\s+/g, ' ');
      assert.match(compact, /jsonb_array_length\(golden_result\)/);
      assert.match(compact, /golden_result->0/);
      // The bare full array must not be selected (that was the perf/leak risk).
      assert.doesNotMatch(
        compact,
        /SELECT[^;]*\bgolden_result\b(?!->0|\))/,
        'must not SELECT the full golden_result column',
      );
      assert.doesNotMatch(compact, /reference_query/);
    });

    it('exposes only the sample row, never the full golden_result, in the output', async () => {
      const rows = [
        {
          code: 'Q5',
          title: 'T',
          prompt: 'P',
          ordered: false,
          expected_row_count: 2,
          sample_row: ['Books', '12'],
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
    });

    it('returns null sample_row and count 0 for an empty/absent golden result', async () => {
      // jsonb_array_length(NULL) and golden_result->0 on [] both yield SQL NULL.
      const rows = [
        {
          code: 'Q8',
          title: 'Low-stock',
          prompt: 'P',
          ordered: false,
          expected_row_count: null,
          sample_row: null,
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
