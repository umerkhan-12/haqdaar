import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { AuthUser, EventBus } from '@haqdaar/nest-kit';
import type { PrismaService } from '../prisma.service';
import { CreateUserBody, UpdateUserBody } from './users.controller';
import { UsersService } from './users.service';
import { describeChanges, refuseChange, temporaryPassword } from './user-policy';

const ME = 'a0000000-0000-4000-8000-000000000001';
const OTHER = 'a0000000-0000-4000-8000-000000000002';
const admin = (id: string, active = true) => ({ id, role: 'admin', active });

test('an admin cannot disable or demote themself', () => {
  const base = { actorId: ME, target: admin(ME), otherActiveAdmins: 3 };
  assert.match(refuseChange({ ...base, change: { active: false } }) ?? '', /yourself/);
  assert.match(refuseChange({ ...base, change: { role: 'officer' } }) ?? '', /yourself/);
  assert.equal(refuseChange({ ...base, change: { role: 'admin', active: true } }), null);
});

test('the last active admin of a tenant cannot be disabled or demoted', () => {
  const base = { actorId: ME, target: admin(OTHER) };
  for (const change of [{ active: false }, { role: 'auditor' as const }]) {
    assert.match(
      refuseChange({ ...base, change, otherActiveAdmins: 0 }) ?? '',
      /last active admin/,
    );
    assert.equal(refuseChange({ ...base, change, otherActiveAdmins: 1 }), null);
  }
  // An already disabled admin does not count as the last one.
  const disabled = { actorId: ME, target: admin(OTHER, false), otherActiveAdmins: 0 };
  assert.equal(refuseChange({ ...disabled, change: { role: 'officer' } }), null);
});

test('ordinary changes are allowed and described as from → to for the audit trail', () => {
  const officer = { id: OTHER, role: 'officer', active: true };
  const ctx = { actorId: ME, target: officer, otherActiveAdmins: 0 };
  assert.equal(refuseChange({ ...ctx, change: { role: 'admin' } }), null);
  assert.equal(refuseChange({ ...ctx, change: { active: false } }), null);
  assert.deepEqual(describeChanges(officer, { role: 'helper', active: false }), {
    role: { from: 'officer', to: 'helper' },
    active: { from: 'true', to: 'false' },
  });
  assert.deepEqual(describeChanges(officer, { role: 'officer', active: true }), {});
});

test('temporary password: 10 unambiguous characters, different every time', () => {
  const a = temporaryPassword();
  assert.match(a, /^[a-km-zA-HJ-NP-Z2-9]{10}$/);
  assert.notEqual(a, temporaryPassword());
});

test('request bodies: staff roles only, Pakistani mobile, no unknown fields', () => {
  const ok = { name: 'Sana Officer', phone: '0300-1112233', role: 'officer' };
  assert.equal(CreateUserBody.safeParse(ok).success, true);
  assert.equal(CreateUserBody.safeParse({ ...ok, role: 'citizen' }).success, false);
  assert.equal(CreateUserBody.safeParse({ ...ok, role: 'partner' }).success, false);
  assert.equal(CreateUserBody.safeParse({ ...ok, phone: '12345' }).success, false);
  assert.equal(UpdateUserBody.safeParse({}).success, false);
  assert.equal(UpdateUserBody.safeParse({ active: false }).success, true);
  assert.equal(UpdateUserBody.safeParse({ role: 'admin', platformAdmin: true }).success, false);
});

/** A fake database holding two tenants, to prove the service never crosses the tenant line. */
function fakeService(users: { id: string; tenantId: string; role: string; active: boolean }[]) {
  const writes: string[] = [];
  const tx = {
    user: {
      findFirst: async (q: { where: { id: string; tenantId: string } }) => {
        const u = users.find((x) => x.id === q.where.id && x.tenantId === q.where.tenantId);
        return u ? { ...u, name: 'X', createdAt: new Date(), phoneEnc: '' } : null;
      },
      count: async (q: { where: { tenantId: string; id: { not: string } } }) =>
        users.filter(
          (x) =>
            x.tenantId === q.where.tenantId &&
            x.role === 'admin' &&
            x.active &&
            x.id !== q.where.id.not,
        ).length,
      update: async () => {
        writes.push('user.update');
        throw new Error('stop after the write (the fake has no encrypted phone to return)');
      },
    },
  };
  const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
  const service = new UsersService(
    prisma as unknown as PrismaService,
    { kick: () => undefined } as unknown as EventBus,
  );
  return { service, writes };
}

test('PATCH is tenant-scoped and enforces the lock-out rules before any write', async () => {
  const T1 = 'b0000000-0000-4000-8000-000000000001';
  const T2 = 'b0000000-0000-4000-8000-000000000002';
  const FOREIGN = 'a0000000-0000-4000-8000-000000000009';
  const { service, writes } = fakeService([
    { id: ME, tenantId: T1, role: 'admin', active: true },
    { id: OTHER, tenantId: T1, role: 'officer', active: true },
    { id: FOREIGN, tenantId: T2, role: 'officer', active: true },
  ]);
  const me = { id: ME, tenantId: T1, role: 'admin', name: 'Admin' } as AuthUser;

  await assert.rejects(service.update(me, FOREIGN, { active: false }), NotFoundException);
  await assert.rejects(service.update(me, ME, { active: false }), BadRequestException);
  await assert.rejects(service.update(me, ME, { role: 'officer' }), BadRequestException);
  assert.deepEqual(writes, [], 'refused changes never reach the database');

  // An allowed change does reach the write.
  await assert.rejects(service.update(me, OTHER, { active: false }), /stop after the write/);
  assert.deepEqual(writes, ['user.update']);
});
