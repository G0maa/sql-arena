import { describe, it } from 'node:test';
import expect from 'expect';
import {
  buildExplainSql,
  parseExecutionMs,
  minExecutionMs,
} from './explain-timing';

describe('buildExplainSql', () => {
  it('prepends EXPLAIN clause to a plain SELECT', () => {
    const result = buildExplainSql('SELECT * FROM orders');
    expect(result).toBe(
      'EXPLAIN (ANALYZE, FORMAT JSON, TIMING ON) SELECT * FROM orders',
    );
  });

  it('strips a trailing semicolon before prepending', () => {
    const result = buildExplainSql('SELECT * FROM orders;');
    expect(result).toBe(
      'EXPLAIN (ANALYZE, FORMAT JSON, TIMING ON) SELECT * FROM orders',
    );
  });

  it('strips trailing whitespace + semicolon', () => {
    const result = buildExplainSql('SELECT 1  ;  ');
    expect(result).toBe('EXPLAIN (ANALYZE, FORMAT JSON, TIMING ON) SELECT 1');
  });
});

describe('parseExecutionMs', () => {
  // pg returns EXPLAIN FORMAT JSON as an already-parsed JS value:
  // [{ "Plan": {...}, "Execution Time": <number>, ... }]
  const makeRow = (ms: number) => [{ Plan: {}, 'Execution Time': ms }];

  it('extracts Execution Time from a pg-parsed explain row', () => {
    expect(parseExecutionMs(makeRow(42.5))).toBe(42.5);
  });

  it('extracts Execution Time from a JSON string (defensive)', () => {
    expect(parseExecutionMs(JSON.stringify(makeRow(13.7)))).toBeCloseTo(13.7);
  });

  it('returns 0 for 0 ms', () => {
    expect(parseExecutionMs(makeRow(0))).toBe(0);
  });

  it('throws when Execution Time is missing', () => {
    expect(() => parseExecutionMs([{ Plan: {} }])).toThrow();
  });

  it('throws when the value is not a finite number', () => {
    expect(() =>
      parseExecutionMs([{ Plan: {}, 'Execution Time': NaN }]),
    ).toThrow();
    expect(() =>
      parseExecutionMs([{ Plan: {}, 'Execution Time': Infinity }]),
    ).toThrow();
  });

  it('throws when given an empty array', () => {
    expect(() => parseExecutionMs([])).toThrow();
  });
});

describe('minExecutionMs', () => {
  it('returns the minimum of three values', () => {
    expect(minExecutionMs([10.5, 8.2, 9.9])).toBe(8.2);
  });

  it('returns the single value when only one is given', () => {
    expect(minExecutionMs([7.3])).toBe(7.3);
  });

  it('throws on an empty array', () => {
    expect(() => minExecutionMs([])).toThrow();
  });
});
