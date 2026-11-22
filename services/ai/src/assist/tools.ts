import { serviceUrl, type ServiceName } from '@haqdaar/shared';
import { z } from 'zod';
import type { AssistTools, MessageVerdict } from './assist';

const Claims = z.array(
  z.object({
    id: z.string(),
    status: z.string(),
    amount: z.number().nullable(),
    updatedAt: z.string(),
  }),
);
const Payments = z.array(
  z.object({
    caseId: z.string(),
    amount: z.number(),
    state: z.string(),
    settledAt: z.string().nullable(),
  }),
);
const PolicyAnswer = z.object({
  answer: z.string(),
  citations: z.array(z.object({ docId: z.string(), heading: z.string(), quote: z.string() })),
  refused: z.boolean(),
});

/**
 * The agent's tools, bound to one caller. Every HTTP call carries HER OWN access token (not this
 * service's internal token), so cases / payments / knowledge apply their normal access rules:
 * she gets her own claims and payments and nothing else, whatever the model asked for.
 * All four are reads; there is deliberately no tool that writes.
 */
export function callerTools(
  authorization: string,
  checkMessage: (text: string) => Promise<MessageVerdict>,
  requestId?: string,
): AssistTools {
  async function call<S extends z.ZodTypeAny>(
    schema: S,
    target: ServiceName,
    path: string,
    body?: unknown,
    timeoutMs = 8000,
  ): Promise<z.infer<S>> {
    const res = await fetch(`${serviceUrl(target)}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization,
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`${target} answered ${res.status}`);
    return schema.parse(await res.json());
  }

  return {
    searchPolicy: (question, lang) =>
      call(PolicyAnswer, 'knowledge', '/knowledge/ask', { question, lang }, 25_000),
    getMyClaims: () => call(Claims, 'cases', '/cases'),
    getMyPayments: (caseId) =>
      call(
        Payments,
        'payments',
        `/payments/mine${caseId ? `?caseId=${encodeURIComponent(caseId)}` : ''}`,
      ),
    checkMessage,
  };
}
