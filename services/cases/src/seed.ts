/** Seed reference persons, Sahara rule v1 and default costs. SYNTHETIC DATA ONLY (docs/CONTRACTS.md). */
import { env } from './env';
import { encryptField, lookupHash } from '@haqdaar/nest-kit';
import { DEFAULT_COSTS } from '@haqdaar/shared';
import { PrismaClient } from '../generated/prisma';
import { normalizeName } from './engine/names';
import { combinedLogic, SAHARA_V1 } from './engine/rules';

const RELIEF_TENANT = '00000000-0000-4000-8000-000000000001';

const PERSONS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    fullName: 'Zainab Bibi',
    cnic: '42201-1234567-4',
    phone: '03001110001',
    district: 'Thatta',
    payoutIban: 'PK36SAHA0000001234567890',
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    fullName: 'Rashida Begum',
    cnic: '42201-7654321-2',
    phone: '03001110007',
    district: 'Karachi West',
    payoutIban: 'PK52SAHA0000007654321098',
  },
];

async function main() {
  const prisma = new PrismaClient();

  for (const p of PERSONS) {
    const data = {
      tenantId: RELIEF_TENANT,
      fullName: p.fullName,
      nameNormalized: normalizeName(p.fullName),
      cnicEnc: encryptField(p.cnic, env.PII_ENC_KEY),
      cnicHash: lookupHash(p.cnic, env.PII_HASH_KEY),
      phoneEnc: encryptField(p.phone, env.PII_ENC_KEY),
      district: p.district,
      payoutIban: p.payoutIban,
    };
    await prisma.person.upsert({
      where: { id: p.id },
      update: data,
      create: { id: p.id, ...data },
    });
  }

  const hasRule = await prisma.ruleVersion.findFirst({ where: { tenantId: RELIEF_TENANT } });
  if (!hasRule) {
    await prisma.ruleVersion.create({
      data: {
        tenantId: RELIEF_TENANT,
        version: 1,
        status: 'PUBLISHED',
        clauses: SAHARA_V1.clauses as object[],
        logic: combinedLogic(SAHARA_V1.clauses) as object,
        amount: SAHARA_V1.amount,
        notes: SAHARA_V1.notes,
        createdBy: 'seed',
        publishedBy: 'seed',
        publishedAt: new Date(),
      },
    });
  }

  await prisma.costSettings.upsert({
    where: { tenantId: RELIEF_TENANT },
    update: {},
    create: { tenantId: RELIEF_TENANT, ...DEFAULT_COSTS, updatedBy: 'seed' },
  });

  console.log(`Seeded ${PERSONS.length} persons, Sahara rule v1 (published) and default costs.`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
