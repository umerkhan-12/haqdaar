# Every screen and every control: what it does and why

Haqdaar is a prototype. Identity checks (NADRA), the bank rail (Raast) and SMS are simulated; no real person is checked, paid or messaged.

How to read this: "API" names the call in `apps/web/lib/api.ts` and the gateway path it reaches. "Client-only" means nothing is sent to the server. Screens are in `apps/web/app/**/page.tsx`; the code for each is in `apps/web/features/**`.

## Shared shell (every signed-in screen)

Code: `components/shell.tsx`, `components/citizen-shell.tsx`, `components/ui.tsx`.

| Control                                      | What it does                                                                                                  | Why it is there                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Amber "PROTOTYPE" strip                      | Fixed label on every page. Client-only.                                                                       | Nobody mistakes the demo for a government service.        |
| App name (header link)                       | Goes to the home screen of your role. Client-only.                                                            | One way back from anywhere.                               |
| Language switch                              | Flips Urdu and English for all text and speech. Client-only.                                                  | Most citizens read or hear Urdu; judges read English.     |
| Log out                                      | `api.logout` (POST /auth/logout), clears the session, reloads to /login.                                      | Shared phones: the next person must not see this account. |
| Listen button (speaker icon)                 | Speaks the text next to it. POST /ai/speak, else browser voice or recorded audio.                             | Many citizens cannot read.                                |
| Offline banner                               | Shows "no internet" and how many claims wait to be sent. Client-only.                                         | She knows her claim is saved, not lost.                   |
| Automatic resend                             | When the internet returns, saved claims are sent (`api.grantConsent`, `api.submitClaim`).                     | Weak rural networks.                                      |
| "Helping: family" bar + Switch family        | Helper only. Drops the family session and returns to /helper. Client-only.                                    | One helper serves many families on one phone.             |
| Side navigation (officer)                    | Queue, Payments, Scam Map.                                                                                    | Officer's three jobs.                                     |
| Side navigation (admin)                      | Rules, AI, Money, Evaluation, Scam Map, Team, Programs, API keys, Webhooks, API docs, Judge Mode, Mock phone. | Admin runs the program and the demo.                      |
| Side navigation (auditor)                    | Audit log, Scam Map, Evaluation.                                                                              | Auditor reads; cannot change claims.                      |
| Role guard                                   | No session goes to /login; wrong role goes to that role's home. Client-only (server checks roles again).      | A citizen cannot open staff screens.                      |
| Back-swipe guard                             | Reloads a page restored from browser history. Client-only.                                                    | A swipe back never shows the last person's data.          |
| Error page: Try again / Go to the first page | Re-renders the page, or goes to `/`. Client-only.                                                             | A calm way forward instead of a crash.                    |

## /login

| Control                     | What it does                                                                 | Why it is there                                            |
| --------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Language switch             | Flips Urdu and English. Client-only.                                         | Same as everywhere.                                        |
| Mobile number               | Text input.                                                                  | The account is the phone number.                           |
| Password or PIN             | Hidden input.                                                                | Staff use a password, citizens a 4-digit PIN.              |
| Sign in                     | `api.login` (POST /auth/login), then opens the role's home.                  | Entry for all five roles.                                  |
| Create an account           | Link to /signup.                                                             | Citizens register themselves.                              |
| Demo accounts (six buttons) | Fill the number and the demo password. Client-only; you still press Sign in. | Judges can try each role in one tap. Seeded accounts only. |

## /signup

| Control                   | What it does                                                                      | Why it is there                                        |
| ------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Language switch, Listen   | As in the shell.                                                                  | Sign-up must work by ear.                              |
| Mobile number + Send code | `api.signupStart` (POST /auth/signup/start).                                      | Proves she holds the phone.                            |
| Simulated SMS box         | Polls `api.signupSms` (GET /mock/sms/signup/:phone) every 3 s and shows the code. | No real SMS is sent, so the code is shown on screen.   |
| 6-digit pad + Next        | `api.signupCheck` (POST /auth/signup/check).                                      | A wrong code is refused before name and PIN are asked. |
| Send the code again       | `api.signupStart` again.                                                          | Codes expire or get lost.                              |
| "Mock phone screen" link  | Link to /phone (admin login needed; lists three seeded numbers).                  | Points to the demo SMS inbox used in Judge Mode.       |
| Full name + Next          | Client-only check of the name.                                                    | The name is matched with the identity record later.    |
| PIN pad (twice)           | Client-only; refuses weak PINs such as 1234.                                      | A PIN is easier than a password on a keypad phone.     |
| Create account            | `api.signupVerify` (POST /auth/signup/verify), signs her in.                      | One step from code to a working account.               |
| Back                      | Goes one step back. Client-only.                                                  | Fix a typo without starting over.                      |
| I already have an account | Link to /login.                                                                   | Wrong screen, quick exit.                              |

