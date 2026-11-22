import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, ZBody, ZQuery, type AuthUser } from '@haqdaar/nest-kit';
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

const ScamMapQuery = z.object({ days: z.coerce.number().int().min(1).max(30).default(7) });
const ResolveBody = z.object({ label: z.enum(['confirmed_scam', 'genuine']) }).strict();

/**
 * Append-only by design: there is no update or delete endpoint anywhere in this service.
 * The one write (a scam report label) adds a new chained event.
 */
@ApiTags('audit')
@ApiBearerAuth()
@Roles('auditor', 'admin')
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @ZQuery(ListQuery) q: z.infer<typeof ListQuery>) {
    return this.audit.list(q, user.tenantId);
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

  /** "My information is wrong" requests from citizens, newest first, for the caller's program. */
  @Roles('officer', 'admin', 'auditor')
  @Get('correction-requests')
  correctionRequests(@CurrentUser() user: AuthUser) {
    return this.audit.correctionRequests(user.tenantId);
  }

  /** Scam patterns by type, district and time for the caller's program. No message text. */
  @Roles('admin', 'officer', 'auditor')
  @Get('scam-map')
  scamMap(@CurrentUser() user: AuthUser, @ZQuery(ScamMapQuery) q: z.infer<typeof ScamMapQuery>) {
    return this.audit.scamMap(user.tenantId, q.days);
  }

  /** An officer labels a reported message; appended to the chain, never an edit. */
  @Roles('officer', 'admin')
  @Post('scam-reports/:id/resolve')
  @HttpCode(200)
  resolveScamReport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(ResolveBody) b: z.infer<typeof ResolveBody>,
  ) {
    return this.audit.resolveScamReport(id, b.label, user);
  }

  @Get(':eventId')
  get(@CurrentUser() user: AuthUser, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.audit.get(eventId, user.tenantId);
  }
}
