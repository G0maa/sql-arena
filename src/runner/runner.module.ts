import { Module } from '@nestjs/common';
import { RunnerService } from './runner.service';

@Module({
  providers: [RunnerService],
})
export class RunnerModule {}
