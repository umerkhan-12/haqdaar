# Haqdaar Web — Design

The PWA that every Haqdaar user touches: a low-literacy widow on a cheap phone, the shopkeeper who helps her, the officer, the admin, the auditor and the judges. This document is the contract the code follows; reviews check against it.

## 1. Personas and constraints

| Persona                                           | Device / context                               | Constraints                                                                 | What the UI must do                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Zainab — citizen** (low-literacy widow, Thatta) | Cheap Android, 2G, shared phone, often offline | Cannot read forms; Urdu speaker; small screen; fears scams                  | Voice first, icon + colour + spoken audio on every state, Urdu RTL, **one primary action per screen**, works offline, never a dead end |
| **Asif — shopkeeper helper**                      | His own phone, serves many families a day      | Speed; must not mix families; must not see a family without its PIN         | Family list, **PIN pad** per family, a permanent "Acting for …" banner, one tap to switch                                              |
| **Sana — officer**                                | Office laptop, keyboard                        | Throughput on a long queue; needs evidence, not noise                       | Dense but readable **queue**, keyboard-only flow, masked CNIC, reasons required for rejection, clear maker-checker messages            |
| **Hira — admin**                                  | Laptop                                         | Changing rules is risky                                                     | Digital Twin **before** publish, cost model with live threshold, AI controls (profile, Kill AI) with clear state                       |
| **Bilal — auditor**                               | Laptop                                         | Read-only; must trust the record                                            | Filterable log, decision trace, **Verify chain** with an unambiguous result                                                            |
| **Judges**                                        | Projector / laptop, 6 minutes                  | Want proof, not claims                                                      | **Judge Mode**: one button per challenge, live steps with ✓/✗, durations and a one-line summary                                        |
| **Inclusive needs**                               | Any                                            | Low vision, motor impairment, screen readers, colour blindness, older users | ≥ 48 px targets, 200 % text resize, visible focus, labels + `aria-live`, status never by colour alone                                  |

## 2. Journeys and information architecture

**Citizen — claim money (the north-star journey, "time to money")**

1. Login (or helper switches to her family) → Home: three big cards.
2. _Claim my money_ → hold the mic and speak → system transcribes and fills the form.
3. Check details (pre-filled; typing allowed when AI is unsure or off).
4. Consent: two plain-language permissions, each a big toggle, withdrawable later.
5. Send → result card spoken aloud: approved / officer checking / more info needed. Offline → "saved on your phone, will send itself".
6. _Where is my money?_ → status, Urdu reason, timeline; **Haq Receipt** with the exact amount when paid.

**Citizen — is this message real?** Paste/type the SMS → Verdict card (Genuine / Scam / Not sure) with reasons, spoken.

**Helper** Login → choose family → PIN pad → citizen screens with "Acting for" banner → Switch family.

**Officer** Queue (priority sorted) → case (decision, clauses, flags, timeline) → Approve / Reject (reason) / Ask for info → Payments: HELD reasons → Release (maker) → a different officer Approves (checker).

**Admin** Rules → edit draft threshold → Digital Twin (before/after lanes, changed cases) → Publish. Cost model → threshold updates. AI: profile + Kill AI + provider chain. API keys (shown once). Money: ledger + reconciliation. Judge Mode. Mock phone.

**Auditor** Audit log (filters, paging) → entry → decision trace; Verify chain.

**Route map**

```
/login
/citizen                 home (citizen, or helper acting for a family)
/citizen/claim           voice → confirm → consent → result
/citizen/status          status, reason, timeline, Haq Receipt
/citizen/scam            verdict
/helper                  families + PIN pad
/officer                 queue + case panel
/officer/payments        payouts, holds, maker-checker
/admin                   rules + Digital Twin + costs
/admin/ai                AI profile, Kill AI, providers
/admin/money             ledger + reconciliation
/admin/keys              API keys
/auditor                 audit log, trace, verify chain
/judge                   Judge Mode
/phone                   mock phone (SMS inbox → check if real)
/offline                 offline fallback page (served by the service worker)
```

## 3. Design system

### Tokens

| Token           | Value                               | Use                        | Contrast                                         |
| --------------- | ----------------------------------- | -------------------------- | ------------------------------------------------ |
| `brand`         | `#0b6b4f`                           | primary actions, headers   | white on brand **6.5 : 1**                       |
| `brand-dark`    | `#08513c`                           | hover/pressed              | white on it 9.3 : 1                              |
| `brand-soft`    | `#e6f3ee`                           | selected / info background | brand-dark text on it 8.2 : 1                    |
| `ink`           | `#1d2433`                           | body text                  | 15.5 : 1 on white                                |
| `muted`         | `#5b6677`                           | secondary text             | 5.8 : 1 on white, 5.5 : 1 on the page background |
| ok / bad / warn | 900-text on 50-tint, 600-700 border | status                     | green 8.7, red 9.2, amber 8.7 : 1                |

All ratios computed with the WCAG relative-luminance formula. Rejected during design: white on amber-500 (2.1 : 1) — the offline banner uses amber-900 on amber-100 (8.1 : 1) instead.

**Status is never colour alone:** every status has an **icon + words + a Listen button** (shape + text + sound), so it works for colour-blind users, screen readers and people who cannot read.

