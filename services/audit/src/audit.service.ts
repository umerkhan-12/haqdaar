import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { buildEvent, EventBus, type AuthUser } from '@haqdaar/nest-kit';
import { aggregateScamMap, SCAM_EVENT_TYPES, type ScamMap } from './scam-map';
import { ALL_EVENT_TYPES, EventEnvelope } from '@haqdaar/shared';
import { Prisma, type AuditLog } from '../generated/prisma';
import { PrismaService } from './prisma.service';
import {
  chainHash,
  entityIdOf,
  GENESIS_HASH,
  verifyRows,
  type ChainFields,
  type VerifyResult,
} from './chain';

/** Any constant works; it only has to be the same for every appender. */
const CHAIN_LOCK = 7_420_101;
const VERIFY_BATCH = 1000;
/** Most scam events one map request reads; beyond it the response says `capped`. */
const SCAM_MAP_CAP = 5000;

export interface AuditQuery {
  type?: string;
  entityId?: string;
  actorId?: string;
  tenantId?: string;
  from?: Date;
  to?: Date;
  cursor?: number;
  limit: number;
}

@Injectable()
export class AuditService implements OnModuleInit {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  async onModuleInit() {
    await this.bus.subscribe(ALL_EVENT_TYPES, (e) => this.append(e));
  }

  /**
   * Append one event to the chain. A transaction-level advisory lock serialises appenders,
   * so two consumers (or replicas) can never link to the same previous row.
   * Redelivered events (same eventId) are a no-op.
   */
  async append(raw: unknown): Promise<void> {
    const e = EventEnvelope.parse(raw);
    const fields: ChainFields = {
      eventId: e.eventId,
      type: e.type,
      source: e.source,
      tenantId: e.tenantId,
      actor: e.actor,
      entityId: entityIdOf(e.payload),
      payload: e.payload,
      occurredAt: new Date(e.occurredAt).toISOString(),
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK})`;
      if (await tx.auditLog.findUnique({ where: { eventId: e.eventId }, select: { seq: true } }))
        return;
      const last = await tx.auditLog.findFirst({
        orderBy: { seq: 'desc' },
        select: { hash: true },
      });
      const prevHash = last?.hash ?? GENESIS_HASH;
      await tx.auditLog.create({
        data: {
          ...fields,
          actorId: e.actor?.id ?? null,
          actor: e.actor ?? Prisma.DbNull,
          payload: e.payload as Prisma.InputJsonValue,
          occurredAt: new Date(fields.occurredAt),
          prevHash,
          hash: chainHash(fields, prevHash),
        },
      });
    });
  }

  async list(q: AuditQuery, ownTenantId: string) {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        type: q.type,
        entityId: q.entityId,
        actorId: q.actorId,
        // Own program plus system entries (no program); never another program's.
        OR: [{ tenantId: ownTenantId }, { tenantId: null }],
        occurredAt: q.from || q.to ? { gte: q.from, lte: q.to } : undefined,
        seq: q.cursor ? { lt: BigInt(q.cursor) } : undefined,
      },
      orderBy: { seq: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit).map(toDto);
    return { items: page, nextCursor: rows.length > q.limit ? page.at(-1)!.seq : null };
  }

  async get(eventId: string, ownTenantId: string) {
    const row = await this.prisma.auditLog.findUnique({ where: { eventId } });
    if (!row || (row.tenantId && row.tenantId !== ownTenantId))
      throw new NotFoundException('Audit entry not found');
    return toDto(row);
  }

  /** Recompute every hash from genesis (or from `fromSeq`, anchored on the row before it). */
  async verify(fromSeq?: number): Promise<VerifyResult & { fromSeq: number }> {
    let expectedPrev = GENESIS_HASH;
    let cursor = 0;
    if (fromSeq && fromSeq > 1) {
      const anchor = await this.prisma.auditLog.findFirst({
        where: { seq: { lt: BigInt(fromSeq) } },
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      });
      if (anchor) {
        expectedPrev = anchor.hash;
        cursor = Number(anchor.seq);
      }
    }

    let checked = 0;
    let lastSeq: number | null = null;
    for (;;) {
      const batch = await this.prisma.auditLog.findMany({
        where: { seq: { gt: BigInt(cursor) } },
        orderBy: { seq: 'asc' },
        take: VERIFY_BATCH,
      });
      if (!batch.length) break;
      const r = verifyRows(batch.map(toChainRow), expectedPrev);
      if (!r.valid) {
        this.logger.error({ brokenAtSeq: r.brokenAtSeq, reason: r.reason }, 'Audit chain broken');
        return { ...r, checked: checked + r.checked, fromSeq: fromSeq ?? 1 };
      }
      checked += r.checked;
      expectedPrev = r.lastHash;
      lastSeq = r.lastSeq;
      cursor = Number(batch.at(-1)!.seq);
    }
    return { valid: true, checked, lastSeq, lastHash: expectedPrev, fromSeq: fromSeq ?? 1 };
  }

  /**
   * Scam Map for the caller's own program: built from scam-check events only, which hold no
   * message text. Newest rows first and capped, so a flood of checks cannot slow the page down.
   */
  async scamMap(tenantId: string, days: number): Promise<ScamMap> {
    const now = new Date();
    const rows = await this.prisma.auditLog.findMany({
      where: {
        type: { in: [...SCAM_EVENT_TYPES] },
        tenantId,
        occurredAt: { gte: new Date(now.getTime() - days * 86_400_000) },
      },
      orderBy: { seq: 'desc' },
      take: SCAM_MAP_CAP + 1,
      select: { type: true, occurredAt: true, payload: true },
    });
    return aggregateScamMap(rows.slice(0, SCAM_MAP_CAP), {
      days,
      now,
      capped: rows.length > SCAM_MAP_CAP,
    });
  }

  /**
   * An officer's label for a reported message. Nothing is edited: the label is one more chained
   * event, appended here directly so the map shows it at once.
   */
  async resolveScamReport(reportId: string, label: 'confirmed_scam' | 'genuine', by: AuthUser) {
    const report = await this.prisma.auditLog.findFirst({
      where: {
        type: 'ai.scam.reported',
        tenantId: by.tenantId,
        payload: { path: ['reportId'], equals: reportId },
      },
      select: { seq: true },
    });
    if (!report) throw new NotFoundException('Scam report not found');
    await this.append(
      buildEvent(
        'ai.scam.report_resolved',
        { reportId, label },
        { source: 'audit', principal: by },
      ),
    );
    return { reportId, label };
  }

  async stats() {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const [total, byType, last] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.groupBy({
        by: ['type'],
        where: { recordedAt: { gte: since } },
        _count: { _all: true },
        orderBy: { type: 'asc' },
      }),
      this.prisma.auditLog.findFirst({
        orderBy: { seq: 'desc' },
        select: { seq: true, recordedAt: true },
      }),
    ]);
    return {
      total,
      last24h: Object.fromEntries(byType.map((t) => [t.type, t._count._all])),
      lastSeq: last ? Number(last.seq) : null,
      lastRecordedAt: last?.recordedAt ?? null,
    };
  }
}

function toChainRow(r: AuditLog) {
  return {
    seq: Number(r.seq),
    eventId: r.eventId,
    type: r.type,
    source: r.source,
    tenantId: r.tenantId,
    actor: r.actor,
    entityId: r.entityId,
    payload: r.payload,
    occurredAt: r.occurredAt.toISOString(),
    prevHash: r.prevHash,
    hash: r.hash,
  };
}

function toDto(r: AuditLog) {
  return { ...toChainRow(r), actorId: r.actorId, recordedAt: r.recordedAt.toISOString() };
}
