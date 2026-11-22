import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import {
  buildEvent,
  decryptField,
  encryptField,
  EventBus,
  lookupHash,
  outboxRow,
  randomToken,
  ServiceClient,
  sha256,
  signAccessToken,
  type AuthUser,
} from '@haqdaar/nest-kit';
import type { Role, SignupVerifyRequest, TokenPair } from '@haqdaar/shared';
import { PrismaService } from '../prisma.service';
import { env } from '../env';
import {
  checkCode,
  CODE_TTL_MINUTES,
  hashCode,
  MAX_CODE_TRIES,
  newCode,
  SIGNUP_SENDER,
  signupSms,
} from './signup-code';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
/** New citizens join the Sahara relief program (the seeded default tenant). */
export const DEFAULT_TENANT_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly client: ServiceClient,
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
      await tx.user.update({
        where: { id: user.id },
        data: { failedLogins: 0, lockedUntil: null },
      });
      const event = buildEvent(
        'identity.user.logged_in',
        { userId: user.id },
        { source: 'identity', tenantId: user.tenantId },
      );
      await tx.outboxEvent.create({ data: outboxRow(event) });
      return this.issue(tx, user, randomUUID(), undefined, userAgent);
    });
    this.bus.kick();
    if (user.role === 'citizen') void this.openMockWallet(phone, user.name);
    return pair;
  }

  /**
   * SIMULATION ONLY: the mock bank keeps accounts in memory, so a self-registered citizen's wallet is
   * (re)opened on sign-up and on each login. Best effort: a failure never blocks signing in.
   */
  private async openMockWallet(phone: string, name: string): Promise<void> {
    await this.client
      .call('rails-mock', '/mock/raast/wallets', {
        method: 'POST',
        body: { alias: `0${normalizePhone(phone).replace(/^92/, '')}`, title: name },
        retries: 0,
      })
      .catch(() => undefined);
  }

  /**
   * Sign-up step 1: text a 6-digit code to the phone. The answer is always the same, so nobody
   * can learn which numbers have an account; a registered number gets an SMS saying so instead.
   * A new request replaces the old code (one live code per phone).
   */
  async signupStart(phone: string): Promise<{ sent: true }> {
    const normalized = normalizePhone(phone);
    const phoneHash = lookupHash(normalized, env.PII_HASH_KEY);
    const existing = await this.prisma.user.findUnique({
      where: { phoneHash },
      select: { id: true },
    });

    let body = signupSms.alreadyRegistered();
    if (!existing) {
      const code = newCode();
      const data = {
        codeHash: hashCode(normalized, code, env.PII_HASH_KEY),
        expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
        attempts: 0,
        usedAt: null,
      };
      await this.prisma.signupCode.upsert({
        where: { phoneHash },
        update: data,
        create: { phoneHash, ...data },
      });
      body = signupSms.code(code);
    }
    await this.client.call('rails-mock', '/mock/sms/send', {
      method: 'POST',
      body: { to: phone, body, from: SIGNUP_SENDER },
      retries: 0,
    });
    return { sent: true };
  }

  /**
   * Sign-up step 2: check the code, then create the citizen and log them in.
   * The PIN is stored like a password (argon2id), so the normal login works with it.
   * The new person id is only reserved here: cases creates the person record on the first claim.
   */
  async signupVerify(b: SignupVerifyRequest, userAgent?: string): Promise<TokenPair> {
    const phone = normalizePhone(b.phone);
    const phoneHash = lookupHash(phone, env.PII_HASH_KEY);

    // Count the try first (atomic), so parallel guesses cannot get more than the limit.
    await this.prisma.signupCode.updateMany({
      where: { phoneHash, usedAt: null, attempts: { lte: MAX_CODE_TRIES } },
      data: { attempts: { increment: 1 } },
    });
    const row = await this.prisma.signupCode.findUnique({ where: { phoneHash } });
    const verdict = checkCode(row, hashCode(phone, b.code, env.PII_HASH_KEY));
    if (verdict === 'locked')
      throw new ForbiddenException('Too many wrong codes. Ask for a new code.');
    if (verdict !== 'ok') throw new BadRequestException('Wrong or expired code');

    const passwordHash = await argon2.hash(b.pin, { type: argon2.argon2id });
    try {
      const pair = await this.prisma.$transaction(async (tx) => {
        // Single use: only one request can claim the code.
        const claimed = await tx.signupCode.updateMany({
          where: { phoneHash, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (claimed.count === 0) throw new BadRequestException('Wrong or expired code');
        const user = await tx.user.create({
          data: {
            tenantId: DEFAULT_TENANT_ID,
            role: 'citizen',
            name: b.fullName,
            phoneEnc: encryptField(phone, env.PII_ENC_KEY),
            phoneHash,
            passwordHash,
            personId: randomUUID(),
          },
        });
        const event = buildEvent(
          'identity.user.registered',
          { userId: user.id, personId: user.personId! },
          { source: 'identity', tenantId: user.tenantId },
        );
        await tx.outboxEvent.create({ data: outboxRow(event) });
        return this.issue(tx, user, randomUUID(), undefined, userAgent);
      });
      this.bus.kick();
      void this.openMockWallet(b.phone, b.fullName);
      return pair;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002')
        throw new ConflictException('This phone number already has an account');
      throw err;
    }
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
      this.logger.warn(
        { userId: row.userId, familyId: row.familyId },
        'Refresh token reuse detected',
      );
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
  async actFor(
    helper: AuthUser,
    personId: string,
    pin: string,
    userAgent?: string,
  ): Promise<TokenPair> {
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
          lockedUntil:
            failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      });
      throw new UnauthorizedException('Wrong PIN');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: helper.id } });
    return this.prisma.$transaction(async (tx) => {
      await tx.helperLink.update({
        where: { id: link.id },
        data: { failedPins: 0, lockedUntil: null },
      });
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
