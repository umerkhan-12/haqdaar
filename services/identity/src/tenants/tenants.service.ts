import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import argon2 from 'argon2';
import {
  buildEvent,
  encryptField,
  EventBus,
  lookupHash,
  outboxRow,
  type AuthUser,
} from '@haqdaar/nest-kit';
import {
  DEFAULT_MONTHLY_REQUEST_QUOTA,
  type LaunchProgramRequest,
  type UsageBatch,
} from '@haqdaar/shared';
import { PrismaService } from '../prisma.service';
import { normalizePhone } from '../auth/auth.service';
import { env } from '../env';
import { dailyUsage, dayRange, monthStart, quotaView } from './usage';

const TENANT_VIEW = {
  id: true,
  name: true,
  type: true,
  monthlyRequestQuota: true,
  createdAt: true,
} as const;

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  /**
   * Platform admin = an admin user with the `platform_admin` flag (seeded, never settable via API).
   * Checked against the database on every call, not a token claim: revoking it is immediate.
   */
  async isPlatformAdmin(user: AuthUser): Promise<boolean> {
    if (user.role !== 'admin') return false;
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { platformAdmin: true, active: true },
    });
    return !!row?.active && row.platformAdmin;
  }

  private async requirePlatformAdmin(user: AuthUser): Promise<void> {
    if (!(await this.isPlatformAdmin(user)))
      throw new ForbiddenException('Requires a platform admin');
  }

  /** Tenant + first admin + `identity.tenant.created` (outbox) in ONE transaction. */
  async launch(user: AuthUser, b: LaunchProgramRequest) {
    await this.requirePlatformAdmin(user);
    const phone = normalizePhone(b.adminPhone);
    const phoneHash = lookupHash(phone, env.PII_HASH_KEY);
    const passwordHash = await argon2.hash(b.adminPassword, { type: argon2.argon2id });

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: b.programName,
            type: b.type,
            monthlyRequestQuota: b.monthlyRequestQuota ?? DEFAULT_MONTHLY_REQUEST_QUOTA,
            createdBy: user.id,
          },
          select: TENANT_VIEW,
        });
        const admin = await tx.user.create({
          data: {
            tenantId: tenant.id,
            role: 'admin',
            name: b.adminName,
            phoneEnc: encryptField(phone, env.PII_ENC_KEY),
            phoneHash,
            passwordHash,
          },
          select: { id: true, name: true, role: true },
        });
        const event = buildEvent(
          'identity.tenant.created',
          { tenantId: tenant.id, name: tenant.name, type: tenant.type, adminUserId: admin.id },
          { source: 'identity', principal: user, tenantId: tenant.id },
        );
        await tx.outboxEvent.create({ data: outboxRow(event) });
        return { tenant, admin: { ...admin, phoneMasked: maskPhone(phone) } };
      });
      this.bus.kick();
      this.logger.warn({ by: user.id, tenantId: result.tenant.id }, 'Program launched');
      return result;
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('This phone number already has an account');
      }
      throw err;
    }
  }

  async list(user: AuthUser) {
    await this.requirePlatformAdmin(user);
    const rows = await this.prisma.tenant.findMany({
      select: { ...TENANT_VIEW, _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(({ _count, ...t }) => ({ ...t, users: _count.users }));
  }

  async mine(user: AuthUser) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      select: TENANT_VIEW,
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return { ...tenant, platformAdmin: await this.isPlatformAdmin(user) };
  }

  /** That tenant's own admin, or a platform admin. Everyone else gets 403 (even for unknown ids). */
  async usage(user: AuthUser, tenantId: string, days: number) {
    const own = user.role === 'admin' && user.tenantId === tenantId;
    if (!own) await this.requirePlatformAdmin(user);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: TENANT_VIEW,
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const range = dayRange(days);
    const from = new Date(`${range[0]}T00:00:00Z`);
    const [rows, ai, mtd] = await Promise.all([
      this.prisma.usageDaily.findMany({ where: { tenantId, day: { gte: from } } }),
      this.prisma.aiUsageDaily.findMany({ where: { tenantId, day: { gte: from } } }),
      this.prisma.usageDaily.aggregate({
        where: { tenantId, day: { gte: monthStart() } },
        _sum: { requests: true },
      }),
    ]);
    const daily = dailyUsage(range, rows, ai);
    return {
      tenant,
      from: range[0],
      to: range[range.length - 1],
      totals: {
        requests: daily.reduce((n, d) => n + d.requests, 0),
        errors: daily.reduce((n, d) => n + d.errors, 0),
        aiCalls: daily.reduce((n, d) => n + d.aiCalls, 0),
      },
      quota: quotaView(tenant.monthlyRequestQuota, mtd._sum.requests ?? 0),
      daily,
      note: 'Counts reach this report within ~15 s (gateway flush interval).',
    };
  }

  /** Gateway flush: add the counts. Rows for unknown tenants are dropped (no junk from stale tokens). */
  async record(batch: UsageBatch) {
    const ids = [...new Set(batch.entries.map((e) => e.tenantId))];
    const known = new Set(
      (await this.prisma.tenant.findMany({ where: { id: { in: ids } }, select: { id: true } })).map(
        (t) => t.id,
      ),
    );
    const entries = batch.entries.filter(
      (e) => known.has(e.tenantId) && (e.requests > 0 || e.errors > 0),
    );
    await this.prisma.$transaction(
      entries.map((e) => {
        const key = {
          tenantId: e.tenantId,
          day: new Date(`${e.day}T00:00:00Z`),
          service: e.service,
        };
        return this.prisma.usageDaily.upsert({
          where: { tenantId_day_service: key },
          create: { ...key, requests: e.requests, errors: e.errors },
          update: { requests: { increment: e.requests }, errors: { increment: e.errors } },
        });
      }),
    );
    return { recorded: entries.length, dropped: batch.entries.length - entries.length };
  }
}

function maskPhone(phone: string): string {
  return phone.replace(/^(.{4}).*(.{2})$/, '$1*****$2');
}
