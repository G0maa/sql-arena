import { describe, it } from 'node:test';
import expect from 'expect';
import { DatabaseService } from './database.service';
import { ConfigService } from '@nestjs/config';

function makeService(envVars: Record<string, string>): DatabaseService {
  const config = {
    get: (key: string) => envVars[key] ?? undefined,
  } as unknown as ConfigService;
  return new DatabaseService(config);
}

describe('DatabaseService', () => {
  it('throws when DATABASE_URL is missing', () => {
    const svc = makeService({});
    expect(() => svc.onModuleInit()).toThrow(/DATABASE_URL/);
  });

  it('throws when RUNNER_DATABASE_URL is missing', () => {
    const svc = makeService({ DATABASE_URL: 'postgres://localhost/db' });
    expect(() => svc.onModuleInit()).toThrow(/RUNNER_DATABASE_URL/);
  });

  it('throws when RW_DATABASE_URL is missing', () => {
    const svc = makeService({
      DATABASE_URL: 'postgres://localhost/db',
      RUNNER_DATABASE_URL: 'postgres://localhost/db',
    });
    expect(() => svc.onModuleInit()).toThrow(/RW_DATABASE_URL/);
  });

  it('exposes getPrivilegedPool() after init', () => {
    const svc = makeService({
      DATABASE_URL: 'postgres://localhost/db',
      RUNNER_DATABASE_URL: 'postgres://localhost/db',
      RW_DATABASE_URL: 'postgres://localhost/db',
    });
    svc.onModuleInit();
    expect(svc.getPrivilegedPool()).toBeDefined();
    void svc.onModuleDestroy();
  });

  it('exposes getRunnerPool() after init', () => {
    const svc = makeService({
      DATABASE_URL: 'postgres://localhost/db',
      RUNNER_DATABASE_URL: 'postgres://localhost/db',
      RW_DATABASE_URL: 'postgres://localhost/db',
    });
    svc.onModuleInit();
    expect(svc.getRunnerPool()).toBeDefined();
    void svc.onModuleDestroy();
  });

  it('exposes getRwPool() after init', () => {
    const svc = makeService({
      DATABASE_URL: 'postgres://localhost/db',
      RUNNER_DATABASE_URL: 'postgres://localhost/db',
      RW_DATABASE_URL: 'postgres://localhost/db',
    });
    svc.onModuleInit();
    expect(svc.getRwPool()).toBeDefined();
    void svc.onModuleDestroy();
  });
});
