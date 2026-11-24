import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles, ZBody, type AuthUser } from '@haqdaar/nest-kit';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { RailsClient } from '../payments/rails.client';
import { forProgram, reconcile } from './reconcile';

const RunBody = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .default({});

@ApiTags('reconciliation')
@ApiBearerAuth()
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rails: RailsClient,
  ) {}

  /** Our settled payouts for the day vs the Raast statement. Every mismatch is listed. */
  @Roles('officer', 'admin', 'auditor')
  @Post('run')
  @HttpCode(200)
  async run(@CurrentUser() user: AuthUser, @ZBody(RunBody) b: z.infer<typeof RunBody>) {
    // The bank's statement day is a Pakistan day (UTC+5), so ours is cut at the same midnight.
    const date = b.date ?? new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
    const from = new Date(`${date}T00:00:00.000+05:00`);
    const to = new Date(from.getTime() + 86_400_000);

    const [ours, statement] = await Promise.all([
      this.prisma.payment.findMany({
        where: {
          tenantId: user.tenantId,
          settledAt: { gte: from, lt: to },
          state: { in: ['SUCCESS', 'REVERSAL_REQUESTED', 'REVERSED'] },
        },
        select: { id: true, endToEndId: true, amount: true },
      }),
      this.rails.statement(date),
    ]);

    const others = await this.prisma.payment.findMany({
      where: {
        tenantId: { not: user.tenantId },
        endToEndId: { in: statement.entries.map((e) => e.endToEndId) },
      },
      select: { endToEndId: true },
    });
    const items = reconcile(
      ours.map((p) => ({ paymentId: p.id, endToEndId: p.endToEndId, amount: p.amount })),
      forProgram(statement.entries, new Set(others.map((o) => o.endToEndId))),
    );
    const matched = items.filter((i) => i.status === 'matched').length;
    return this.prisma.reconciliationRun.create({
      data: {
        tenantId: user.tenantId,
        date,
        matched,
        mismatched: items.length - matched,
        items: items as object[],
        runBy: user.id,
      },
    });
  }

  @Roles('officer', 'admin', 'auditor')
  @Get('runs')
  runs(@CurrentUser() user: AuthUser) {
    return this.prisma.reconciliationRun.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }
}