## /citizen (home)

| Control                | What it does                  | Why it is there                                      |
| ---------------------- | ----------------------------- | ---------------------------------------------------- |
| Listen                 | Reads the five choices aloud. | She can choose by ear.                               |
| Make a claim           | Link to /citizen/claim.       | The main job.                                        |
| My claim status        | Link to /citizen/status.      | "Where is my money?"                                 |
| Is this message real?  | Link to /citizen/scam.        | Fake "you won money" messages target these families. |
| Ask about the program  | Link to /citizen/ask.         | Questions without visiting an office.                |
| My data and permission | Link to /citizen/consents.    | She controls who sees her data.                      |

## /citizen/claim

| Control                                                         | What it does                                                                                                     | Why it is there                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Back                                                            | Link to /citizen.                                                                                                | Leave without sending.                                            |
| Progress steps                                                  | Shows the current step. Not pressable.                                                                           | She knows how far she is.                                         |
| Big microphone                                                  | Records; then `api.transcribe` (POST /ai/transcribe) and `api.extract` (POST /ai/extract-claim).                 | She can claim by speaking Urdu.                                   |
| Follow-up question + microphone                                 | Asks only for the missing detail, same two calls.                                                                | No long form; one question at a time.                             |
| Start with a photo of my CNIC                                   | Opens the photo step.                                                                                            | The card number is read from the card, not typed.                 |
| Take photo / Retake                                             | Camera input; `api.documentCheck` (POST /ai/document-check).                                                     | Checks the card is readable and matches the typed number.         |
| Next / Skip photo                                               | Continues with or without the photo result. Client-only.                                                         | A bad camera must not block a claim.                              |
| Type instead                                                    | Opens the typed form. Client-only.                                                                               | Works when speech fails or AI is off.                             |
| Typed form: name, CNIC, district, household size, payout mobile | Inputs; Next is enabled when all are valid. Client-only.                                                         | The five facts the rules need.                                    |
| Start over                                                      | Clears the draft. Client-only.                                                                                   | Wrong person or wrong details.                                    |
| Review: Listen per row                                          | Reads each detail back.                                                                                          | She confirms by ear what the AI heard.                            |
| Yes, correct                                                    | Goes to the permission step. Client-only.                                                                        | AI output is never sent without her yes.                          |
| No, speak again                                                 | Clears and records again.                                                                                        | Fix a mishearing by voice.                                        |
| Fix by typing                                                   | Opens the typed form with the draft.                                                                             | Fix one field without re-recording.                               |
| Permission boxes (identity, household, payment)                 | Toggle each consent. Client-only until Send.                                                                     | Data is checked only with her permission.                         |
| Send                                                            | `api.grantConsent` (POST /consents) per box, then `api.submitClaim` (POST /cases). Offline: saved to the outbox. | One press files the claim; safe to repeat (idempotency key).      |
| Result card + My claim status                                   | Shows the lane and reason; link to /citizen/status.                                                              | She hears the outcome at once, in plain words (POST /ai/explain). |

## /citizen/status

| Control                                    | What it does                                                                                | Why it is there                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Back, Listen                               | As above.                                                                                   | Navigation and audio.                      |
| Claim list chips                           | Pick which claim to show. Loads `api.cases` (GET /cases), `api.case` (GET /cases/:id).      | A family can have more than one claim.     |
| Make a claim (when empty)                  | Link to /citizen/claim.                                                                     | Nothing to show yet.                       |
| Status card and timeline                   | Read-only; spoken once.                                                                     | She sees each step and who decided.        |
| Haq Receipt + Listen                       | Shows and speaks the exact amount paid.                                                     | Nobody can quietly keep part of her money. |
| Payment problem card + Listen              | Says the payout is held, failed or waiting on the bank.                                     | Honest news when money has not arrived.    |
| Speak my correct name or CNIC (microphone) | `api.transcribe` + `api.extract`. Shown only when an officer asked for information.         | Fix a detail by voice.                     |
| Name and CNIC inputs                       | Typed correction. Client-only until sent.                                                   | Fix a detail by typing.                    |
| Send again                                 | `api.grantConsent` for missing permissions, then `api.resubmit` (POST /cases/:id/resubmit). | Answers the officer without a new claim.   |

