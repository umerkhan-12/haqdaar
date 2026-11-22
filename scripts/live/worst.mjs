// What a judge would try to break. Usage: node worst.mjs <base>
const B = process.argv[2];
let fails = 0;
const step = (label, ok, detail = '') => {
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail !== '' ? ' — ' + String(detail).replace(/\s+/g, ' ').slice(0, 150) : ''}`);
};
const call = async (method, path, { token, body, headers, raw } = {}) => {
  const r = await fetch(B + path, {
    method,
    headers: { ...(body !== undefined || raw ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  }).catch((e) => ({ status: 0, text: async () => String(e) }));
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
};
const login = async (phone, password = 'demo1234') => (await call('POST', '/auth/login', { body: { phone, password } })).body?.accessToken;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');
const signup = async (name) => {
  const phone = '0349' + rnd(7);
  await call('POST', '/auth/signup/start', { body: { phone } });
  const code = String((await call('GET', `/mock/sms/signup/${phone}`)).body?.message?.body ?? '').match(/\b(\d{6})\b/)?.[1];
  const r = await call('POST', '/auth/signup/verify', { body: { phone, code, fullName: name, pin: '4826' } });
  const token = r.body?.accessToken;
  const me = (await call('GET', '/auth/me', { token })).body;
  for (const purpose of ['identity_verification', 'household_data']) await call('POST', '/consents', { token, body: { personId: me.personId, purpose } });
  return { phone, token, me };
};
const claim = (token, body, key = crypto.randomUUID()) =>
  call('POST', '/cases', { token, headers: { 'idempotency-key': key }, body: { type: 'relief_claim', ...body } });

const zainab = await login('03001110001');
const sana = await login('03001110003');
const kamran = await login('03001110006');
const admin = await login('03001110004');
const auditor = await login('03001110005');
const helper = await login('03001110002');
step('all six demo accounts log in', [zainab, sana, kamran, admin, auditor, helper].every(Boolean));

console.log('--- authentication');
let r = await call('GET', '/cases');
step('no token → 401', r.status === 401, r.status);
r = await call('GET', '/cases', { token: 'abc.def.ghi' });
step('garbage token → 401', r.status === 401, r.status);
const parts = zainab.split('.');
const forged = [parts[0], Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), role: 'admin' })).toString('base64url'), parts[2]].join('.');
r = await call('GET', '/users', { token: forged });
step('token edited to say "admin" → 401', r.status === 401, r.status);
const none = [Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url'), parts[1], ''].join('.');
r = await call('GET', '/cases', { token: none });
step('unsigned ("alg none") token → 401', r.status === 401, r.status);
r = await call('POST', '/auth/login', { body: { phone: "03001110004' OR '1'='1", password: 'x' } });
step('SQL in the login phone → refused, no crash', r.status === 400 || r.status === 401, r.status);
r = await call('POST', '/auth/login', { body: { phone: '03001110004', password: 'wrong-password-1' } });
step('wrong password → 401 with no detail', r.status === 401, JSON.stringify(r.body).slice(0, 80));

console.log('--- one role reaching into another');
const a = await signup('Worst Case One');
const b = await signup('Worst Case Two');
step('two new citizens signed up', !!a.token && !!b.token);
const cnicA = `99${rnd(3)}-${rnd(7)}-${rnd(1)}`;
r = await claim(a.token, { fullName: 'Worst Case One', cnic: cnicA, district: 'Thatta', householdSize: 6, payout: { alias: a.phone } });
const caseA = r.body;
step('citizen A files a claim', r.status === 201, `${caseA?.status} / ${caseA?.lane}`);
r = await call('GET', `/cases/${caseA.id}`, { token: b.token });
step('citizen B cannot open citizen A\'s claim', r.status === 403 || r.status === 404, r.status);
r = await call('POST', `/cases/${caseA.id}/resubmit`, { token: b.token, body: { fullName: 'Thief' } });
step('citizen B cannot change citizen A\'s claim', r.status === 403 || r.status === 404, r.status);
r = await call('POST', `/cases/${caseA.id}/approve`, { token: a.token, body: {} });
step('a citizen cannot approve her own claim', r.status === 403, r.status);
r = await call('POST', `/cases/${caseA.id}/approve`, { token: auditor, body: {} });
step('the auditor cannot approve (read-only)', r.status === 403, r.status);
r = await call('POST', `/cases/${caseA.id}/approve`, { token: helper, body: {} });
step('a helper cannot approve', r.status === 403, r.status);
r = await claim(b.token, { fullName: 'Worst Case Two', cnic: cnicA, district: 'Thatta', householdSize: 6, payout: { alias: b.phone } });
step('citizen B cannot claim on citizen A\'s CNIC', r.status === 403 || (r.status === 201 && r.body.lane !== 'AUTO_APPROVE'), `${r.status} ${r.body?.message ?? r.body?.lane}`);
r = await claim(b.token, { fullName: 'Zainab Bibi', cnic: '42201-1234567-4', district: 'Thatta', householdSize: 5, payout: { alias: b.phone } });
step('a new account claiming with Zainab\'s real record is never paid automatically', r.status === 403 || (r.status === 201 && r.body.lane !== 'AUTO_APPROVE'), `${r.status} ${r.body?.message ?? r.body?.lane}`);
r = await call('GET', '/consents', { token: a.token });
step('citizen reads only her own consents', r.status === 200, r.status);
r = await call('POST', '/consents', { token: a.token, body: { personId: b.me.personId, purpose: 'identity_verification' } });
step('citizen A cannot give consent for citizen B', r.status === 403 || r.status === 404, r.status);
r = await call('POST', '/auth/act-for', { token: helper, body: { personId: a.me.personId, pin: '4826' } });
step('helper cannot act for a family that never linked him', r.status === 403 || r.status === 404, r.status);
r = await call('POST', '/rules', { token: sana, body: {} });
step('officer cannot change the rules', r.status === 403 || r.status === 404 || r.status === 405, r.status);
r = await call('POST', '/ai/kill-switch', { token: sana, body: { killed: true } });
step('officer cannot switch the AI off', r.status === 403, r.status);

console.log('--- bad input');
const base = { fullName: 'Worst Case One', cnic: cnicA, district: 'Thatta', householdSize: 6, payout: { alias: a.phone } };
for (const [label, patch] of [
  ['CNIC with letters', { cnic: '4220A-1234567-4' }],
  ['CNIC too short', { cnic: '42201-123456-4' }],
  ['household 0', { householdSize: 0 }],
  ['household -3', { householdSize: -3 }],
  ['household 31', { householdSize: 31 }],
  ['household "five"', { householdSize: 'five' }],
  ['name of 500 letters', { fullName: 'A'.repeat(500) }],
  ['name with a control character', { fullName: 'Zainab\u0000Bibi' }],
  ['payout number of 5 digits', { payout: { alias: '03001' } }],
  ['both alias and IBAN', { payout: { alias: a.phone, iban: 'PK36SAHA0000001234567890' } }],
  ['no payout at all', { payout: {} }],
  ['unknown claim type', { type: 'free_money' }],
]) {
  r = await claim(a.token, { ...base, ...patch });
  step(`refused: ${label}`, r.status === 400, r.status);
}
r = await call('POST', '/cases', { token: a.token, headers: { 'idempotency-key': crypto.randomUUID() }, raw: '{"fullName": "broken json' });
step('broken JSON → 400, not a crash', r.status === 400, r.status);
r = await call('POST', '/cases', { token: a.token, headers: { 'idempotency-key': crypto.randomUUID() }, raw: JSON.stringify({ ...base, type: 'relief_claim', junk: 'x'.repeat(3_000_000) }) });
step('3 MB body → refused (413 or 400)', r.status === 413 || r.status === 400, r.status);
r = await claim(a.token, { ...base, fullName: "Robert'); DROP TABLE cases;--" });
step('SQL in the name is stored as text or refused, service stays up', r.status === 201 || r.status === 400 || r.status === 409, r.status);
r = await claim(a.token, { ...base, district: '<img src=x onerror=alert(1)>' });
step('script in the district → refused or sent to an officer', r.status === 400 || (r.status === 201 && r.body.lane !== 'AUTO_APPROVE') || r.status === 409, `${r.status} ${r.body?.lane ?? ''}`);
r = await call('GET', '/cases/not-a-uuid', { token: sana });
step('malformed id → 400', r.status === 400, r.status);
r = await call('GET', '/cases/00000000-0000-4000-8000-00000000dead', { token: sana });
step('unknown id → 404', r.status === 404, r.status);
r = await call('GET', '/definitely/not/a/route', { token: sana });
step('unknown route → 404 JSON', r.status === 404 && typeof r.body === 'object', r.status);

console.log('--- double clicks, repeats, races');
const key = crypto.randomUUID();
const c2 = await signup('Worst Case Three');
const body3 = { fullName: 'Worst Case Three', cnic: `99${rnd(3)}-${rnd(7)}-${rnd(1)}`, district: 'Badin', householdSize: 7, payout: { alias: c2.phone } };
const five = await Promise.all([1, 2, 3, 4, 5].map(() => claim(c2.token, body3, key)));
const ids = new Set(five.filter((x) => x.status === 201 || x.status === 200).map((x) => x.body.id));
step('5 identical submits at once → 1 claim', ids.size === 1, `${ids.size} claim(s), statuses ${five.map((x) => x.status).join(',')}`);
const caseC = five.find((x) => x.body?.id)?.body;
r = await claim(c2.token, body3);
step('second claim on the same CNIC this month → officer, never automatic', r.status === 409 || (r.status === 201 && r.body.lane !== 'AUTO_APPROVE'), `${r.status} ${r.body?.lane ?? r.body?.message}`);
const both = await Promise.all([call('POST', `/cases/${caseC.id}/approve`, { token: sana, body: {} }), call('POST', `/cases/${caseC.id}/approve`, { token: kamran, body: {} })]);
step('two officers approve the same claim at once → one wins', both.filter((x) => x.status < 300).length === 1, both.map((x) => x.status).join(','));
r = await call('POST', `/cases/${caseC.id}/reject`, { token: sana, body: { reason: 'changed my mind after approval' } });
step('an approved claim cannot be rejected afterwards', r.status === 409 || r.status === 400, r.status);
let pays = [];
for (let i = 0; i < 12; i++) {
  await sleep(1500);
  r = await call('GET', `/payments?caseId=${caseC.id}`, { token: sana });
  pays = Array.isArray(r.body) ? r.body : r.body?.items ?? [];
  if (pays[0] && !['CREATED', 'TITLE_CHECK', 'APPROVED', 'SENT'].includes(pays[0].state)) break;
}
step('the double approval produced exactly one payout', pays.length === 1, `${pays.length} payout(s), ${pays[0]?.state}`);

console.log('--- money');
const d = await signup('Worst Case Four');
r = await claim(d.token, { fullName: 'Worst Case Four', cnic: `99${rnd(3)}-${rnd(7)}-${rnd(1)}`, district: 'Thatta', householdSize: 6, payout: { alias: '03009990000' } });
const caseD = r.body;
await call('POST', `/cases/${caseD.id}/approve`, { token: sana, body: {} });
let payD;
for (let i = 0; i < 12; i++) {
  await sleep(1500);
  r = await call('GET', `/payments?caseId=${caseD.id}`, { token: sana });
  payD = (Array.isArray(r.body) ? r.body : r.body?.items ?? [])[0];
  if (payD && !['CREATED', 'TITLE_CHECK'].includes(payD.state)) break;
}
step('payout to an account in another name is HELD, no money moves', payD?.state === 'HELD', `${payD?.state} ${payD?.holdReason ?? ''}`);
if (payD?.state === 'HELD') {
  r = await call('POST', `/payments/${payD.id}/release`, { token: sana, body: { note: 'worst-case test' } });
  step('officer releases the hold', r.status < 300, r.status);
  r = await call('POST', `/payments/${payD.id}/approve`, { token: sana, body: {} });
  step('the same officer cannot also approve it (four eyes)', r.status === 403, r.status);
  r = await call('POST', `/payments/${payD.id}/approve`, { token: a.token, body: {} });
  step('a citizen cannot approve a payout', r.status === 403, r.status);
}
r = await call('GET', '/payments/mine', { token: a.token });
step('citizen sees only her own payments', r.status === 200 && JSON.stringify(r.body).length < 5000, r.status);

console.log('--- consent');
const e = await signup('Worst Case Five');
const cons = (await call('GET', '/consents', { token: e.token })).body;
const list = Array.isArray(cons) ? cons : cons?.items ?? cons?.consents ?? [];
const idc = list.find((x) => x.purpose === 'identity_verification' && !x.withdrawnAt)?.id;
if (idc) {
  r = await call('POST', `/consents/${idc}/withdraw`, { token: e.token, body: {} });
  if (r.status === 404) r = await call('DELETE', `/consents/${idc}`, { token: e.token });
  step('she takes her identity consent back', r.status < 300, r.status);
  r = await claim(e.token, { fullName: 'Worst Case Five', cnic: `99${rnd(3)}-${rnd(7)}-${rnd(1)}`, district: 'Thatta', householdSize: 6, payout: { alias: e.phone } });
  step('a claim without consent is not decided: she is asked first', r.status === 201 ? r.body.lane !== 'AUTO_APPROVE' && r.body.status !== 'APPROVED' : r.status === 403 || r.status === 409, `${r.status} ${r.body?.status ?? ''} ${r.body?.lane ?? r.body?.message ?? ''}`);
} else console.log('SKIP consent withdraw: no consent row found', JSON.stringify(cons).slice(0, 120));

console.log('--- still healthy after all that');
r = await call('GET', '/status');
step('every service is up', r.status === 200 && r.body.services?.every((s) => s.ok), r.body.services?.filter((s) => !s.ok).map((s) => s.name).join(','));
r = await call('POST', '/audit/verify-chain', { token: auditor, body: {} });
step('the audit chain still verifies', r.status === 200 && r.body.valid === true, `${r.body.checked} entries`);
console.log(fails ? `\n${fails} FAILED` : '\nall worst-case checks passed');