**Type:** Urdu in Noto Nastaliq Urdu with line-height 2.1 (Nastaliq stacks diagonally and collides below ~2); Latin in the system UI font, 1.5. Base 18 px for citizens (text-lg), 16 px for staff. Sizes: 14 / 16 / 18 / 20 / 24 / 30 / 48 (receipt amount).
**Spacing:** 4 px scale (Tailwind). **Radius:** 12 px controls, 16 px cards, full for audio/mic. **Motion:** only spin/pulse for progress, wrapped in `motion-safe:` so `prefers-reduced-motion` turns it off.

### Components (`components/`)

| Component                                | Purpose                                                                                    |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Button`                                 | primary / ghost / danger, min 48 px                                                        |
| `BigActionCard`                          | citizen home actions: icon + label, 96 px tall                                             |
| `AudioButton`                            | speaks any text (SpeechSynthesis, Urdu voice when available)                               |
| `StatusCard`                             | icon + title + body + AudioButton; the single way to show any state                        |
| `StatusPill`                             | compact status for staff tables (icon/letter + text)                                       |
| `VerdictCard`                            | scam verdict: shield/x/question icon, colour, reasons, audio                               |
| `Timeline`                               | ordered case events                                                                        |
| `Field`                                  | label + input; every input has a visible label                                             |
| `PinPad`                                 | 3×4 numeric pad, 64 px keys, masked dots, works without a keyboard                         |
| `OfflineBanner`                          | persistent, `role="alert"`, with outbox count                                              |
| `EmptyState` / `ErrorState` / `Skeleton` | designed states; skeletons keep layout stable (no shift)                                   |
| `DataTable`                              | staff lists: semantic `<table>`, header scope, keyboard-reachable row actions              |
| `ConfirmDialog`                          | native `<dialog>` for irreversible staff actions (reject, publish, revoke) with focus trap |

### Every screen state

| State   | Citizen                                                                 | Staff                           |
| ------- | ----------------------------------------------------------------------- | ------------------------------- |
| Loading | Skeleton + "Please wait"                                                | Skeleton rows                   |
| Empty   | StatusCard (neutral) + the next action                                  | EmptyState line                 |
| Error   | StatusCard (bad) in plain words, Retry, short ref id — never raw errors | exact server message + ref id   |
| Offline | OfflineBanner; claims go to the outbox                                  | OfflineBanner; actions disabled |
| Waiting | "A person will decide, not a machine"                                   | queue age shown                 |
| Success | StatusCard (ok) spoken aloud                                            | inline confirmation             |

## 4. Accessibility (WCAG 2.2 AA)

| Requirement                 | How                                                                                                                                           |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Focus order + visible focus | DOM order = visual order; global `:focus-visible` 3 px amber ring                                                                             |
| Labels                      | every input wrapped in `Field` with a visible label; icon-only buttons have `aria-label`                                                      |
| Async results announced     | StatusCard is `role="status"` (polite); errors/offline `role="alert"`                                                                         |
| Target size                 | all interactive elements ≥ 48 × 48 px (2.5.8 asks 24)                                                                                         |
| RTL / LTR                   | `dir` on `<html>` follows the language; numbers, CNICs and phones are `dir="ltr"`; logical properties (`text-start`, `ms-`) so layouts mirror |
| Resize to 200 %             | fluid single-column citizen layout, no fixed heights on text containers                                                                       |
| Keyboard-only officer flow  | queue rows are buttons; approve/reject reachable by Tab; dialogs trap and return focus                                                        |
| Reduced motion              | `motion-safe:` on all animation                                                                                                               |
| Not colour alone            | icon + text + audio for every status                                                                                                          |

Verification is recorded in the report of each change (axe run in the browser on the main screens, manual keyboard pass on the officer flow).

## 5. Engineering principles

- **Feature folders:** `features/<area>/…` hold screens and their components; `app/…/page.tsx` files are thin route wrappers. Shared UI in `components/`, cross-cutting code in `lib/`.
- **One typed API client** (`lib/api.ts`): all endpoints, shapes and errors; components never call `fetch`.
- **Server state** comes only from the API through `useAsync` (screen-level loading/error/reload); no duplicated caches. The session is the only client store (`lib/session.ts`, `useSession`).
- **Components are free of fetch logic**: features load data and pass it down.
- **Errors:** `ApiError` everywhere; `app/error.tsx` is the error boundary; citizens never see raw messages.
- **Offline:** service worker caches the app shell; claims go to an IndexedDB outbox with their idempotency key and are flushed on `online` — resending is safe by design.
- **No layout shift:** skeletons reserve space; fonts use `display: swap` with a fallback stack.
- **Performance budget:** citizen routes ≤ 100 KB JS gzipped first load where feasible; measured after every `next build` (numbers in the README of this app).
  - **Measured (Next 16.4.6, production build):** first load ≈ 191–196 KB gzipped JS on every route. Of that, ≈ 170 KB is the framework floor (React DOM ≈ 78 KB, Next client runtime ≈ 92 KB — the near-empty `/offline` page alone is 185 KB). Haqdaar's own code is ≈ 15 KB shared + 3–11 KB per route. HTML is 2.7 KB per page.
  - **So the 100 KB target is not met on first visit**, and cannot be with Next.js + React. Mitigation in place: the service worker serves all `/_next/static` JS cache-first, so every later visit downloads only the ~3 KB HTML even on 2G, and the app opens fully offline. If first-visit size becomes critical, the citizen screens are small enough to move to a separate Preact build; not worth it for the prototype.
