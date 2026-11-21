/**
 * SYNTHETIC reference data for the simulated rails. No real person, CNIC or account.
 * Contract people (docs/CONTRACTS.md) are fixed; the rest is generated from a fixed seed,
 * so every run and every teammate sees the same data.
 */

export type Gender = 'F' | 'M';
export type MaritalStatus = 'single' | 'married' | 'widowed' | 'divorced';

export interface PersonRecord {
  cnic: string;
  fullName: string;
  guardianName: string;
  dateOfBirth: string;
  gender: Gender;
  district: string;
  maritalStatus: MaritalStatus;
  deceased: boolean;
}

export interface Household {
  cnic: string;
  householdSize: number;
  monthlyIncomePkr: number;
  district: string;
  pmtScore: number;
  ownsVehicle: boolean;
}

export interface Account {
  iban: string;
  alias: string | null;
  title: string;
  bank: string;
  cnic: string | null;
}

export interface SeedData {
  people: PersonRecord[];
  households: Household[];
  accounts: Account[];
  programAccount: Account;
}

/** Hand-made records for the demo and the bad-data challenge (03). */
export const DEMO_SCENARIOS = {
  sameNameDifferentPerson: ['42201-1234567-4', '41201-4455667-2'],
  nameVariants: ['41101-2233445-1', '41101-5566778-3'],
  urduScriptRecord: { cnic: '43201-1122334-8', saysName: 'Shazia Bibi' },
  slightNameDifference: { cnic: '42101-6677889-4', saysName: 'Kaneez Fatma' },
  deceased: '44201-9988776-5',
  muleAlias: '03009990000',
} as const;

const BANKS: Record<string, string> = {
  SAHA: 'Sahara Partner Bank (demo)',
  HABB: 'Habib Bank (demo)',
  MEZN: 'Meezan Bank (demo)',
  UNIL: 'United Bank (demo)',
  JSBL: 'JS Bank (demo)',
  MULE: 'QuickCash Microfinance (demo)',
};

const PROGRAM_ACCOUNT: Account = {
  iban: 'PK00SAHA0000000000000001',
  alias: null,
  title: 'SAHARA RELIEF PROGRAM',
  bank: BANKS.SAHA!,
  cnic: null,
};

interface Fixed {
  person: PersonRecord;
  household: Household;
  account?: { iban: string; alias: string; bank: string };
}

const person = (
  cnic: string,
  fullName: string,
  guardianName: string,
  dateOfBirth: string,
  gender: Gender,
  district: string,
  maritalStatus: MaritalStatus,
  deceased = false,
): PersonRecord => ({ cnic, fullName, guardianName, dateOfBirth, gender, district, maritalStatus, deceased });

const household = (
  cnic: string,
  householdSize: number,
  monthlyIncomePkr: number,
  district: string,
  pmtScore: number,
  ownsVehicle = false,
): Household => ({ cnic, householdSize, monthlyIncomePkr, district, pmtScore, ownsVehicle });

const FIXED: Fixed[] = [
  {
    person: person('42201-1234567-4', 'Zainab Bibi', 'Ghulam Hussain', '1979-03-14', 'F', 'Thatta', 'widowed'),
    household: household('42201-1234567-4', 5, 18_000, 'Thatta', 18),
    account: { iban: 'PK36SAHA0000001234567890', alias: '03001110001', bank: 'SAHA' },
  },
  {
    person: person('42201-7654321-2', 'Rashida Begum', 'Abdul Majeed', '1972-11-02', 'F', 'Karachi West', 'married'),
    household: household('42201-7654321-2', 7, 22_000, 'Karachi West', 24),
    account: { iban: 'PK52SAHA0000007654321098', alias: '03001110007', bank: 'SAHA' },
  },
  {
    person: person('41201-4455667-2', 'Zainab Bibi', 'Allah Bux', '1990-07-21', 'F', 'Badin', 'married'),
    household: household('41201-4455667-2', 4, 35_000, 'Badin', 41),
    account: { iban: 'PK19HABB0000004455667021', alias: '03121234501', bank: 'HABB' },
  },
  {
    person: person('41101-2233445-1', 'Muhammad Akram', 'Muhammad Yousuf', '1968-05-09', 'M', 'Hyderabad', 'married'),
    household: household('41101-2233445-1', 6, 28_000, 'Hyderabad', 33),
    account: { iban: 'PK44MEZN0000002233445010', alias: '03211234502', bank: 'MEZN' },
  },
  {
    person: person('41101-5566778-3', 'Mohammad Akram', 'Noor Muhammad', '1983-01-30', 'M', 'Hyderabad', 'married'),
    household: household('41101-5566778-3', 3, 52_000, 'Hyderabad', 58, true),
    account: { iban: 'PK71UNIL0000005566778030', alias: '03331234503', bank: 'UNIL' },
  },
  {
    person: person('42401-3344556-6', 'Nasreen Bi Bi', 'Mehboob Ali', '1975-08-17', 'F', 'Karachi West', 'widowed'),
    household: household('42401-3344556-6', 8, 16_000, 'Karachi West', 15),
    account: { iban: 'PK08JSBL0000003344556060', alias: '03451234504', bank: 'JSBL' },
  },
  {
    person: person('43201-1122334-8', 'شازیہ بی بی', 'غلام قادر', '1981-12-05', 'F', 'Sukkur', 'widowed'),
    household: household('43201-1122334-8', 5, 20_000, 'Sukkur', 21),
    account: { iban: 'PK63HABB0000001122334080', alias: '03011234505', bank: 'HABB' },
  },
  {
    person: person('42101-6677889-4', 'Kaneez Fatima', 'Sher Muhammad', '1970-04-23', 'F', 'Karachi East', 'widowed'),
    household: household('42101-6677889-4', 6, 19_000, 'Karachi East', 19),
    account: { iban: 'PK27MEZN0000006677889040', alias: '03151234506', bank: 'MEZN' },
  },
  {
    person: person('44201-9988776-5', 'Ghulam Rasool', 'Pir Bux', '1950-02-11', 'M', 'Larkana', 'married', true),
    household: household('44201-9988776-5', 4, 12_000, 'Larkana', 14),
  },
];

