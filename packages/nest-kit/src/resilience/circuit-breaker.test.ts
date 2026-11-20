import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker';

test('opens after threshold failures, half-opens after reset, closes on success', async () => {
  let now = 0;
  const b = new CircuitBreaker('t', { failureThreshold: 2, resetAfterMs: 1000 }, () => now);
  const fail = () => Promise.reject(new Error('x'));

  await assert.rejects(b.exec(fail));
  assert.equal(b.status.state, 'CLOSED');
  await assert.rejects(b.exec(fail));
  assert.equal(b.status.state, 'OPEN');
  await assert.rejects(b.exec(fail), CircuitOpenError);

  now = 1000;
  assert.equal(b.status.state, 'HALF_OPEN');
  assert.equal(await b.exec(async () => 42), 42);
  assert.equal(b.status.state, 'CLOSED');
});

test('a failed trial call in HALF_OPEN re-opens immediately', async () => {
  let now = 0;
  const b = new CircuitBreaker('t', { failureThreshold: 1, resetAfterMs: 10 }, () => now);
  await assert.rejects(b.exec(() => Promise.reject(new Error('x'))));
  now = 10;
  await assert.rejects(b.exec(() => Promise.reject(new Error('x'))));
  assert.equal(b.status.state, 'OPEN');
});
