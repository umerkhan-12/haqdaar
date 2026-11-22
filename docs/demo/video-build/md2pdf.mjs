// node md2pdf.mjs <in.md> <out.pdf> — small Markdown (headings, tables, lists, quotes) to a readable landscape PDF.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [src, out] = process.argv.slice(2);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/&lt;(https?:[^&]+)&gt;/g, '<a href="$1">$1</a>');
const lines = readFileSync(src, 'utf8').replace(/\r/g, '').split('\n');
let html = '';
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^\|/.test(l)) {
    const rows = [];
    while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
    i--;
    const cells = (r) => r.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
    const head = cells(rows[0]);
    html += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`;
    for (const r of rows.slice(2)) {
      html += `<tr>${cells(r)
        .map((c, k) => `<td class="${head[k] === 'Result' ? 'res' : ''}">${inline(c)}</td>`)
        .join('')}</tr>`;
    }
    html += '</tbody></table>';
  } else if (/^#+ /.test(l)) {
    const n = l.match(/^#+/)[0].length;
    html += `<h${n}>${inline(l.replace(/^#+ /, ''))}</h${n}>`;
  } else if (/^> /.test(l)) html += `<blockquote>${inline(l.slice(2))}</blockquote>`;
  else if (/^- /.test(l)) html += `<li>${inline(l.slice(2))}</li>`;
  else if (/^---/.test(l)) html += '<hr>';
  else if (l.trim()) html += `<p>${inline(l)}</p>`;
}
const page = `<html><meta charset="utf-8"><style>
body{font-family:'Segoe UI',sans-serif;font-size:11.5pt;color:#0f172a;line-height:1.4}
h1{font-size:21pt;color:#172554;margin:0 0 8px}h2{font-size:15pt;color:#1e40af;margin:20px 0 8px;break-after:avoid}
blockquote{margin:8px 0;padding:8px 12px;background:#fef3c7;border-left:5px solid #f59e0b;border-radius:4px}
table{width:100%;border-collapse:collapse;margin:6px 0 14px;font-size:10.5pt}
th{background:#1e40af;color:#fff;text-align:left;padding:6px 8px}
td{border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top}tr{break-inside:avoid}
tbody tr:nth-child(even){background:#f1f5f9}td.res{min-width:95px;background:#fff}
td:first-child{font-weight:700;color:#1e40af;white-space:nowrap}
code{background:#e2e8f0;border-radius:3px;padding:0 4px;font-size:10pt}li{margin:4px 0 4px 18px}a{color:#1e40af}
</style><body>${html}</body></html>`;
const b = await chromium.launch();
const pg = await b.newPage();
await pg.setContent(page);
await pg.pdf({ path: resolve(out), format: 'A4', landscape: true, printBackground: true, margin: { top: '12mm', bottom: '12mm', left: '10mm', right: '10mm' } });
await b.close();
console.log('wrote', out);
