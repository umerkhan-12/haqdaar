import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadRootEnv } from '@haqdaar/nest-kit';
import { serviceUrl } from '@haqdaar/shared';

loadRootEnv();

type Golden = { id: string; question: string; expectedDocIds: string[]; expectedRefused: boolean };
type Answer = { answer: string; citations: { docId: string; heading: string; quote: string }[]; refused: boolean };

async function main() {
  const token = process.env.KNOWLEDGE_EVAL_TOKEN;
  if (!token) throw new Error('Set KNOWLEDGE_EVAL_TOKEN to an authorized citizen, helper or officer access token');
  const file = resolve(process.cwd(), 'eval/golden.jsonl');
  const cases = (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Golden);
  const outcomes: { expectedRefused: boolean; refused: boolean; expectedDocIds: string[]; citedDocIds: string[] }[] = [];
  for (const item of cases) {
    const response = await fetch(`${serviceUrl('gateway')}/knowledge/ask`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ question: item.question }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Golden ${item.id} failed with HTTP ${response.status}`);
    const answer = await response.json() as Answer;
    outcomes.push({
      expectedRefused: item.expectedRefused,
      refused: answer.refused,
      expectedDocIds: item.expectedDocIds,
      citedDocIds: answer.citations.map((citation) => citation.docId),
    });
  }
  const refusalCorrect = outcomes.filter((o) => o.expectedRefused === o.refused).length;
  const refusalCases = outcomes.filter((o) => o.expectedRefused).length;
  const citationCorrect = outcomes.filter((o) => !o.expectedRefused && o.citedDocIds.some((id) => o.expectedDocIds.includes(id))).length;
  const answerableCases = outcomes.filter((o) => !o.expectedRefused).length;
  const invalidRefusals = outcomes.filter((o) => !o.expectedRefused && o.refused).length;
  console.log(JSON.stringify({
    cases: outcomes.length,
    citationDocumentAccuracy: ratio(citationCorrect, answerableCases),
    refusalClassificationAccuracy: ratio(refusalCorrect, outcomes.length),
    refusalRecall: ratio(outcomes.filter((o) => o.expectedRefused && o.refused).length, refusalCases),
    falseRefusalRate: ratio(invalidRefusals, answerableCases),
  }, null, 2));
}

function ratio(n: number, d: number) { return d ? Number((n / d).toFixed(4)) : null; }

main().catch((error) => { console.error('Knowledge golden evaluation failed:', error); process.exitCode = 1; });
