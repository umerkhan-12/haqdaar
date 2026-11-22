# Live checks

These scripts drive the deployed site through its public API, the way a judge would. They create only synthetic test people.

```bash
B=https://172-198-74-124.sslip.io/api
node scripts/live/journey.mjs $B                      # new sign-up → claim → officer → payout → receipt
node scripts/live/worst.mjs $B                        # forged tokens, other people's data, bad input, races
node scripts/live/edge.mjs $B scripts/live/fixtures   # sign-up codes, PINs, names, phone-photo card scans
node scripts/live/ai.mjs $B . scripts/live/fixtures   # every AI feature, and Kill AI
node scripts/live/final.mjs $B .                      # correction, sealed receipt, held payout, PIN reset, helper link
```

Each line prints OK or FAIL with what was seen. Results of the last run are in `docs/TESTING.md`.
