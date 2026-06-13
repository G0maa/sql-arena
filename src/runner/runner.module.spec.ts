/**
 * runner.module.spec.ts — DI-contract regression guard.
 *
 * The unit tests in runner.service.spec.ts `new`-up RunnerService directly,
 * bypassing NestJS DI. That left a gap: RunnerService's constructor has a
 * default-valued test seam (`_runJob: RunJobFn = runJob`). Under a production
 * `nest build` (tsc), `emitDecoratorMetadata` emits `Function` as that param's
 * `design:paramtypes` entry, so Nest's container tries to resolve it as a
 * provider — crashing app bootstrap with:
 *   "Nest can't resolve dependencies of the RunnerService (DatabaseService, ?)".
 * No test booted the container, so #9/#10 shipped a non-booting app.
 *
 * The fix: mark the param `@Optional()` so the container skips it and the
 * default value (`runJob`) applies.
 *
 * Why this is a METADATA assertion, not a NestFactory boot test: the test
 * suite runs under tsx (esbuild), which — unlike tsc — does NOT emit
 * `design:paramtypes`. So a container boot under tsx can't reproduce the
 * production resolution path (Nest would inject nothing and the symptom would
 * differ from prod). What esbuild DOES preserve is the `@Optional()`
 * decorator's own metadata. Asserting that metadata is therefore the stable,
 * runtime-independent guard: it is red the instant someone deletes the
 * decorator, which is the exact change that reintroduces the prod crash.
 */
import 'reflect-metadata';
import { describe, it } from 'node:test';
import expect from 'expect';
import { OPTIONAL_DEPS_METADATA } from '@nestjs/common/constants';

import { RunnerService } from './runner.service';

describe('RunnerService DI contract', () => {
  it('marks the runJob test-seam param @Optional() so the container can bootstrap', () => {
    const optionalParamIndexes: number[] =
      Reflect.getMetadata(OPTIONAL_DEPS_METADATA, RunnerService) ?? [];

    // index 0 = DatabaseService (a real provider), index 1 = the runJob seam.
    expect(optionalParamIndexes).toContain(1);
  });
});
