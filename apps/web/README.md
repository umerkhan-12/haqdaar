# @haqdaar/web

The Haqdaar PWA: voice-first Urdu citizen app, Helper Mode, officer, admin, auditor and Judge Mode. Installable on phones, works offline. Design contract: [DESIGN.md](DESIGN.md).

```bash
pnpm --filter @haqdaar/web dev      # http://localhost:3000 (backend gateway on :4000)
pnpm --filter @haqdaar/web build    # production build (service worker active only in production)
```

The app calls the API same-origin at `/api`; `next.config.ts` rewrites `/api/*` to the gateway (`GATEWAY_URL`, default `http://127.0.0.1:4000`). No CORS, and phones on the Wi-Fi work.

**Open it on a phone (same Wi-Fi):**

```bash
pnpm --filter @haqdaar/web dev -- -H 0.0.0.0     # or: next dev -p 3000 -H 0.0.0.0
```

Then on the phone open `http://<laptop LAN IP>:3000` (e.g. `http://192.168.0.103:3000`; find it with `ipconfig`). Allow port 3000 through the Windows firewall if the phone cannot connect. Note: on a plain `http://` LAN address the browser blocks the **microphone** and the **service worker** (both need `https` or `localhost`), so voice falls back to typing and offline/install is unavailable. The CNIC photo still works (it uses the phone's camera through a file input). For the full PWA on a phone — voice, offline, "Add to Home screen" — use HTTPS: an HTTPS tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) or the deployed Vercel URL.

**CNIC photo:** sent as taken, because the forgery checks (ELA, EXIF) need the original bytes; only photos over 5 MB are downscaled. The step can ask for a retake or hand the card to an officer, but never blocks the claim.

## Structure

```
app/            thin route files (page.tsx) + layout, error boundary, offline page
features/<area> screens per persona: citizen, helper, officer, admin, auditor, judge, phone
components/     design-system components (ui.tsx), shell, icons
lib/            api client (all endpoints), session, i18n + speech, outbox (IndexedDB), hooks
public/         manifest, service worker, icons
```

## Offline

- `public/sw.js` caches the app shell; pages are network-first with cache fallback, then `/offline`.
- A claim sent with no network goes to the IndexedDB outbox (`lib/outbox.ts`) with its idempotency key and consents; it is flushed on `online` and on every app start. Resending is safe: the same key always means the same case.

## Bundle sizes

Measured on the production build (gzipped first-load JS, all `<script>` tags of the page):

| Route | JS gzip | HTML gzip |
|---|---|---|
| `/login` | 191.3 KB | 3.3 KB |
| `/citizen` | 193.7 KB | 2.7 KB |
| `/citizen/claim` | 195.8 KB | 2.7 KB |
| `/citizen/status` | 194.6 KB | 2.7 KB |
| `/officer` | 195.3 KB | 2.7 KB |
| `/judge` | 194.8 KB | 2.7 KB |
| `/offline` (almost no app code) | 185.5 KB | 2.8 KB |

≈ 170 KB of that is React DOM + the Next.js runtime; Haqdaar code is ≈ 15 KB shared + ≈ 11 KB on the claim route. After the first visit the service worker serves all JS from cache (see DESIGN.md §5).
