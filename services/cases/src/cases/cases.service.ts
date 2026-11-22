import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  buildEvent,
  decryptField,
  encryptField,
  EventBus,
  lookupHash,
  maskCnic,
  outboxRow,
  type AuthUser,
} from '@haqdaar/nest-kit';
import {
  autoApproveThreshold,
  type CaseStatus,
  type ConsentPurpose,
  type EventEnvelope,
} from '@haqdaar/shared';
import { Prisma, type Case, type Decision, type Person } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';
import { RulesService, type ActiveRule } from '../rules/rules.service';
import { Upstream, type HouseholdRecord, type NadraVerifyResponse } from '../upstream';
import { decide, type DecisionInputs, type HardFlag } from '../engine/decide';
import {
  ANOMALY_WINDOWS,
  detectAnomalies,
  detectAnomaliesForCase,
  flagsVisibleTo,
  type AnomalyCandidateGroups,
  type AnomalyObservation,
  type AnomalySignal,
  type AnomalyType,
} from '../engine/anomaly';
import { nameSimilarity, normalizeName } from '../engine/names';
import { priority } from '../engine/priority';
import type { Facts } from '../engine/rules';
import { isStaff, subjectPerson } from '../access';
import { env } from '../env';
import type { CreateCaseBody } from './cases.schemas';
import {
  applyCaution,
  auditNotes,
  PHOTO_SKIPPED,
  softFlags,
  storedDocumentCheck,
  storedExtraction,
  trustedExtractionConfidence,
  viewNotes,
} from './ai-notes';
import { boosted, refusal, REVIEWABLE, type OfficerMove } from './lifecycle';

type Tx = Prisma.TransactionClient;

const OPEN: CaseStatus[] = ['SUBMITTED', 'PROCESSING', 'NEEDS_INFO', 'IN_REVIEW', 'APPROVED'];
const PROCESSABLE: CaseStatus[] = ['SUBMITTED', 'NEEDS_INFO'];
const CONSENTS: ConsentPurpose[] = ['identity_verification', 'household_data'];
const DUPLICATE_NAME_MIN = 0.92;
const ANOMALY_OPEN_STATUSES = ['SUBMITTED', 'PROCESSING', 'NEEDS_INFO', 'IN_REVIEW'] as const;
const ANOMALY_COUNTED_STATUSES = [
  'SUBMITTED',
  'PROCESSING',
  'NEEDS_INFO',
  'IN_REVIEW',
  'APPROVED',
  'PAID',
] as const;
const ANOMALY_BATCH_SIZE = 250;
/** Submit path: most recent rows read per group. Far above every threshold, and it bounds the work. */
const ANOMALY_GROUP_LIMIT = 200;
const ANOMALY_OBSERVATION_SELECT = {
  id: true,
  tenantId: true,
  status: true,
  personId: true,
  payoutKey: true,
  helperId: true,
  districtSnapshot: true,
  householdSize: true,
  nameNormalizedSnapshot: true,
  createdAt: true,
  person: { select: { cnicHash: true } },
} satisfies Prisma.CaseSelect;
type AnomalyRow = Prisma.CaseGetPayload<{ select: typeof ANOMALY_OBSERVATION_SELECT }>;

