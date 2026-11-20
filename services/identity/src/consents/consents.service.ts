import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { buildEvent, EventBus, outboxRow, type AuthUser, type Principal } from '@haqdaar/nest-kit';
import type { ConsentPurpose } from '@haqdaar/shared';
import { PrismaService } from '../prisma.service';

@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  /** The person a user acts for: themselves, or the family selected in Helper Mode. */
  private subjectOf(user: AuthUser): string {
    const personId = user.onBehalfOf ?? null;
    if (personId) return personId;
    throw new ForbiddenException('No person selected');
  }

  async list(user: AuthUser, personId?: string) {
    const target = personId ?? this.subjectOf(user);
    return this.prisma.consent.findMany({
      where: { tenantId: user.tenantId, personId: target },
      orderBy: { grantedAt: 'desc' },
    });
  }

  async grant(user: AuthUser, personId: string, purpose: ConsentPurpose, grantedTo?: string) {
    const consent = await this.prisma.$transaction(async (tx) => {
      const c = await tx.consent.create({
        data: { tenantId: user.tenantId, personId, purpose, grantedTo },
      });
      const event = buildEvent(
        'identity.consent.granted',
        { consentId: c.id, personId, purpose },
        { source: 'identity', principal: user },
      );
      await tx.outboxEvent.create({ data: outboxRow(event) });
      return c;
    });
    this.bus.kick();
    return consent;
  }

  /** Withdrawal is effective on the very next request: consumers check live, no caching. */
  async withdraw(user: AuthUser, consentId: string) {
    const existing = await this.prisma.consent.findFirst({
      where: { id: consentId, tenantId: user.tenantId },
    });
    if (!existing) throw new NotFoundException('Consent not found');
    if (existing.status === 'WITHDRAWN') return existing;

    const updated = await this.prisma.$transaction(async (tx) => {
      const c = await tx.consent.update({
        where: { id: consentId },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      const event = buildEvent(
        'identity.consent.withdrawn',
        { consentId: c.id, personId: c.personId, purpose: c.purpose },
        { source: 'identity', principal: user },
      );
      await tx.outboxEvent.create({ data: outboxRow(event) });
      return c;
    });
    this.bus.kick();
    return updated;
  }

  /** Internal check used by other services before reading personal data. */
  async check(_caller: Principal, personId: string, purpose: string, grantedTo?: string) {
    const consent = await this.prisma.consent.findFirst({
      where: {
        personId,
        purpose,
        status: 'ACTIVE',
        ...(grantedTo ? { OR: [{ grantedTo }, { grantedTo: null }] } : {}),
      },
      orderBy: { grantedAt: 'desc' },
    });
    return { allowed: !!consent, consentId: consent?.id ?? null };
  }
}
