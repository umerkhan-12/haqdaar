import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
  async resubmit(user: AuthUser, id: string, requestId?: string) {
    const c = await this.ownCase(user, id);
    if (c.status !== 'NEEDS_INFO') throw new ConflictException(`Case is ${c.status}`);
    await this.process(c.id, user, requestId);
    return this.view(user, c.id);
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
    return rows.map((c) => this.summary(c));
  }

  /** Officer queue: no names or CNICs here, only what is needed to pick the next case. */
  async queue(user: AuthUser) {
    const rows = await this.prisma.case.findMany({
      where: { tenantId: user.tenantId, status: { in: REVIEWABLE } },
      include: { person: { select: { district: true } } },
      take: 500,
    });
    const now = new Date();
    return rows
      .map((c) => ({
        ...this.summary(c),
        district: c.person.district,
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
    const [person, events, decision, costs] = await Promise.all([
      this.prisma.person.findUniqueOrThrow({ where: { id: c.personId } }),
      this.prisma.caseEvent.findMany({ where: { caseId: c.id }, orderBy: { at: 'asc' } }),
      this.lastDecision(c.id),
      this.rules.costs(c.tenantId),
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
      ...this.summary(c),
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
        ...this.decisionView(decision),
        ruleVersion: rule?.version ?? null,
        threshold: decision.threshold ?? autoApproveThreshold(costs),
        clauseTexts: clauseTexts(rule?.clauses),
      },
      timeline: events.map((e) => ({ type: e.type, actor: e.actor, data: e.data, at: e.at })),
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

  private summary(c: Case) {
    return {
      id: c.id,
      type: c.type,
      status: c.status,
      lane: c.lane,
      confidence: c.confidence,
      amount: c.amount,
      flags: c.flags,
      assignedTo: c.assignedTo,
      escalated: !!c.escalatedAt,
      escalatedAt: c.escalatedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private decisionView(d: Decision) {
    return {
      id: d.id,
      lane: d.lane,
      confidence: d.confidence,
      eligible: d.eligible,
      clauses: d.clausesHit,
      hardFlags: d.hardFlags,
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
