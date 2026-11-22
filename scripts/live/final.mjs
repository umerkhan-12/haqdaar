// The features added in the last build, end to end on the live site. Usage: node final.mjs <base> <repoRoot>
import { readFileSync } from 'node:fs';
const [B, ROOT] = process.argv.slice(2);
let fails = 0;
const step = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail !== '' ? ' — ' + String(detail).replace(/\s+/g, ' ').slice(0, 160) : ''}`);
};
const call = async (method, path, { token, body, headers } = {}) => {
  const r = await fetch(B + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
};
const login = async (phone, password = 'demo1234') => (await call('POST', '/auth/login', { body: { phone, password } })).body?.accessToken;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const signup = async (name) => {
  const phone = '0349' + rnd(7);
  await call('POST', '/auth/signup/start', { body: { phone } });
  const code = String((await call('GET', `/mock/sms/signup/${phone}`)).body?.message?.body ?? '').match(/\b(\d{6})\b/)?.[1];
  const token = (await call('POST', '/auth/signup/verify', { body: { phone, code, fullName: name, pin: '4826' } })).body?.accessToken;
  const me = (await call('GET', '/auth/me', { token })).body;
  for (const purpose of ['identity_verification', 'household_data']) await call('POST', '/consents', { token, body: { personId: me.personId, purpose } });
  return { phone, token, me };
};
const claim = (token, body) => call('POST', '/cases', { token, headers: { 'idempotency-key': crypto.randomUUID() }, body: { type: 'relief_claim', ...body } });
const payFor = async (caseId, token, until) => {
  let p;
  for (let i = 0; i < 14; i++) { await sleep(1500); const r = await call('GET', `/payments?caseId=${caseId}`, { token }); p = (Array.isArray(r.body) ? r.body : r.body?.items ?? [])[0]; if (p && until(p.state)) break; }
  return p;
};
const sana = await login('03001110003');
const kamran = await login('03001110006');
const admin = await login('03001110004');

console.log('--- officer asks, citizen corrects her CNIC');
const a = await signup('Final Check One');
const wrong = `99${rnd(3)}-${rnd(7)}-${rnd(1)}`;
const right = `99${rnd(3)}-${rnd(7)}-${rnd(1)}`;
let r = await claim(a.token, { fullName: 'Final Check One', cnic: wrong, district: 'Thatta', householdSize: 6, payout: { alias: a.phone } });
const caseA = r.body;
r = await call('POST', `/cases/${caseA.id}/request-info`, { token: sana, body: { message: 'The CNIC on your card is different. Please send the correct number.' } });
step('officer asks for the correct CNIC', r.status < 300, r.body?.status);
r = await call('POST', `/cases/${caseA.id}/resubmit`, { token: a.token, body: { cnic: '4220' } });
step('a malformed corrected CNIC is refused', r.status === 400, r.status);
r = await call('POST', `/cases/${caseA.id}/resubmit`, { token: a.token, body: { cnic: '42201-1234567-4' } });
step('she cannot "correct" to another person\'s CNIC', r.status === 403, `${r.status} ${r.body?.message}`);
r = await call('POST', `/cases/${caseA.id}/resubmit`, { token: a.token, body: { cnic: right } });
step('she sends the corrected CNIC; the claim goes back to the officer', r.status === 200 && r.body.status !== 'NEEDS_INFO', `${r.status} ${r.body?.status}`);
r = await call('GET', `/cases/${caseA.id}`, { token: sana });
step('the timeline records the correction (fields only)', JSON.stringify(r.body.timeline).includes('info_provided'), JSON.stringify(r.body.timeline?.find((e) => e.type === 'info_provided')?.data));
await call('POST', `/cases/${caseA.id}/approve`, { token: sana, body: {} });
let p = await payFor(caseA.id, sana, (s) => ['SUCCESS', 'HELD', 'FAILED'].includes(s));
step('after approval she is paid', p?.state === 'SUCCESS', p?.state);
r = await call('POST', `/cases/${caseA.id}/resubmit`, { token: a.token, body: { cnic: `99${rnd(3)}-${rnd(7)}-${rnd(1)}` } });
step('once approved, the CNIC can no longer be changed by her', r.status === 409 || r.status === 403, r.status);

console.log('--- sealed Haq Receipt');
r = await call('GET', `/payments/mine/receipt?caseId=${caseA.id}`, { token: a.token });
step('her receipt carries the amount and a Haqdaar code', r.status === 200 && /^HQ1-\d{8}-/.test(r.body.code ?? ''), `${r.body?.amount} ${r.body?.code}`);
const sealed = r.body?.sealed ?? '';
r = await call('POST', '/ai/scam-check', { token: a.token, body: { text: sealed } });
step('the receipt text checks as GENUINE', /genuine/i.test(r.body?.verdict ?? ''), r.body?.verdict);
r = await call('POST', '/ai/scam-check', { token: a.token, body: { text: sealed.replace('12,000', '120,000') } });
step('the same receipt with the amount changed is caught', !/genuine/i.test(r.body?.verdict ?? ''), r.body?.verdict);
const b = await signup('Final Check Two');
r = await call('GET', `/payments/mine/receipt?caseId=${caseA.id}`, { token: b.token });
step('another citizen cannot fetch her receipt', r.status === 404 || r.status === 403, r.status);

console.log('--- held payout released to a corrected number');
r = await claim(b.token, { fullName: 'Final Check Two', cnic: `99${rnd(3)}-${rnd(7)}-${rnd(1)}`, district: 'Thatta', householdSize: 6, payout: { alias: '03009990000' } });
const caseB = r.body;
await call('POST', `/cases/${caseB.id}/approve`, { token: sana, body: {} });
p = await payFor(caseB.id, sana, (s) => !['CREATED', 'TITLE_CHECK'].includes(s));
step('payout to an account in another name is held', p?.state === 'HELD', `${p?.state} ${p?.holdReason}`);
r = await call('POST', `/payments/${p.id}/release`, { token: sana, body: { note: 'claimant gave a new number', alias: '03001110007' } });
step('releasing it to yet another person\'s account is refused', r.status === 409, `${r.status} ${r.body?.message}`);
r = await call('POST', `/payments/${p.id}/release`, { token: sana, body: { note: 'claimant gave her own number', alias: b.phone } });
step('releasing it to her own number is accepted', r.status === 200 && r.body.state === 'AWAITING_APPROVAL', `${r.status} ${r.body?.state}`);
r = await call('POST', `/payments/${p.id}/approve`, { token: sana, body: {} });
step('the releasing officer still cannot approve it', r.status === 403, r.status);
r = await call('POST', `/payments/${p.id}/approve`, { token: kamran, body: {} });
p = await payFor(caseB.id, sana, (s) => ['SUCCESS', 'FAILED', 'HELD'].includes(s));
step('a second officer approves and the money arrives', p?.state === 'SUCCESS', `${p?.state} title=${p?.titleFetched}`);

console.log('--- forgotten PIN');
r = await call('POST', '/auth/pin-reset/start', { body: { phone: a.phone } });
step('reset code requested', r.status === 200);
r = await call('GET', `/mock/sms/signup/${a.phone}`);
step('the reset code is NOT on the public sign-up preview', !/PIN badalne/.test(JSON.stringify(r.body)), JSON.stringify(r.body).slice(0, 80));
r = await call('GET', `/mock/sms/inbox/${a.phone}`, { token: admin });
const code = (Array.isArray(r.body) ? r.body : []).map((m) => m.body).find((t) => /PIN badalne/.test(t))?.match(/\b(\d{6})\b/)?.[1];
step('the code reaches her (simulated) inbox', !!code);
r = await call('POST', '/auth/pin-reset/verify', { body: { phone: a.phone, code: code === '111111' ? '222222' : '111111', pin: '7391' } });
step('a wrong reset code is refused', r.status === 400, r.status);
r = await call('POST', '/auth/pin-reset/verify', { body: { phone: a.phone, code, pin: '1234' } });
step('an easy new PIN is refused', r.status === 400, r.status);
r = await call('POST', '/auth/pin-reset/verify', { body: { phone: a.phone, code, pin: '7391' } });
step('right code + new PIN signs her in', r.status === 200 && !!r.body.accessToken, r.status);
step('the old PIN no longer works', !(await login(a.phone, '4826')));
step('the new PIN works', !!(await login(a.phone, '7391')));
r = await call('POST', '/auth/pin-reset/start', { body: { phone: '03001110004' } });
const adminInbox = await call('GET', '/mock/sms/inbox/03001110004', { token: admin });
step('a staff account cannot be reset this way', r.status === 200 && !/PIN badalne/.test(JSON.stringify(adminInbox.body)));

console.log('--- citizen links a helper');
const helper = await login('03001110002');
const aToken = await login(a.phone, '7391');
r = await call('POST', '/auth/helper-links', { token: aToken, body: { helperPhone: '03001110003', pin: '5820' } });
step('an officer\'s number is not accepted as a helper', r.status === 404, r.status);
r = await call('POST', '/auth/helper-links', { token: aToken, body: { helperPhone: '03001110002', pin: '1111' } });
step('an easy family PIN is refused', r.status === 400, r.status);
r = await call('POST', '/auth/helper-links', { token: aToken, body: { helperPhone: '03001110002', pin: '5820' } });
step('she links helper Asif with her own family PIN', r.status === 200, r.status);
r = await call('GET', '/auth/families', { token: helper });
step('the helper now sees her family in his list', JSON.stringify(r.body).includes(a.me.personId), r.status);
r = await call('POST', '/auth/act-for', { token: helper, body: { personId: a.me.personId, pin: '0000' } });
step('the helper is refused with a wrong PIN', r.status === 401 || r.status === 403, r.status);
r = await call('POST', '/auth/act-for', { token: helper, body: { personId: a.me.personId, pin: '5820' } });
step('with her PIN he can act for her', r.status === 200 && !!r.body.accessToken, r.status);
const obo = r.body?.accessToken;
r = await call('GET', '/cases', { token: obo });
step('acting for her, he sees her claims only', r.status === 200 && JSON.stringify(r.body).includes(caseA.id), r.status);

console.log('--- correction requests reach an officer');
r = await call('POST', '/consents/correction-request', { token: aToken, body: { field: 'district', note: 'I moved to Sujawal' } });
step('she reports that her district is wrong', r.status < 300, r.status);
let seen = false;
for (let i = 0; i < 8 && !seen; i++) { await sleep(1500); r = await call('GET', '/audit/correction-requests', { token: sana }); seen = JSON.stringify(r.body).includes('I moved to Sujawal'); }
step('the officer sees the request', seen, r.status);
r = await call('GET', '/audit/correction-requests', { token: aToken });
step('a citizen cannot read the request list', r.status === 403, r.status);

console.log('--- Urdu speech is not written in Hindi letters');
for (const clip of ['ur-01', 'ur-03', 'ur-05']) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(`${ROOT}/services/ai/eval/voice/audio/${clip}.mp3`)], { type: 'audio/mpeg' }), 'c.mp3');
  const res = await fetch(B + '/ai/transcribe', { method: 'POST', headers: { authorization: `Bearer ${aToken}` }, body: fd });
  const j = await res.json().catch(() => ({}));
  step(`${clip}: no Hindi script in the transcript`, res.status === 200 && !/[ऀ-ॿ]/.test(j.text ?? ''), j.text);
  await sleep(2500);
}
console.log(fails ? `\n${fails} FAILED` : '\nall final checks passed');
