// Renders the static artwork with the browser: device-frame overlay, title/end cards, explainer panels.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

import { L, P, overlayHtml } from './overlay2.mjs';
export { L, P };

const css = `*{box-sizing:border-box;margin:0}body{font-family:'Segoe UI',sans-serif;color:#fff}`;

const overlay = `<html><style>${css}
body{width:1920px;height:1080px;background:transparent}
.hole{position:absolute;border-radius:var(--r);box-shadow:0 0 0 var(--b) #0b0d17,0 0 0 calc(var(--b) + 2px) #3a3f58,0 0 0 4000px #14162b}
.base{position:absolute;left:${L.x - 70}px;top:${L.y + L.h + 16}px;width:${L.w + 140}px;height:22px;background:linear-gradient(#4a4f6a,#2a2d42);border-radius:4px 4px 18px 18px}
.notch{position:absolute;left:${P.x + P.w / 2 - 45}px;top:${P.y - 9}px;width:90px;height:6px;border-radius:3px;background:#2c3047}
.brand{position:absolute;left:${L.x - 14}px;top:22px;font-size:30px;font-weight:700;letter-spacing:.5px}
.brand span{color:#a5b4fc;font-weight:400;font-size:22px;margin-left:14px}
.tag{position:absolute;right:56px;top:28px;font-size:20px;color:#fde68a;border:1px solid #fde68a88;border-radius:20px;padding:4px 16px}
</style><body>
<div class="hole" style="--r:10px;--b:14px;left:${L.x}px;top:${L.y}px;width:${L.w}px;height:${L.h}px"></div>
</body></html>`;
// two holes cannot share one giant shadow, so the overlay is drawn with an SVG mask instead
const overlaySvg = `<html><style>${css}body{width:1920px;height:1080px;background:transparent}
.brand{position:absolute;left:${L.x - 14}px;top:22px;font-size:30px;font-weight:700;letter-spacing:.5px}
.brand span{color:#a5b4fc;font-weight:400;font-size:22px;margin-left:14px}
.tag{position:absolute;right:56px;top:28px;font-size:20px;color:#fde68a;border:1px solid #fde68a88;border-radius:20px;padding:4px 16px}
</style><body>
<svg width="1920" height="1080" style="position:absolute;left:0;top:0">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171a33"/><stop offset="1" stop-color="#0d0f1f"/></linearGradient>
<mask id="m"><rect width="1920" height="1080" fill="#fff"/>
<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" rx="8" fill="#000"/>
<rect x="${P.x}" y="${P.y}" width="${P.w}" height="${P.h}" rx="30" fill="#000"/></mask></defs>
<rect width="1920" height="1080" fill="url(#g)" mask="url(#m)"/>
<rect x="${L.x - 14}" y="${L.y - 14}" width="${L.w + 28}" height="${L.h + 28}" rx="18" fill="#07080f" stroke="#454a66" stroke-width="2" mask="url(#m)"/>
<rect x="${L.x - 90}" y="${L.y + L.h + 14}" width="${L.w + 180}" height="22" rx="10" fill="#3a3f58" mask="url(#m)"/>
<rect x="${P.x - 12}" y="${P.y - 12}" width="${P.w + 24}" height="${P.h + 24}" rx="42" fill="#07080f" stroke="#454a66" stroke-width="2" mask="url(#m)"/>
</svg>
<div class="brand">Haqdaar<span>live product recording · laptop (staff) and phone (citizen)</span></div>
<div class="tag">PROTOTYPE · synthetic data</div>
</body></html>`;

const card = (inner) => `<html><style>${css}
body{width:1920px;height:1080px;background:radial-gradient(circle at 30% 20%,#2a2470,#0d0f1f 70%);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:34px}
h1{font-size:130px;font-weight:800;letter-spacing:1px}h1 .ur{font-family:'Noto Nastaliq Urdu','Jameel Noori Nastaleeq','Segoe UI',serif;color:#c4b5fd;margin-left:30px}
h2{font-size:54px;font-weight:400;color:#e0e7ff;max-width:1500px;line-height:1.3}
p{font-size:34px;color:#fde68a;border:2px solid #fde68a88;border-radius:16px;padding:14px 34px;max-width:1600px}
.s{font-size:38px;color:#c7d2fe;max-width:1600px;line-height:1.45}.link{font-size:50px;color:#fff;font-weight:700;background:#4f46e5;border-radius:18px;padding:14px 40px}
b{color:#fff}</style><body>${inner}</body></html>`;

const title = card(`<h1>Haqdaar <span class="ur">حقدار</span></h1>
<h2>Claim your relief payment by voice, in Urdu, even offline</h2>
<p>PROTOTYPE — not an official government service. All data is synthetic.</p>`);
const end = card(`<h1 style="font-size:100px">Haqdaar <span class="ur">حقدار</span></h1>
<div class="s"><b>Real:</b> Urdu speech in and out, the language model, card checks, rule engine, consent, hash-chained audit log, payment logic<br>
<b>Simulated:</b> NADRA identity, Raast payments, SMS, every person and number</div>
<div class="link">https://172-198-74-124.sslip.io</div>
<p>Team Haqdaar · PROTOTYPE — not an official government service</p>`);

const panel = (p) => `<html><style>${css}
body{width:1280px;height:800px;background:linear-gradient(135deg,#1e1b4b,#111327);padding:40px 64px;display:flex;flex-direction:column;gap:18px}
.k{font-size:26px;color:#a5b4fc;letter-spacing:3px;text-transform:uppercase}
h1{font-size:54px;line-height:1.15}
ul{list-style:none;display:flex;flex-direction:column;gap:20px;margin-top:10px}
li{font-size:33px;line-height:1.25;padding:13px 24px;background:#ffffff12;border-left:8px solid #818cf8;border-radius:10px}
li b{color:#fde68a}
.f{margin-top:auto;font-size:26px;color:#c7d2fe}</style><body>
<div class="k">${p.kicker}</div><h1>${p.title}</h1><ul>${p.points.map((x) => `<li>${x}</li>`).join('')}</ul><div class="f">${p.foot || ''}</div></body></html>`;

if (process.argv[1] && process.argv[1].endsWith('cards.mjs')) {
  mkdirSync('art', { recursive: true });
  const panels = JSON.parse(readFileSync('panels.json', 'utf8'));
  const b = await chromium.launch();
  const shot = async (html, w, h, file, transparent = false) => {
    const pg = await b.newPage({ viewport: { width: w, height: h } });
    await pg.setContent(html);
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: file, omitBackground: transparent });
    await pg.close();
    console.log(file);
  };
  await shot(overlayHtml(css), 1920, 1080, 'art/overlay.png', true);
  await shot(title, 1920, 1080, 'art/title.png');
  await shot(end, 1920, 1080, 'art/end.png');
  for (const [id, p] of Object.entries(panels)) await shot(panel(p), 1280, 800, `art/panel-${id}.png`);
  await b.close();
}