function toObservation(row: AnomalyRow): AnomalyObservation {
  return {
    tenantId: row.tenantId,
    caseId: row.id,
    status: row.status,
    personId: row.personId,
    cnicHash: row.person.cnicHash,
    nameNormalized: row.nameNormalizedSnapshot ?? '',
    district: row.districtSnapshot,
    payoutKey: row.payoutKey,
    helperId: row.helperId,
    householdSize: row.householdSize,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class CasesService {
  private readonly logger = new Logger(CasesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: EventBus,
    private readonly rules: RulesService,
    private readonly upstream: Upstream,
  ) {}

  // ---------- citizen / helper ----------

  /** Same idempotency key → same case. The CNIC must belong to the person this session acts for. */
  async create(
    user: AuthUser,
    body: CreateCaseBody,
    clientKey: string | undefined,
    requestId?: string,
  ) {
    if (!clientKey || clientKey.length < 8 || clientKey.length > 100) {
      throw new BadRequestException('Header idempotency-key (8-100 chars) is required');
    }
    const personId = subjectPerson(user);
    const idempotencyKey = `${user.id}:${clientKey}`;
    const existing = await this.prisma.case.findUnique({ where: { idempotencyKey } });
    if (existing) return this.view(user, existing.id);

    await this.rules.published(user.tenantId); // fail before creating anything if no rule is live
    const cnicHash = lookupHash(body.cnic, env.PII_HASH_KEY);

    let created: Case;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const person = await this.resolvePerson(tx, user.tenantId, personId, cnicHash, body);
        const c = await tx.case.create({
          data: {
            tenantId: user.tenantId,
            personId: person.id,
            type: body.type,
            createdBy: user.id,
            onBehalfOf: user.role === 'helper' ? personId : null,
            idempotencyKey,
            payoutIban: body.payout.iban ?? null,
            payoutAlias: body.payout.alias ?? null,
            payoutKey: this.payoutKey(body.payout.iban, body.payout.alias),
            districtSnapshot: person.district,
            householdSize: body.householdSize ?? body.extraction?.householdSize ?? null,
            nameNormalizedSnapshot: person.nameNormalized,
            helperId: user.role === 'helper' ? user.id : null,
            extraction: (body.extraction as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            documentCheck:
              body.documentCheck === undefined
                ? Prisma.JsonNull
                : ((body.documentCheck ?? PHOTO_SKIPPED) as Prisma.InputJsonValue),
            events: { create: { type: 'submitted', actor: user.id, data: { via: user.role } } },
          },
        });
        const ctx = { source: 'cases', principal: user, correlationId: requestId };
        const hasNotes = body.extraction != null || body.documentCheck !== undefined;
        const aiNotes = hasNotes
          ? auditNotes(
              body.extraction,
              body.documentCheck,
              softFlags(body.cnic, body.extraction, body.documentCheck),
            )
          : undefined;
        await this.emit(
          tx,
          buildEvent(
            'cases.case.submitted',
            { caseId: c.id, personId: person.id, type: c.type, aiNotes },
            ctx,
          ),
        );
        await this.emit(
          tx,
          buildEvent(
            'cases.case.status_changed',
            { caseId: c.id, from: null, to: 'SUBMITTED' },
            ctx,
          ),
        );
        return c;
      });
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
      const raced = await this.prisma.case.findUnique({ where: { idempotencyKey } });
      if (!raced) throw e;
      return this.view(user, raced.id);
    }
    this.bus.kick();
    await this.process(created.id, user, requestId);
    return this.view(user, created.id);
  }

  /** Re-run the decision after the citizen added consent or information. */
  async resubmit(
    user: AuthUser,
    id: string,
    requestId?: string,
    fix?: { fullName?: string; cnic?: string },
  ) {
    const c = await this.ownCase(user, id);
    if (c.status !== 'NEEDS_INFO') throw new ConflictException(`Case is ${c.status}`);
    if (fix?.fullName || fix?.cnic) await this.correctDetails(c, user, fix);
    await this.process(c.id, user, requestId);
    return this.view(user, c.id);
  }

  /**
   * The officer asked her to correct her details and she sends them again. The name can always be
   * corrected. The CNIC only while no officer has ever approved a claim for this person: after
   * that the identity is confirmed and changing it needs an officer. A CNIC that belongs to someone
   * else is refused. The timeline records which fields changed, never the values.
   */
  private async correctDetails(
    c: { id: string; personId: string; tenantId: string },
    user: AuthUser,
    fix: { fullName?: string; cnic?: string },
  ) {
    const person = await this.prisma.person.findUniqueOrThrow({ where: { id: c.personId } });
    const data: Prisma.PersonUpdateInput = {};
    const changed: string[] = [];
    if (fix.cnic) {
      const cnicHash = lookupHash(fix.cnic, env.PII_HASH_KEY);
      if (cnicHash !== person.cnicHash) {
        const confirmed = await this.prisma.case.count({
          where: { personId: c.personId, status: { in: ['APPROVED', 'PAID', 'CLOSED'] } },
        });
        if (confirmed > 0)
          throw new ForbiddenException(
            'Your identity is already confirmed. An officer must change the CNIC.',
          );
        const other = await this.prisma.person.findUnique({
          where: { tenantId_cnicHash: { tenantId: c.tenantId, cnicHash } },
        });
        if (other) throw new ForbiddenException('This CNIC belongs to another person');
        data.cnicHash = cnicHash;
        data.cnicEnc = encryptField(fix.cnic, env.PII_ENC_KEY);
        changed.push('cnic');
      }
    }
    if (fix.fullName && normalizeName(fix.fullName) !== person.nameNormalized) {
      data.fullName = fix.fullName;
      data.nameNormalized = normalizeName(fix.fullName);
      changed.push('name');
    }
    if (changed.length === 0) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.person.update({ where: { id: c.personId }, data });
      await tx.case.update({
        where: { id: c.id },
        data: {
          ...(data.nameNormalized ? { nameNormalizedSnapshot: String(data.nameNormalized) } : {}),
          // The earlier card photo was checked against the old number: it no longer counts.
          ...(changed.includes('cnic')
            ? { documentCheck: PHOTO_SKIPPED as Prisma.InputJsonValue }
            : {}),
          events: { create: { type: 'info_provided', actor: user.id, data: { fields: changed } } },
        },
      });
    });
  }

  private async resolvePerson(
    tx: Tx,
    tenantId: string,
    personId: string,
    cnicHash: string,
    body: CreateCaseBody,
  ) {
    const byCnic = await tx.person.findUnique({
      where: { tenantId_cnicHash: { tenantId, cnicHash } },
    });
    if (byCnic && byCnic.id !== personId)
      throw new ForbiddenException('This CNIC belongs to another person');
    const byId = byCnic ?? (await tx.person.findUnique({ where: { id: personId } }));
    if (byId && byId.cnicHash !== cnicHash) {
      throw new ForbiddenException('CNIC does not match the registered identity');
    }
    const data = {
      fullName: body.fullName,
      nameNormalized: normalizeName(body.fullName),
      district: body.district ?? byId?.district ?? null,
      payoutIban: body.payout.iban ?? null,
      payoutAlias: body.payout.alias ?? null,
    };
    if (byId) return tx.person.update({ where: { id: byId.id }, data });
    return tx.person.create({
      data: {
        id: personId,
        tenantId,
        cnicHash,
        cnicEnc: encryptField(body.cnic, env.PII_ENC_KEY),
        ...data,
      },
    });
  }

  /**
   * True when this claim created the person record (it did not exist before the claim) and no earlier
   * claim of theirs was ever approved. People enrolled by the program (seeded, or already approved once
   * by an officer) are known; a record born in the same moment as its first claim is not.
   */
  private async isFirstClaimOfNewPerson(c: {
    id: string;
    personId: string;
    createdAt: Date;
    person: { createdAt: Date };
  }) {
    const bornWithClaim = c.createdAt.getTime() - c.person.createdAt.getTime() < 60_000;
    if (!bornWithClaim) return false;
    const approvedBefore = await this.prisma.case.count({
      where: {
        personId: c.personId,
        id: { not: c.id },
        status: { in: ['APPROVED', 'PAID', 'CLOSED'] },
      },
    });
    return approvedBefore === 0;
  }

  // ---------- decision pipeline ----------

  /**
   * consent → NADRA + household (only with consent) → flags → rules → decision.
   * Any upstream failure degrades to human review; it never crashes the claim or guesses.
   */
  private async process(caseId: string, actor: AuthUser, requestId?: string) {
    const c = await this.prisma.case.findUniqueOrThrow({
      where: { id: caseId },
      include: { person: true },
    });
    const rule = await this.rules.published(c.tenantId);
    const costs = await this.rules.costs(c.tenantId);
    const inputs = await this.gather(c, c.person, requestId);
    // Fraud-ring check: a few indexed lookups for this claim's own groups, outside any transaction
    // and without a lock, so claims never wait for each other. The claim's row is already committed,
    // so whichever claim of a ring arrives last always sees the others.
    const signals = await this.anomaliesForCase(c, new Date());
    inputs.externalFlags.push(...signals.map((signal) => this.anomalyHardFlag(signal.type)));
    const engine = decide(inputs, {
      clauses: rule.clauses,
      amount: rule.amount,
      costs,
      amountCap: env.AUTO_APPROVE_AMOUNT_CAP_PKR,
    });
    // AI notes come from the client: applied after the engine, they can only send the case to a human.
    const soft = softFlags(
      decryptField(c.person.cnicEnc, env.PII_ENC_KEY),
      storedExtraction(c.extraction),
      storedDocumentCheck(c.documentCheck),
    );
    // Anyone can sign up and type any CNIC. Knowing a number proves nothing, and every proof the phone
    // sends (photo check, AI notes) is the client's word. So the first claim that ties a CNIC to a
    // self-registered account is never decided by the machine: an officer confirms the person once.
    if (actor.role === 'citizen' && (await this.isFirstClaimOfNewPerson(c)))
      soft.push('identity_first_claim');
    const outcome = applyCaution(engine, soft);
    const flags = [...outcome.hardFlags, ...soft];

    const to: CaseStatus =
      outcome.lane === 'AUTO_APPROVE'
        ? 'APPROVED'
        : outcome.lane === 'ASK_MORE'
          ? 'NEEDS_INFO'
          : 'IN_REVIEW';
    const ctx = { source: 'cases', principal: actor, correlationId: requestId };

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.case.updateMany({
        where: { id: c.id, status: { in: PROCESSABLE } },
        data: {
          status: to,
          lane: outcome.lane,
          confidence: outcome.confidence,
          amount: rule.amount,
          ruleVersionId: rule.id,
          flags,
          priority: priority({
            confidence: outcome.confidence,
            hardFlagCount: flags.length,
            amount: rule.amount,
            createdAt: c.createdAt,
          }),
        },
      });
      if (claimed.count === 0) throw new ConflictException('Case was already processed');

      const decision = await tx.decision.create({
        data: {
          caseId: c.id,
          ruleVersionId: rule.id,
          lane: outcome.lane,
          confidence: outcome.confidence,
          threshold: outcome.threshold,
          eligible: outcome.eligible,
          clausesHit: outcome.clauses as object[],
          hardFlags: flags,
          explanationUr: outcome.explanationUr,
          explanationEn: outcome.explanationEn,
          inputs: { ...inputs, softFlags: soft } as unknown as Prisma.InputJsonValue,
          decidedBy: 'system',
        },
      });
      await tx.caseEvent.create({
        data: {
          caseId: c.id,
          type: 'decision',
          actor: 'system',
          data: {
            decisionId: decision.id,
            lane: outcome.lane,
            ruleVersion: rule.version,
            confidence: outcome.confidence,
          },
        },
      });
      await this.emit(
        tx,
        buildEvent('cases.case.status_changed', { caseId: c.id, from: c.status, to }, ctx),
      );
      if (to === 'APPROVED') {
        await this.emit(
          tx,
          this.decidedEvent(c.id, c.personId, 'AUTO_APPROVE', outcome.confidence, rule, ctx),
        );
      }
    });
    this.bus.kick();

    // After the decision is committed: evidence for officers, and the flag on the ring's other open
    // claims. It only ever adds a flag; it never changes a status, so a failure here is not fatal.
    if (signals.length) {
      try {
        await this.prisma.$transaction((tx) => this.persistOpenFindings(tx, c.tenantId, signals));
      } catch (err) {
        this.logger.warn({ err: String(err), caseId: c.id }, 'Could not record anomaly evidence');
      }
    }
  }

  /** The rows that share a payout key, helper, district + household size or name + district with this claim. */
  private async anomaliesForCase(c: Case, now: Date): Promise<AnomalySignal[]> {
    if (c.type !== 'relief_claim') return [];
    const group = (where: Prisma.CaseWhereInput, windowMs: number) =>
      this.prisma.case.findMany({
        where: {
          tenantId: c.tenantId,
          type: 'relief_claim',
          status: { in: [...ANOMALY_COUNTED_STATUSES] },
          createdAt: { gte: new Date(now.getTime() - windowMs), lte: now },
          ...where,
        },
        orderBy: { createdAt: 'desc' },
        take: ANOMALY_GROUP_LIMIT,
        select: ANOMALY_OBSERVATION_SELECT,
      });
    const groups = await Promise.all([
      c.payoutKey ? group({ payoutKey: c.payoutKey }, ANOMALY_WINDOWS.sharedPayoutMs) : [],
      c.helperId ? group({ helperId: c.helperId }, ANOMALY_WINDOWS.helperVelocityMs) : [],
      c.districtSnapshot && c.householdSize !== null
        ? group(
            { districtSnapshot: c.districtSnapshot, householdSize: c.householdSize },
            ANOMALY_WINDOWS.householdPatternMs,
          )
        : [],
      c.nameNormalizedSnapshot && c.districtSnapshot
        ? group(
            {
              nameNormalizedSnapshot: c.nameNormalizedSnapshot,
              districtSnapshot: c.districtSnapshot,
            },
            ANOMALY_WINDOWS.identityCollisionMs,
          )
        : [],
    ]);
    return detectAnomaliesForCase(
      c.tenantId,
      c.id,
      groups.flat().map(toObservation),
      now,
      this.anomalyThresholds(),
    );
  }

  private anomalyThresholds() {
    return {
      sharedPayoutPeople: env.ANOMALY_SHARED_PAYOUT_PEOPLE,
      helperClaimsPerHour: env.ANOMALY_HELPER_CLAIMS_PER_HOUR,
      householdPatternPeople: env.ANOMALY_HOUSEHOLD_PATTERN_PEOPLE,
      identityCorroboratingDetails: env.ANOMALY_IDENTITY_CORROBORATION_DETAILS,
    };
  }

  /** Authenticated, tenant-scoped, repeatable scan. It only adds evidence to open claims. */
  async scanAnomalies(user: AuthUser) {
    const now = new Date();
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockTenantAnomalyScan(tx, user.tenantId);
        const observations = await this.anomalyObservations(tx, user.tenantId, now);
        const candidates = await this.anomalyCandidateGroups(tx, user.tenantId, now);
        const signals = this.detectTenantAnomalies(user.tenantId, observations, now, candidates);
        const result = await this.persistOpenFindings(tx, user.tenantId, signals);
        return {
          tenantId: user.tenantId,
          scannedCases: observations.length,
          signalsDetected: signals.length,
          findingsCreated: result.created,
          findingsUpdated: result.updated,
          findings: signals.map((signal) => ({
            type: signal.type,
            evidenceCaseIds: signal.evidenceCaseIds,
            observedCount: signal.observedCount,
            threshold: signal.threshold,
            windowStart: signal.windowStart,
            windowEnd: signal.windowEnd,
          })),
        };
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }

  private async lockTenantAnomalyScan(tx: Tx, tenantId: string) {
    // Serializes on-demand scans of one tenant. Claim submission never takes this lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;
  }

  private async anomalyObservations(
    tx: Tx,
    tenantId: string,
    now: Date,
  ): Promise<AnomalyObservation[]> {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const rows: AnomalyObservation[] = [];
    let afterId: string | undefined;
    for (;;) {
      const batch = await tx.case.findMany({
        where: {
          tenantId,
          type: 'relief_claim',
          status: { in: [...ANOMALY_COUNTED_STATUSES] },
          createdAt: { gte: cutoff, lte: now },
          ...(afterId ? { id: { gt: afterId } } : {}),
        },
        orderBy: { id: 'asc' },
        take: ANOMALY_BATCH_SIZE,
        select: ANOMALY_OBSERVATION_SELECT,
      });
      if (batch.length === 0) break;
      rows.push(...batch.map(toObservation));
      afterId = batch[batch.length - 1]!.id;
      if (batch.length < ANOMALY_BATCH_SIZE) break;
    }
    return rows;
  }

  private detectTenantAnomalies(
    tenantId: string,
    observations: AnomalyObservation[],
    now: Date,
    candidates: AnomalyCandidateGroups,
  ): AnomalySignal[] {
    return detectAnomalies(tenantId, observations, now, this.anomalyThresholds(), candidates);
  }

  /** Candidate clusters are SQL GROUP BY aggregates; the pure engine verifies them and builds evidence. */
  private async anomalyCandidateGroups(
    tx: Tx,
    tenantId: string,
    now: Date,
  ): Promise<AnomalyCandidateGroups> {
    const base = {
      tenantId,
      type: 'relief_claim' as const,
      status: { in: [...ANOMALY_COUNTED_STATUSES] },
      createdAt: { lte: now },
    };
    const candidates: Record<AnomalyType, Set<string>> = {
      shared_payout: new Set(),
      helper_velocity: new Set(),
      household_pattern: new Set(),
      identity_collision: new Set(),
    };

    const payoutPeople = await tx.case.groupBy({
      by: ['payoutKey', 'personId'],
      where: {
        ...base,
        payoutKey: { not: null },
        createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60_000), lte: now },
      },
    });
    const payoutCounts = new Map<string, Set<string>>();
    for (const item of payoutPeople) {
      if (!item.payoutKey) continue;
      const people = payoutCounts.get(item.payoutKey) ?? new Set<string>();
      people.add(item.personId);
      payoutCounts.set(item.payoutKey, people);
    }
    for (const [key, people] of payoutCounts) {
      if (people.size > env.ANOMALY_SHARED_PAYOUT_PEOPLE) candidates.shared_payout.add(key);
    }

    const helperPeople = await tx.case.groupBy({
      by: ['helperId', 'personId'],
      where: {
        ...base,
        helperId: { not: null },
        createdAt: { gte: new Date(now.getTime() - 60 * 60_000), lte: now },
      },
    });
    const helperCounts = new Map<string, number>();
    for (const item of helperPeople) {
      if (item.helperId)
        helperCounts.set(item.helperId, (helperCounts.get(item.helperId) ?? 0) + 1);
    }
    for (const [helperId, people] of helperCounts) {
      if (people > env.ANOMALY_HELPER_CLAIMS_PER_HOUR) candidates.helper_velocity.add(helperId);
    }

    const householdPeople = await tx.case.groupBy({
      by: ['districtSnapshot', 'householdSize', 'personId'],
      where: {
        ...base,
        districtSnapshot: { not: null },
        householdSize: { not: null },
        createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000), lte: now },
      },
    });
    const householdCounts = new Map<string, Set<string>>();
    for (const item of householdPeople) {
      if (!item.districtSnapshot || item.householdSize === null) continue;
      const key = `${normalizeGroupValue(item.districtSnapshot)}\u0000${item.householdSize}`;
      const people = householdCounts.get(key) ?? new Set<string>();
      people.add(item.personId);
      householdCounts.set(key, people);
    }
    for (const [key, people] of householdCounts) {
      if (people.size >= env.ANOMALY_HOUSEHOLD_PATTERN_PEOPLE)
        candidates.household_pattern.add(key);
    }

    const identityDetails = await tx.case.groupBy({
      by: [
        'nameNormalizedSnapshot',
        'districtSnapshot',
        'personId',
        'payoutKey',
        'helperId',
        'householdSize',
      ],
      where: {
        ...base,
        nameNormalizedSnapshot: { not: null },
        districtSnapshot: { not: null },
        createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60_000), lte: now },
      },
    });
    const identityGroups = new Map<
      string,
      Map<string, { payout: Set<string>; helper: Set<string>; household: Set<number> }>
    >();
    for (const item of identityDetails) {
      if (!item.nameNormalizedSnapshot || !item.districtSnapshot) continue;
      const key = `${normalizeGroupValue(item.nameNormalizedSnapshot)}\u0000${normalizeGroupValue(item.districtSnapshot)}`;
      const people = identityGroups.get(key) ?? new Map();
      const details = people.get(item.personId) ?? {
        payout: new Set<string>(),
        helper: new Set<string>(),
        household: new Set<number>(),
      };
      if (item.payoutKey) details.payout.add(item.payoutKey);
      if (item.helperId) details.helper.add(item.helperId);
      if (item.householdSize !== null) details.household.add(item.householdSize);
      people.set(item.personId, details);
      identityGroups.set(key, people);
    }
    for (const [key, people] of identityGroups) {
      const identities = [...people.values()];
      let corroborated = false;
      for (let i = 0; i < identities.length && !corroborated; i++) {
        for (let j = i + 1; j < identities.length && !corroborated; j++) {
          const left = identities[i]!;
          const right = identities[j]!;
          const details =
            Number(intersects(left.payout, right.payout)) +
            Number(intersects(left.helper, right.helper)) +
            Number(intersects(left.household, right.household));
          corroborated = details >= env.ANOMALY_IDENTITY_CORROBORATION_DETAILS;
        }
      }
      if (corroborated) candidates.identity_collision.add(key);
    }
    return candidates;
  }

  /**
   * Adds evidence and the hard flag to the open claims of each signal. Idempotent and additive:
   * it never changes a status or lane, and never touches a decided claim.
   */
  private async persistOpenFindings(tx: Tx, tenantId: string, signals: AnomalySignal[]) {
    const byCase = new Map<string, AnomalySignal[]>();
    for (const signal of signals) {
      for (const caseId of signal.evidenceCaseIds)
        byCase.set(caseId, [...(byCase.get(caseId) ?? []), signal]);
    }
    const open = { in: [...ANOMALY_OPEN_STATUSES] };
    const targets = await tx.case.findMany({
      where: { id: { in: [...byCase.keys()] }, tenantId, status: open },
      select: { id: true },
      orderBy: { id: 'asc' }, // one lock order for every writer, so two submissions cannot deadlock
    });
    let created = 0;
    let updated = 0;
    for (const { id: caseId } of targets) {
      for (const signal of byCase.get(caseId)!) {
        const signalKey = createHmac('sha256', env.PII_HASH_KEY)
          .update(`${signal.type}:${signal.groupKey}`)
          .digest('hex');
        const flag = this.anomalyHardFlag(signal.type);
        const marked = await tx.case.updateMany({
          where: { id: caseId, status: open, NOT: { flags: { has: flag } } },
          data: { flags: { push: flag } },
        });
        if (marked.count === 0) {
          const still = await tx.case.count({ where: { id: caseId, status: open } });
          if (still === 0) continue; // decided in the meantime: leave it alone
        }
        const data = {
          tenantId,
          signalType: signal.type,
          signalKey,
          evidenceCaseIds: signal.evidenceCaseIds,
          windowStart: signal.windowStart,
          windowEnd: signal.windowEnd,
          observedCount: signal.observedCount,
          threshold: signal.threshold,
        };
        const inserted = await tx.anomalyFinding.createMany({
          data: [{ ...data, caseId }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) {
          await tx.anomalyFinding.update({
            where: { caseId_signalKey: { caseId, signalKey } },
            data,
          });
          updated++;
          continue;
        }
        await tx.caseEvent.create({
          data: {
            caseId,
            type: 'anomaly.detected',
            actor: 'system',
            data: {
              signalType: signal.type,
              evidenceCaseIds: signal.evidenceCaseIds,
              windowStart: signal.windowStart.toISOString(),
              windowEnd: signal.windowEnd.toISOString(),
              observedCount: signal.observedCount,
              threshold: signal.threshold,
            },
          },
        });
        created++;
      }
    }
    return { created, updated };
  }

  private anomalyHardFlag(type: AnomalyType): HardFlag {
    return `anomaly:${type}`;
  }

  private payoutKey(iban: string | undefined, alias: string | undefined): string | null {
    if (alias)
      return createHmac('sha256', env.PII_HASH_KEY)
        .update(`alias:${alias.replace(/\D/g, '')}`)
        .digest('hex');
    if (iban)
      return createHmac('sha256', env.PII_HASH_KEY)
        .update(`iban:${iban.replace(/[^a-z0-9]/gi, '').toUpperCase()}`)
        .digest('hex');
    return null;
  }

  private async gather(c: Case, person: Person, requestId?: string): Promise<DecisionInputs> {
    const cnic = decryptField(person.cnicEnc, env.PII_ENC_KEY);
    const extraction = c.extraction as { isWidow?: boolean; householdSize?: number } | null;
    const facts: Facts = {
      claim: {
        fullName: person.fullName,
        district: person.district,
        householdSize: extraction?.householdSize ?? null,
        isWidow: extraction?.isWidow ?? null,
      },
      nadra: null,
      household: null,
    };
    const evidence = {
      nadraMatch: false,
      nameScore: 0,
      householdVerified: false,
      extractionConfidence: trustedExtractionConfidence(c.extraction),
      possibleDuplicate: await this.possibleDuplicatePerson(person),
    };
    const externalFlags: HardFlag[] = [];
    if (await this.hasOtherClaimThisMonth(c)) externalFlags.push('duplicate_claim_this_month');

    // Consent first: without it we do not even ask NADRA.
    let missing: string[];
    try {
      const allowed = await Promise.all(
        CONSENTS.map((p) => this.upstream.consentAllowed(person.id, p, requestId)),
      );
      missing = CONSENTS.filter((_, i) => !allowed[i]).map((p) => `consent:${p}`);
    } catch (err) {
      this.logger.warn({ err: String(err), caseId: c.id }, 'Consent check unavailable');
      return {
        facts,
        evidence,
        externalFlags: [...externalFlags, 'verification_unavailable'],
        missing: [],
      };
    }
    if (missing.length) return { facts, evidence, externalFlags, missing };

    let nadra: NadraVerifyResponse;
    let household: HouseholdRecord | null;
    try {
      [nadra, household] = await Promise.all([
        this.upstream.nadraVerify(cnic, person.fullName, requestId),
        this.upstream.household(cnic, requestId),
      ]);
    } catch (err) {
      this.logger.warn({ err: String(err), caseId: c.id }, 'Verification services unavailable');
      return {
        facts,
        evidence,
        externalFlags: [...externalFlags, 'verification_unavailable'],
        missing,
      };
    }

    const r = nadra.record;
    const nameScore = r ? nameSimilarity(person.fullName, r.fullName) : 0;
    facts.nadra = {
      match: nadra.match && !!r,
      nameScore,
      deceased: r?.deceased ?? false,
      maritalStatus: r?.maritalStatus ?? 'unknown',
      gender: r?.gender ?? 'unknown',
      district: r?.district ?? 'unknown',
    };
    if (household) {
      facts.household = {
        householdSize: household.householdSize,
        monthlyIncomePkr: household.monthlyIncomePkr,
        district: household.district,
        pmtScore: household.pmtScore,
      };
    } else {
      externalFlags.push('household_not_found');
    }
    Object.assign(evidence, {
      nadraMatch: facts.nadra.match,
      nameScore,
      householdVerified: !!household,
    });
    return { facts, evidence, externalFlags, missing };
  }

  private async hasOtherClaimThisMonth(c: Case): Promise<boolean> {
    const monthStart = new Date(
      Date.UTC(c.createdAt.getUTCFullYear(), c.createdAt.getUTCMonth(), 1),
    );
    const n = await this.prisma.case.count({
      where: {
        personId: c.personId,
        id: { not: c.id },
        type: c.type,
        createdAt: { gte: monthStart },
        status: { in: [...OPEN, 'PAID'] },
      },
    });
    return n > 0;
  }

  /** Similar name, different CNIC: evidence of a possible duplicate identity. Never merged automatically. */
  private async possibleDuplicatePerson(person: Person): Promise<boolean> {
    const others = await this.prisma.person.findMany({
      where: { tenantId: person.tenantId, id: { not: person.id } },
      select: { fullName: true, district: true },
      take: 1000,
    });
    return others.some(
      (o) =>
        (!o.district || !person.district || o.district === person.district) &&
        nameSimilarity(o.fullName, person.fullName) >= DUPLICATE_NAME_MIN,
    );
  }

  // ---------- officer actions (only humans can reject) ----------

  async approve(user: AuthUser, id: string, note: string | undefined, requestId?: string) {
    const c = await this.staffCase(user, id);
    if (c.createdBy === user.id)
      throw new ForbiddenException('You cannot approve a case you created');
    const rule = c.ruleVersionId
      ? await this.prisma.ruleVersion.findUniqueOrThrow({ where: { id: c.ruleVersionId } })
      : await this.rules.published(c.tenantId);
    const last = await this.lastDecision(c.id);
    const amount = c.amount ?? rule.amount;
    const ctx = { source: 'cases', principal: user, correlationId: requestId };

    await this.humanDecision(c, user, 'APPROVED', {
      eligible: true,
      confidence: last?.confidence ?? 0,
      threshold: last?.threshold ?? null,
      ur: `افسر نے آپ کی درخواست منظور کر دی۔${note ? ` ${note}` : ''}`,
      en: `Approved by an officer.${note ? ` Note: ${note}` : ''}`,
      extra: (tx) =>
        this.emit(
          tx,
          this.decidedEvent(
            c.id,
            c.personId,
            'HUMAN_REVIEW',
            last?.confidence ?? 0,
            { id: rule.id, amount },
            ctx,
          ),
        ),
      ctx,
    });
    return this.view(user, c.id);
  }

  async reject(user: AuthUser, id: string, reason: string, requestId?: string) {
    const c = await this.staffCase(user, id);
    const last = await this.lastDecision(c.id);
    await this.humanDecision(c, user, 'REJECTED', {
      eligible: false,
      confidence: last?.confidence ?? 0,
      threshold: last?.threshold ?? null,
      ur: `افسر نے یہ درخواست منظور نہیں کی۔ وجہ: ${reason}`,
      en: `Not approved by an officer. Reason: ${reason}`,
      ctx: { source: 'cases', principal: user, correlationId: requestId },
    });
    return this.view(user, c.id);
  }

  async requestInfo(user: AuthUser, id: string, message: string, requestId?: string) {
    const c = await this.staffCase(user, id);
    await this.transition(c, user, 'NEEDS_INFO', 'info_requested', { message }, requestId);
    return this.view(user, c.id);
  }

  /** "Assign to me" (or to a named officer): the queue shows who is already looking at a case. */
  async assign(user: AuthUser, id: string, officerId: string | undefined, requestId?: string) {
    const c = await this.staffCase(user, id);
    this.allow('assign', c);
    const to = officerId ?? user.id;
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.case.updateMany({
        where: { id: c.id, status: { in: REVIEWABLE } },
        data: { assignedTo: to },
      });
      if (moved.count === 0) throw new ConflictException('Case is no longer waiting for review');
      await tx.caseEvent.create({
        data: { caseId: c.id, type: 'assigned', actor: user.id, data: { to } },
      });
      await this.emit(tx, this.managed(c, c.status, 'assigned', undefined, user, requestId));
    });
    this.bus.kick();
    return this.view(user, c.id);
  }

  /**
   * Officer -> supervisor: the case stays in review but jumps the queue and carries the officer's reason.
   * The status does not change, so approval/rejection rules stay exactly as they were.
   */
  async escalate(user: AuthUser, id: string, reason: string, requestId?: string) {
    const c = await this.staffCase(user, id);
    this.allow('escalate', c);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.case.updateMany({
        where: { id: c.id, status: { in: REVIEWABLE }, escalatedAt: null },
        data: {
          escalatedAt: new Date(),
          escalationReason: reason,
          priority: boosted(c.priority, true),
        },
      });
      if (moved.count === 0)
        throw new ConflictException('Case was escalated or decided by someone else');
      await tx.caseEvent.create({
        data: { caseId: c.id, type: 'escalated', actor: user.id, data: { reason } },
      });
      await this.emit(tx, this.managed(c, c.status, 'escalated', reason, user, requestId));
    });
    this.bus.kick();
    return this.view(user, c.id);
  }

  /** File a finished case away. Only PAID or REJECTED cases can be closed; nothing open ever is. */
  async close(user: AuthUser, id: string, note: string | undefined, requestId?: string) {
    const c = await this.staffCase(user, id);
    this.allow('close', c);
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.case.updateMany({
        where: { id: c.id, status: c.status },
        data: { status: 'CLOSED' },
      });
      if (moved.count === 0) throw new ConflictException('Case changed while closing; reload it');
      await tx.caseEvent.create({
        data: {
          caseId: c.id,
          type: 'closed',
          actor: user.id,
          data: { note: note ?? null, from: c.status },
        },
      });
      await this.emit(tx, this.managed(c, 'CLOSED', 'closed', note, user, requestId));
    });
    this.bus.kick();
    return this.view(user, c.id);
  }

  private allow(move: OfficerMove, c: Case) {
    const why = refusal(move, c);
    if (why) throw new ConflictException(why);
  }

  /** Audit event for a case-management step (kept as a status event so the audit service needs no new subscription). */
  private managed(
    c: Case,
    to: CaseStatus,
    action: string,
    note: string | undefined,
    user: AuthUser,
    requestId?: string,
  ) {
    return buildEvent(
      'cases.case.status_changed',
      { caseId: c.id, from: c.status, to, action, ...(note ? { note } : {}) },
      { source: 'cases', principal: user, correlationId: requestId },
    );
  }

  private async humanDecision(
    c: Case,
    user: AuthUser,
    to: 'APPROVED' | 'REJECTED',
    d: {
      eligible: boolean;
      confidence: number;
      /** Threshold of the automated decision the officer is overruling or confirming */
      threshold: number | null;
      ur: string;
      en: string;
      ctx: { source: string; principal: AuthUser; correlationId?: string };
      extra?: (tx: Tx) => Promise<unknown>;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.case.updateMany({
        where: { id: c.id, status: { in: REVIEWABLE } },
        data: { status: to },
      });
      if (moved.count === 0) throw new ConflictException(`Case is ${c.status}`);
      const decision = await tx.decision.create({
        data: {
          caseId: c.id,
          ruleVersionId: c.ruleVersionId,
          lane: 'HUMAN_REVIEW',
          confidence: d.confidence,
          threshold: d.threshold,
          eligible: d.eligible,
          clausesHit: [],
          hardFlags: c.flags,
          explanationUr: d.ur,
          explanationEn: d.en,
          inputs: { humanDecision: to },
          decidedBy: user.id,
        },
      });
      await tx.caseEvent.create({
        data: {
          caseId: c.id,
          type: to === 'APPROVED' ? 'approved' : 'rejected',
          actor: user.id,
          data: { decisionId: decision.id },
        },
      });
      await this.emit(
        tx,
        buildEvent('cases.case.status_changed', { caseId: c.id, from: c.status, to }, d.ctx),
      );
      await d.extra?.(tx);
    });
    this.bus.kick();
  }

  private async transition(
    c: Case,
    user: AuthUser,
    to: CaseStatus,
    type: string,
    data: object,
    requestId?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.case.updateMany({
        where: { id: c.id, status: { in: REVIEWABLE } },
        data: { status: to },
      });
      if (moved.count === 0) throw new ConflictException(`Case is ${c.status}`);
      await tx.caseEvent.create({ data: { caseId: c.id, type, actor: user.id, data } });
      await this.emit(
        tx,
        buildEvent(
          'cases.case.status_changed',
          { caseId: c.id, from: c.status, to },
          { source: 'cases', principal: user, correlationId: requestId },
        ),
      );
    });
    this.bus.kick();
  }

  // ---------- reads ----------

  async list(user: AuthUser, status?: CaseStatus) {
    const where: Prisma.CaseWhereInput = { tenantId: user.tenantId, ...(status ? { status } : {}) };
    if (!isStaff(user)) where.personId = subjectPerson(user);
    const rows = await this.prisma.case.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((c) => this.summary(c, isStaff(user)));
  }

  /** Officer queue: no names or CNICs here, only what is needed to pick the next case. */
  async queue(user: AuthUser) {
    const rows = await this.prisma.case.findMany({
      where: { tenantId: user.tenantId, status: { in: REVIEWABLE } },
      include: {
        person: { select: { district: true } },
        anomalies: { orderBy: { createdAt: 'desc' } },
      },
      take: 500,
    });
    const now = new Date();
    return rows
      .map((c) => ({
        ...this.summary(c, true),
        district: c.districtSnapshot ?? c.person.district,
        anomalies: c.anomalies.map((finding) => this.anomalyView(finding)),
        priority: boosted(
          priority(
            {
              confidence: c.confidence,
              hardFlagCount: c.flags.length,
              amount: c.amount,
              createdAt: c.createdAt,
            },
            now,
          ),
          !!c.escalatedAt,
        ),
        waitingMinutes: Math.round((now.getTime() - c.createdAt.getTime()) / 60_000),
      }))
      .sort((a, b) => b.priority - a.priority);
  }

  async view(user: AuthUser, id: string) {
    const c = isStaff(user) ? await this.staffCase(user, id) : await this.ownCase(user, id);
    if (isStaff(user) && user.role !== 'auditor') await this.requireConsent(c.personId);
    const [person, events, decision, costs, anomalies] = await Promise.all([
      this.prisma.person.findUniqueOrThrow({ where: { id: c.personId } }),
      this.prisma.caseEvent.findMany({ where: { caseId: c.id }, orderBy: { at: 'asc' } }),
      this.lastDecision(c.id),
      this.rules.costs(c.tenantId),
      isStaff(user)
        ? this.prisma.anomalyFinding.findMany({
            where: { tenantId: user.tenantId, caseId: c.id },
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve([]),
    ]);
    const ruleId = decision?.ruleVersionId ?? c.ruleVersionId;
    const rule = ruleId
      ? await this.prisma.ruleVersion.findUnique({
          where: { id: ruleId },
          select: { version: true, clauses: true },
        })
      : null;
    const cnic = decryptField(person.cnicEnc, env.PII_ENC_KEY);
    return {
      ...this.summary(c, isStaff(user)),
      escalationReason: c.escalationReason,
      person: {
        id: person.id,
        fullName: person.fullName,
        cnicMasked: maskCnic(cnic),
        district: person.district,
      },
      payout: { ibanMasked: maskTail(c.payoutIban), aliasMasked: maskTail(c.payoutAlias) },
      /** Reached only through ownCase / staffCase above: the citizen herself, or staff of her program. */
      aiNotes: viewNotes(cnic, c.extraction, c.documentCheck),
      decision: decision && {
        ...this.decisionView(decision, isStaff(user)),
        ruleVersion: rule?.version ?? null,
        threshold: decision.threshold ?? autoApproveThreshold(costs),
        clauseTexts: clauseTexts(rule?.clauses),
      },
      ...(isStaff(user)
        ? { anomalies: anomalies.map((finding) => this.anomalyView(finding)) }
        : {}),
      timeline: events
        .filter((event) => event.type !== 'anomaly.detected' || isStaff(user))
        .map((e) => ({ type: e.type, actor: e.actor, data: e.data, at: e.at })),
    };
  }

  /** Live consent check on every staff read: withdrawal takes effect on the very next request. */
  private async requireConsent(personId: string) {
    const allowed = await this.upstream.consentAllowed(personId, 'identity_verification');
    if (!allowed) {
      throw new ForbiddenException({
        message: 'The citizen has withdrawn (or not given) consent: personal data is blocked',
        details: { code: 'CONSENT_WITHDRAWN' },
      });
    }
  }

  private summary(c: Case, revealAnomalyFlags = false) {
    return {
      id: c.id,
      type: c.type,
      status: c.status,
      lane: c.lane,
      confidence: c.confidence,
      amount: c.amount,
      flags: flagsVisibleTo(c.flags, revealAnomalyFlags),
      assignedTo: c.assignedTo,
      escalated: !!c.escalatedAt,
      escalatedAt: c.escalatedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private anomalyView(finding: {
    signalType: string;
    evidenceCaseIds: string[];
    windowStart: Date;
    windowEnd: Date;
    observedCount: number;
    threshold: number;
    createdAt: Date;
  }) {
    return {
      type: finding.signalType,
      evidenceCaseIds: finding.evidenceCaseIds,
      windowStart: finding.windowStart,
      windowEnd: finding.windowEnd,
      observedCount: finding.observedCount,
      threshold: finding.threshold,
      createdAt: finding.createdAt,
    };
  }

  private decisionView(d: Decision, revealAnomalyFlags: boolean) {
    return {
      id: d.id,
      lane: d.lane,
      confidence: d.confidence,
      eligible: d.eligible,
      clauses: d.clausesHit,
      hardFlags: flagsVisibleTo(d.hardFlags, revealAnomalyFlags),
      explanationUr: d.explanationUr,
      explanationEn: d.explanationEn,
      decidedBy: d.decidedBy === 'system' ? 'system' : 'officer',
      at: d.createdAt,
    };
  }

  private lastDecision(caseId: string) {
    return this.prisma.decision.findFirst({ where: { caseId }, orderBy: { createdAt: 'desc' } });
  }

  private async ownCase(user: AuthUser, id: string) {
    const c = await this.prisma.case.findFirst({
      where: { id, tenantId: user.tenantId, personId: subjectPerson(user) },
    });
    if (!c) throw new NotFoundException('Case not found');
    return c;
  }

  private async staffCase(user: AuthUser, id: string) {
    const c = await this.prisma.case.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!c) throw new NotFoundException('Case not found');
    return c;
  }

  // ---------- events ----------

  private decidedEvent(
    caseId: string,
    personId: string,
    lane: 'AUTO_APPROVE' | 'HUMAN_REVIEW',
    confidence: number,
    rule: Pick<ActiveRule, 'id' | 'amount'>,
    ctx: { source: string; principal: AuthUser; correlationId?: string },
  ) {
    return buildEvent(
      'cases.case.decided',
      { caseId, personId, lane, confidence, ruleVersionId: rule.id, amount: rule.amount },
      ctx,
    );
  }

  private emit(tx: Tx, event: EventEnvelope) {
    return tx.outboxEvent.create({ data: outboxRow(event) });
  }
}

function normalizeGroupValue(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function intersects<T>(left: ReadonlySet<T>, right: ReadonlySet<T>) {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

/** English clause texts by id, so staff read the condition and not its internal name. */
function clauseTexts(clauses: unknown): Record<string, string> {
  if (!Array.isArray(clauses)) return {};
  return Object.fromEntries(
    (clauses as { id?: unknown; textEn?: unknown }[])
      .filter((c) => typeof c.id === 'string' && typeof c.textEn === 'string')
      .map((c) => [c.id as string, c.textEn as string]),
  );
}

function maskTail(v: string | null): string | null {
  return v ? `${'*'.repeat(Math.max(0, v.length - 4))}${v.slice(-4)}` : null;
}
