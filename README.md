# Haqdaar

> **PROTOTYPE ONLY — not an official government service.** All identity, payment, SMS and data services are simulated. No real personal data is used.

**Coder's Cup '26 · Hagrid's Hackathon · The Last Mile: AI on Public Rails**

We help **a low-literacy widow** **claim her monthly relief payment** even though **she cannot read forms, has a weak phone signal, and keeps receiving fake "relief payment" messages that could steal her savings.**

*Knows when it doesn't know. Proves who's real.*

## Start here

- 📄 **Full build plan:** [docs/PLAN.md](docs/PLAN.md) (also as [PDF](docs/Haqdaar-Plan.pdf))
- 👥 Team split, timeline and demo script are in the plan (sections 13–15)

## What makes it different

1. **Haqdaar Seal:** genuine program messages carry a signed code, so "real" is proven, not guessed.
2. **Haq Receipt:** the beneficiary hears the exact payout amount, so middlemen can't skim it.
3. **Judge Mode:** one button per hackathon challenge, so judges can try to break it live.
4. **The LLM never approves; automation never rejects.** Auto-approve only when `p ≥ 0.988` (cost-based threshold).

## Repository layout

```
apps/web        Next.js PWA (citizen, helper, officer, admin, auditor, Judge Mode)
apps/api        NestJS API (Fastify adapter) + mock NADRA / Raast / household / SMS services
packages/shared Zod schemas shared by web and api
data/           synthetic data generators, seed, policy docs, Urdu audio clips
docs/           plan and design notes
```

## Stack

TypeScript · Next.js · NestJS (Fastify adapter) · Zod · Prisma · Supabase Postgres · pg-boss · Groq (Llama + Whisper) · Gemini (fallback) · tesseract.js · sharp · Vercel · Render. Total cost: free tiers only.

## Setup

_Coming during the build: `pnpm install`, env setup from `.env.example`, `pnpm db:migrate`, `pnpm dev`._

## Real vs simulated

See [docs/PLAN.md §16](docs/PLAN.md#16-real-vs-simulated-for-readme-and-judges).
