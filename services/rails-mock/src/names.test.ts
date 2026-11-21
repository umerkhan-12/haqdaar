import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jaroWinkler, nameScore, normalizeName } from './names';

test('spelling variants of Muhammad and Bibi normalize to the same name', () => {
  assert.equal(nameScore('Muhammad Akram', 'Mohammad Akram'), 1);
  assert.equal(nameScore('Muhammed Akram', 'MD. AKRAM'), 1);
  assert.equal(nameScore('Nasreen Bibi', 'Nasreen Bi Bi'), 1);
});

test('Urdu-script record matches the spoken Latin name', () => {
  assert.equal(normalizeName('شازیہ بی بی'), 'shazia bibi');
  assert.equal(nameScore('Shazia Bibi', 'شازیہ بی بی'), 1);
});

test('word order does not matter', () => {
  assert.equal(nameScore('Bibi Zainab', 'Zainab Bibi'), 1);
});

test('a slight difference scores high but not perfect; different people score low', () => {
  const slight = nameScore('Kaneez Fatma', 'Kaneez Fatima');
  assert.ok(slight > 0.9 && slight < 1, `got ${slight}`);
  assert.ok(nameScore('Zainab Bibi', 'Muhammad Aslam') < 0.6);
});

test('jaro-winkler reference value', () => {
  assert.equal(Math.round(jaroWinkler('martha', 'marhta') * 1000) / 1000, 0.961);
});
