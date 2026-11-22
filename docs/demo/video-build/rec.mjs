// node rec.mjs <scene> [<scene> ...]  → records raw/<scene>.webm + raw/<scene>.json (cue marks)
import { launch } from './lib.mjs';

const KIND = { claim: 'phone', scamask: 'phone', receipt: 'phone', helper: 'phone', officer: 'laptop', admin: 'laptop', auditor: 'laptop' };
let failed = 0;
for (const name of process.argv.slice(2)) {
  const scene = (await import(`./scenes/${name}.mjs`)).default;
  const s = await launch(KIND[name], name, { wav: 'audio/claim-ur.wav' });
  try {
    await scene(s);
    console.log(`[${name}] ok`);
  } catch (e) {
    failed++;
    console.error(`[${name}] FAILED:`, e.message.split('\n').slice(0, 4).join(' | '));
    await s.page.screenshot({ path: `shots/${name}-FAILED.png` }).catch(() => {});
  } finally {
    await s.done();
  }
}
process.exit(failed ? 1 : 0);
