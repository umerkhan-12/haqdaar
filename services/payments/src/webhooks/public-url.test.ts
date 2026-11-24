import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, pinnedLookup, resolvePublicUrl } from './public-url';

/** The host exactly as the URL parser hands it over (it rewrites many spellings). */
const hostOf = (url: string) => new URL(url).hostname.replace(/^\[|\]$/g, '');

test('private, loopback and metadata IPv4 addresses are blocked', () => {
  for (const ip of [
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '192.0.2.10',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
  ])
    assert.equal(isBlockedAddress(ip), true, ip);
});

test('public addresses pass', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111', '2a00:1450::1'])
    assert.equal(isBlockedAddress(ip), false, ip);
});

test('IPv4 hidden inside IPv6 is judged by the IPv4 address', () => {
  assert.equal(hostOf('https://[::ffff:127.0.0.1]/'), '::ffff:7f00:1');
  for (const ip of [
    hostOf('https://[::ffff:127.0.0.1]/'),
    hostOf('https://[::ffff:169.254.169.254]/'),
    '::ffff:10.0.0.1',
    '::ffff:0:7f00:1',
    '::127.0.0.1',
    '::7f00:1',
    '::',
    '::1',
    '0:0:0:0:0:0:0:1',
    '2002:7f00:1::',
    '2002:a9fe:a9fe::1',
  ])
    assert.equal(isBlockedAddress(ip), true, ip);
  assert.equal(isBlockedAddress('::ffff:8.8.8.8'), false);
  assert.equal(isBlockedAddress('2002:808:808::1'), false);
});

test('NAT64, Teredo, unique-local, link-local and multicast IPv6 are blocked', () => {
  for (const ip of [
    '64:ff9b::7f00:1',
    '64:ff9b::808:808',
    hostOf('https://[64:ff9b::127.0.0.1]/'),
    '64:ff9b:1::1',
    '2001::1',
    '2001:db8::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'febf::1',
    'fec0::1',
    'ff02::1',
    '100::1',
  ])
    assert.equal(isBlockedAddress(ip), true, ip);
});

test('anything that is not an IP address is blocked', () => {
  assert.equal(isBlockedAddress('localhost'), true);
  assert.equal(isBlockedAddress(''), true);
});

test('only https URLs to public literal addresses resolve', async () => {
  await assert.rejects(resolvePublicUrl('http://8.8.8.8/hook'), /https/);
  await assert.rejects(resolvePublicUrl('https://[::ffff:127.0.0.1]/hook'), /public/);
  await assert.rejects(resolvePublicUrl('https://0x7f.1/hook'), /public/);
  await assert.rejects(resolvePublicUrl('https://2130706433/hook'), /public/);
  const t = await resolvePublicUrl('https://8.8.8.8/hook');
  assert.deepEqual([t.address, t.family], ['8.8.8.8', 4]);
});

test('the socket lookup always answers with the checked address', () => {
  const lookup = pinnedLookup('93.184.216.34', 4);
  lookup('example.com', {}, (err, address, family) => {
    assert.equal(err, null);
    assert.deepEqual([address, family], ['93.184.216.34', 4]);
  });
  lookup('example.com', { all: true }, (err, list) => {
    assert.equal(err, null);
    assert.deepEqual(list, [{ address: '93.184.216.34', family: 4 }]);
  });
});
