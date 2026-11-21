import { ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InternalOnly } from '@haqdaar/nest-kit';
import { PrismaService } from './prisma.service';

/** Service-to-service routes. Never exposed through the gateway. */
@ApiTags('internal')
@ApiSecurity('internal')
@InternalOnly()
@Controller('internal/cases')
export class InternalController {
  constructor(private readonly prisma: PrismaService) {}

  /** Payout details for an approved case (used by payments). Bound to the account given at claim time. */
  @Get(':id/payout')
  async payout(@Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.case.findUnique({ where: { id }, include: { person: true } });
    if (!c) throw new NotFoundException('Case not found');
    if (c.status !== 'APPROVED' && c.status !== 'PAID') throw new ConflictException(`Case is ${c.status}`);
    if (!c.amount) throw new ConflictException('Case has no amount');
    return {
      caseId: c.id,
      tenantId: c.tenantId,
      personId: c.personId,
      beneficiaryName: c.person.fullName,
      accountIban: c.payoutIban,
      accountAlias: c.payoutAlias,
      amount: c.amount,
    };
  }
}
