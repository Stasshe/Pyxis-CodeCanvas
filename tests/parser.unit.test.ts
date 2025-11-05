import { parseCommandLine } from '@/engine/cmd/shell/parser';

describe('parser unit', () => {
  test('parse command-substitution marker', () => {
    const segs = parseCommandLine('echo $(echo a)');
    expect(segs.length).toBeGreaterThan(0);
    const toks = segs[0].tokens;
    // Expect at least one token that is a JSON string containing cmdSub
    const found = toks.some(t => typeof t === 'string' && t.includes('cmdSub'));
    expect(found).toBe(true);
  });

  test('variable expansion works with env param', () => {
    const segs = parseCommandLine('echo $FOO', { FOO: 'bar' } as any);
  if (segs[0].tokens[1] !== 'bar') throw new Error('tokens: ' + JSON.stringify(segs[0].tokens));
  });
});
