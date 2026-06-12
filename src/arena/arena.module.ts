import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ArenaController } from './arena.controller';
import { ArenaService } from './arena.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ArenaController],
  providers: [ArenaService],
})
export class ArenaModule {}