## /citizen/scam

| Control                         | What it does                                                                                            | Why it is there                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Back, Listen                    | As above.                                                                                               | Navigation and audio.                                  |
| Message box                     | Paste or type the suspicious message.                                                                   | The thing to check.                                    |
| Check                           | `api.scamCheck` (POST /ai/scam-check); verdict is shown and spoken.                                     | Tells her if a message is real, a scam, or unsure.     |
| Show this message to an officer | `api.reportScam` (POST /ai/scam-report); numbers are masked on the server. Hidden for genuine messages. | "Not sure" ends with a person, and feeds the Scam Map. |

## /citizen/ask

| Control                             | What it does                                                    | Why it is there                                                         |
| ----------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Back, Listen                        | As above.                                                       | Navigation and audio.                                                   |
| Microphone                          | Records; `api.transcribe`, then `api.assist` (POST /ai/assist). | Ask a question by voice.                                                |
| Six ready questions                 | Each sends that question to `api.assist`.                       | She may not know what to ask.                                           |
| Typed question + Ask                | `api.assist`.                                                   | For people who prefer typing.                                           |
| Answer, "what was checked", sources | Read-only; spoken. Shows the policy text the answer came from.  | Answers come from program documents, with proof; unsure answers say so. |

## /citizen/consents (My data and permission)

| Control                                               | What it does                                                                                                      | Why it is there                                                                  |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Back, Listen                                          | As above. Loads `api.consents` (GET /consents).                                                                   | Navigation and audio.                                                            |
| Give permission (per purpose)                         | `api.grantConsent` (POST /consents).                                                                              | She can allow a check she refused before.                                        |
| Take back (per purpose)                               | Opens a spoken warning of what will stop. Client-only.                                                            | She hears the effect before deciding.                                            |
| Yes, take back / Cancel                               | `api.withdrawConsent` (POST /consents/:id/withdraw), or closes.                                                   | Consent is hers to withdraw at any time.                                         |
| Which one is wrong? (name, CNIC, district, household) | Picks the field. Client-only.                                                                                     | She can say her record is wrong.                                                 |
| Note box + Send                                       | `api.requestCorrection` (POST /consents/correction-request); written to the audit log (no staff list screen yet). | A recorded request; she cannot edit identity herself, so nobody else can either. |

## /helper

| Control        | What it does                                                                             | Why it is there                                            |
| -------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Listen         | Reads the title.                                                                         | Audio everywhere.                                          |
| Demo PIN note  | Lists the five seeded family PINs. Read-only.                                            | Judges can try Helper Mode; real PINs stay secret.         |
| Family buttons | Loads `api.families` (GET /auth/families); picks a family. Locked families are disabled. | A shopkeeper helps several families.                       |
| PIN pad        | `api.actFor` (POST /auth/act-for); opens the citizen screens as that family.             | The family's PIN is her consent; five wrong tries lock it. |
| Back           | Returns to the family list. Client-only.                                                 | Wrong family picked.                                       |

## /officer (review queue)

