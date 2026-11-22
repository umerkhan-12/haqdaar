# Sahara Relief Programme: the programme Haqdaar runs

> **Fictional programme for a prototype.** The department, the rules, the districts, the amounts and every person below are invented for the hackathon. This is not a real government scheme and not Pakistani law.

Haqdaar is the platform. **Sahara Relief Programme** is the programme registered on it. Another department could register its own programme on the same platform (Admin → Programs) with its own rules, staff and data.

## 1. Programme at a glance

| Item                | Value                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Programme           | Sahara Relief Programme (rule set "Sahara v1", published)                                                                                                               |
| Run by              | Provincial Social Protection Department (fictional). On the admin panel: Admin → Programs → "Sahara Relief Department"; its live rule is Admin → Rules → "Live rule v1" |
| Purpose             | Monthly cash relief for widows and large low-income households after the coastal floods                                                                                 |
| Benefit             | PKR 12,000 per approved household per month, paid in full to the claimant's own account                                                                                 |
| Districts           | Thatta, Sujawal, Badin, Tharparkar, Karachi West                                                                                                                        |
| How to apply        | By voice or typing in the Haqdaar app, on her own phone or with a registered helper                                                                                     |
| Cost to the citizen | Nothing. No fee, no agent's share. Any message asking for a fee is a scam                                                                                               |
| Decision time       | At once when the rules are met and identity is certain; otherwise an officer within 3 working days                                                                      |
| Where to see it     | Admin → Rules (the rule set), Admin → Programs (the programme), Citizen → Ask (the policy)                                                                              |

## 2. Who is eligible

All four rules must be true. They are stored as data, so the department can change them without a programmer (Admin → Rules, tested first in the Digital Twin).

| #   | Rule                                                                 | Checked against                       |
| --- | -------------------------------------------------------------------- | ------------------------------------- |
| 1   | The applicant is alive                                               | Identity record (simulated NADRA)     |
| 2   | The household lives in a programme district                          | Household record (simulated registry) |
| 3   | The applicant is a widow, **or** the household has 5 or more members | Identity record and household record  |
| 4   | Monthly household income is below PKR 40,000                         | Household record                      |

Also:

- One claim per CNIC per month. A second claim goes to an officer.
- The payout account must be in the claimant's own name.
- The claimant must give consent for the identity check and the household data check. She can take it back.

## 3. What the applicant gives

| What                        | How                                                            | Why                                              |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------------ |
| Full name                   | Spoken, typed or read from the card                            | Matched with the identity record                 |
| CNIC number                 | Spoken, typed or read from the card photo                      | Identity check; one claim per CNIC               |
| District and household size | Spoken or typed                                                | Compared with the household record               |
| Mobile account number       | Typed (her wallet or bank account linked to her mobile number) | Where the money is sent                          |
| Card photo (optional)       | Camera                                                         | Fewer spelling mistakes; edited cards are caught |
| Consent                     | Two boxes she ticks herself                                    | The programme may not check records without it   |

She does not bring an income paper: income comes from the household record.

## 4. How a claim is decided

1. **Listen and fill.** The AI turns her speech into the form fields and reads them back. The AI never approves or rejects.
2. **Check the records.** Identity and household records are read (with consent).
3. **Apply the rules.** A rule engine applies the four rules and writes down which passed.
4. **How sure are we?** A confidence is computed from name match, record match and data quality.
5. **Three lanes.**
   - **Approved automatically:** all rules pass, confidence is at or above 0.988, and there is no warning flag.
   - **Ask for more:** something small is missing; she is asked for it.
   - **An officer decides:** any rule fails, the software is not sure, or there is a warning flag (second claim this month, shared payout account, first claim of a new account, name spelled differently, card looks edited). The software never rejects; only an officer can say no.
6. **Pay.** The bank is asked whose name is on the mobile account. Only a match is paid. Larger or held payments need a second officer.
7. **Receipt.** She gets the Haq Receipt: the exact amount, in digits and words, with a seal that proves the message is genuine.
8. **Log.** Every step is written to a log that cannot be changed quietly.

Why 0.988: a wrong approval costs the programme about PKR 25,000 and an officer's review about PKR 300, so the software approves alone only when it is almost certain (Admin → Rules → "Cost of being wrong").

## 5. Roles in the programme

| Role               | Who (demo account) | What they may do                                                            |
| ------------------ | ------------------ | --------------------------------------------------------------------------- |
| Citizen            | Zainab             | Claim, see status, check messages, ask, control her data                    |
| Community helper   | Asif, a shopkeeper | Act for a family only with that family's PIN; every action is in his name   |
| Department officer | Sana, Kamran       | Review, approve, reject, ask for more; release held payments (two officers) |
| Programme admin    | Hira               | Rules, staff, AI switch, API keys, programmes                               |
| Auditor            | Bilal              | Read-only: the log, consents, AI decisions                                  |

## 6. Test people (all synthetic)

