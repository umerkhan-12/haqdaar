import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import { requireUser } from '../access';
import { EvalService } from './eval.service';

const RunBody = z
  .object({
    seed: z.number().int().min(0).max(2_147_483_647).optional(),
    size: z.number().int().min(100).max(5000).optional(),
  })
  .strict()
  .optional()
  .default({});

@ApiTags('eval')
@ApiBearerAuth()
@Controller('eval')
export class EvalController {
  constructor(private readonly evals: EvalService) {}

  /** Offline evaluation on the synthetic labelled set at the current cost settings; persisted. */
  @Roles('admin')
  @Post('run')
  @HttpCode(200)
  run(@CurrentUser() user: AuthUser, @ZBody(RunBody) body: z.infer<typeof RunBody>) {
    return this.evals.run(requireUser(user), body);
  }

  @Roles('admin', 'auditor')
  @Get('runs')
  runs(@CurrentUser() user: AuthUser) {
    return this.evals.runs(requireUser(user).tenantId);
  }

  @Roles('admin', 'auditor')
  @Get('runs/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.evals.get(requireUser(user).tenantId, id);
  }

  /** Live metrics from real claims plus the last evaluation's headline. */
  @Roles('admin', 'auditor', 'officer')
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.evals.summary(requireUser(user).tenantId);
  }
}