| Control                                              | What it does                                                                             | Why it is there                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Refresh                                              | Reloads `api.staffQueue` (GET /queue).                                                   | See new cases.                                                      |
| Scan for fraud rings                                 | `api.anomalyScan` (POST /cases/anomaly-scan); lists signals found.                       | Finds linked claims (shared phone, account) a single review misses. |
| Sort: Priority / Lowest confidence / Longest waiting | Reorders the list. Client-only.                                                          | Officer picks what matters first.                                   |
| Case row                                             | Opens the case (`api.staffCase`, GET /cases/:id). No names in the list.                  | Least data shown until a case is opened.                            |
| Back to the queue (phones)                           | Closes the case. Client-only.                                                            | One column on small screens.                                        |
| Approve                                              | `api.approve` (POST /cases/:id/approve).                                                 | A person decides what the rules were unsure about.                  |
| Reject…                                              | Needs a reason; `api.reject` (POST /cases/:id/reject).                                   | The citizen hears why.                                              |
| Ask for info…                                        | Needs a message; `api.requestInfo` (POST /cases/:id/request-info).                       | Fix a missing detail without rejecting.                             |
| Assign to me                                         | `api.assign` (POST /cases/:id/assign).                                                   | Two officers do not work the same case.                             |
| Escalate…                                            | Needs a reason; `api.escalate` (POST /cases/:id/escalate). Moves the case to the top.    | Hard cases get a second look.                                       |
| Close case…                                          | Optional note; `api.closeCase` (POST /cases/:id/close). Only for paid or rejected cases. | Tidy end of a case.                                                 |
| Decision, fraud signals, AI notes, timeline          | Read-only cards.                                                                         | Officer sees why the engine was unsure and all the AI heard.        |

## /officer/payments

| Control                            | What it does                                                                | Why it is there                                    |
| ---------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------- |
| State filter                       | Reloads `api.payments` (GET /payments?state=).                              | Find held or failed payouts fast.                  |
| Release… (held)                    | Needs a note; `api.release` (POST /payments/:id/release).                   | A held payout needs a named person and a reason.   |
| Approve (awaiting approval)        | `api.approvePayment` (POST /payments/:id/approve). The releaser is refused. | Four-eyes: two different people for risky money.   |
| Ask bank (inquiry) (unknown)       | `api.paymentInquiry` (POST /payments/:id/inquiry). Never sends money.       | After a timeout, ask before paying again.          |
| Retry… (failed) + corrected number | `api.paymentRetry` (POST /payments/:id/retry), same payment reference.      | Pay once, never twice; fix a wrong mobile account. |

## /admin (Rules and costs)

| Control                     | What it does                                                                                    | Why it is there                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Monthly amount              | Number input on the draft. Loads `api.rules` (GET /rules).                                      | The benefit amount is policy, not code.                          |
| Threshold inputs per clause | Edit the numbers in each rule. Client-only until simulated.                                     | Policy staff change rules without a developer.                   |
| Run Digital Twin            | `api.draftRule` (POST /rules/versions) then `api.simulate` (POST /rules/versions/:id/simulate). | See how past decisions would change before going live.           |
| Undo changes                | Resets the form to the live rule. Client-only.                                                  | Abandon an edit.                                                 |
| Publish v… / Publish now    | `api.publish` (POST /rules/versions/:id/publish) after a confirm.                               | Rules are versioned; old decisions keep their version.           |
| Three cost inputs           | Wrong approval, human review, asking for info. Loads `api.costs` (GET /cost-settings).          | The auto-approve threshold comes from stated costs, not a guess. |
| Save costs                  | `api.setCosts` (PUT /cost-settings).                                                            | New threshold applies to new decisions.                          |

## /admin/ai

| Control                                 | What it does                                    | Why it is there                                           |
| --------------------------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Kill AI… / Kill AI (confirm)            | `api.setKill(true)` (POST /ai/kill-switch).     | One switch turns every model off; claims go to people.    |
| Turn AI on                              | `api.setKill(false)`.                           | Undo the kill switch.                                     |
| Profile radio (Build, Judging, Offline) | `api.setProfile` (POST /ai/profile).            | Choose which model providers are tried first, or none.    |
| Provider tables and counters            | Read-only from `api.aiStatus` (GET /ai/status). | Shows keys set, circuit breakers, fallbacks and failures. |

## /admin/money

| Control            | What it does                                                  | Why it is there                                             |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------- |
| Refresh            | Reloads `api.balances` (GET /ledger/balances).                | Shows the double-entry ledger balances.                     |
| Run reconciliation | `api.reconcile` (POST /reconciliation/run); lists mismatches. | Proves every payout matches the (simulated) bank statement. |

## /admin/eval (admin and auditor)

| Control                                         | What it does                                                                                                 | Why it is there                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Run evaluation now (admin only)                 | `api.runEval` (POST /eval/run).                                                                              | Measures the engine on held-out synthetic claims.                                           |
| Result tiles, live panel, AI quality, past runs | Read-only: `api.evalRuns`, `api.evalRun`, `api.evalSummary` (GET /eval/…), `api.aiQuality` (GET /ai/status). | Wrong approvals, false alarms, calibration and cost, with a warning that data is synthetic. |

