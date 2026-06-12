import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { ArenaModule } from './arena/arena.module';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { RunnerModule } from './runner/runner.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    RunnerModule,
    ArenaModule,
    // Serves public/index.html at `/`. API + health routes are excluded so
    // they fall through to their controllers instead of the static handler.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: ['/health', '/api/*'],
    }),
  ],
  controllers: [HealthController],
})
export class AppModule {}
