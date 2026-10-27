import { describe, expect, it } from 'vitest';
import {
  resolveVersionSpec,
  satisfiesVersionSpec,
} from '@/engine/system/npm/install/versionSpec';

describe('npm version utils', () => {
  const versions = {
    '1.0.0': {},
    '1.2.0': {},
    '1.2.5': {},
    '1.3.0': {},
    '2.0.0': {},
  };

  it('resolves range specs to the highest matching registry version', () => {
    expect(resolveVersionSpec('^1.2.0', versions)).toBe('1.3.0');
    expect(resolveVersionSpec('~1.2.0', versions)).toBe('1.2.5');
    expect(resolveVersionSpec('>=1.2.0 <2.0.0', versions)).toBe('1.3.0');
    expect(resolveVersionSpec('1.x', versions)).toBe('1.3.0');
    expect(resolveVersionSpec('1', versions)).toBe('1.3.0');
    expect(resolveVersionSpec('1.2', versions)).toBe('1.2.5');
    expect(resolveVersionSpec('^0.0.3', { '0.0.3': {}, '0.0.4': {} })).toBe('0.0.3');
    expect(
      resolveVersionSpec('>= 2.1.2 < 3.0.0', {
        '2.1.2': {},
        '2.9.9': {},
        '3.0.0': {},
      })
    ).toBe('2.9.9');
  });

  it('checks installed versions against dependency specs', () => {
    expect(satisfiesVersionSpec('1.3.0', '^1.2.0')).toBe(true);
    expect(satisfiesVersionSpec('1.2.5', '~1.2.0')).toBe(true);
    expect(satisfiesVersionSpec('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesVersionSpec('1.3.0', '>=1.2.0 <2.0.0')).toBe(true);
    expect(satisfiesVersionSpec('1.3.0', '1')).toBe(true);
    expect(satisfiesVersionSpec('1.3.0', '1.2')).toBe(false);
    expect(satisfiesVersionSpec('1.2.5', '1.2')).toBe(true);
    expect(satisfiesVersionSpec('2.9.9', '>= 2.1.2 < 3.0.0')).toBe(true);
    expect(satisfiesVersionSpec('3.0.0', '>= 2.1.2 < 3.0.0')).toBe(false);
  });

  it('prefers a satisfying latest tag without changing exact or out-of-range requests', () => {
    const available = { '1.3.0': {}, '1.3.1': {}, '2.0.0': {} };

    expect(resolveVersionSpec('^1.3.0', available, '1.3.0')).toBe('1.3.0');
    expect(resolveVersionSpec('1.3.1', available, '1.3.0')).toBe('1.3.1');
    expect(resolveVersionSpec('>=1.3.1 <2.0.0', available, '1.3.0')).toBe('1.3.1');
    expect(resolveVersionSpec('^1.3.0', available, '9.0.0')).toBe('1.3.1');
  });
});
