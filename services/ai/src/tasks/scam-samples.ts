import { sealMessage } from '@haqdaar/nest-kit';

/** One synthetic message for the Scam Map demo, with the district it is "received" in. */
export interface ScamSample {
  text: string;
  district: string;
}

const DAY_MS = 86_400_000;
/** A code in the right shape that no secret ever signed: the seal layer calls it forged, no model needed. */
const FORGED = 'Haqdaar code: HQ1-20991231-AAAAAAAAAA';

/** Real program wording; each one gets a fresh, valid Haqdaar code. */
const GENUINE: ScamSample[] = [
  { district: 'Thatta', text: 'Sahara Relief: Rs 12,000 has been sent to your account.' },
  { district: 'Thatta', text: 'سہارا ریلیف: آپ کی درخواست موصول ہو گئی ہے۔ کوئی فیس نہیں ہے۔' },
  { district: 'Thatta', text: 'Sahara Relief: aap ki darkhwast manzoor ho gayi hai.' },
  {
    district: 'Badin',
    text: 'Sahara Relief: your claim is with an officer. You do not need to do anything.',
  },
  { district: 'Badin', text: 'سہارا ریلیف: آپ کی رقم بھیج دی گئی ہے۔' },
  { district: 'Sukkur', text: 'Sahara Relief: aap ki raqam aap ke account mein aa gayi hai.' },
  { district: 'Sukkur', text: 'Sahara Relief: your payment is on its way and will arrive today.' },
  { district: 'Hyderabad', text: 'سہارا ریلیف: افسر آپ کی درخواست دیکھ رہا ہے۔' },
  { district: 'Hyderabad', text: 'Sahara Relief: we received your claim. This service is free.' },
  {
    district: 'Karachi West',
    text: 'Sahara Relief: Rs 12,000 aap ke account mein bhej diye gaye hain.',
  },
  { district: 'Karachi West', text: 'Sahara Relief: your details were corrected by an officer.' },
  { district: 'Karachi East', text: 'سہارا ریلیف: آپ کی شکایت درج ہو گئی ہے۔' },
];

/** Scam wording carrying a made-up code: caught by the seal layer, red flags still listed. */
const FORGED_SCAMS: ScamSample[] = [
  { district: 'Thatta', text: 'BISP: Rs 25,000 manzoor. Apna PIN code bhej dein.' },
  { district: 'Thatta', text: 'مبارک ہو! آپ کا انعام نکلا ہے۔ اپنا پن کوڈ بھیجیں۔' },
  { district: 'Thatta', text: 'Ehsaas: pay Rs 500 registration fee today to receive Rs 12,000.' },
  { district: 'Thatta', text: 'Sahara: raqam lene ke liye foran 1000 rupay easypaisa kar dein.' },
  {
    district: 'Thatta',
    text: 'Urgent: your relief is blocked. Open http://sahara-relief.xyz now.',
  },
  { district: 'Badin', text: 'احساس پروگرام: رقم کے لیے پہلے 2000 روپے فیس جمع کرائیں۔' },
  { district: 'Badin', text: 'Benazir lucky draw winner! Send your OTP to claim the prize.' },
  { district: 'Badin', text: 'BISP: aaj hi apna OTP bata dein warna raqam wapas ho jayegi.' },
  {
    district: 'Sukkur',
    text: 'Congratulations, you won a lottery of Rs 50,000. Pay the processing charges first.',
  },
  { district: 'Sukkur', text: 'آپ کی لاٹری نکلی ہے۔ فوراً رابطہ کریں اور فیس بھیجیں۔' },
  {
    district: 'Sukkur',
    text: 'Ehsaas: verify your account at www.ehsaas-pay.top within 24 hours.',
  },
  {
    district: 'Hyderabad',
    text: 'Sahara officer here. Tell me your password to release the money.',
  },
  { district: 'Hyderabad', text: 'BISP inaam: 30,000 rupay. Fees jama kar ke code bhej dein.' },
  { district: 'Hyderabad', text: 'خفیہ کوڈ بتائیں ورنہ آپ کی رقم آج ہی بند ہو جائے گی۔' },
  {
    district: 'Karachi West',
    text: 'Last chance: click bit.ly/relief-now to get your Benazir payment.',
  },
  {
    district: 'Karachi West',
    text: 'Ehsaas: mubarak ho, inaam ke liye abhi processing fee bhej den.',
  },
  { district: 'Karachi West', text: 'آپ کا او ٹی پی بھیجیں، آپ کی امداد فوری جاری ہو گی۔' },
  { district: 'Karachi East', text: 'BISP: urgent, send your CVV and PIN to unlock Rs 12,000.' },
];

/** No code at all, so the rules and the model decide: the only ones that use AI quota. */
const UNSEALED: ScamSample[] = [
  {
    district: 'Thatta',
    text: 'BISP: aap ka inaam nikla hai. Foran PIN bhej dein aur 500 fees jama karein.',
  },
  { district: 'Badin', text: 'احساس: انعام کے لیے فوراً اپنا پن کوڈ بھیجیں اور فیس جمع کرائیں۔' },
  {
    district: 'Sukkur',
    text: 'You are a lucky draw winner. Pay the registration fee at http://prize-pk.xyz',
  },
  { district: 'Hyderabad', text: 'Ehsaas: urgent, share your OTP now or lose your payment.' },
  {
    district: 'Karachi West',
    text: 'Sahara: paise lene ke liye pehle 1500 processing charges bhej den.',
  },
  { district: 'Karachi East', text: 'مبارک ہو، لاٹری نکلی ہے۔ آج ہی فیس بھیجیں ورنہ انعام ختم۔' },
  { district: 'Thatta', text: 'Ammi, main shaam ko ghar aa jaunga. Khana rakh dena.' },
  { district: 'Badin', text: 'Your electricity bill for this month is ready at the office.' },
  { district: 'Sukkur', text: 'کل صبح سکول میں والدین کا اجلاس ہے۔' },
  { district: 'Karachi West', text: 'Doctor sahib kal subah das baje clinic mein honge.' },
];

/**
 * The fixed demo set for "Load 40 sample messages". Thirty of the forty are settled by the seal
 * alone, so filling the map costs at most ten model calls. All text is synthetic.
 */
export function scamSamples(sealSecret: string, now = new Date()): ScamSample[] {
  const expiry = new Date(now.getTime() + 30 * DAY_MS);
  return [
    ...GENUINE.map((s) => ({ ...s, text: sealMessage(s.text, sealSecret, expiry) })),
    ...FORGED_SCAMS.map((s) => ({ ...s, text: `${s.text}\n${FORGED}` })),
    ...UNSEALED,
  ];
}
