/** Every backend service, its default port and the URL env var other services use to reach it. */
export const SERVICES = {
  gateway: { port: 4000, urlEnv: 'GATEWAY_URL' },
  identity: { port: 4001, urlEnv: 'IDENTITY_URL' },
  cases: { port: 4002, urlEnv: 'CASES_URL' },
  ai: { port: 4003, urlEnv: 'AI_URL' },
  payments: { port: 4004, urlEnv: 'PAYMENTS_URL' },
  audit: { port: 4005, urlEnv: 'AUDIT_URL' },
  'rails-mock': { port: 4006, urlEnv: 'RAILS_URL' },
  judge: { port: 4007, urlEnv: 'JUDGE_URL' },
  knowledge: { port: 4008, urlEnv: 'KNOWLEDGE_URL' },
} as const;

export type ServiceName = keyof typeof SERVICES;

export function serviceUrl(name: ServiceName, env: NodeJS.ProcessEnv = process.env): string {
  const s = SERVICES[name];
  const v = env[s.urlEnv];
  if (!v) return `http://127.0.0.1:${s.port}`;
  // Hosts wired by the platform (e.g. Render `fromService`) come without a scheme.
  return v.includes('://') ? v : `https://${v}`;
}

/** Public route prefixes the gateway forwards to each service. */
export const GATEWAY_ROUTES: Record<string, ServiceName> = {
  '/auth': 'identity',
  '/users': 'identity',
  '/tenants': 'identity',
  '/consents': 'identity',
  '/api-keys': 'identity',
  '/cases': 'cases',
  '/queue': 'cases',
  '/rules': 'cases',
  '/decisions': 'cases',
  '/cost-settings': 'cases',
  '/eval': 'cases',
  '/ai': 'ai',
  '/knowledge': 'knowledge',
  '/payments': 'payments',
  '/ledger': 'payments',
  '/reconciliation': 'payments',
  '/webhooks': 'payments',
  '/audit': 'audit',
  '/mock': 'rails-mock',
  '/judge': 'judge',
};
