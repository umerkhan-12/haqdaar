import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventSchemas } from '@haqdaar/shared';
import { CorrectionRequestBody } from './correction';

test('correction request: one of four fields, note optional', () => {
  assert.deepEqual(CorrectionRequestBody.parse({ field: 'name' }), { field: 'name' });
  assert.deepEqual(
    CorrectionRequestBody.parse({ field: 'household', note: '  5 people, not 3 ' }),
    {
      field: 'household',
      note: '5 people, not 3',
    },
  );
});

test('correction request: no free-form field, no oversized note, no smuggled new values', () => {
  assert.equal(CorrectionRequestBody.safeParse({ field: 'phone' }).success, false);
  assert.equal(
    CorrectionRequestBody.safeParse({ field: 'name', note: 'x'.repeat(281) }).success,
    false,
  );
  assert.equal(
    CorrectionRequestBody.safeParse({ field: 'cnic', personId: 'someone-else' }).success,
    false,
  );
  assert.equal(
    CorrectionRequestBody.safeParse({ field: 'cnic', newValue: '42201-0000000-0' }).success,
    false,
  );
});

test('correction request has an audit event schema (audit only stores registered event types)', () => {
  const payload = { personId: 'p1', field: 'district', note: null };
  assert.deepEqual(EventSchemas['identity.correction.requested'].parse(payload), payload);
});
