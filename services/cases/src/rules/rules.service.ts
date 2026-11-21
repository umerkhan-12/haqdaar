import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { z } from 'zod';
import { autoApproveThreshold, DEFAULT_COSTS, type CostSettings, type Lane } from '@haqdaar/shared';
import { buildEvent, EventBus, outboxRow, type AuthUser } from '@haqdaar/nest-kit';
import { PrismaService } from '../prisma.service';
import { decide, type DecisionInputs } from '../engine/decide';
import { Clause, combinedLogic, type RuleDefinition } from '../engine/rules';
import { env } from '../env';

export interface ActiveRule {
  id: string;
  version: number;
  clauses: Clause[];
  amount: number;
}

const REPLAY_LIMIT = 200;

@Injectable()
export class RulesService {
  private readonly logger = new Logger(RulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
  ) {}

  list(tenantId: string) {
    return this.prisma.ruleVersion.findMany({ where: { tenantId }, orderBy: { version: 'desc' } });
  }

  async published(tenantId: string): Promise<ActiveRule> {
    const r = await this.prisma.ruleVersion.findFirst({ where: { tenantId, status: 'PUBLISHED' } });
    if (!r) throw new ServiceUnavailableException('No published rule for this program');
    return { id: r.id, version: r.version, clauses: z.array(Clause).parse(r.clauses), amount: r.amount };
  }

  async createDraft(user: AuthUser, def: RuleDefinition) {
    const last = await this.prisma.ruleVersion.findFirst({
      where: { tenantId: user.tenantId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return this.prisma.ruleVersion.create({
      data: {
        tenantId: user.tenantId,
        version: (last?.version ?? 0) + 1,
        clauses: def.clauses as object[],
        logic: combinedLogic(def.clauses) as object,
        amount: def.amount,
        notes: def.notes,
        createdBy: user.id,
      },
    });
  }

  /** Retires the current version and publishes this one. New decisions use it immediately; old ones keep theirs. */
  async publish(user: AuthUser, id: string) {
    const published = await this.prisma.$transaction(async (tx) => {
      const draft = await tx.ruleVersion.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!draft) throw new NotFoundException('Rule version not found');
      if (draft.status !== 'DRAFT') throw new ConflictException(`Rule version is ${draft.status}`);
      const previous = await tx.ruleVersion.findFirst({
        where: { tenantId: user.tenantId, status: 'PUBLISHED' },
        select: { id: true },
      });
      await tx.ruleVersion.updateMany({
        where: { tenantId: user.tenantId, status: 'PUBLISHED' },
        data: { status: 'RETIRED' },
      });
      const result = await tx.ruleVersion.update({
        where: { id },
        data: { status: 'PUBLISHED', publishedBy: user.id, publishedAt: new Date() },
      });
      const event = buildEvent(
        'cases.rule.published',
        { ruleVersionId: result.id, version: result.version, previousVersionId: previous?.id ?? null },
        { source: 'cases', principal: user },
      );
      await tx.outboxEvent.create({ data: outboxRow(event) });
      return result;
    });
    this.bus.kick();
    this.logger.warn({ by: user.id, version: published.version }, 'Rule version published');
    return published;
  }

  /**
   * Digital Twin: replay the stored inputs of recent automated decisions under a draft rule
   * and show what would change, before anyone publishes it.
   */
  async simulate(user: AuthUser, id: string) {
    const draft = await this.prisma.ruleVersion.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!draft) throw new NotFoundException('Rule version not found');
    const clauses = z.array(Clause).parse(draft.clauses);
    const costs = await this.costs(user.tenantId);

    const decisions = await this.prisma.decision.findMany({
      where: { decidedBy: 'system', case: { tenantId: user.tenantId } },
      orderBy: { createdAt: 'desc' },
      distinct: ['caseId'],
      take: REPLAY_LIMIT,
      select: { caseId: true, lane: true, inputs: true },
    });

    const empty = (): Record<Lane, number> => ({ AUTO_APPROVE: 0, ASK_MORE: 0, HUMAN_REVIEW: 0 });
    const before = empty();
    const after = empty();
    const changed: { caseId: string; from: Lane; to: Lane }[] = [];
    for (const d of decisions) {
      const lane = decide(d.inputs as unknown as DecisionInputs, {
        clauses,
        amount: draft.amount,
        costs,
        amountCap: env.AUTO_APPROVE_AMOUNT_CAP_PKR,
      }).lane;
      before[d.lane] += 1;
      after[lane] += 1;
      if (lane !== d.lane) changed.push({ caseId: d.caseId, from: d.lane, to: lane });
    }
    return {
      ruleVersion: { id: draft.id, version: draft.version, status: draft.status },
      casesReplayed: decisions.length,
      before,
      after,
      changed: changed.slice(0, 50),
      changedCount: changed.length,
    };
  }

  async costs(tenantId: string): Promise<CostSettings> {
    const c = await this.prisma.costSettings.findUnique({ where: { tenantId } });
    return c ? { wrongApproval: c.wrongApproval, humanReview: c.humanReview, askMore: c.askMore } : DEFAULT_COSTS;
  }

  async costView(tenantId: string) {
    const costs = await this.costs(tenantId);
    return { ...costs, autoApproveThreshold: autoApproveThreshold(costs) };
  }

  async setCosts(user: AuthUser, costs: CostSettings) {
    await this.prisma.costSettings.upsert({
      where: { tenantId: user.tenantId },
      update: { ...costs, updatedBy: user.id },
      create: { tenantId: user.tenantId, ...costs, updatedBy: user.id },
    });
    this.logger.warn({ by: user.id, costs }, 'Cost settings changed');
    return this.costView(user.tenantId);
  }
}
