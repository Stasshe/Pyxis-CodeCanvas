import { parseCommandLine } from '@/engine/cmd/shell/parser';

describe('parser AST extra tests', () => {
  test('backtick inside double quotes is preserved as placeholder and quote=double', () => {
    const segs = parseCommandLine('echo "a `echo b` c"');
    expect(segs.length).toBeGreaterThan(0);
    const toks = segs[0].tokens as any[];
    // tokens: [ 'echo', { text: 'a __CMD_SUB_0__ c', quote: 'double' } ] (approx)
    expect(toks.length).toBeGreaterThanOrEqual(2);
    const second = toks[1];
    expect(typeof second).toBe('object');
    expect(second.quote).toBe('double');
    // should contain placeholder marker
    expect(second.text).toMatch(/__CMD_SUB_\d+__/);
  });

  test('escaped spaces and quoted segments produce correct token texts', () => {
    const segs = parseCommandLine("echo a\\ b \"c d\"");
    const toks = segs[0].tokens as any[];
    // tokens should be: echo, 'a b', 'c d'
    expect(toks.length).toBe(3);
    expect(toks[0].text === 'echo' || toks[0] === 'echo').toBeTruthy();
    expect(toks[1].text).toBe('a b');
    expect(toks[2].text).toBe('c d');
  });

  test('multi-line file parsing simulation: split lines and parse each', () => {
    const script = `# simple script\nVAR=foo\necho $VAR\nfor i in a b; do echo $i; done\n`;
  const lines = script.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const parsed = lines.map(l => parseCommandLine(l, { VAR: 'foo' } as any));
  // assignment line
  expect(parsed[0][0].tokens[0].text).toMatch(/VAR=foo/);
    // echo line
    const echoToks = parsed[1][0].tokens as any[];
    expect(echoToks.length).toBeGreaterThanOrEqual(2);
    expect(echoToks[1].text).toBe('foo');
    // for line should at least parse 'for' token
    const forToks = parsed[2][0].tokens as any[];
    expect(forToks[0].text).toMatch(/for/);
  });
});
