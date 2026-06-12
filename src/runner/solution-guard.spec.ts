import { describe, it } from 'node:test';
import expect from 'expect';
import { assertSingleSelect, GuardError } from './solution-guard';

describe('assertSingleSelect', () => {
  // --- accept ---
  it('accepts a plain SELECT', () => {
    expect(() => assertSingleSelect('SELECT * FROM orders')).not.toThrow();
  });

  it('accepts a SELECT with a trailing semicolon', () => {
    expect(() => assertSingleSelect('SELECT 1;')).not.toThrow();
  });

  it('accepts a WITH (CTE) query', () => {
    expect(() =>
      assertSingleSelect('WITH cte AS (SELECT 1) SELECT * FROM cte'),
    ).not.toThrow();
  });

  it('accepts SELECT with leading whitespace', () => {
    expect(() => assertSingleSelect('   SELECT id FROM orders')).not.toThrow();
  });

  it('accepts SELECT with a leading line comment', () => {
    expect(() =>
      assertSingleSelect('-- optimised\nSELECT * FROM orders'),
    ).not.toThrow();
  });

  it('accepts SELECT with a block comment', () => {
    expect(() =>
      assertSingleSelect('/* my query */ SELECT * FROM orders'),
    ).not.toThrow();
  });

  // --- reject: wrong leading keyword ---
  it('rejects INSERT', () => {
    expect(() => assertSingleSelect('INSERT INTO orders VALUES (1)')).toThrow(
      GuardError,
    );
  });

  it('rejects UPDATE', () => {
    expect(() => assertSingleSelect('UPDATE orders SET total = 0')).toThrow(
      GuardError,
    );
  });

  it('rejects DELETE', () => {
    expect(() => assertSingleSelect('DELETE FROM orders')).toThrow(GuardError);
  });

  it('rejects DROP', () => {
    expect(() => assertSingleSelect('DROP TABLE orders')).toThrow(GuardError);
  });

  it('rejects TRUNCATE', () => {
    expect(() => assertSingleSelect('TRUNCATE orders')).toThrow(GuardError);
  });

  it('rejects CREATE', () => {
    expect(() => assertSingleSelect('CREATE INDEX i ON orders (id)')).toThrow(
      GuardError,
    );
  });

  it('rejects ALTER', () => {
    expect(() =>
      assertSingleSelect('ALTER TABLE orders ADD COLUMN foo int'),
    ).toThrow(GuardError);
  });

  // --- reject: multi-statement ---
  it('rejects two statements separated by semicolon', () => {
    expect(() => assertSingleSelect('SELECT 1; SELECT 2')).toThrow(GuardError);
  });

  it('rejects SELECT followed by DROP hidden behind comment-looking semicolon', () => {
    expect(() => assertSingleSelect('SELECT 1; DROP TABLE orders')).toThrow(
      GuardError,
    );
  });

  // --- reject: empty / blank ---
  it('rejects empty string', () => {
    expect(() => assertSingleSelect('')).toThrow(GuardError);
  });

  it('rejects whitespace-only string', () => {
    expect(() => assertSingleSelect('   ')).toThrow(GuardError);
  });
});
