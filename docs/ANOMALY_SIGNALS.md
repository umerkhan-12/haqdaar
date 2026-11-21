# Case anomaly review signals

Anomaly signals add evidence for an officer. They never reject a claim, reverse a past decision, or cancel a settled payment. Automated decisions and on-demand scans use only the cases service's own tenant-scoped data.

## Signals and thresholds

All signals consider relief claims created in the preceding 30 days and exclude `DRAFT`, `REJECTED`, and `CLOSED` cases. Counts use distinct CNIC HMACs or case IDs, never plaintext CNICs. Open cases (`SUBMITTED`, `PROCESSING`, `NEEDS_INFO`, `IN_REVIEW`) receive findings; `APPROVED` and `PAID` records can corroborate a pattern but are not changed by a scan.

| Signal               |                Default threshold |   Window | Evidence rule                                                                                                                                           |
| -------------------- | -------------------------------: | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared_payout`      |      More than 2 distinct people |  30 days | Same normalized alias or same normalized IBAN. Alias and IBAN are separate namespaces; the cases service does not guess that they refer to one account. |
| `helper_velocity`    |     More than 10 distinct people |   1 hour | Same authenticated helper ID, counted by distinct CNIC HMAC. Re-filing for the same family does not count twice.                                        |
| `household_pattern`  |       At least 5 distinct people | 24 hours | Same normalized district and stated household size. This is a review lead, not proof of fraud.                                                          |
| `identity_collision` | At least 2 corroborating details |  30 days | Same normalized name and district under different CNIC hashes, plus at least two of: same payout destination, same helper, same household size.         |

The thresholds are configurable through `ANOMALY_SHARED_PAYOUT_PEOPLE`, `ANOMALY_HELPER_CLAIMS_PER_HOUR`, `ANOMALY_HOUSEHOLD_PATTERN_PEOPLE`, and `ANOMALY_IDENTITY_CORROBORATION_DETAILS`. Claim-time district, household size, normalized name, helper ID, and a namespaced HMAC payout key are stored on each case so later profile edits do not rewrite the evidence.

## What the claimant sees

Nothing about the check. Anomaly flags, findings and `anomaly.detected` timeline entries are returned to officers, admins and auditors only. The decision explanation stored for a claim that only an anomaly flag sent to review is word for word the one an ordinary uncertain claim gets ("we are not fully sure, so an officer will check"); next to other reasons the anomaly flag adds no text. Naming the check would tell a ring what to change.

## When the check runs

**On every claim (cheap, no lock).** After the claim row is committed and before the decision is written, the service reads only the rows that share a key with this claim: same payout key, same helper (1 hour), same district + household size (24 hours), same name + district. That is at most four indexed lookups (`@@index` on each key with `created_at`), capped at 200 rows each, outside any transaction. The pure detector runs on those rows. A signal adds an `anomaly:<type>` hard flag to this claim's decision, so it goes to an officer. Because every claim is committed before it looks, the claim that completes a ring always sees the others; claims decided earlier, when the pattern did not exist yet, are not reopened. After the decision is committed, a short second transaction writes the evidence and adds the flag to the ring's other claims that are still open. It never changes a status or lane; if it fails the claim's own decision already carries the flag.

**On demand (`POST /cases/anomaly-scan`).** Tenant-scoped SQL `GROUP BY` aggregates first identify candidate clusters; the pure detector verifies them and builds evidence. It pages through claim snapshots in batches of 250. A PostgreSQL advisory transaction lock serializes scans with each other; claim submission never takes it. Evidence rows and `anomaly.detected` timeline entries are idempotent per case and signal group. Evidence contains affected case IDs, the fixed time window, observed count, and threshold; it contains no CNIC hashes, names, aliases, or IBANs. Staff can read it in the case detail and review queue; citizen views hide the finding and its case-to-case links.

## Judge Mode

Run Judge Mode scenario `c09-fraud-ring`. It submits claims for three different seeded synthetic beneficiaries to one shared demo alias, one after another. It checks that the third claim goes to an officer, that the family's own view of it shows no anomaly flag, evidence or wording, that the officer sees the flag with all three case IDs as evidence, and that a repeated scan creates no duplicates.

## API

`POST /cases/anomaly-scan` is available to officers and admins through the gateway. It scans only the caller's tenant and returns detected signal summaries. `GET /cases/:id` and `GET /queue` include anomaly evidence only for staff. Repeating a scan updates an existing finding without duplicating timeline entries.
