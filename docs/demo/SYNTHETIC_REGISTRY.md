# Synthetic registry: every record in the simulated identity, household and bank services

> **All people here are invented.** These rows stand in for the NADRA identity record, the household registry and bank account titles. A CNIC that is not in this sheet gets "not found" and goes to an officer.

33 people. Source: `services/rails-mock/src/data/seed-data.ts` (the first 9 are written by hand, the rest are generated from a fixed seed, so the list is the same on every start). Rules: 1 alive, 2 programme district (Thatta, Sujawal, Badin, Tharparkar, Karachi West), 3 widow or 5+ members, 4 income under 40,000.

| Name                     | CNIC            | District     | Status   | Family | Income | Mobile account | Expected                                                           |
| ------------------------ | --------------- | ------------ | -------- | ------ | ------ | -------------- | ------------------------------------------------------------------ |
| Zainab Bibi              | 42201-1234567-4 | Thatta       | widowed  | 5      | 18,000 | 03001110001    | Eligible                                                           |
| Rashida Begum            | 42201-7654321-2 | Karachi West | married  | 7      | 22,000 | 03001110007    | Eligible                                                           |
| Zainab Bibi              | 41201-4455667-2 | Badin        | married  | 4      | 35,000 | 03121234501    | Officer: rule 3 not widow, under 5 members                         |
| Muhammad Akram           | 41101-2233445-1 | Hyderabad    | married  | 6      | 28,000 | 03211234502    | Officer: rule 2 district                                           |
| Mohammad Akram           | 41101-5566778-3 | Hyderabad    | married  | 3      | 52,000 | 03331234503    | Officer: rule 2 district; 3 not widow, under 5 members; 4 income   |
| Nasreen Bi Bi            | 42401-3344556-6 | Karachi West | widowed  | 8      | 16,000 | 03451234504    | Eligible                                                           |
| شازیہ بی بی              | 43201-1122334-8 | Sukkur       | widowed  | 5      | 20,000 | 03011234505    | Officer: rule 2 district                                           |
| Kaneez Fatima            | 42101-6677889-4 | Karachi East | widowed  | 6      | 19,000 | 03151234506    | Officer: rule 2 district                                           |
| Ghulam Rasool (deceased) | 44201-9988776-5 | Larkana      | married  | 4      | 12,000 | none           | Officer: rule 1 deceased; 2 district; 3 not widow, under 5 members |
| Faisal Siddiqui          | 43202-9581681-5 | Sukkur       | married  | 9      | 29,000 | 03294747202    | Officer: rule 2 district                                           |
| Fatima Bibi              | 43202-3506894-8 | Sukkur       | single   | 8      | 31,000 | none           | Officer: rule 2 district                                           |
| Shabana Begum            | 44102-2813148-2 | Tharparkar   | single   | 5      | 33,000 | none           | Eligible                                                           |
| Sakina Khatoon           | 42202-7417913-6 | Thatta       | single   | 10     | 46,000 | 03016737647    | Officer: rule 4 income                                             |
| Fatima Begum             | 43302-0564735-6 | Dadu         | married  | 4      | 21,000 | 03414526753    | Officer: rule 2 district; 3 not widow, under 5 members             |
| Hajra Begum              | 44102-7017291-4 | Tharparkar   | married  | 9      | 52,000 | 03284015967    | Officer: rule 4 income                                             |
| Hajra Bi Bi              | 44302-3351654-6 | Mirpurkhas   | single   | 3      | 24,000 | 03083969012    | Officer: rule 2 district; 3 not widow, under 5 members             |
| Razia Bibi               | 42102-1728509-4 | Karachi East | married  | 2      | 22,000 | none           | Officer: rule 2 district; 3 not widow, under 5 members             |
| Parveen Begum            | 44302-0661826-0 | Mirpurkhas   | widowed  | 1      | 8,000  | 03276879317    | Officer: rule 2 district                                           |
| Khadija Begum            | 43202-7213699-8 | Sukkur       | widowed  | 2      | 33,000 | 03144800486    | Officer: rule 2 district                                           |
| Saima Khatoon            | 42102-4087643-8 | Karachi East | widowed  | 5      | 18,000 | 03075038160    | Officer: rule 2 district                                           |
| Parveen Khatoon          | 43202-7779431-6 | Sukkur       | single   | 2      | 26,000 | none           | Officer: rule 2 district; 3 not widow, under 5 members             |
| Razia Bi Bi              | 42402-1599966-0 | Karachi West | widowed  | 5      | 51,000 | 03263214003    | Officer: rule 4 income                                             |
| Saima Bi Bi              | 43202-6848363-0 | Sukkur       | divorced | 5      | 58,000 | 03364686967    | Officer: rule 2 district; 4 income                                 |
| Imran Baloch             | 43302-1693700-9 | Dadu         | married  | 2      | 37,000 | 03020805221    | Officer: rule 2 district; 3 not widow, under 5 members             |
| Asif Shah                | 42402-3013916-7 | Karachi West | married  | 1      | 59,000 | 03449040502    | Officer: rule 3 not widow, under 5 members; 4 income               |
| Rafiq Soomro             | 44102-9319210-1 | Tharparkar   | married  | 4      | 56,000 | 03393963156    | Officer: rule 3 not widow, under 5 members; 4 income               |
| Allah Dino Baloch        | 41202-2430854-5 | Badin        | married  | 10     | 26,000 | 03054333646    | Eligible                                                           |
| Asif Brohi               | 42202-8726077-7 | Thatta       | single   | 3      | 60,000 | 03474383072    | Officer: rule 3 not widow, under 5 members; 4 income               |
| Allah Dino Chandio       | 41202-9202708-7 | Badin        | single   | 1      | 54,000 | 03110585859    | Officer: rule 3 not widow, under 5 members; 4 income               |
| Parveen Begum            | 43302-2190637-6 | Dadu         | widowed  | 6      | 52,000 | 03251401058    | Officer: rule 2 district; 4 income                                 |
| Rukhsana Begum           | 42102-7411445-0 | Karachi East | widowed  | 5      | 56,000 | 03465189236    | Officer: rule 2 district; 4 income                                 |
| Shahid Qureshi           | 42102-8115938-1 | Karachi East | divorced | 8      | 8,000  | none           | Officer: rule 2 district                                           |
| Ayesha Begum             | 43202-9663668-8 | Sukkur       | married  | 7      | 54,000 | 03143981981    | Officer: rule 2 district; 4 income                                 |

Also in the bank: the fraud account `03009990000`, title "MUHAMMAD ASLAM" (belongs to none of these people), and the programme's own paying account.
