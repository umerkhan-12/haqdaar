# Specimen CNIC cards for the demo

> **Never use a real CNIC in the demo. Not yours, not a teammate's, not a photo from the internet.**
> The brief says: "Use of real personal data will result in disqualification. Mock everything."
> One real card held up to the camera is enough to lose the whole submission.

The live demo uses only the synthetic specimen cards described here. They belong to a made-up person, Zainab Bibi, whose details are the same ones seeded in every mock service (`docs/CONTRACTS.md`).

## What the specimens are

The generator (`services/ai/src/vision/fixtures.ts`) draws a card with the same field layout, labels and date format as a Pakistani CNIC, so the OCR is tested on realistic input. It has **no emblem, no issuer marks and no security features**. The header reads **SAMPLE IDENTITY CARD — NOT A REAL CNIC**, and the photo box is a grey silhouette stamped **SAMPLE**. The QR code contains `HAQDAAR-SAMPLE|CNIC:<number>`.

Printed fields on the genuine specimen:

| Field | Value |
| ----- | ----- |
| Name | Zainab Bibi |
| Father Name | Allah Ditta |
| Gender | F |
| Country of Stay | Pakistan |
| Identity Number | 42201-1234567-4 |
| Date of Birth | 01.01.1980 |
| Date of Issue | 15.03.2021 |
| Date of Expiry | 15.03.2031 |

## How to produce them

Do this once on the demo laptop. It writes image files; it does not touch any service or database.

```bash
pnpm --filter @haqdaar/ai build
node services/ai/dist/vision/fixtures.js docs/demo/cards
```

Expected output: `Wrote 7 fixtures to docs/demo/cards`.

Do not commit the images unless the team decides to; they can always be regenerated.

## The seven files and what each one shows

| File | How it is made | What the system should do |
| ---- | -------------- | ------------------------- |
| `genuine.jpg` | The card saved like a phone photo (JPEG quality 75, camera-style EXIF). | Reads `42201-1234567-4` and "Zainab Bibi", QR matches, every check passes. The screen says "The photo is fine" and the name and number are filled in from the card. |
| `genuinePng.png` | The same card, lossless PNG. | Same as genuine. Shows that PNG uploads work. |
| `tampered.jpg` | The identity-number area is cut from a different card (Rashida Begum, `42201-7654321-2`) and pasted onto Zainab's card, then saved again at quality 95. | The printed number no longer matches the QR, and the pasted area shows up as an edited region. The screen says "An officer will look at your card. Your claim continues." The claim goes to the officer queue; nothing is rejected by the machine. |
| `blurred.jpg` | The genuine card with a strong blur. | "The photo is not clear. Please take it again." A blurry photo is never called a forgery. |
| `editedExif.jpg` | The genuine card with the EXIF software tag "Adobe Photoshop 25.1 (Windows)". | The picture looks fine but the file says it passed through an editor. Goes to an officer. |
| `mismatchedQr.jpg` | Zainab's printed number, but the QR encodes `42201-7654321-2`. | Printed number and QR disagree. Goes to an officer. |
| `expired.jpg` | Issue date 10.02.2012, expiry 10.02.2022. | The expiry check fails. Goes to an officer. |

In the officer's case panel, the "AI notes" card shows the number on the claim, the number printed on the card, the number inside the QR, the edit suspicion and blur scores, and which checks failed.

## Using them in the demo

- **On a laptop:** on the claim screen tap "Start with a photo of my CNIC", then "Take photo", and choose the file from `docs/demo/cards`.
- **On a phone:** open the image on a second screen (or print it) and photograph it. Room lighting and glare can blur the photo; if the app asks for a retake, that is the blur check working. Rehearse this with the actual phone and screen.
- Demo order that works: `genuine.jpg` for the happy path, `tampered.jpg` to show a forged card going to an officer, `blurred.jpg` to show the retake.
- Make sure nobody's real card, wallet or ID lanyard is in the camera frame.

## Limits to say out loud

- The checks are heuristics. They never reject; any doubt sends the claim to an officer.
- OCR reads the English text only.
- The specimens are clean, flat renderings. A real photo under bad light will read less reliably, which is why a failed read asks for a retake or a human instead of guessing.
- Under "Kill AI" the document check adds a failed `ai_available` check, so every card goes to an officer.
