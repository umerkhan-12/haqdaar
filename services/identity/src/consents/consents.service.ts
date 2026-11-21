import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { buildEvent, EventBus, outboxRow, type AuthUser, type Principal } from '@haqdaar/nest-kit';
import type { ConsentPurpose } from '@haqdaar/shared';
import { PrismaService } from '../prisma.service';
import type { CorrectionRequestBody } from './correction';

@Injectable()
export class ConsentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  /** The person a citizen/helper acts for: themselves, or the family selected in Helper Mode. */
  private subjectOf(user: AuthUser): string {
    if (user.onBehalfOf) return user.onBehalfOf;
    throw new ForbiddenException('No person selected');
  }

  /** Citizens and helpers may only touch their own subject's consents; staff may read any. */
  private assertSubject(user: AuthUser, personId: string): void {
    const isStaff = user.role === 'officer' || user.role === 'admin' || user.role === 'auditor';
    if (!isStaff && personId !== this.subjectOf(user)) {
      throw new ForbiddenException('You can only manage your own consents');
    }
  }

  async list(user: AuthUser, personId?: string) {
    const target = personId ?? this.subjectOf(user);
    this.assertSubject(user, target);
    return this.prisma.consent.findMany({
      where: { tenantId: user.tenantId, personId: target },
      orderBy: { grantedAt: 'desc' },
    });
  }

  async grant(user: AuthUser, personId: string, purpose: ConsentPurpose, grantedTo?: string) {
    this.assertSubject(user, personId);
    // Idempotent: a permission that is already in force is returned as is. A retry on a weak connection
    // (or a second tap) must not pile up duplicate rows, each of which would need its own withdrawal.
    const inForce = await this.prisma.consent.findFirst({
      where: {
        tenantId: user.tenantId,
        personId,
        purpose,
        status: 'ACTIVE',
        grantedTo: grantedTo ?? null,
      },
    });
    if (inForce) return inForce;
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
    this.assertSubject(user, existing.personId);
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

  /**
   * The citizen (or her helper) reports that a stored fact is wrong. Nothing is changed here:
   * the request goes to the tamper-evident audit log, where staff pick it up and fix the record
   * only after checking, so a thief with her phone cannot rewrite a verified identity.
   */
  async requestCorrection(user: AuthUser, body: CorrectionRequestBody) {
    const personId = this.subjectOf(user);
    const event = buildEvent(
      'identity.correction.requested',
      { personId, field: body.field, note: body.note ?? null },
      { source: 'identity', principal: user },
    );
    await this.prisma.outboxEvent.create({ data: outboxRow(event) });
    this.bus.kick();
    return {
      requestId: event.eventId,
      personId,
      field: body.field,
      status: 'RECEIVED' as const,
      at: event.occurredAt,
    };
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
