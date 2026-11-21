import { Injectable } from '@nestjs/common';
import { DemoResetter } from '@haqdaar/nest-kit';
import { PrismaService } from './prisma.service';

/** Clears consents and lockouts so every rehearsal starts from "nothing shared yet". */
@Injectable()
export class IdentityDemoReset extends DemoResetter {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async reset() {
    const [consents] = await this.prisma.$transaction([
      this.prisma.consent.deleteMany(),
      this.prisma.helperLink.updateMany({ data: { failedPins: 0, lockedUntil: null } }),
      this.prisma.user.updateMany({ data: { failedLogins: 0, lockedUntil: null } }),
      this.prisma.outboxEvent.deleteMany({ where: { publishedAt: { not: null } } }),
    ]);
    return { consents: consents.count };
  }
}
