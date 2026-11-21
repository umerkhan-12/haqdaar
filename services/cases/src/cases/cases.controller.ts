import { Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentUser, Roles, ZBody, ZQuery, type AuthUser } from '@haqdaar/nest-kit';
import { requireUser } from '../access';
import { CasesService } from './cases.service';
import { ApproveBody, AssignBody, CreateCase, ListQuery, RejectBody, RequestInfoBody } from './cases.schemas';

@ApiTags('cases')
@ApiBearerAuth()
@Controller()
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Roles('citizen', 'helper')
  @ApiHeader({ name: 'idempotency-key', required: true })
  @Post('cases')
  create(
    @CurrentUser() user: AuthUser,
    @ZBody(CreateCase) body: z.infer<typeof CreateCase>,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.cases.create(requireUser(user), body, key, req.id);
  }

  @Roles('citizen', 'helper')
  @Post('cases/:id/resubmit')
  @HttpCode(200)
  resubmit(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Req() req: FastifyRequest) {
    return this.cases.resubmit(requireUser(user), id, req.id);
  }

  /** Citizens and helpers see only their (selected) person's cases; staff see the tenant's. */
  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @Get('cases')
  list(@CurrentUser() user: AuthUser, @ZQuery(ListQuery) q: z.infer<typeof ListQuery>) {
    return this.cases.list(requireUser(user), q.status);
  }

  @Roles('citizen', 'helper', 'officer', 'admin', 'auditor')
  @Get('cases/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.cases.view(requireUser(user), id);
  }

  @Roles('officer', 'admin')
  @Get('queue')
  queue(@CurrentUser() user: AuthUser) {
    return this.cases.queue(requireUser(user));
  }

  @Roles('officer', 'admin')
  @Post('cases/:id/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(ApproveBody) b: z.infer<typeof ApproveBody>,
    @Req() req: FastifyRequest,
  ) {
    return this.cases.approve(requireUser(user), id, b.note, req.id);
  }

  /** Only a human can say no, and must say why. */
  @Roles('officer', 'admin')
  @Post('cases/:id/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(RejectBody) b: z.infer<typeof RejectBody>,
    @Req() req: FastifyRequest,
  ) {
    return this.cases.reject(requireUser(user), id, b.reason, req.id);
  }

  @Roles('officer', 'admin')
  @Post('cases/:id/request-info')
  @HttpCode(200)
  requestInfo(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(RequestInfoBody) b: z.infer<typeof RequestInfoBody>,
    @Req() req: FastifyRequest,
  ) {
    return this.cases.requestInfo(requireUser(user), id, b.message, req.id);
  }

  @Roles('officer', 'admin')
  @Post('cases/:id/assign')
  @HttpCode(200)
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(AssignBody) b: z.infer<typeof AssignBody>,
  ) {
    return this.cases.assign(requireUser(user), id, b.officerId);
  }
}
