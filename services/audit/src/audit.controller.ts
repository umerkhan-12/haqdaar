import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles, ZBody, ZQuery } from '@haqdaar/nest-kit';
import { z } from 'zod';
import { AuditService } from './audit.service';

const ListQuery = z.object({
  type: z.string().max(80).optional(),
  entityId: z.string().max(80).optional(),
  actorId: z.string().max(80).optional(),
  tenantId: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const VerifyBody = z.object({ fromSeq: z.number().int().positive().optional() }).default({});

/** Read-only by design: there is no update or delete endpoint anywhere in this service. */
@ApiTags('audit')
@ApiBearerAuth()
@Roles('auditor', 'admin')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@ZQuery(ListQuery) q: z.infer<typeof ListQuery>) {
    return this.audit.list(q);
  }

  @Get('stats')
  stats() {
    return this.audit.stats();
  }

  @Post('verify-chain')
  @HttpCode(200)
  verify(@ZBody(VerifyBody) b: z.infer<typeof VerifyBody>) {
    return this.audit.verify(b.fromSeq);
  }

  @Get(':eventId')
  get(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.audit.get(eventId);
  }
}
