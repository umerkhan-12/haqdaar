/**
 * Seed demo tenants and one user per role. SYNTHETIC DATA ONLY.
 * All demo accounts use the password below; it exists only in this seed file.
 */
import { env } from './env';
import argon2 from 'argon2';
import { encryptField, lookupHash } from '@haqdaar/nest-kit';
import { PrismaClient } from '../generated/prisma';
import { normalizePhone } from './auth/auth.service';

export const DEMO_PASSWORD = 'demo1234';

/** Fixed ids so other services' seeds can reference the same people. */
export const DEMO_IDS = {
  reliefTenant: '00000000-0000-4000-8000-000000000001',
  fraudTenant: '00000000-0000-4000-8000-000000000002',
  zainabPerson: '10000000-0000-4000-8000-000000000001',
  rashidaPerson: '10000000-0000-4000-8000-000000000002',
};

/** Families the shopkeeper helper serves (docs/CONTRACTS.md). Each has its own PIN. */
const HELPER_FAMILIES = [
  [DEMO_IDS.zainabPerson, 'Zainab Bibi', '1111'],
  [DEMO_IDS.rashidaPerson, 'Rashida Begum', '2222'],
  ['10000000-0000-4000-8000-000000000003', 'Nasreen Bi Bi', '3333'],
  ['10000000-0000-4000-8000-000000000004', 'Kaneez Fatima', '4444'],
  ['10000000-0000-4000-8000-000000000005', 'Zainab Bibi (Badin)', '5555'],
  ['10000000-0000-4000-8000-000000000006', 'Mohammad Akram', '6666'],
  ['10000000-0000-4000-8000-000000000007', 'Ghulam Rasool', '7777'],
  ['10000000-0000-4000-8000-000000000008', 'Shazia Bibi', '8888'],
] as const;

const USERS = [
  { name: 'Zainab Bibi', role: 'citizen', phone: '03001110001', personId: DEMO_IDS.zainabPerson },
  { name: 'Asif (shopkeeper helper)', role: 'helper', phone: '03001110002', personId: null },
  { name: 'Officer Sana', role: 'officer', phone: '03001110003', personId: null },
  { name: 'Officer Kamran', role: 'officer', phone: '03001110006', personId: null },
  { name: 'Admin Hira', role: 'admin', phone: '03001110004', personId: null, platformAdmin: true },
  { name: 'Auditor Bilal', role: 'auditor', phone: '03001110005', personId: null },
] as const;

/** Admin Hira is also the platform operator: she can launch new programs (tenants). */
const platformAdmin = (u: (typeof USERS)[number]) => 'platformAdmin' in u && u.platformAdmin;

async function main() {
  const prisma = new PrismaClient();
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  await prisma.tenant.upsert({
    where: { id: DEMO_IDS.reliefTenant },
    update: {},
    create: { id: DEMO_IDS.reliefTenant, name: 'Sahara Relief Department', type: 'relief' },
  });
  await prisma.tenant.upsert({
    where: { id: DEMO_IDS.fraudTenant },
    update: {},
    create: { id: DEMO_IDS.fraudTenant, name: 'Fraud & Complaints Desk', type: 'fraud_desk' },
  });

  for (const u of USERS) {
    const phone = normalizePhone(u.phone);
    const phoneHash = lookupHash(phone, env.PII_HASH_KEY);
    await prisma.user.upsert({
      where: { phoneHash },
      update: { passwordHash, failedLogins: 0, lockedUntil: null, platformAdmin: platformAdmin(u) },
      create: {
        tenantId: DEMO_IDS.reliefTenant,
        role: u.role,
        name: u.name,
        phoneEnc: encryptField(phone, env.PII_ENC_KEY),
        phoneHash,
        passwordHash,
        personId: u.personId,
        platformAdmin: platformAdmin(u),
      },
    });
  }

  const helper = await prisma.user.findUniqueOrThrow({
    where: { phoneHash: lookupHash(normalizePhone('03001110002'), env.PII_HASH_KEY) },
  });
  for (const [personId, label, pin] of HELPER_FAMILIES) {
    await prisma.helperLink.upsert({
      where: { helperId_personId: { helperId: helper.id, personId } },
      update: {},
      create: { helperId: helper.id, personId, label, pinHash: await argon2.hash(pin) },
    });
  }

  console.log(`Seeded ${USERS.length} users (password: ${DEMO_PASSWORD}).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
