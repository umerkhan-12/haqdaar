# Case anomaly review signals

Anomaly signals add evidence for an officer. They never reject a claim, reverse a past decision, or cancel a settled payment. Automated decisions and on-demand scans use only the cases service's own tenant-scoped data.

## Signals and thresholds

All signals consider relief claims created in the preceding 30 days and exclude `DRAFT`, `REJECTED`, and `CLOSED` cases. Counts use distinct CNIC HMACs or case IDs, never plaintext CNICs. Open cases (`SUBMITTED`, `PROCESSING`, `NEEDS_INFO`, `IN_REVIEW`) receive findings; `APPROVED` and `PAID` records can corroborate a pattern but are not changed by a scan.

| Signal               |                Default threshold |   Window | Evidence rule                                                                                                                                           |
| -------------------- | -------------------------------: | -------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared_payout`      |      More than 2 distinct people |  30 days | Same normalized alias or same normalized IBAN. Alias and IBAN are separate namespaces; the cases service does not guess that they refer to one account. |
| `helper_velocity`    |               More than 5 claims |   1 hour | Same authenticated helper ID and distinct case IDs. Idempotent retries retain one case ID.                                                              |
| `household_pattern`  |       At least 5 distinct people | 24 hours | Same normalized district and stated household size. This is a review lead, not proof of fraud.                                                          |
| `identity_collision` | At least 2 corroborating details |  30 days | Same normalized name and district under different CNIC hashes, plus at least two of: same payout destination, same helper, same household size.         |

The thresholds are configurable through `ANOMALY_SHARED_PAYOUT_PEOPLE`, `ANOMALY_HELPER_CLAIMS_PER_HOUR`, `ANOMALY_HOUSEHOLD_PATTERN_PEOPLE`, and `ANOMALY_IDENTITY_CORROBORATION_DETAILS`. Claim-time district, household size, normalized name, helper ID, and a namespaced HMAC payout key are stored on each case so later profile edits do not rewrite the evidence.

Tenant-scoped SQL `GROUP BY` aggregates first identify candidate clusters; the pure detector verifies them and builds evidence. It pages through claim snapshots in batches of 250. A PostgreSQL advisory transaction lock serializes anomaly scans and case decisions. Evidence rows and `anomaly.detected` timeline entries are idempotent per case and signal group. Evidence contains affected case IDs, the fixed time window, observed count, and threshold; it contains no CNIC hashes, names, aliases, or IBANs. Staff can read it in the case detail and review queue; citizen views hide the finding and its case-to-case links.

## Judge Mode

Run Judge Mode scenario `c09-fraud-ring`. It submits claims for three different seeded synthetic beneficiaries to one shared demo alias, runs the authenticated scan, and checks that the shared-payout finding points to all three case IDs and routes the open claims to human review.

## API

`POST /cases/anomaly-scan` is available to officers and admins through the gateway. It scans only the caller's tenant and returns detected signal summaries. `GET /cases/:id` and `GET /queue` include anomaly evidence only for staff. Repeating a scan updates an existing finding without duplicating timeline entries.
