import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import {
  buildEvent,
  decryptField,
  encryptField,
  EventBus,
  lookupHash,
  outboxRow,
  type AuthUser,
} from '@haqdaar/nest-kit';
import { PrismaService } from '../prisma.service';
import { normalizePhone } from '../auth/auth.service';
import { env } from '../env';
import {
  describeChanges,
  maskPhone,
  refuseChange,
  TEAM_ROLES,
  temporaryPassword,
  type TeamRole,
  type UserChange,
} from './user-policy';

/**
 * Admin user management ("Manage users, roles" in the brief). Everything is scoped to the
 * admin's own tenant: another program's people are never listed, created or changed.
 * Only team members (officer, helper, auditor, admin) are managed here; citizens own their
 * accounts and are not shown to the admin as a phone list.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async list(admin: AuthUser) {
    const rows = await this.prisma.user.findMany({
      where: { tenantId: admin.tenantId, role: { in: [...TEAM_ROLES] } },
      select: {
        id: true,
        name: true,
        role: true,
        phoneEnc: true,
        active: true,
        createdAt: true,
        // A login or a session renewal writes a refresh token, so the newest one = last seen.
        refreshTokens: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: [{ active: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(({ phoneEnc, refreshTokens, ...u }) => ({
      ...u,
      phoneMasked: maskPhone(decryptField(phoneEnc, env.PII_ENC_KEY)),
      lastLoginAt: refreshTokens[0]?.createdAt ?? null,
      isYou: u.id === admin.id,
    }));
  }

  /** The temporary password is returned ONCE here; only its argon2id hash is stored. */
  async create(admin: AuthUser, b: { name: string; phone: string; role: TeamRole }) {
    const phone = normalizePhone(b.phone);
    const password = temporaryPassword();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const row = await tx.user.create({
          data: {
            tenantId: admin.tenantId,
            role: b.role,
            name: b.name,
            phoneEnc: encryptField(phone, env.PII_ENC_KEY),
            phoneHash: lookupHash(phone, env.PII_HASH_KEY),
            passwordHash,
          },
          select: { id: true, name: true, role: true, active: true, createdAt: true },
        });
        const event = buildEvent(
          'identity.user.created',
          { userId: row.id, role: row.role },
          { source: 'identity', principal: admin, tenantId: admin.tenantId },
        );
        await tx.outboxEvent.create({ data: outboxRow(event) });
        return row;
      });
      this.bus.kick();
      return {
        user: { ...user, phoneMasked: maskPhone(phone), lastLoginAt: null, isYou: false },
        temporaryPassword: password,
        note: 'Shown once. Give it to the team member; they log in with their phone number and this password.',
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('This phone number already has an account');
      }
      throw err;
    }
  }

  /**
   * Change role and/or disable/enable. A role change reaches the user's NEXT access token
   * (at most ACCESS_TOKEN_TTL_SECONDS later, on refresh); disabling also ends every session now,
   * so the user cannot refresh, and login is refused while `active` is false.
   */
  async update(admin: AuthUser, id: string, change: UserChange) {
    const result = await this.prisma.$transaction(async (tx) => {
      // Tenant in the WHERE: another tenant's user looks exactly like a missing one (404).
      const target = await tx.user.findFirst({
        where: { id, tenantId: admin.tenantId, role: { in: [...TEAM_ROLES] } },
        select: { id: true, name: true, role: true, active: true, createdAt: true, phoneEnc: true },
      });
      if (!target) throw new NotFoundException('Team member not found');

      const otherActiveAdmins = await tx.user.count({
        where: { tenantId: admin.tenantId, role: 'admin', active: true, id: { not: id } },
      });
      const refusal = refuseChange({ actorId: admin.id, target, change, otherActiveAdmins });
      if (refusal) throw new BadRequestException(refusal);

      const changes = describeChanges(target, change);
      if (Object.keys(changes).length === 0) return { target, changed: false };

      const updated = await tx.user.update({
        where: { id },
        data: {
          role: change.role,
          active: change.active,
          // Re-enabling starts clean: an old lock must not keep the person out.
          ...(change.active === true ? { failedLogins: 0, lockedUntil: null } : {}),
        },
        select: { id: true, name: true, role: true, active: true, createdAt: true, phoneEnc: true },
      });
      if (change.active === false) {
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      const event = buildEvent(
        'identity.user.updated',
        { userId: id, changes },
        { source: 'identity', principal: admin, tenantId: admin.tenantId },
      );
      await tx.outboxEvent.create({ data: outboxRow(event) });
      return { target: updated, changed: true };
    });
    if (result.changed) this.bus.kick();
    const { phoneEnc, ...user } = result.target;
    return {
      user: {
        ...user,
        phoneMasked: maskPhone(decryptField(phoneEnc, env.PII_ENC_KEY)),
        isYou: user.id === admin.id,
      },
      changed: result.changed,
      note: 'A role change applies from the next access token (within minutes). Disabling ends all sessions now.',
    };
  }
}
