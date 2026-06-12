import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ArenaService, SubmitInput } from './arena.service';

const MAX_SQL_BYTES = 32_768; // 32 KiB

interface RawSubmitBody {
  question_code?: unknown;
  display_name?: unknown;
  setup_sql?: unknown;
  sql?: unknown;
}

function parseSubmitBody(body: RawSubmitBody): SubmitInput {
  if (
    typeof body.question_code !== 'string' ||
    body.question_code.trim() === ''
  ) {
    throw new BadRequestException(
      'question_code is required and must be a non-empty string',
    );
  }
  if (
    typeof body.display_name !== 'string' ||
    body.display_name.trim() === ''
  ) {
    throw new BadRequestException(
      'display_name is required and must be a non-empty string',
    );
  }
  if (typeof body.sql !== 'string' || body.sql.trim() === '') {
    throw new BadRequestException(
      'sql is required and must be a non-empty string',
    );
  }
  if (Buffer.byteLength(body.sql, 'utf8') > MAX_SQL_BYTES) {
    throw new BadRequestException(
      `sql exceeds maximum size of ${MAX_SQL_BYTES} bytes`,
    );
  }
  if (
    body.setup_sql !== undefined &&
    body.setup_sql !== null &&
    typeof body.setup_sql !== 'string'
  ) {
    throw new BadRequestException('setup_sql must be a string or null');
  }
  return {
    question_code: body.question_code.trim(),
    display_name: body.display_name.trim(),
    sql: body.sql,
    setup_sql: typeof body.setup_sql === 'string' ? body.setup_sql : null,
  };
}

@Controller('api')
export class ArenaController {
  constructor(private readonly arena: ArenaService) {}

  @Get('questions')
  listQuestions() {
    return this.arena.listQuestions();
  }

  @Post('submit')
  async submit(@Body() body: RawSubmitBody) {
    const input = parseSubmitBody(body);
    return this.arena.enqueueSubmission(input);
  }

  @Get('submission/:id')
  async getSubmission(@Param('id') id: string) {
    const result = await this.arena.getSubmission(id);
    if (result === null)
      throw new NotFoundException(`Submission ${id} not found`);
    return result;
  }

  @Get('leaderboard/:code')
  getLeaderboard(@Param('code') code: string) {
    return this.arena.getLeaderboard(code);
  }
}