## /admin/scams (Scam Map: admin, officer, auditor)

| Control                                   | What it does                                                              | Why it is there                                                |
| ----------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Load sample messages (admin only)         | `api.scamSamples` (GET /ai/scam-samples), then `api.scamCheck` for each.  | Fills the map with synthetic messages for a demo.              |
| Charts and tables                         | Read-only from `api.scamMap` (GET /audit/scam-map), refreshed every 15 s. | Shows which scams hit which districts this week.               |
| Confirmed scam / Genuine (officer, admin) | `api.resolveScamReport` (POST /audit/scam-reports/:id/resolve).           | A person labels what citizens reported; measures false alarms. |

## /admin/users (Team)

| Control                  | What it does                                                       | Why it is there                                     |
| ------------------------ | ------------------------------------------------------------------ | --------------------------------------------------- |
| Role dropdown per person | `api.updateTeamMember` (PATCH /users/:id). Not shown for yourself. | Least privilege; change what a person may do.       |
| Disable / Enable         | `api.updateTeamMember` with `active`. Disable asks to confirm.     | Remove access when someone leaves.                  |
| Name, mobile, role + Add | `api.addTeamMember` (POST /users).                                 | Admin adds officers, helpers, auditors.             |
| Password box + Copy      | Shows the new password once; Copy is client-only.                  | Stored only as a hash, so it cannot be shown again. |

## /admin/tenants (Programs)

| Control                                                              | What it does                                                                         | Why it is there                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Show (usage)                                                         | `api.tenantUsage` (GET /tenants/:id/usage). List from `api.tenantMe`, `api.tenants`. | Requests, errors and AI calls per program.      |
| Launch form: name, type, monthly limit, admin name, mobile, password | Inputs. Shown to the platform admin only.                                            | One platform can host many relief programs.     |
| Launch program                                                       | `api.launchProgram` (POST /tenants).                                                 | Creates a separate tenant with its first admin. |

## /admin/keys (Partner API keys)

| Control          | What it does                                                                                       | Why it is there                                           |
| ---------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Partner name     | Text input.                                                                                        | Each key belongs to a named partner.                      |
| Scope boxes      | "Check messages for scams" is enforced on POST /ai/scam-check. "Read claim status" is stored only. | A key can do only what it is scoped for.                  |
| Create key       | `api.createKey` (POST /api-keys); the key is shown once.                                           | Banks and telcos call the scam check from their own apps. |
| Revoke… / Revoke | `api.revokeKey` (DELETE /api-keys/:id).                                                            | Cut off a partner at once.                                |

## /admin/webhooks

| Control                     | What it does                                                 | Why it is there                                       |
| --------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| Partner endpoint + Register | `api.createWebhook` (POST /webhooks).                        | Partners are told when a payment changes, no polling. |
| Show (deliveries)           | `api.webhookDeliveries` (GET /webhooks/:id/deliveries).      | Every attempt is logged.                              |
| Resend                      | `api.resendDelivery` (POST /webhooks/deliveries/:id/resend). | Recover when the partner was down.                    |

## /admin/docs

| Control                  | What it does                                                                            | Why it is there                               |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------- |
| Open docs (per service)  | Opens `/api/docs/<service>` in a new tab. Status from `api.systemStatus` (GET /status). | Partners and judges can read and try the API. |
| /api/status link         | Opens the health report.                                                                | Shows which services are up.                  |
| Copy (two curl examples) | Copies the text. Client-only.                                                           | Try the partner flow from a terminal.         |
| API keys, Webhooks links | Links to those screens.                                                                 | Next steps of the partner flow.               |

## /judge (Judge Mode, admin)

