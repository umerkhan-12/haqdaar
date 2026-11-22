// Full new-user journey through the gateway: sign-up → claim → officer → payout. Usage: node journey.mjs [base]
const B = process.argv[2] ?? 'http://127.0.0.1:4000';
const call = async (method, path, { token, body, headers } = {}) => {
  const r = await fetch(B + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: r.status, body: json };
};
const login = async (phone, password = 'demo1234') => (await call('POST', '/auth/login', { body: { phone, password } })).body.accessToken;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (label, ok, detail = '') => console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`);

const phone = '0345' + String(Math.floor(1000000 + Math.random() * 8999999));
const cnic = `99${String(Math.floor(100 + Math.random() * 899))}-${String(Math.floor(1000000 + Math.random() * 8999999))}-${Math.floor(Math.random() * 9)}`;
const name = 'Sakina Journey';

let r = await call('POST', '/auth/signup/start', { body: { phone } });
step('sign-up: code requested', r.status === 200);
r = await call('GET', `/mock/sms/signup/${phone}`);
const code = String(r.body?.message?.body ?? '').match(/\b(\d{6})\b/)?.[1];
step('sign-up: code arrives on the mock SMS rail', !!code);
r = await call('POST', '/auth/signup/verify', { body: { phone, code, fullName: name, pin: '4821' } });
step('sign-up: account created', r.status === 201);
const citizen = await login(phone, '4821');
step('login with the PIN', !!citizen);
const me = (await call('GET', '/auth/me', { token: citizen })).body;

for (const purpose of ['identity_verification', 'household_data']) {
  r = await call('POST', '/consents', { token: citizen, body: { personId: me.personId, purpose } });
  if (r.status !== 201) step(`consent ${purpose}`, false, JSON.stringify(r.body).slice(0, 120));
}
r = await call('POST', '/cases', {
  token: citizen,
  headers: { 'idempotency-key': crypto.randomUUID() },
  body: { type: 'relief_claim', fullName: name, cnic, district: 'Thatta', householdSize: 6, payout: { alias: phone } },
});
const c = r.body;
step('claim submitted', r.status === 201, `${c.status} / ${c.lane} flags=${JSON.stringify(c.flags)}`);
step('first claim of a new account is NOT auto-approved', c.lane !== 'AUTO_APPROVE');
console.log('     citizen is told:', c.decision?.explanationEn);

const sana = await login('03001110003');
const kamran = await login('03001110006');
r = await call('GET', `/cases/${c.id}`, { token: sana });
step('officer can read the case', r.status === 200);
r = await call('POST', `/cases/${c.id}/approve`, { token: sana, body: { note: 'Identity confirmed in person (journey test)' } });
step('officer Sana approves the claim', r.status < 300, typeof r.body === 'object' ? (r.body.status ?? r.body.message ?? '') : '');

let pay;
for (let i = 0; i < 20; i++) {
  await sleep(1500);
  r = await call('GET', `/payments?caseId=${c.id}`, { token: sana });
  pay = Array.isArray(r.body) ? r.body[0] : r.body?.items?.[0];
  if (pay && !['CREATED', 'TITLE_CHECK'].includes(pay.state)) break;
}
step('payout created', !!pay, pay ? `${pay.state}${pay.holdReason ? ' (' + pay.holdReason + ')' : ''} title=${pay.titleFetched} score=${pay.titleMatchScore}` : JSON.stringify(r.body).slice(0, 200));

if (pay?.state === 'HELD') {
  r = await call('POST', `/payments/${pay.id}/release`, { token: sana, body: { note: 'journey test' } });
  step('officer releases the held payout', r.status < 300, JSON.stringify(r.body).slice(0, 140));
}
if (pay) {
  if (pay.state === 'AWAITING_APPROVAL') {
    r = await call('POST', `/payments/${pay.id}/approve`, { token: sana, body: {} });
    step('the releasing officer cannot also approve', r.status === 403 || r.status === 409, `HTTP ${r.status}`);
    r = await call('POST', `/payments/${pay.id}/approve`, { token: kamran, body: {} });
    step('second officer Kamran approves the payout', r.status < 300, `HTTP ${r.status}`);
  } else {
    r = await call('POST', `/payments/${pay.id}/retry`, { token: sana });
    step('paying an already paid payout again is refused', r.status === 409, `HTTP ${r.status}`);
  }
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    r = await call('GET', `/payments?caseId=${c.id}`, { token: sana });
    pay = Array.isArray(r.body) ? r.body[0] : r.body?.items?.[0];
    if (['SUCCESS', 'FAILED', 'HELD'].includes(pay?.state)) break;
  }
  step('money arrives', pay?.state === 'SUCCESS', `${pay?.state} ${pay?.transitions?.[0]?.reason ?? ''}`);
}
r = await call('GET', `/cases/${c.id}`, { token: citizen });
step('citizen sees the final status', r.status === 200, r.body.status);
r = await call('GET', `/mock/sms/signup/${phone}`);
const admin = await login('03001110004');
r = await call('GET', `/mock/sms/inbox/${phone}`, { token: admin });
const receipt = Array.isArray(r.body) ? r.body.find((m) => /12,?000|Rs/.test(m.body)) : null;
step('Haq Receipt SMS with the amount', !!receipt, receipt ? receipt.body.slice(0, 110) : '');
r = await call('POST', '/ai/assist', { token: citizen, body: { question: 'Where is my money?', lang: 'en' } });
step('assistant answers "where is my money?" from her own records', r.status === 200 && !r.body.refused, String(r.body.answer).slice(0, 120));