Use these to test each rule. Log in as **Helper Asif** to claim for the families that have a PIN, or sign up a new account and type the details.

| Person                    | CNIC            | District     | Status  | Household | Income | Mobile account | What should happen                                                                                                         |
| ------------------------- | --------------- | ------------ | ------- | --------- | ------ | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Zainab Bibi               | 42201-1234567-4 | Thatta       | Widow   | 5         | 18,000 | 03001110001    | **Eligible.** All four rules pass                                                                                          |
| Rashida Begum             | 42201-7654321-2 | Karachi West | Married | 7         | 22,000 | 03001110007    | **Eligible.** Not a widow, but 7 members                                                                                   |
| Nasreen Bi Bi             | 42401-3344556-6 | Karachi West | Widow   | 8         | 16,000 | 03451234504    | **Eligible.** Name is written "Bi Bi" in the record: tests name matching                                                   |
| Zainab Bibi (Badin)       | 41201-4455667-2 | Badin        | Married | 4         | 35,000 | 03121234501    | **Officer.** Rule 3 fails: not a widow and fewer than 5 members                                                            |
| Muhammad Akram            | 41101-2233445-1 | Hyderabad    | Married | 6         | 28,000 | 03211234502    | **Officer.** Rule 2 fails: Hyderabad is not a programme district                                                           |
| Mohammad Akram            | 41101-5566778-3 | Hyderabad    | Married | 3         | 52,000 | 03331234503    | **Officer.** Rules 2, 3 and 4 fail. Same name as the man above, spelled differently                                        |
| Shazia Bibi (شازیہ بی بی) | 43201-1122334-8 | Sukkur       | Widow   | 5         | 20,000 | 03011234505    | **Officer.** Rule 2 fails. Her record is in Urdu script: tests name matching                                               |
| Kaneez Fatima             | 42101-6677889-4 | Karachi East | Widow   | 6         | 19,000 | 03151234506    | **Officer.** Rule 2 fails (Karachi East). Try the spelling "Kaneez Fatma"                                                  |
| Ghulam Rasool             | 44201-9988776-5 | Larkana      | Married | 4         | 12,000 | none           | **Officer.** Rule 1 fails: the identity record says deceased. Someone is using a dead man's card                           |
| Fraud account             | —               | —            | —       | —         | —      | 03009990000    | Account title is "MUHAMMAD ASLAM". Use it as the payout number for anyone else: the payout is **held** for a name mismatch |

Notes for testing:

- These people have already claimed during development, so a new claim this month for the same CNIC goes to an officer with "Second claim this month". That is rule "one claim per CNIC per month" working, not an error. To see an automatic approval, run **Judge Mode → challenge 01**, which resets its own test person first.
- A brand-new sign-up is never approved automatically on its first claim (it could be a stranger's CNIC). An officer approves it.
- A made-up CNIC that is in no record goes to an officer with "identity not found".

## 7. Complaints, corrections and appeals

- **Wrong data:** she reports what is wrong ("My information is wrong"); officers see the request on their queue and ask her through the claim. She then says or types the corrected name or CNIC, and the officer decides. After an officer has approved her identity, only an officer can change the CNIC.
- **Forgotten PIN:** a code is texted to her phone and she chooses a new PIN; all earlier sessions end.
- **Rejected:** the reason is given in plain words and she may claim again with corrected details or ask an officer to look again.
- **Payment not received:** Status shows where the money is. Her status screen says plainly when a payout is held or failed. If the bank has no account on her number, or the account is in another name, the officer asks her for the correct number and releases or resends the payout to it; it is paid only if that account is in her own name.
- **Suspicious message:** "Is this message real?" checks it and can send it to an officer; reports appear on the Scam Map.

## 8. People with no bank account or mobile wallet

**Not built in this prototype.** The brief asks for one task done end to end, and it does not ask for cash collection; the prototype pays to an account only.

How the programme would do it (design):

1. At the claim she chooses "I have no account: cash".
2. After approval she gets the Haq Receipt as a **one-time cash code and QR** with the Haqdaar Seal, valid for a few days.
3. She goes to an **authorised cash point** (a bank agent or a government service counter), not to the helper. The helper never handles cash: he already fills in claims, so letting him also pay them out would let one person both create and collect a payment.
4. The cash point scans the QR. Haqdaar checks the seal, that the code is unused, and her identity (CNIC, and a fingerprint in a real deployment).
5. The screen and her phone **speak the exact amount** before the cash is handed over, so nobody can keep a share.
6. The code is used up, the cash point's float is debited, and the handover is written to the audit log.

The parts this needs already exist in the prototype: the sealed receipt, the amount in words, the two-person control and the audit log.

## 9. What is real and what is simulated

Real in the prototype: the rule engine, the confidence and lanes, the Urdu speech in and out, the card check, the scam check and seal, consent, roles, the audit chain. Simulated: the identity record, the household registry, the bank and its account titles, SMS. Details: `docs/REAL_VS_SIMULATED.md`.