| Control                    | What it does                                                                                          | Why it is there                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Mock phone                 | Link to /phone.                                                                                       | See the SMS a family receives.                              |
| Reset demo… / Reset        | `api.resetDemo` (POST /judge/reset). Clears claims, payouts, consents; keeps the audit log.           | A clean start between judges.                               |
| Four "break Raast" buttons | `api.setRailFault` (POST /mock/faults): down, timeout, timeout after debit, duplicate statement line. | Judges break the mock bank rail and watch money stay safe.  |
| Break the next N calls     | Dropdown, 1 to 5. Client-only until a fault is set.                                                   | The fault heals by itself.                                  |
| Reset rail / Refresh       | `api.setRailFault('none')`; `api.railFaults` (GET /mock/faults).                                      | Put the rail back.                                          |
| Run (per scenario)         | `api.runScenario` (POST /judge/scenarios/:id/run); shows each step and pass or fail.                  | Each challenge is proved end to end through the public API. |

## /phone (Mock phone, admin)

| Control                    | What it does                                                | Why it is there                                            |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| Zainab / Rashida / Nasreen | Loads that inbox: `api.inbox` (GET /mock/sms/inbox/:phone). | Shows the simulated SMS a family would get.                |
| Refresh                    | Reloads the inbox.                                          | New messages after a payout.                               |
| Is this real?              | `api.scamCheck` on that message.                            | A genuine Haqdaar SMS carries a seal the check can verify. |

## /auditor (Audit log: auditor and admin)

| Control                                                              | What it does                                                                  | Why it is there                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- |
| Verify chain                                                         | `api.verifyChain` (POST /audit/verify-chain).                                 | Proves no entry was edited or removed.                   |
| Totals row                                                           | Read-only from `api.auditStats` (GET /audit/stats).                           | Volume at a glance.                                      |
| Quick filters (Everything, Decisions, AI actions, Consent, Payments) | Reload `api.audit` (GET /audit) by event type.                                | Find a kind of event fast.                               |
| Exact event type, Case / payment id + Filter                         | `api.audit` with those filters.                                               | Follow one claim or payout.                              |
| entry                                                                | `api.auditEntry` (GET /audit/:eventId).                                       | Read one record in full.                                 |
| trace                                                                | `api.staffCase`, `api.decisionTrace` (GET /decisions/:id/trace), `api.audit`. | Shows which rule version and inputs produced a decision. |
| Raw JSON (names masked)                                              | Expands the trace as JSON. Client-only.                                       | Evidence an auditor can copy.                            |
| Close                                                                | Closes the entry or trace. Client-only.                                       | Back to the list.                                        |
| Newest / Older                                                       | Pages through `api.audit` by cursor.                                          | The log is long.                                         |

## /offline

| Control              | What it does                                     | Why it is there                   |
| -------------------- | ------------------------------------------------ | --------------------------------- |
| Listen               | Speaks the offline message from recorded audio.  | She hears that her claim is safe. |
| Go to the first page | Link to /citizen (cached by the service worker). | A way forward with no network.    |

## Added in the last build

| Screen                | Control                                         | What it does                                                                 | Why it is there                                                   |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| /login                | "Forgot your PIN?"                              | Opens /forgot-pin: phone, texted code, new PIN                               | A citizen who forgets her PIN is not locked out                   |
| /forgot-pin           | Phone, code and PIN pads                        | Sends a reset code, checks it, saves the new PIN and signs her in            | Only the holder of the phone can change the PIN; old sessions end |
| /citizen/status       | "Correct your details" (microphone, name, CNIC) | Sends a corrected name or CNIC when an officer asked for information         | A wrong number is fixed by her, checked by an officer             |
| /citizen/status       | Haqdaar Seal with QR on the receipt             | Shows the sealed receipt code and a QR of the sealed text                    | Anyone can prove the receipt is genuine                           |
| /citizen/status       | "The money has not reached you yet" card        | Explains a held, failed or unconfirmed payout                                | She knows what is happening and what to do                        |
| /citizen/consents     | "Let a helper act for you"                      | Links a registered helper to her with a PIN she chooses                      | The family, not the helper, decides who may act for it            |
| /officer              | "Citizens say their information is wrong"       | Lists correction requests with field and note                                | Requests reach an officer, who asks through the claim             |
| /officer              | "Back to the queue" (phones)                    | Closes the open case and shows the list again                                | On a phone the case opens in place of the list                    |
| /officer/payments     | Corrected number in Release and Retry           | Releases or resends to a new number if the account is in the claimant's name | A wrong payout number is fixed without paying a stranger          |
| Admin side navigation | Queue, Payments                                 | Opens the officer screens for the admin                                      | Judge Mode steps that say "officer > Payments" are reachable      |
