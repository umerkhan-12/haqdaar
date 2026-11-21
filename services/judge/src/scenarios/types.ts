import type { GatewayApi } from '../gateway-api';
import type { Run } from '../run';

export interface ScenarioContext {
  api: GatewayApi;
  run: Run;
  /** Sign a genuine program message with the Haqdaar Seal (server-side secret). */
  seal: (body: string) => string;
}

export interface Scenario {
  id: string;
  /** Hackathon challenge number ("01"–"08"), or "PAY" for the fintech payout checks. */
  challenge: string;
  title: string;
  /** One sentence the presenter can read out: what this button proves. */
  proves: string;
  /** Returns the one-line result shown on the button after it runs. */
  run(ctx: ScenarioContext): Promise<string>;
}
