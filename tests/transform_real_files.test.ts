import { describe, it, expect } from '@jest/globals';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { normalizeCjsEsm } from '@/engine/runtime/normalizeCjsEsm';

describe('normalizeCjsEsm real files', () => {
  it('math.ts and use-math.ts transform without injecting module.exports inside class bodies', () => {
    const mathPath = 'initial_files/typescript/math.ts';
    const usePath = 'initial_files/typescript/use-math.ts';
    const mathSrc = readFileSync(mathPath, 'utf8');
    const useSrc = readFileSync(usePath, 'utf8');

    const outMath = normalizeCjsEsm(mathSrc);
    const outUse = normalizeCjsEsm(useSrc);

    // Write artifacts for final manual inspection
    const artifactsDir = 'tests/__artifacts__';
    if (!existsSync(artifactsDir)) mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(`${artifactsDir}/math.transformed.ts`, outMath, 'utf8');
    writeFileSync(`${artifactsDir}/use-math.transformed.ts`, outUse, 'utf8');

    // Find class Calculator in transformed math and ensure module.exports isn't inside it
    const classMatch = outMath.match(/class\s+Calculator[\s\S]*?\}/);
    expect(classMatch).not.toBeNull();
    if (classMatch) {
      expect(classMatch[0]).not.toContain('module.exports');
    }

    // Ensure use-math import lines were converted to __require__ calls
    expect(outUse).toContain("await __require__('./math')");
  });
});
