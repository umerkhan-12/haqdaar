// node cardsheet.mjs → ../SPECIMEN_CARDS.pdf : the synthetic specimen cards on one printable page
import { chromium } from 'playwright';
import { readdirSync, readFileSync } from 'node:fs';
const dir = '../cards';
const imgs = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => `<figure><img src="data:image/png;base64,${readFileSync(`${dir}/${f}`).toString('base64')}"><figcaption>${f.replace('specimen-', '').replace('.png', '').replace(/-/g, ' ')}</figcaption></figure>`);
const html = `<html><style>body{font-family:'Segoe UI',sans-serif;margin:0}h1{font-size:15pt;margin:0 0 2mm}p{font-size:10pt;margin:0 0 5mm;color:#7c2d12}
.g{display:grid;grid-template-columns:1fr 1fr;gap:7mm}img{width:86mm;border:1px solid #94a3b8;border-radius:3mm}figure{margin:0;break-inside:avoid}figcaption{font-size:9pt;color:#475569;text-transform:capitalize}</style>
<h1>Haqdaar specimen cards (synthetic people, for testing the card scan)</h1><p>Not real identity cards. Never scan a real CNIC in the demo: real personal data disqualifies the team.</p><div class="g">${imgs.join('')}</div></html>`;
const b = await chromium.launch(); const pg = await b.newPage(); await pg.setContent(html);
await pg.pdf({ path: '../SPECIMEN_CARDS.pdf', format: 'A4', printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
await b.close(); console.log('ok');
