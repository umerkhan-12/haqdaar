// Device artwork drawn over the recordings: a MacBook (browser full screen) and an iPhone, on a desktop wallpaper.
// The two screens are transparent holes; everything else is opaque.
export const L = { x: 60, y: 108, w: 1280, h: 800 };
export const P = { x: 1500, y: 118, w: 360, h: 779 };
export const CAP = { titleY: 968, textY: 1004 };

const bar = 52; // browser toolbar inside the MacBook screen
const sb = 40; // iPhone status bar
const px = P.x, py = P.y, pw = P.w, ph = P.h, r = 44;
const phoneHole = `M${px},${py} H${px + pw} V${py + ph - r} a${r},${r} 0 0 1 -${r},${r} H${px + r} a${r},${r} 0 0 1 -${r},-${r} Z`;
const phoneStatus = `M${px},${py + 1} V${py - sb + r} a${r},${r} 0 0 1 ${r},-${r} H${px + pw - r} a${r},${r} 0 0 1 ${r},${r} V${py + 1} Z`;

export const overlayHtml = (css) => `<html><style>${css}body{width:1920px;height:1080px;background:transparent}
.t{position:absolute;white-space:nowrap}
</style><body>
<svg width="1920" height="1080" style="position:absolute;left:0;top:0" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="wall" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071a3a"/><stop offset=".55" stop-color="#1a1247"/><stop offset="1" stop-color="#3a1433"/></linearGradient>
<radialGradient id="glow1" cx=".85" cy="1" r=".6"><stop offset="0" stop-color="#f97316" stop-opacity=".55"/><stop offset="1" stop-color="#f97316" stop-opacity="0"/></radialGradient>
<radialGradient id="glow2" cx=".05" cy=".9" r=".55"><stop offset="0" stop-color="#0ea5e9" stop-opacity=".45"/><stop offset="1" stop-color="#0ea5e9" stop-opacity="0"/></radialGradient>
<linearGradient id="alu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3e5e8"/><stop offset=".5" stop-color="#b9bcc2"/><stop offset="1" stop-color="#7d8188"/></linearGradient>
<linearGradient id="ti" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c9ccd1"/><stop offset=".5" stop-color="#8d9096"/><stop offset="1" stop-color="#c2c5ca"/></linearGradient>
<mask id="m"><rect width="1920" height="1080" fill="#fff"/>
<rect x="${L.x}" y="${L.y}" width="${L.w}" height="${L.h}" fill="#000"/>
<path d="${phoneHole}" fill="#000"/></mask>
</defs>
<g mask="url(#m)">
<rect width="1920" height="1080" fill="url(#wall)"/>
<rect width="1920" height="1080" fill="url(#glow1)"/>
<rect width="1920" height="1080" fill="url(#glow2)"/>

<!-- MacBook: lid, camera notch, browser toolbar, aluminium base -->
<ellipse cx="700" cy="958" rx="720" ry="16" fill="#000" opacity=".35"/>
<rect x="${L.x - 18}" y="${L.y - bar - 18}" width="${L.w + 36}" height="${L.h + bar + 36}" rx="24" fill="#0a0a0c" stroke="#5c5f66" stroke-width="2"/>
<rect x="${L.x + L.w / 2 - 62}" y="${L.y - bar - 17}" width="124" height="15" rx="7" fill="#000"/>
<circle cx="${L.x + L.w / 2}" cy="${L.y - bar - 9}" r="3.2" fill="#1b2a4a"/>
<path d="M${L.x},${L.y} V${L.y - bar + 10} a10,10 0 0 1 10,-10 H${L.x + L.w - 10} a10,10 0 0 1 10,10 V${L.y} Z" fill="#23263a"/>
<circle cx="${L.x + 26}" cy="${L.y - bar / 2}" r="7" fill="#ff5f57"/><circle cx="${L.x + 50}" cy="${L.y - bar / 2}" r="7" fill="#febc2e"/><circle cx="${L.x + 74}" cy="${L.y - bar / 2}" r="7" fill="#28c840"/>
<rect x="${L.x + L.w / 2 - 290}" y="${L.y - bar + 11}" width="580" height="30" rx="9" fill="#34384f"/>
<path d="M${L.x - 64},${L.y + L.h + 18} H${L.x + L.w + 64} v10 a16,16 0 0 1 -16,16 H${L.x - 48} a16,16 0 0 1 -16,-16 Z" fill="url(#alu)"/>
<rect x="${L.x + L.w / 2 - 100}" y="${L.y + L.h + 18}" width="200" height="9" rx="4.5" fill="#70747b"/>

<!-- iPhone: titanium body, buttons, status bar, Dynamic Island -->
<rect x="${px - 20}" y="${py + 110}" width="5" height="34" rx="2" fill="#8d9096"/><rect x="${px - 20}" y="${py + 170}" width="5" height="62" rx="2" fill="#8d9096"/><rect x="${px - 20}" y="${py + 246}" width="5" height="62" rx="2" fill="#8d9096"/>
<rect x="${px + pw + 15}" y="${py + 200}" width="5" height="96" rx="2" fill="#8d9096"/>
<rect x="${px - 16}" y="${py - sb - 16}" width="${pw + 32}" height="${ph + sb + 32}" rx="60" fill="url(#ti)"/>
<rect x="${px - 12}" y="${py - sb - 12}" width="${pw + 24}" height="${ph + sb + 24}" rx="56" fill="#060607"/>
<path d="${phoneStatus}" fill="#fef3c7"/>
<rect x="${px + pw / 2 - 54}" y="${py - sb + 9}" width="108" height="27" rx="13.5" fill="#000"/>
<rect x="${px + pw - 58}" y="${py - sb + 16}" width="26" height="13" rx="4" fill="none" stroke="#1f2937" stroke-width="1.4"/><rect x="${px + pw - 56}" y="${py - sb + 18}" width="19" height="9" rx="2" fill="#1f2937"/><rect x="${px + pw - 31}" y="${py - sb + 20}" width="2.4" height="5" rx="1" fill="#1f2937"/>
<path d="M${px + pw - 92},${py - sb + 29} v-4 h3 v4 z m5,0 v-7 h3 v7 z m5,0 v-10 h3 v10 z m5,0 v-13 h3 v13 z" fill="#1f2937"/>

<!-- caption pill -->
<rect x="210" y="958" width="1500" height="104" rx="18" fill="#0b0d17" opacity=".86"/>
<rect x="210" y="958" width="7" height="104" rx="3" fill="#38bdf8"/>
</g>
</svg>
<div class="t" style="left:${L.x - 16}px;top:6px;font-size:22px;font-weight:700;letter-spacing:.4px">Haqdaar<span style="color:#bae6fd;font-weight:400;font-size:17px;margin-left:12px">live product recording · MacBook (staff) and iPhone (citizen)</span></div>
<div class="t" style="right:44px;top:22px;font-size:17px;color:#fde68a;border:1px solid #fde68a88;border-radius:20px;padding:3px 14px">PROTOTYPE · synthetic data</div>
<div class="t" style="left:${L.x + L.w / 2 - 290}px;top:${L.y - bar + 11}px;width:580px;height:30px;line-height:30px;text-align:center;font-size:15px;color:#d7dae6">🔒 172-198-74-124.sslip.io</div>
<div class="t" style="left:${px + 30}px;top:${py - sb + 12}px;font-size:16px;font-weight:700;color:#1f2937">9:41</div>
</body></html>`;
