import { describe, it } from 'node:test';
import expect from 'expect';
import { buildResetStatements } from './seed-reset';

describe('buildResetStatements', () => {
  it('returns an array of SQL strings', () => {
    const stmts = buildResetStatements();
    expect(Array.isArray(stmts)).toBe(true);
    expect(stmts.length).toBeGreaterThan(0);
  });

  it('starts with DROP SCHEMA seed CASCADE', () => {
    const stmts = buildResetStatements();
    expect(stmts[0]).toMatch(/DROP SCHEMA.*seed.*CASCADE/i);
  });

  it('recreates the seed schema owned by arena_runner', () => {
    const stmts = buildResetStatements();
    const recreate = stmts.find((s) => /CREATE SCHEMA/i.test(s));
    expect(recreate).toBeDefined();
    expect(recreate).toMatch(/arena_runner/i);
  });

  it('revokes seed access from arena_rw and PUBLIC', () => {
    const stmts = buildResetStatements();
    const revoke = stmts.find((s) => /REVOKE/i.test(s));
    expect(revoke).toBeDefined();
    expect(revoke).toMatch(/arena_rw/i);
  });

  it('includes the five seed table CREATE statements', () => {
    const stmts = buildResetStatements();
    const creates = stmts.filter((s) => /CREATE TABLE/i.test(s));
    // category, product, customer, orders, order_details
    expect(creates.length).toBe(5);
  });
});
