import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ArenaController } from './arena.controller';
import type { ArenaService } from './arena.service';

function makeService(overrides: Partial<ArenaService> = {}): ArenaService {
  return {
    listQuestions: mock.fn(async () => []),
    enqueueSubmission: mock.fn(async () => ({
      submission_id: 'x',
      status: 'queued' as const,
    })),
    getSubmission: mock.fn(async () => null),
    getLeaderboard: mock.fn(async () => []),
    ...overrides,
  } as unknown as ArenaService;
}

describe('ArenaController', () => {
  describe('listQuestions', () => {
    it('delegates to service', async () => {
      const questions = [{ code: 'q1', title: 'T', prompt: 'P' }];
      const svc = makeService({
        listQuestions: mock.fn(async () => questions),
      });
      const ctrl = new ArenaController(svc);
      const result = await ctrl.listQuestions();
      assert.deepEqual(result, questions);
    });
  });

  describe('submit', () => {
    it('returns queued status on valid body', async () => {
      const svc = makeService();
      const ctrl = new ArenaController(svc);
      const result = await ctrl.submit({
        question_code: 'q1',
        display_name: 'Alice',
        sql: 'SELECT 1',
      });
      assert.equal(result.status, 'queued');
    });

    it('throws BadRequestException when question_code is missing', async () => {
      const ctrl = new ArenaController(makeService());
      await assert.rejects(
        () => ctrl.submit({ display_name: 'Alice', sql: 'SELECT 1' }),
        BadRequestException,
      );
    });

    it('throws BadRequestException when display_name is empty string', async () => {
      const ctrl = new ArenaController(makeService());
      await assert.rejects(
        () =>
          ctrl.submit({
            question_code: 'q1',
            display_name: '  ',
            sql: 'SELECT 1',
          }),
        BadRequestException,
      );
    });

    it('throws BadRequestException when sql is missing', async () => {
      const ctrl = new ArenaController(makeService());
      await assert.rejects(
        () => ctrl.submit({ question_code: 'q1', display_name: 'Alice' }),
        BadRequestException,
      );
    });

    it('throws BadRequestException when sql exceeds 32 KiB', async () => {
      const ctrl = new ArenaController(makeService());
      await assert.rejects(
        () =>
          ctrl.submit({
            question_code: 'q1',
            display_name: 'Alice',
            sql: 'x'.repeat(33_000),
          }),
        BadRequestException,
      );
    });
  });

  describe('getSubmission', () => {
    it('throws NotFoundException when not found', async () => {
      const svc = makeService({ getSubmission: mock.fn(async () => null) });
      const ctrl = new ArenaController(svc);
      await assert.rejects(
        () => ctrl.getSubmission('missing-id'),
        NotFoundException,
      );
    });

    it('returns submission status when found', async () => {
      const status = { status: 'queued' as const, position: 2 };
      const svc = makeService({ getSubmission: mock.fn(async () => status) });
      const ctrl = new ArenaController(svc);
      const result = await ctrl.getSubmission('some-id');
      assert.deepEqual(result, status);
    });
  });

  describe('getLeaderboard', () => {
    it('delegates to service with code', async () => {
      const entries = [{ rank: 1, display_name: 'Alice', exec_ms: '10' }];
      const svc = makeService({ getLeaderboard: mock.fn(async () => entries) });
      const ctrl = new ArenaController(svc);
      const result = await ctrl.getLeaderboard('q1');
      assert.deepEqual(result, entries);
    });
  });
});
