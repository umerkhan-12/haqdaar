# Deploying Haqdaar (free tiers)

| Part                                                                                 | Where                                              | Cost |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | ---- |
| 8 NestJS services (gateway, identity, cases, ai, payments, audit, rails-mock, judge) | Render free web services, Docker, region Singapore | Free |
| PostgreSQL (one schema per service + `pgboss`)                                       | Supabase free project, region Singapore            | Free |
| Web app (`apps/web`)                                                                 | Vercel Hobby                                       | Free |
| Keep-alive pings                                                                     | UptimeRobot free                                   | Free |

All images come from one `Dockerfile`: `docker build --build-arg SERVICE=<name> .`

---

## 1. Know the free-tier limits first

**Render free web services** ([Deploy for Free](https://render.com/docs/free), [Private Network](https://render.com/docs/private-network)):

- **750 free instance hours per workspace per calendar month, shared by all free services.** When they run out, free services are suspended until the next month.
- A free service **spins down after 15 minutes without inbound traffic** and takes about a minute to spin up again.
- Free web services **can send but cannot receive private-network traffic.** So our services call each other over their **public** `https://haqdaar-<name>.onrender.com` URLs. That is safe by design: internal calls carry a 60-second internal token scoped to the target service, and every service verifies user JWTs itself.

**Budget maths:** 8 services always awake = 8 × 24 = 192 hours/day → 750 hours last about **3.9 days**. So:

- deploy on **Sat 21 Nov** (not earlier), keep everything awake through judging on **Mon 23 Nov** (≈ 2.5 days ≈ 480 hours), and
- if you need to save hours, let `rails-mock`, `audit` and `judge` sleep until rehearsals (they wake on the first request).

**Supabase connections** ([Connect to your database](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supavisor FAQ](https://supabase.com/docs/guides/troubleshooting/supavisor-faq-YyP5tI)):

- **Port 5432 on the pooler host = session mode**; **port 6543 = transaction mode**.
- Transaction mode does **not** support prepared statements, and **pg-boss needs a session** (it holds connections and uses advisory locks). → **Use the session pooler (port 5432) for everything.** Never use 6543 here.
- The direct connection (`db.<ref>.supabase.co:5432`) is IPv6-only on the free plan; the **session pooler** (`aws-0-<region>.pooler.supabase.com:5432`) works over IPv4 and from Render.

---

## 2. Supabase (≈ 10 min)

1. Create a project, region **Southeast Asia (Singapore)**. Save the database password.
2. SQL Editor → run:
   ```sql
   CREATE SCHEMA IF NOT EXISTS identity;
   CREATE SCHEMA IF NOT EXISTS cases;
   CREATE SCHEMA IF NOT EXISTS payments;
   CREATE SCHEMA IF NOT EXISTS audit;
   CREATE SCHEMA IF NOT EXISTS pgboss;
   ```
3. Project Settings → Database → Connection string → **Session pooler**. It looks like
   `postgresql://postgres.<ref>:<PASSWORD>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`
4. Build the five URLs (same base, different `schema`; keep connections small on the free tier):

   | Variable                | Value                                              |
   | ----------------------- | -------------------------------------------------- |
   | `IDENTITY_DATABASE_URL` | `<session-url>?schema=identity&connection_limit=5` |
   | `CASES_DATABASE_URL`    | `<session-url>?schema=cases&connection_limit=5`    |
   | `PAYMENTS_DATABASE_URL` | `<session-url>?schema=payments&connection_limit=5` |
   | `AUDIT_DATABASE_URL`    | `<session-url>?schema=audit&connection_limit=5`    |
   | `BUS_DATABASE_URL`      | `<session-url>` (no `schema`)                      |

5. Create tables and seed **from a laptop** (put the five URLs in your local `.env` temporarily):
   ```bash
   pnpm db:generate && pnpm build
   pnpm db:push
   pnpm db:seed
   ```
   Put your local URLs back afterwards. Seeds are synthetic demo data only.

> Supabase free projects pause after a week without activity — open the dashboard on Sunday and Monday morning.

---

## 3. Secrets

```bash
pnpm keys --force    # in a scratch copy, or just read your existing .env
```

Use **production values that are different from your laptop's**. Never paste them in chat or commit them.

| Secret                                                  | Goes to                                                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`                                       | **identity only** (only identity can mint tokens)                                                     |
| `JWT_PUBLIC_KEY`, `INTERNAL_SECRET`                     | env group `haqdaar-secrets` (all services)                                                            |
| `PII_ENC_KEY`, `PII_HASH_KEY`                           | identity **and** cases (must be identical in both, and identical to what was used for `pnpm db:seed`) |
| `SEAL_SECRET`                                           | ai, payments, judge (identical)                                                                       |
| `WEBHOOK_SIGNING_SECRET`                                | payments                                                                                              |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `GEMINI_DEMO_API_KEY` | ai                                                                                                    |

Multi-line PEM keys: paste them as one line with literal `\n` (exactly as `pnpm keys` writes them) — the services convert them back.

---

## 4. Render (≈ 20 min, then ~10 min of builds)

1. Render Dashboard → **Env Groups → New** → name **`haqdaar-secrets`** with:
   `JWT_PUBLIC_KEY`, `INTERNAL_SECRET`, `BUS_DATABASE_URL`, `CORS_ORIGINS` (your Vercel URL, e.g. `https://haqdaar.vercel.app`),
   and the service URLs:
   ```
   GATEWAY_URL=https://haqdaar-gateway.onrender.com
   IDENTITY_URL=https://haqdaar-identity.onrender.com
   CASES_URL=https://haqdaar-cases.onrender.com
   AI_URL=https://haqdaar-ai.onrender.com
   PAYMENTS_URL=https://haqdaar-payments.onrender.com
   AUDIT_URL=https://haqdaar-audit.onrender.com
   RAILS_URL=https://haqdaar-rails-mock.onrender.com
   JUDGE_URL=https://haqdaar-judge.onrender.com
   ```
   (If Render gives a service a different hostname, update the URL here after the first deploy.)
2. **Blueprints → New Blueprint Instance** → pick the GitHub repo. Render reads `render.yaml` and asks for every `sync: false` value (DB URLs and the per-service secrets from section 3).
3. Wait for all 8 builds. Check `https://haqdaar-gateway.onrender.com/status` → every service `ok`.
4. The `haqdaar-config` group sets `DEMO_MODE=1` (Judge Mode + demo reset). For a non-demo deployment, set it to `0`.

---

## 5. Vercel (web app)

1. Import the repo, **Root Directory = `apps/web`**, framework Next.js.
2. Env: `NEXT_PUBLIC_API_URL=https://haqdaar-gateway.onrender.com`
3. Deploy, then make sure the Vercel URL is in `CORS_ORIGINS` in `haqdaar-secrets` (redeploy the gateway after changing it).

---

## 6. Keep it awake (UptimeRobot)

Create HTTP monitors every **10 minutes** (free tier minimum is 5) on:

- `https://haqdaar-gateway.onrender.com/status` — this one request also wakes every backend, because the status page calls each service's `/health`.

Turn the monitor **on** from Sunday noon until judging ends, **off** otherwise, to protect the 750-hour budget.

---

## 7. Demo day checklist (Mon 23 Nov)

- [ ] 30 min before: open the Supabase dashboard (unpause if needed), open `/status` → all `ok`.
- [ ] Switch AI to the paid key: Render → haqdaar-ai → `AI_PROFILE=demo` (needs `GEMINI_DEMO_API_KEY`), or at runtime as admin: `POST /ai/profile {"profile":"demo"}`.
- [ ] Reset demo data: Judge Mode → **Reset demo** (or `POST /judge/reset` as admin).
- [ ] Full regression against production:
  ```bash
  E2E_GATEWAY=https://haqdaar-gateway.onrender.com pnpm e2e
  ```
  (then reset the demo again).
- [ ] Laptop backup running: `pnpm db:up && pnpm build && pnpm start` → `http://localhost:4000/status`.
- [ ] Recorded demo video on a USB stick and in Google Drive.

---

## 8. Building and running an image locally

```bash
docker build --build-arg SERVICE=rails-mock -t haqdaar-rails .
docker run --rm -p 4106:8080 --env-file rails.env haqdaar-rails   # PORT inside the image is 8080
curl http://localhost:4106/health
```

Prisma clients are generated **inside** the image, so the query engine is the Alpine (`linux-musl-openssl-3.0.x`) build automatically — no `binaryTargets` change is needed in the schemas.
