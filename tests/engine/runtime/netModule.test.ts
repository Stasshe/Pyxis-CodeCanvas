import * as nodeNet from 'node:net';
import { describe, expect, it } from 'vitest';
import * as net from '@/engine/runtime/nodejs/modules/netModule';

describe('Node net address helpers', () => {
  it('identifies strict IPv4 and IPv6 addresses', () => {
    for (const address of ['127.0.0.1', '0.0.0.0', '255.255.255.255']) {
      expect(net.isIPv4(address)).toBe(true);
      expect(net.isIP(address)).toBe(4);
    }
    for (const address of ['::1', '2001:db8::1', '::ffff:192.0.2.1', 'fe80::1%eth0']) {
      expect(net.isIPv6(address)).toBe(true);
      expect(net.isIP(address)).toBe(6);
    }
  });

  it('rejects malformed addresses and IPv4 leading zeroes', () => {
    for (const address of [
      '127.000.000.001',
      '256.0.0.1',
      '127.0.0.1/24',
      '1:2:3:4:5:6:7',
      '1::2::3',
      '::ffff:192.168.001.1',
      'fe80::1%',
      'fe80::1%en_0',
      '192.168.0.1::',
      '[::1]',
    ]) {
      expect(net.isIP(address)).toBe(0);
      expect(net.isIPv4(address)).toBe(false);
      expect(net.isIPv6(address)).toBe(false);
    }
  });

  it('returns zero for non-string inputs', () => {
    expect(net.isIP(null)).toBe(0);
    expect(net.isIPv4(127)).toBe(false);
    expect(net.isIPv6(undefined)).toBe(false);
  });

  it('matches the local Node runtime on address edge cases', () => {
    const addresses = [
      '01.2.3.4',
      '255.255.255.255',
      '2001:db8::1',
      '::ffff:192.0.2.1',
      '::ffff:192.168.001.1',
      'fe80::1%eth0',
      'fe80::1%',
      'fe80::1%en_0',
      '192.168.0.1::',
      '1:2:3:4:5:6:7:8',
      '1:2:3:4:5:6:7::',
      '1:2:3:4:5:6:7:8::',
      '1::2::3',
    ];

    for (const address of addresses) {
      expect(net.isIP(address)).toBe(nodeNet.isIP(address));
      expect(net.isIPv4(address)).toBe(nodeNet.isIPv4(address));
      expect(net.isIPv6(address)).toBe(nodeNet.isIPv6(address));
    }
  });
});
