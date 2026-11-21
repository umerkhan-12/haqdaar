'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'ur' | 'en';

const M = {
  appName: ['حقدار', 'Haqdaar'],
  prototype: ['نمونہ — سرکاری سروس نہیں', 'PROTOTYPE — not an official government service'],
  switchLang: ['English', 'اردو'],
  listen: ['سنیں', 'Listen'],
  logout: ['باہر نکلیں', 'Log out'],
  back: ['واپس', 'Back'],
  retry: ['دوبارہ کوشش کریں', 'Try again'],
  loading: ['انتظار کریں…', 'Please wait…'],
  offline: ['انٹرنیٹ نہیں ہے۔ آپ کا کام فون میں محفوظ ہے۔', 'No internet. Your work is saved on this phone.'],
  error: ['کچھ مسئلہ ہوا۔ دوبارہ کوشش کریں۔', 'Something went wrong. Please try again.'],
  empty: ['ابھی یہاں کچھ نہیں ہے۔', 'Nothing here yet.'],
  forbidden: ['آپ کو اس کی اجازت نہیں ہے۔', 'You are not allowed to do this.'],

  loginTitle: ['اپنے فون نمبر سے داخل ہوں', 'Sign in with your phone number'],
  phone: ['فون نمبر', 'Phone number'],
  password: ['پاس ورڈ', 'Password'],
  signIn: ['داخل ہوں', 'Sign in'],
  wrongLogin: ['فون نمبر یا پاس ورڈ غلط ہے۔', 'Wrong phone number or password.'],
  demoAccounts: ['ڈیمو اکاؤنٹ (ایک ٹیپ)', 'Demo accounts (one tap)'],

  homeGreeting: ['السلام علیکم', 'Assalam-o-Alaikum'],
  claim: ['میرے پیسے کے لیے درخواست', 'Claim my money'],
  status: ['میرے پیسے کہاں ہیں؟', 'Where is my money?'],
  scam: ['کیا یہ پیغام اصلی ہے؟', 'Is this message real?'],

  recordHold: ['بٹن دبا کر رکھیں اور بولیں', 'Hold the button and speak'],
  recordHint: ['اپنا نام، شناختی کارڈ نمبر، ضلع اور گھر کے افراد بتائیں', 'Say your name, CNIC number, district and household size'],
  recording: ['سن رہے ہیں…', 'Listening…'],
  understanding: ['سمجھ رہے ہیں…', 'Understanding…'],
  typeInstead: ['لکھ کر بتائیں', 'Type instead'],
  aiUnsure: ['ہمیں پوری بات سمجھ نہیں آئی۔ براہ کرم تفصیل دیکھ لیں۔', 'We could not understand everything. Please check the details.'],
  checkDetails: ['اپنی تفصیل دیکھیں', 'Check your details'],
  fullName: ['پورا نام', 'Full name'],
  cnic: ['شناختی کارڈ نمبر', 'CNIC number'],
  district: ['ضلع', 'District'],
  household: ['گھر کے افراد', 'People in household'],
  payoutPhone: ['رقم اس نمبر پر (راست)', 'Send money to this number (Raast)'],
  next: ['آگے', 'Next'],
  photoTitle: ['شناختی کارڈ کی تصویر', 'Photo of your CNIC'],
  photoHint: ['کارڈ کو روشنی میں سیدھا رکھ کر سامنے والی طرف کی تصویر لیں', 'Hold the card flat in good light and photograph the front'],
  takePhoto: ['تصویر لیں', 'Take photo'],
  retakePhoto: ['دوبارہ تصویر لیں', 'Take the photo again'],
  skipPhoto: ['تصویر کے بغیر آگے بڑھیں', 'Continue without a photo'],
  photoChecking: ['تصویر جانچ رہے ہیں…', 'Checking the photo…'],
  photoOk: ['تصویر ٹھیک ہے', 'The photo is fine'],
  photoRetake: ['تصویر صاف نہیں۔ براہ کرم دوبارہ لیں۔', 'The photo is not clear. Please take it again.'],
  photoOfficer: ['ایک افسر آپ کا کارڈ دیکھے گا۔ آپ کی درخواست جاری رہے گی۔', 'An officer will look at your card. Your claim continues.'],
  consentTitle: ['اجازت', 'Your permission'],
  consentIdentity: ['نادرا سے میری شناخت کی تصدیق کی اجازت دیتی/دیتا ہوں', 'I allow checking my identity with NADRA'],
  consentHousehold: ['میرے گھر کی آمدنی کی معلومات دیکھنے کی اجازت دیتی/دیتا ہوں', "I allow checking my household's income records"],
  consentNote: ['آپ یہ اجازت کسی بھی وقت واپس لے سکتے ہیں۔', 'You can take this permission back at any time.'],
  send: ['درخواست بھیجیں', 'Send my claim'],
  sending: ['بھیج رہے ہیں…', 'Sending…'],
  savedOffline: ['درخواست فون میں محفوظ ہے۔ انٹرنیٹ آتے ہی خود بھیج دی جائے گی۔', 'Saved on your phone. It will be sent automatically when the internet is back.'],
  outboxPending: ['درخواستیں بھیجی جانی ہیں', 'claims waiting to be sent'],

  laneAUTO_APPROVE: ['منظور ہو گئی', 'Approved'],
  laneHUMAN_REVIEW: ['ایک افسر دیکھ رہا ہے', 'An officer is checking it'],
  laneASK_MORE: ['مزید معلومات چاہییں', 'More information needed'],
  statusPAID: ['رقم آپ کے اکاؤنٹ میں بھیج دی گئی', 'Money sent to your account'],
  statusAPPROVED: ['منظور — رقم بھیجی جا رہی ہے', 'Approved — money is on its way'],
  statusIN_REVIEW: ['ایک افسر آپ کی درخواست دیکھ رہا ہے', 'An officer is checking your claim'],
  statusNEEDS_INFO: ['ہمیں آپ سے مزید معلومات یا اجازت چاہیے', 'We need more information or your permission'],
  statusREJECTED: ['افسر نے درخواست منظور نہیں کی', 'An officer did not approve the claim'],
  statusSUBMITTED: ['درخواست موصول ہو گئی', 'Claim received'],
  waitingOfficer: ['انتظار کریں — فیصلہ ایک انسان کرے گا، مشین نہیں۔', 'Please wait — a person will decide, not a machine.'],
  noClaims: ['ابھی آپ کی کوئی درخواست نہیں۔', 'You have no claims yet.'],
  receiptTitle: ['حق رسید', 'Haq Receipt'],
  receiptLine: ['یہ پوری رقم آپ کی ہے۔ کوئی اس میں سے پیسے مانگے تو شکایت کریں۔', 'All of this money is yours. If anyone asks for a share, report it.'],
  rupees: ['روپے', 'rupees'],
  resubmit: ['اجازت دے کر دوبارہ بھیجیں', 'Give permission and resend'],
  ev_submitted: ['درخواست موصول ہوئی', 'Claim received'],
  ev_decided: ['فیصلہ ہوا', 'Decision made'],
  ev_approved: ['افسر نے منظور کیا', 'Approved by an officer'],
  ev_rejected: ['افسر نے منظور نہیں کیا', 'Not approved by an officer'],
  ev_paid: ['رقم بھیج دی گئی', 'Money sent'],
  ev_info_requested: ['مزید معلومات مانگی گئیں', 'More information requested'],
  ev_consent_withdrawn: ['آپ نے اجازت واپس لی', 'You withdrew permission'],

  scamPaste: ['مشکوک پیغام یہاں لکھیں یا چسپاں کریں', 'Paste or type the suspicious message'],
  check: ['جانچیں', 'Check'],
  verdictGENUINE: ['اصلی پیغام', 'Genuine message'],
  verdictSCAM: ['دھوکا! اس پر عمل نہ کریں', 'Scam! Do not act on it'],
  verdictUNSURE: ['یقین نہیں — افسر دیکھے گا', 'Not sure — an officer will check'],

  helperTitle: ['کس خاندان کی مدد کر رہے ہیں؟', 'Which family are you helping?'],
  enterPin: ['اس خاندان کا پن درج کریں', "Enter this family's PIN"],
  wrongPin: ['پن غلط ہے', 'Wrong PIN'],
  actingFor: ['آپ مدد کر رہے ہیں:', 'Acting for:'],
  switchFamily: ['خاندان بدلیں', 'Switch family'],
} as const;

