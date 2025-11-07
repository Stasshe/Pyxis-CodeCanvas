import { parseGitignore, isPathIgnored } from '@/engine/core/gitignore';

describe('gitignore parser and matcher', () => {
  test('ignores node_modules and its contents', () => {
    const content = 'node_modules\n';
    const rules = parseGitignore(content);
    expect(isPathIgnored(rules, '/node_modules')).toBe(true);
    expect(isPathIgnored(rules, '/node_modules/is-even/README.md')).toBe(true);
    expect(isPathIgnored(rules, 'node_modules/inner/file.js')).toBe(true);
    expect(isPathIgnored(rules, 'src/node_modules/local.js')).toBe(true);
  });

  test('wildcard *.log ignores logs', () => {
    const content = '*.log\n';
    const rules = parseGitignore(content);
    expect(isPathIgnored(rules, 'error.log')).toBe(true);
  expect(isPathIgnored(rules, 'logs/error.log')).toBe(true); // pattern without slash matches basename anywhere
  });

  test('globstar **/dist ignores any dist folder', () => {
    const content = '**/dist/\n';
    const rules = parseGitignore(content);
    expect(isPathIgnored(rules, 'dist')).toBe(true);
    expect(isPathIgnored(rules, 'packages/foo/dist/index.js')).toBe(true);
  });

  test('negation (!) unignores matching files', () => {
    const content = 'node_modules\n!important.js\n';
    const rules = parseGitignore(content);
    expect(isPathIgnored(rules, 'node_modules/some.js')).toBe(true);
    expect(isPathIgnored(rules, 'important.js')).toBe(false);
  });
});
