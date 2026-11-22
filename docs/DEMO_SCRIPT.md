# Live demo script (7 minutes)

> **PROTOTYPE ONLY.** Say it in the first 20 seconds: "Everything you will see is a prototype. NADRA, Raast and SMS are simulated and every person is synthetic."
> **Never show a real CNIC.** Use only the specimen cards from [`docs/demo/specimen-cnic.md`](demo/specimen-cnic.md).

Rubric tags in brackets refer to [`docs/COVERAGE.md` section 10](COVERAGE.md#10-rubric-6-categories-20-criteria-strongest-evidence): **AI** (30), **SaaS** (20), **Real** (15), **Access** (10), **Safety** (15), **Innov** (10).

## Who does what

| Person                  | Plays                               | Screen                                                                                                         |
| ----------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **P1**                  | Narrator and Zainab (citizen)       | Phone, or a narrow browser window. Logged in as "Citizen — Zainab" (`03001110001`).                            |
| **P2**                  | Officer Sana, then Auditor Bilal    | Laptop window 2: Officer (`03001110003`). Window 3: Auditor (`03001110005`).                                   |
| **P3**                  | Admin Hira                          | Laptop window 4: Admin (`03001110004`). This is the projector screen for rules, AI, Judge Mode and Evaluation. |
| **P4** (if four people) | Helper, shopkeeper Asif; timekeeper | Second phone or window 5: Helper (`03001110002`). With three people, P1 does this.                             |

The app keeps one login per browser profile. Use a **separate browser profile or private window for each role**, all logged in before you start. Password for every demo account: `demo1234`.

## Timeline

| Time | Step                                                                | Who         | Rubric            |
| ---- | ------------------------------------------------------------------- | ----------- | ----------------- |
| 0:00 | 1. The problem in one sentence                                      | P1          | Real              |
| 0:20 | 2. Zainab claims by voice and by card scan → approved → Haq Receipt | P1          | AI, Access, Real  |
| 1:40 | 3. Fake SMS vs sealed genuine SMS                                   | P3, P1      | AI, Innov, Safety |
| 2:15 | 4. "I am not sure" → officer queue with AI notes → approve          | P4, P2      | Safety, AI        |
| 3:00 | 5. Rule change, Digital Twin, old decision keeps its version        | P3, P2      | SaaS, Innov       |
| 3:50 | 6. Consent take-back blocks the officer, shows in the audit log     | P4, P2      | Safety            |
| 4:25 | 7. Helper Mode: switching families with PINs                        | P4          | Innov, Safety     |
| 4:55 | 8. Offline claim that syncs once                                    | P4          | Access            |
| 5:30 | 9. Kill AI                                                          | P3, P1      | Safety, AI        |
| 6:00 | 10. Judge Mode: break it yourself                                   | P3 + judges | Safety, SaaS      |
| 6:30 | 11. The numbers behind our threshold                                | P3          | AI, Safety        |
| 7:00 | Stop. Questions.                                                    | all         |                   |

---

## The script

### 1. The problem (0:00, 20 s) — P1

**Say:** "We help a low-literacy widow claim her monthly relief payment, even though she cannot read forms, has a weak phone signal, and keeps getting fake 'relief payment' messages that could steal her savings. This is Zainab. She is not real; nobody in this demo is. Watch her finish the claim without reading a word."

### 2. Zainab claims (0:20, 80 s) — P1

Start on the citizen home screen (four big cards).

1. Tap **"Claim my money"** (میرے پیسے کے لیے درخواست). The screen speaks by itself. _Let the judges hear two seconds of it._
2. Tap **"Start with a photo of my CNIC"**, then **"Take photo"**, and choose `docs/demo/cards/genuine.jpg`.
   **Say:** "This is a specimen card, stamped 'not a real CNIC'. The photo is read on our own server. It never goes to an outside model."
   The screen says "The photo is fine". Name and number are now filled from the card.
3. The app asks aloud only for what the card cannot tell it. Tap the **microphone**, say in Urdu: _"Main Thatta mein rehti hoon, ghar mein paanch log hain"_ ("I live in Thatta, five people at home"), tap again to stop.
   **Say:** "It asks only for what is missing, and the next question is chosen by code, not by the model."
4. The review screen reads everything back in Urdu. Tap the green **"Yes, it is correct"** (جی ہاں، ٹھیک ہے).
5. Permission screen: tap both boxes (NADRA check, household income), then **"Send my claim"**.
   **Say:** "Nothing is pre-ticked. Without her permission we do not even ask NADRA."
6. Result: **"Approved"**, with the reason spoken in Urdu.
   **Say:** "A rule engine approved this, not a language model. Confidence was above 0.988 and no flag was raised."
7. Tap **"Where is my money?"**. When the status is "Money sent to your account", the green **Haq Receipt** shows 12,000 rupees in digits and words and reads it aloud.
   **Say:** "She hears the exact amount on her own phone, so a middleman cannot quietly keep a share."

_If the microphone fails:_ tap **"Type instead"**, fill Thatta and 5, continue. Say "voice is the first way in, not the only one."
_If the voice claim goes to an officer instead of approving:_ say "the speech model was not sure, so a person decides" and let P2 approve it. That is step 4 done early.

### 3. Fake SMS vs sealed SMS (1:40, 35 s) — P3 then P1

1. **P3:** Admin > **Mock phone** > **Zainab**. The payout SMS is there, with a Haqdaar code. Tap **"Is this real?"** → **Genuine message**.
   **Say:** "Every real program message carries a signed code. We do not guess that it is real. We prove it."
2. **P1:** Citizen home > **"Is this message real?"**, paste:
   `BISP: Rs 25000 lene ke liye apna PIN aur Rs 500 fee bhejein`
   Tap **"Check"** → **Scam! Do not act on it**, with the reasons (asks for a PIN, asks for a fee, program name without a code).
3. _Optional, 10 s:_ paste the genuine SMS with one digit of the amount changed → Scam (forged code).
   **Say:** "This is the shopkeeper's problem from the brief. The AI is only used for messages the seal and the rules cannot settle, and it is allowed to say 'not sure'."

### 4. "I am not sure" (2:15, 45 s) — P4 files it during step 3; P2 reviews

**P4, quietly during step 3:** Helper home > **Zainab Bibi (Badin)** > PIN `5555` > "Claim my money" > **"Type instead"** > name `Zainab Bibi`, CNIC `41201-4455667-2`, district Badin, household 4, number `03121234501` > Next > Yes > tick both permissions > Send.

1. **P4** shows the result: **"An officer is checking it"** and the line "Please wait — a person will decide, not a machine."
   **Say:** "A second Zainab Bibi, different CNIC, different district. The names are identical, so the system refuses to decide alone. It did not merge her with the first Zainab and it did not reject her."
2. **P2:** Officer > **Queue** > tap **"Lowest confidence"** > open the case.
   Point at: "Decided under rule v1 · confidence … vs auto-approve threshold 0.988", the rule clauses (met / not met), and the **AI notes** card ("Why this case needs care").
3. **P2:** check the CNIC and district, tap **"Approve"** → "Approved. Payout will start."
   **Say:** "Automation can approve when it is very sure, or hand over. It can never reject. Only a person can say no."

### 5. Rules that change (3:00, 50 s) — P3, then P2

1. **P3:** Admin > **Rules**. Under "Monthly household income is below PKR 40,000" change the threshold from `40000` to `35000`.
2. Tap **"Run Digital Twin"**. Read the line "Replayed N past decisions. M would change." and the lane table.
   **Say:** "Before anything goes live, the draft rule is replayed on past decisions. We see the effect first."
3. Tap **"Publish v2…"** > **"Publish now"**. The message reads "v2 is live. Earlier decisions keep the version they were made with."
   **Say:** "No code change, no redeploy. The next claim uses v2."
4. **P2:** open the pre-staged case in the queue (see checklist). It still reads **"Decided under rule v1"**.

### 6. Consent and take-back (3:50, 35 s) — P4, then P2

The pre-staged case in the queue belongs to Kaneez Fatima.

1. **P4:** Helper > **Kaneez Fatima** > PIN `4444` > **"My data and permission"** > on the **NADRA** row tap **"Take back"** > **"Yes, take it back"**.
2. **P2 (officer):** tap Kaneez's case in the queue again. It is refused: _"The citizen has withdrawn (or not given) consent: personal data is blocked"_.
   **Say:** "This is enforced on the server on the very next request, not hidden in the screen."
3. **P2 (auditor window):** **Audit log** > type `identity.consent.withdrawn` in the event filter. The entry is there, with who and when. Tap **"Verify chain"**.
   **Say:** "The log is append-only and hash-chained. The auditor can read everything and change nothing."

### 7. Helper Mode (4:25, 30 s) — P4

1. Tap **"Switch family"** in the banner. The family list returns; nothing of Kaneez is on screen.
2. Tap **Nasreen Bi Bi**, enter a wrong PIN (`0000`) → **"Wrong PIN"**, spoken. Enter `3333` → her home screen, banner "Acting for: Nasreen Bi Bi".
   **Say:** "One shared phone, many families. Each family has its own PIN and its own permissions. Five wrong PINs lock that family for fifteen minutes, and every action is recorded as the helper acting for that person."

### 8. Offline (4:55, 35 s) — P4

1. Still acting for Nasreen: tap "Claim my money" so the screen is loaded, then turn the network off (airplane mode, or browser DevTools > Network > Offline). The amber banner says "No internet. Your work is saved on this phone."
2. **"Type instead"** > `Nasreen Bi Bi`, `42401-3344556-6`, Karachi West, 8, `03451234504` > Next > Yes > tick both > **Send**.
   Screen: "Saved on your phone. It will be sent automatically when the internet is back." The banner counts one waiting claim.
3. Turn the network on. The counter clears. Open **"Where is my money?"**: exactly one claim.
   **Say:** "The claim carries one idempotency key. Send it five times on a bad line and the server files it once."

### 9. Kill AI (5:30, 30 s) — P3, then P1

1. **P3:** Admin > **AI** > **"Kill AI…"** > **"Kill AI"**. The pill turns to "AI is OFF".
2. **P1:** Citizen > "Is this message real?" > paste the fake SMS again → still **Scam** (the fixed rules catch it). Paste `Aap ka case number 4471 hai.` → **Not sure**.
   **Say:** "With every model off, the system keeps working. Rules still catch the obvious scam, the unclear one becomes 'not sure', voice falls back to typing, and every scanned card goes to an officer. Nothing guesses."
3. **P3:** tap **"Turn AI on"**.

### 10. Judge Mode: break it yourself (6:00, 30 s) — P3 hands over the laptop

1. Admin > **Judge Mode**.
   **Say:** "One button for each of your eight challenges, plus five payment failures. Each one drives the real system through the public API and prints every step. Please pick one."
2. If they do not pick: under "Bank-grade payouts" run **"Raast times out after taking the money"**. Read the steps: UNKNOWN → status inquiry → SUCCESS, paid once.
3. Point at **"Break a public rail"**: "You can also break the mock Raast yourself and then pay a claim."

### 11. The numbers behind our threshold (6:30, 30 s) — P3

1. Admin > **Evaluation** > **"Run evaluation now"**.
2. **Say:** "A wrong approval costs us 25,000 rupees: the payout, the recovery work and the harm to the real beneficiary. A human review costs 300. So the machine may act alone only when (1 − p) × 25,000 is less than 300, which is p of at least 0.988. An admin can change those costs and the threshold moves with them."
3. Read from the screen, do not quote from memory: **Wrong auto-approvals**, **False alarms**, **Handled without an officer**, **Cost per case**.
   **Say:** "These numbers come from a synthetic labelled set that we generated. False alarms are shown because blocking a real person is also a cost. Real-world accuracy would need real, consented data."

**Close:** "It knows when it does not know, and it proves who is real. Thank you."

---

## Questions judges will ask

| Question                                                      | Answer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Why microservices for a hackathon?**                        | Three reasons we can show. Blast radius: the AI service can be down and login, payments and audit keep working (`pnpm chaos`). Security boundaries: only identity can sign tokens, only payments can move money, audit is separate from what it audits. Parallel work: one owner per service and schema. The cost is more moving parts; we kept it down with one shared toolkit, shared contracts, one Postgres with a schema per service and a queue inside Postgres. For a small deployment the same services can run in one container (`Dockerfile.allinone`). |
| **Why 0.988?**                                                | It is not chosen, it is derived: approve alone only if the expected loss of approving, (1 − p) × 25,000, is below the cost of a review, 300. The costs are admin settings. Nonsense costs (zero, or a review dearer than a wrong approval) switch auto-approval off.                                                                                                                                                                                                                                                                                              |
| **Is that confidence a real probability?**                    | The raw score has hand-set weights, so we calibrate it with Platt scaling on a labelled set and show the reliability table. A test refits it and fails if the stored values drift. It is calibrated on synthetic data only.                                                                                                                                                                                                                                                                                                                                       |
| **What if the model is wrong?**                               | The model cannot approve, reject or pay. It reads speech, sorts messages and phrases explanations. Its output is schema-checked; what the phone reports can only add caution; she confirms a read-back before anything is sent; the card photo overrides a misheard name. A wrong reading costs a review, not a payout.                                                                                                                                                                                                                                           |
| **What if the model is down or the quota runs out?**          | Fallback chain with a circuit breaker per provider, then a deterministic local answer that routes to a person. Kill AI shows it.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **How do you stop a helper stealing a family's money?**       | A PIN per family, with a lock after five wrong tries. Actions are recorded as the helper acting for that person. Before paying, the account title is fetched and matched to the beneficiary; a mismatch holds the payout. One account collecting for more than two other people in a day is held. Releasing a held payout needs a second officer. She hears the exact amount (Haq Receipt), and the SMS is sealed. Fraud-ring signals across claims are landing. <!-- STATUS: pending merge -->                                                                   |
| **Can someone sign up and claim with another person's CNIC?** | Our own fuzz test found exactly that. Now the first claim that ties a CNIC to a self-registered account always goes to an officer. Knowing a number proves nothing.                                                                                                                                                                                                                                                                                                                                                                                               |
| **How would real data be protected?**                         | CNIC and phone are encrypted at rest (AES-256-GCM) with a keyed hash for lookup; staff screens show masked values; the queue shows no names; consent is checked on every staff read; PII is removed before any prompt; card photos are processed on our server and never sent to an outside model; the audit log records every access-changing event. For production we would add key management in a vault, data residency, retention limits and an external anchor for the audit chain.                                                                         |
| **What happens if Raast times out after the money left?**     | The payment becomes UNKNOWN and is never re-sent blindly. A status inquiry settles it. One idempotency key per payout, a unique constraint, and the rail dedupes by our reference. Judge Mode shows it.                                                                                                                                                                                                                                                                                                                                                           |
| **How do you know the books are right?**                      | Double-entry ledger; balances are derived, never edited; reconciliation against the bank statement flags a duplicate settlement.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Why not let the AI decide? It is an AI hackathon.**         | Because a decision about someone's money must be replayable. Every decision stores its inputs, rule version, confidence and threshold. An LLM answer cannot be replayed. The AI does the parts people cannot: hearing Urdu, reading a card, sorting messages.                                                                                                                                                                                                                                                                                                     |
| **What is not built, and why?**                               | Subscription billing: a relief program has no paying subscribers, so plans are per-program usage limits, reported but not enforced. WhatsApp and email: SMS is simulated, so there was nothing real to send through. Versioned migrations: we used `prisma db push`. A user-management screen. A complaint case from the Haq Receipt. A fraud-desk queue for "not sure" scam messages. Server-side memory across devices. We chose depth on one task over these.                                                                                                  |
| **What are you least sure about?**                            | Accuracy on real speech and real photos; scam recall on wording we did not template; the free Urdu voice endpoint is unofficial. Each of these fails toward a human.                                                                                                                                                                                                                                                                                                                                                                                              |

---

## Pre-demo checklist

**The night before**

- [ ] Generate the specimen cards: `pnpm --filter @haqdaar/ai build`, then `node services/ai/dist/vision/fixtures.js docs/demo/cards`.
- [ ] Rehearse the whole script twice with a timer, once on the deployed link and once on the laptop.
- [ ] Confirm the demo accounts work on the deployed link.
- [ ] Record a backup video of a clean run.

**Thirty minutes before**

- [ ] Laptop plugged in, sleep and screen lock off, notifications off, browser zoom set for the projector.
- [ ] Local stack running (`pnpm start`, and `pnpm dev:web` for the web app). Open `http://localhost:4000/status`: every service up.
- [ ] `pnpm demo:reset` (clears claims, payouts and consents; the audit log is never touched).
- [ ] Admin > **AI**: the profile you want is selected, "AI is ON", keys show "set", circuits "CLOSED".
- [ ] Admin > **Rules**: the live rule is the one you expect and the threshold reads 0.988. A reset does not undo a published rule; if a rehearsal published v2, the next one publishes v3. Adjust the words in step 5.
- [ ] **Pre-stage one case** for steps 5 and 6: Helper > Kaneez Fatima > PIN `4444` > Claim my money > Type instead > `Kaneez Fatma`, `42101-6677889-4`, Karachi East, 6, `03151234506` > send. It must appear in the officer queue.
- [ ] Test the microphone in the same browser and allow the permission. Say one Urdu sentence and check the transcript.
- [ ] Test the speaker volume from the back of the room.
- [ ] Five browser profiles logged in: citizen, helper, officer, auditor, admin.
- [ ] Backup link open in a tab: <https://172-198-74-124.sslip.io>.
- [ ] `docs/demo/cards` folder open in the file picker's recent locations.
- [ ] No real ID card, wallet or badge anywhere near a camera.

## Fallback plan

| What fails                                | What to do                                                                                                                                                                                                                                                       | What to say                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Venue internet                            | Run on the laptop (`localhost`). Recorded Urdu prompts still play. Admin > AI > **Offline**.                                                                                                                                                                     | "No outside AI now. Watch the claim still finish, through a person."                                  |
| Speech vendor (Groq) down or out of quota | The app says it could not hear, then offers typing. Use "Type instead".                                                                                                                                                                                          | "Voice is the first way in, not the only one. Typing is not doubt, so it does not cost her a review." |
| LLM down                                  | Scam check falls back to the seal and the rules. Extraction answers "not sure".                                                                                                                                                                                  | "This is the Kill AI path, for real this time."                                                       |
| Urdu voice endpoint down                  | Recorded prompts still play; other sentences use the phone's own voice.                                                                                                                                                                                          | "Three levels of voice: recordings, server, phone."                                                   |
| **Offline profile, full claim**           | Zainab scans the specimen card (the check adds "AI is off: an officer reviews every document"), types district and household, sends. The case goes to the officer queue. P2 opens it, reads the notes, approves. Payout and Haq Receipt follow on the mock rail. | "With no AI at all the claim still completes, through a human. That is the design, not an accident."  |
| Deployed site slow or down                | Switch to the laptop.                                                                                                                                                                                                                                            | Nothing. Just switch.                                                                                 |
| Laptop dies                               | Second laptop on the deployed link; then the backup video.                                                                                                                                                                                                       | "A live demo is mandatory, so we brought two."                                                        |
| A Judge Mode scenario fails               | Read the failing step aloud. Do not hide it. Tap "Reset demo…" and move on.                                                                                                                                                                                      | "That is a real failure and it tells us exactly where. The log has it."                               |
| Microphone permission blocked             | Use the card scan plus "Type instead".                                                                                                                                                                                                                           | Same as the speech-vendor line.                                                                       |
