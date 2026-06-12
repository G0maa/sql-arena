import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Enable graceful shutdown: SIGTERM/SIGINT trigger OnApplicationShutdown
  // so the runner loop can drain the in-flight job and pools can close cleanly.
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3000);
  // Single instance, bound on all interfaces so the Docker network can reach it.
  // No clustering — the submission queue must have exactly one consumer (AgDR-0003).
  await app.listen(port, '0.0.0.0');
  Logger.log(`SQL Arena listening on :${port}`, 'Bootstrap');
}

void bootstrap();
