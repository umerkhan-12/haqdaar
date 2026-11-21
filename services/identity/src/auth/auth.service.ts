import { ForbiddenException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import {
  buildEvent,
  decryptField,
  EventBus,
  lookupHash,
  outboxRow,
  randomToken,
  sha256,
  signAccessToken,
  type AuthUser,
} from '@haqdaar/nest-kit';
import type { Role, TokenPair } from '@haqdaar/shared';
import { PrismaService } from '../prisma.service';
import { env } from '../env';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async login(phone: string, password: string, userAgent?: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { phoneHash: lookupHash(normalizePhone(phone), env.PII_HASH_KEY) },
    });

    // Same error and similar timing whether the user exists or not (no account enumeration).
    if (!user || !user.active) {
      await argon2.hash(password).catch(() => undefined);
      throw new UnauthorizedException('Wrong phone number or password');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new ForbiddenException('Too many attempts. Try again later.');
    }

    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil:
            failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw new UnauthorizedException('Wrong phone number or password');
    }

    const pair = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
      const event = buildEvent(
        'identity.user.logged_in',
        { userId: user.id },
        { source: 'identity', tenantId: user.tenantId },
      );
      await tx.outboxEvent.create({ data: outboxRow(event) });
      return this.issue(tx, user, randomUUID(), undefined, userAgent);
    });
    this.bus.kick();
    return pair;
  }

  /**
   * Rotate a refresh token. If an already-rotated token is presented again, someone stole it:
   * revoke the whole family so both the thief and the user must log in again.
   */
  async refresh(refreshToken: string, userAgent?: string): Promise<TokenPair> {
    const hash = sha256(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hash },
      include: { user: true },
    });
    if (!row) throw new UnauthorizedException('Invalid session');

    if (row.rotatedAt || row.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn({ userId: row.userId, familyId: row.familyId }, 'Refresh token reuse detected');
      throw new UnauthorizedException('Session ended for your safety. Please log in again.');
    }
    if (row.expiresAt < new Date() || !row.user.active) {
      throw new UnauthorizedException('Session expired');
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional update = only one concurrent refresh can win.
      const claimed = await tx.refreshToken.updateMany({
        where: { id: row.id, rotatedAt: null },
        data: { rotatedAt: new Date() },
      });
      if (claimed.count === 0) throw new UnauthorizedException('Invalid session');
      return this.issue(tx, row.user, row.familyId, row.onBehalfOf ?? undefined, userAgent);
    });
  }

  /** Helper Mode: families this helper may act for (labels only, no personal data). */
  async families(helper: AuthUser) {
    const links = await this.prisma.helperLink.findMany({
      where: { helperId: helper.id },
      select: { personId: true, label: true, lockedUntil: true },
      orderBy: { label: 'asc' },
    });
    return links.map((l) => ({
      personId: l.personId,
      label: l.label,
      locked: !!l.lockedUntil && l.lockedUntil > new Date(),
    }));
  }

  /**
   * Helper Mode: switch to a family with THAT family's PIN. Issues a new session whose tokens
   * carry `obo` = the family, so every service scopes data and consent to them.
   * 5 wrong PINs lock that family for this helper for 15 minutes.
   */
  async actFor(helper: AuthUser, personId: string, pin: string, userAgent?: string): Promise<TokenPair> {
    const link = await this.prisma.helperLink.findUnique({
      where: { helperId_personId: { helperId: helper.id, personId } },
    });
    if (!link) throw new ForbiddenException('You are not a helper for this family');
    if (link.lockedUntil && link.lockedUntil > new Date()) {
      throw new ForbiddenException('Too many wrong PINs. Ask the family to try later.');
    }
    if (!(await argon2.verify(link.pinHash, pin))) {
      const failed = link.failedPins + 1;
      await this.prisma.helperLink.update({
        where: { id: link.id },
        data: {
          failedPins: failed,
          lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw new UnauthorizedException('Wrong PIN');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: helper.id } });
    return this.prisma.$transaction(async (tx) => {
      await tx.helperLink.update({ where: { id: link.id }, data: { failedPins: 0, lockedUntil: null } });
      return this.issue(tx, user, randomUUID(), personId, userAgent);
    });
  }

  async logout(refreshToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
    });
    if (row) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: row.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async me(principal: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.id },
      include: { tenant: true },
    });
    const phone = decryptField(user.phoneEnc, env.PII_ENC_KEY);
    return {
      id: user.id,
      name: user.name,
      role: user.role,
      phoneMasked: phone.replace(/^(.{4}).*(.{2})$/, '$1*****$2'),
      tenant: { id: user.tenant.id, name: user.tenant.name, type: user.tenant.type },
      platformAdmin: user.platformAdmin,
      personId: user.personId,
      onBehalfOf: principal.onBehalfOf ?? null,
    };
  }

  private async issue(
    tx: Pick<PrismaService, 'refreshToken'>,
    user: { id: string; tenantId: string; role: string; name: string; personId: string | null },
    familyId: string,
    onBehalfOf?: string,
    userAgent?: string,
  ): Promise<TokenPair> {
    const refreshToken = randomToken(48);
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        onBehalfOf,
        userAgent: userAgent?.slice(0, 200),
      },
    });
    // `obo` = the person whose data this session works on: a citizen is always themselves,
    // a helper only after switching to a family with that family's PIN.
    const obo = onBehalfOf ?? (user.role === 'citizen' ? (user.personId ?? undefined) : undefined);
    const accessToken = signAccessToken(
      { sub: user.id, tid: user.tenantId, role: user.role as Role, name: user.name, obo },
      env.JWT_PRIVATE_KEY,
      env.ACCESS_TOKEN_TTL_SECONDS,
    );
    return { accessToken, refreshToken, expiresIn: env.ACCESS_TOKEN_TTL_SECONDS };
  }
}

/** Accept 03001234567, +923001234567, 923001234567 → 923001234567 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('92')) return digits;
  if (digits.startsWith('0')) return `92${digits.slice(1)}`;
  return digits;
}
