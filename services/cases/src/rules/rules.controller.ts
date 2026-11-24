import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import type { CostSettings } from '@haqdaar/shared';
import { RuleDefinition } from '../engine/rules';
import { PrismaService } from '../prisma.service';
import { requireUser } from '../access';
import { RulesService } from './rules.service';
import { CostBody } from './rule-checks';

@ApiTags('rules')
@ApiBearerAuth()
@Controller()
export class RulesController {
  constructor(
    private readonly rules: RulesService,
    private readonly prisma: PrismaService,
  ) {}

  @Roles('admin', 'officer', 'auditor')
  @Get('rules')
  list(@CurrentUser() user: AuthUser) {
    return this.rules.list(requireUser(user).tenantId);
  }

  @Roles('admin')
  @Post('rules/versions')
  create(
    @CurrentUser() user: AuthUser,
    @ZBody(RuleDefinition) body: z.infer<typeof RuleDefinition>,
  ) {
    return this.rules.createDraft(requireUser(user), body);
  }

  /** Rewrites a draft in place, so editing and replaying again does not pile up versions. */
  @Roles('admin')
  @Put('rules/versions/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(RuleDefinition) body: z.infer<typeof RuleDefinition>,
  ) {
    return this.rules.updateDraft(requireUser(user), id, body);
  }

  @Roles('admin')
  @Post('rules/versions/:id/simulate')
  @HttpCode(200)
  simulate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.simulate(requireUser(user), id);
  }

  @Roles('admin')
  @Post('rules/versions/:id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.rules.publish(requireUser(user), id);
  }

  @Roles('admin', 'officer', 'auditor')
  @Get('cost-settings')
  costs(@CurrentUser() user: AuthUser) {
    return this.rules.costView(requireUser(user).tenantId);
  }

  /** Changing costs changes the auto-approve threshold — no code change. */
  @Roles('admin')
  @Put('cost-settings')
  setCosts(@CurrentUser() user: AuthUser, @ZBody(CostBody) body: z.infer<typeof CostSettings>) {
    return this.rules.setCosts(requireUser(user), body);
  }

  /** Full trace for auditors: inputs the engine saw, rule version and clause results. */
  @Roles('auditor', 'admin')
  @Get('decisions/:id/trace')
  async trace(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const d = await this.prisma.decision.findFirst({
      where: { id, case: { tenantId: requireUser(user).tenantId } },
    });
    if (!d) throw new NotFoundException('Decision not found');
    const rule = d.ruleVersionId
      ? await this.prisma.ruleVersion.findUnique({ where: { id: d.ruleVersionId } })
      : null;
    return {
      decision: d,
      ruleVersion: rule && {
        id: rule.id,
        version: rule.version,
        status: rule.status,
        clauses: rule.clauses,
        amount: rule.amount,
      },
    };
  }
}
