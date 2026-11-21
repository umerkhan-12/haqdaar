import { Injectable } from '@nestjs/common';
import { DemoResetter } from '@haqdaar/nest-kit';
import { PrismaService } from './prisma.service';

/** Clears claims and decisions, restores rule v1 and default costs. People stay (CNIC-bound). */
@Injectable()
export class CasesDemoReset extends DemoResetter {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async reset() {
    const cases = await this.prisma.case.count();
    await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe('TRUNCATE decisions, case_events, cases, processed_events CASCADE'),
      this.prisma.outboxEvent.deleteMany({ where: { publishedAt: { not: null } } }),
      this.prisma.ruleVersion.deleteMany({ where: { version: { gt: 1 } } }),
      this.prisma.ruleVersion.updateMany({ where: { version: 1 }, data: { status: 'PUBLISHED' } }),
      this.prisma.costSettings.deleteMany(),
    ]);
    return { cases };
  }
}
