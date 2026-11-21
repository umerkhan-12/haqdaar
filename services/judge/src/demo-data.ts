/** Demo accounts and helper families (docs/CONTRACTS.md). Synthetic data only. */
export const ACCOUNTS = {
  citizen: '03001110001',
  helper: '03001110002',
  officer: '03001110003',
  officer2: '03001110006',
  admin: '03001110004',
  auditor: '03001110005',
} as const;

export type DemoRole = keyof typeof ACCOUNTS;

export interface Family {
  personId: string;
  pin: string;
  fullName: string;
  cnic: string;
  district: string;
  householdSize: number;
  alias: string;
}

const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;

export const FAMILIES = {
  zainab: {
    personId: id(1),
    pin: '1111',
    fullName: 'Zainab Bibi',
    cnic: '42201-1234567-4',
    district: 'Thatta',
    householdSize: 5,
    alias: '03001110001',
  },
  rashida: {
    personId: id(2),
    pin: '2222',
    fullName: 'Rashida Begum',
    cnic: '42201-7654321-2',
    district: 'Karachi West',
    householdSize: 7,
    alias: '03001110007',
  },
  nasreen: {
    personId: id(3),
    pin: '3333',
    fullName: 'Nasreen Bi Bi',
    cnic: '42401-3344556-6',
    district: 'Karachi West',
    householdSize: 8,
    alias: '03451234504',
  },
  kaneez: {
    personId: id(4),
    pin: '4444',
    fullName: 'Kaneez Fatma',
    cnic: '42101-6677889-4',
    district: 'Karachi East',
    householdSize: 6,
    alias: '03151234506',
  },
  zainabBadin: {
    personId: id(5),
    pin: '5555',
    fullName: 'Zainab Bibi',
    cnic: '41201-4455667-2',
    district: 'Badin',
    householdSize: 4,
    alias: '03121234501',
  },
  akram: {
    personId: id(6),
    pin: '6666',
    fullName: 'Muhammad Akram',
    cnic: '41101-5566778-3',
    district: 'Hyderabad',
    householdSize: 3,
    alias: '03331234503',
  },
  shazia: {
    personId: id(8),
    pin: '8888',
    fullName: 'Shazia Bibi',
    cnic: '43201-1122334-8',
    district: 'Sukkur',
    householdSize: 5,
    alias: '03011234505',
  },
} satisfies Record<string, Family>;

export const MULE_ALIAS = '03009990000';
