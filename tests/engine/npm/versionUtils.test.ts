import {
  resolveVersionSpec,
  satisfiesVersionSpec,
} from '@/engine/cmd/global/npmOperations/install/versionUtils';
import { describe, expect, it } from 'vitest';

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
    expect(resolveVersionSpec('^0.0.3', { '0.0.3': {}, '0.0.4': {} })).toBe('0.0.3');
  });

  it('checks installed versions against dependency specs', () => {
    expect(satisfiesVersionSpec('1.3.0', '^1.2.0')).toBe(true);
    expect(satisfiesVersionSpec('1.2.5', '~1.2.0')).toBe(true);
    expect(satisfiesVersionSpec('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfiesVersionSpec('1.3.0', '>=1.2.0 <2.0.0')).toBe(true);
  });
});
