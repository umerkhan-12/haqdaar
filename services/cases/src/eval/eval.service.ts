import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '@haqdaar/nest-kit';
import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';
import { RulesService } from '../rules/rules.service';
import { env } from '../env';
import { DEFAULT_SEED, DEFAULT_SIZE } from './dataset';
import { runEvaluation } from './evaluate';

const QUEUE = ['IN_REVIEW', 'NEEDS_INFO'] as const;

@Injectable()
export class EvalService {
  private readonly logger = new Logger(EvalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: RulesService,
  ) {}

  /**
   * Offline evaluation at the tenant's current cost settings. Labels encode Sahara v1 eligibility, so this measures
   * the decision engine (evidence, calibration, threshold) — rule changes are what the Digital Twin is for.
   */
  async run(user: AuthUser, opts: { seed?: number; size?: number }) {
    const costs = await this.rules.costs(user.tenantId);
    const seed = opts.seed ?? DEFAULT_SEED;
    const size = opts.size ?? DEFAULT_SIZE;
    const report = runEvaluation({ seed, size, costs, amountCap: env.AUTO_APPROVE_AMOUNT_CAP_PKR });
    const row = await this.prisma.evalRun.create({
      data: {
        tenantId: user.tenantId,
        datasetSeed: seed,
        datasetSize: size,
        costs: report.costs,
        headline: report.headline,
        report: report as unknown as Prisma.InputJsonValue,
        createdBy: user.id,
      },
    });
    this.logger.log({ by: user.id, runId: row.id, headline: report.headline }, 'Evaluation run');
    return { id: row.id, createdAt: row.createdAt, ...report };
  }

  async runs(tenantId: string) {
    const rows = await this.prisma.evalRun.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        createdAt: true,
        createdBy: true,
        datasetSeed: true,
        datasetSize: true,
        costs: true,
        headline: true,
      },
    });
    return rows;
  }

  async get(tenantId: string, id: string) {
    const row = await this.prisma.evalRun.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Evaluation run not found');
    return {
      id: row.id,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      ...(row.report as object),
    };
  }

  /** Live numbers from real claims: lanes, queue, time to money, plus the last offline evaluation. */
  async summary(tenantId: string) {
    const now = new Date();
    const claims = { tenantId, type: 'relief_claim' as const };
    const [lanes, statuses, queue, paid, last] = await Promise.all([
      this.prisma.case.groupBy({ by: ['lane'], where: claims, _count: { _all: true } }),
      this.prisma.case.groupBy({ by: ['status'], where: claims, _count: { _all: true } }),
      this.prisma.case.findMany({
        where: { ...claims, status: { in: [...QUEUE] } },
        select: { status: true, createdAt: true },
      }),
      this.prisma.caseEvent.findMany({
        where: { type: 'payment.success', case: claims },
        orderBy: { at: 'asc' },
        select: { caseId: true, at: true, case: { select: { createdAt: true, lane: true } } },
      }),
      this.prisma.evalRun.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
    ]);

    const laneCount = Object.fromEntries(
      lanes.filter((l) => l.lane).map((l) => [l.lane!, l._count._all]),
    );
    const decided = Object.values(laneCount).reduce((s, n) => s + n, 0);

    // first successful payment per case: created → money in the account
    const firstPaid = new Map<string, { seconds: number; lane: string | null }>();
    for (const e of paid) {
      if (!firstPaid.has(e.caseId)) {
        firstPaid.set(e.caseId, {
          seconds: (e.at.getTime() - e.case.createdAt.getTime()) / 1000,
          lane: e.case.lane,
        });
      }
    }
    const ttm = [...firstPaid.values()];
    const waits = queue.map((c) => (now.getTime() - c.createdAt.getTime()) / 60_000);

    return {
      at: now,
      claims: {
        total: statuses.reduce((s, x) => s + x._count._all, 0),
        byStatus: Object.fromEntries(statuses.map((s) => [s.status, s._count._all])),
      },
      lanes: {
        decided,
        AUTO_APPROVE: laneCount.AUTO_APPROVE ?? 0,
        HUMAN_REVIEW: laneCount.HUMAN_REVIEW ?? 0,
        ASK_MORE: laneCount.ASK_MORE ?? 0,
        automationRate: decided ? round((laneCount.AUTO_APPROVE ?? 0) / decided) : null,
      },
      queue: {
        size: queue.length,
        inReview: queue.filter((c) => c.status === 'IN_REVIEW').length,
        needsInfo: queue.filter((c) => c.status === 'NEEDS_INFO').length,
        waitingMinutes: {
          median: quantile(waits, 0.5),
          p90: quantile(waits, 0.9),
          max: waits.length ? round(Math.max(...waits), 1) : null,
        },
      },
      timeToMoney: {
        definition: 'case created → first successful payment (timeline event payment.success)',
        paidCases: ttm.length,
        medianSeconds: quantile(
          ttm.map((t) => t.seconds),
          0.5,
        ),
        p90Seconds: quantile(
          ttm.map((t) => t.seconds),
          0.9,
        ),
        medianSecondsAutoApproved: quantile(
          ttm.filter((t) => t.lane === 'AUTO_APPROVE').map((t) => t.seconds),
          0.5,
        ),
        medianSecondsOfficerApproved: quantile(
          ttm.filter((t) => t.lane !== 'AUTO_APPROVE').map((t) => t.seconds),
          0.5,
        ),
      },
      lastEval: last && { id: last.id, createdAt: last.createdAt, ...(last.headline as object) },
    };
  }
}

function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** Linear-interpolated quantile; null for no data. */
function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return round(s[lo] + (s[hi] - s[lo]) * (pos - lo), 1);
}