const MULE: Account = {
  iban: 'PK11MULE0000009999999999',
  alias: '03009990000',
  title: 'MUHAMMAD ASLAM',
  bank: BANKS.MULE!,
  cnic: null,
};

const DISTRICT_PREFIX: Record<string, string> = {
  Thatta: '42202',
  'Karachi West': '42402',
  'Karachi East': '42102',
  Hyderabad: '41102',
  Badin: '41202',
  Sukkur: '43202',
  Larkana: '44202',
  Tharparkar: '44102',
  Mirpurkhas: '44302',
  Dadu: '43302',
};

const FEMALE = ['Ayesha', 'Fatima', 'Sakina', 'Parveen', 'Shabana', 'Rukhsana', 'Hajra', 'Amina', 'Naseem', 'Saima', 'Khadija', 'Razia'];
const MALE = ['Muhammad', 'Ali', 'Abdul Rehman', 'Imran', 'Asif', 'Bilal', 'Ghulam Nabi', 'Shahid', 'Faisal', 'Javed', 'Allah Dino', 'Rafiq'];
const SURNAMES = ['Khan', 'Shah', 'Memon', 'Baloch', 'Soomro', 'Abbasi', 'Qureshi', 'Siddiqui', 'Ansari', 'Chandio', 'Jatoi', 'Brohi'];
const FEMALE_SUFFIX = ['Bibi', 'Begum', 'Khatoon', 'Bi Bi'];
const MALE_SPELLINGS = ['Muhammad', 'Mohammad', 'Muhammed'];

/** mulberry32: tiny deterministic PRNG. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSeed(count = 24, seed = 20261120): SeedData {
  const rand = prng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const digits = (n: number) => Array.from({ length: n }, () => int(0, 9)).join('');

  const people = FIXED.map((f) => f.person);
  const households = FIXED.map((f) => f.household);
  const accounts: Account[] = FIXED.filter((f) => f.account).map((f) => ({
    iban: f.account!.iban,
    alias: f.account!.alias,
    title: f.person.fullName === 'شازیہ بی بی' ? 'SHAZIA BIBI' : f.person.fullName.toUpperCase(),
    bank: BANKS[f.account!.bank]!,
    cnic: f.person.cnic,
  }));
  accounts.push(MULE);

  const usedCnics = new Set(people.map((p) => p.cnic));
  const usedAliases = new Set(accounts.map((a) => a.alias));

  for (let i = 0; i < count; i++) {
    const gender: Gender = rand() < 0.65 ? 'F' : 'M';
    const district = pick(Object.keys(DISTRICT_PREFIX));
    const surname = pick(SURNAMES);
    const first = gender === 'F' ? pick(FEMALE) : pick(MALE).replace('Muhammad', pick(MALE_SPELLINGS));
    const fullName = gender === 'F' ? `${first} ${pick(FEMALE_SUFFIX)}` : `${first} ${surname}`;

    let cnic: string;
    do {
      const last = int(0, 4) * 2 + (gender === 'M' ? 1 : 0); // NADRA: odd = male, even = female
      cnic = `${DISTRICT_PREFIX[district]}-${digits(7)}-${last}`;
    } while (usedCnics.has(cnic));
    usedCnics.add(cnic);

    const maritalStatus: MaritalStatus =
      gender === 'F' && rand() < 0.35 ? 'widowed' : pick(['married', 'married', 'single', 'divorced'] as const);
    people.push(
      person(
        cnic,
        fullName,
        `${pick(MALE)} ${surname}`,
        `${int(1950, 2002)}-${String(int(1, 12)).padStart(2, '0')}-${String(int(1, 28)).padStart(2, '0')}`,
        gender,
        district,
        maritalStatus,
      ),
    );

    const income = int(8, 60) * 1000;
    households.push(
      household(cnic, int(1, 10), income, district, Math.min(95, Math.round(income / 1000 + int(-5, 10))), rand() < 0.15),
    );

    if (rand() < 0.85) {
      let alias: string;
      do alias = `03${int(0, 4)}${digits(8)}`;
      while (usedAliases.has(alias));
      usedAliases.add(alias);
      const code = pick(['HABB', 'MEZN', 'UNIL', 'JSBL']);
      accounts.push({
        iban: `PK${digits(2)}${code}${digits(16)}`,
        alias,
        title: fullName.toUpperCase(),
        bank: BANKS[code]!,
        cnic,
      });
    }
  }

  return { people, households, accounts, programAccount: PROGRAM_ACCOUNT };
}
