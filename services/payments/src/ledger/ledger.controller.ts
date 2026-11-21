import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, ZQuery, type AuthUser } from '@haqdaar/nest-kit';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { deriveBalances } from '../domain/ledger';

const EntriesQuery = z.object({
  account: z.string().max(60).optional(),
  paymentId: z.string().uuid().optional(),
  take: z.coerce.number().int().min(1).max(500).default(100),
});

/** Read-only. Balances are always derived from entries; nothing here can edit the ledger. */
@ApiTags('ledger')
@ApiBearerAuth()
@Roles('officer', 'admin', 'auditor')
@Controller('ledger')
export class LedgerController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('balances')
  async balances(@CurrentUser() user: AuthUser) {
    const lines = await this.prisma.ledgerEntry.findMany({
      where: { payment: { tenantId: user.tenantId } },
      select: { account: true, direction: true, amount: true },
    });
    const accounts = deriveBalances(lines);
    const net = accounts.reduce((s, a) => s + a.balance, 0);
    return { accounts, balanced: net === 0, entries: lines.length };
  }

  @Get('entries')
  entries(@CurrentUser() user: AuthUser, @ZQuery(EntriesQuery) q: z.infer<typeof EntriesQuery>) {
    return this.prisma.ledgerEntry.findMany({
      where: {
        payment: { tenantId: user.tenantId },
        ...(q.account ? { account: q.account } : {}),
        ...(q.paymentId ? { paymentId: q.paymentId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: q.take,
    });
  }
}
