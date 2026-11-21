import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  CurrentPrincipal,
  CurrentUser,
  InternalOnly,
  Roles,
  ZBody,
  ZQuery,
  type AuthUser,
  type Principal,
} from '@haqdaar/nest-kit';
import { ConsentPurpose } from '@haqdaar/shared';
import { z } from 'zod';
import { ConsentsService } from './consents.service';
import { CorrectionRequestBody } from './correction';

const GrantBody = z.object({
  personId: z.string().uuid(),
  purpose: ConsentPurpose,
  grantedTo: z.string().max(64).optional(),
});

const CheckQuery = z.object({
  personId: z.string().uuid(),
  purpose: z.string(),
  grantedTo: z.string().optional(),
});

@ApiTags('consents')
@ApiBearerAuth()
@Controller('consents')
export class ConsentsController {
  constructor(private readonly consents: ConsentsService) {}

  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('personId') personId?: string) {
    return this.consents.list(user, personId);
  }

  @Roles('citizen', 'helper')
  @Post()
  grant(@CurrentUser() user: AuthUser, @ZBody(GrantBody) body: z.infer<typeof GrantBody>) {
    return this.consents.grant(user, body.personId, body.purpose, body.grantedTo);
  }

  @Roles('citizen', 'helper')
  @Post(':id/withdraw')
  withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.consents.withdraw(user, id);
  }

  /** "Correct my data": verified identity data is never self-edited; this files an audited request for an officer. */
  @Roles('citizen', 'helper')
  @Post('correction-request')
  requestCorrection(
    @CurrentUser() user: AuthUser,
    @ZBody(CorrectionRequestBody) body: CorrectionRequestBody,
  ) {
    return this.consents.requestCorrection(user, body);
  }

  /** Service-to-service: "may I read this person's data for this purpose right now?" */
  @InternalOnly()
  @Get('check')
  check(@CurrentPrincipal() p: Principal, @ZQuery(CheckQuery) q: z.infer<typeof CheckQuery>) {
    return this.consents.check(p, q.personId, q.purpose, q.grantedTo);
  }
}
