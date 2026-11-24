import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  buildEvent,
  EventBus,
  requirePlatformAdmin,
  sealMessage,
  ServiceClient,
  type Principal,
} from '@haqdaar/nest-kit';
import type { ServiceName } from '@haqdaar/shared';
import { env } from './env';
import { GatewayApi } from './gateway-api';
import { CheckFailed, Run, type Step } from './run';
import { CHALLENGE_SCENARIOS } from './scenarios/challenges';
import { PAYMENT_SCENARIOS } from './scenarios/payments';
import type { Scenario } from './scenarios/types';

export interface ScenarioResult {
  id: string;
  challenge: string;
  title: string;
  proves: string;
  ok: boolean;
  summary: string;
  durationMs: number;
  steps: Step[];
}

const SCENARIOS: Scenario[] = [...CHALLENGE_SCENARIOS, ...PAYMENT_SCENARIOS];
const RESETTABLE: ServiceName[] = ['identity', 'cases', 'payments', 'rails-mock'];

@Injectable()
export class JudgeService {
  private readonly logger = new Logger(JudgeService.name);
  private readonly api = new GatewayApi(env.DEMO_PASSWORD);
  /** One scenario at a time: injected faults must never leak into another run. */
  private busy: string | null = null;

  constructor(
    private readonly client: ServiceClient,
    private readonly bus: EventBus,
  ) {}

  list() {
    return SCENARIOS.map(({ id, challenge, title, proves }) => ({ id, challenge, title, proves }));
  }

  async run(id: string, by: Principal): Promise<ScenarioResult> {
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) throw new NotFoundException(`Unknown scenario: ${id}`);
    if (this.busy) throw new ConflictException(`"${this.busy}" is still running`);
    this.busy = id;

    const run = new Run();
    const started = Date.now();
    let ok = true;
    let summary: string;
    try {
      summary = await scenario.run({
        api: this.api,
        run,
        seal: (body) => sealMessage(body, env.SEAL_SECRET, new Date(Date.now() + 30 * 86_400_000)),
      });
    } catch (e) {
      ok = false;
      summary =
        e instanceof CheckFailed
          ? `Check failed — ${e.message}`
          : `Could not finish — ${(e as Error).message}`;
      if (!(e instanceof CheckFailed)) this.logger.warn({ err: e, scenario: id }, 'Scenario error');
    } finally {
      this.busy = null;
    }

    const durationMs = Date.now() - started;
    await this.bus
      .publish(
        buildEvent(
          'judge.scenario.ran',
          { scenarioId: id, ok, durationMs },
          { source: 'judge', principal: by },
        ),
      )
      .catch((err) => this.logger.warn({ err }, 'Could not publish judge event'));

    const { challenge, title, proves } = scenario;
    return { id, challenge, title, proves, ok, summary, durationMs, steps: run.steps };
  }

  /** Fresh demo: each service clears its own demo state. The audit log is never touched. */
  async reset(by: Principal) {
    await requirePlatformAdmin(this.client, by, 'Resetting the demo');
    if (this.busy) throw new ConflictException(`"${this.busy}" is still running`);
    this.busy = 'reset';
    try {
      return await this.resetAll(by);
    } finally {
      this.busy = null;
    }
  }

  private async resetAll(by: Principal) {
    const results = await Promise.all(
      RESETTABLE.map(async (service) => {
        try {
          const cleared = await this.client.call(service, '/internal/demo/reset', {
            method: 'POST',
            timeoutMs: 10_000,
          });
          return { service, ok: true, cleared };
        } catch (e) {
          return { service, ok: false, error: (e as Error).message };
        }
      }),
    );
    this.api.forget();
    await this.bus
      .publish(
        buildEvent(
          'judge.demo.reset',
          { services: RESETTABLE },
          { source: 'judge', principal: by },
        ),
      )
      .catch(() => undefined);
    return { ok: results.every((r) => r.ok), services: results };
  }
}