export type MessageKey = keyof typeof M;

interface I18n {
  lang: Lang;
  t: (k: MessageKey) => string;
  toggle: () => void;
  speak: (text: string) => void;
}

const Ctx = createContext<I18n | null>(null);

/** Spoken Urdu for low-literacy users. Uses the phone's voice; Urdu if installed, else Hindi/English. */
export function speakText(text: string, lang: Lang): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const want = lang === 'ur' ? ['ur-PK', 'ur-IN', 'hi-IN'] : ['en-GB', 'en-US'];
  const voice = synth.getVoices().find((v) => want.some((w) => v.lang.toLowerCase() === w.toLowerCase()));
  u.lang = voice?.lang ?? want[0]!;
  if (voice) u.voice = voice;
  u.rate = 0.9;
  synth.speak(u);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('ur');

  useEffect(() => {
    const saved = localStorage.getItem('hq.lang');
    if (saved === 'en' || saved === 'ur') setLang(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
    localStorage.setItem('hq.lang', lang);
  }, [lang]);

  const t = useCallback((k: MessageKey) => M[k][lang === 'ur' ? 0 : 1], [lang]);
  const speak = useCallback((text: string) => speakText(text, lang), [lang]);
  const toggle = useCallback(() => setLang((l) => (l === 'ur' ? 'en' : 'ur')), []);

  return <Ctx.Provider value={{ lang, t, toggle, speak }}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
