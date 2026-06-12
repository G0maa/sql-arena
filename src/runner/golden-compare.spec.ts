import { describe, it } from 'node:test';
import expect from 'expect';
import { compareGolden } from './golden-compare';

// Helpers — mirrors how load-questions.ts produces golden_result:
// normaliseRows() returns (string | null)[][], stored as JSON in the DB.
const asGolden = (rows: (string | null)[][]): unknown =>
  JSON.parse(JSON.stringify(rows));

describe('compareGolden', () => {
  it('returns true when normalised rows match the golden result exactly', () => {
    const golden = asGolden([
      ['1', 'Alice'],
      ['2', 'Bob'],
    ]);
    const normalised: (string | null)[][] = [
      ['1', 'Alice'],
      ['2', 'Bob'],
    ];
    expect(compareGolden(normalised, golden)).toBe(true);
  });

  it('returns false when a value differs', () => {
    const golden = asGolden([['1', 'Alice']]);
    const normalised: (string | null)[][] = [['1', 'Bob']];
    expect(compareGolden(normalised, golden)).toBe(false);
  });

  it('returns false when row counts differ', () => {
    const golden = asGolden([['1'], ['2']]);
    const normalised: (string | null)[][] = [['1']];
    expect(compareGolden(normalised, golden)).toBe(false);
  });

  it('returns false when column counts differ (extra column)', () => {
    const golden = asGolden([['1', 'Alice']]);
    const normalised: (string | null)[][] = [['1', 'Alice', 'extra']];
    expect(compareGolden(normalised, golden)).toBe(false);
  });

  it('handles null values correctly', () => {
    const golden = asGolden([[null, 'x']]);
    const normalised: (string | null)[][] = [[null, 'x']];
    expect(compareGolden(normalised, golden)).toBe(true);
  });

  it('returns false when null vs non-null', () => {
    const golden = asGolden([[null]]);
    const normalised: (string | null)[][] = [['0']];
    expect(compareGolden(normalised, golden)).toBe(false);
  });

  it('returns true for empty result sets', () => {
    expect(compareGolden([], asGolden([]))).toBe(true);
  });

  it('returns false when golden is null (question not yet loaded)', () => {
    expect(compareGolden([['1']], null)).toBe(false);
  });
});
