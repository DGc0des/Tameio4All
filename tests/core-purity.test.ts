import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = fileURLToPath(new URL('../src/core', import.meta.url));
const coreFiles = readdirSync(CORE_DIR).filter((f) => f.endsWith('.ts'));

describe('src/core purity', () => {
  it('scans the real core directory', () => {
    // If src/core moves, this fails instead of the purity checks silently scanning nothing.
    expect(existsSync(join(CORE_DIR, '..', 'core'))).toBe(true);
  });

  for (const file of coreFiles) {
    const source = readFileSync(join(CORE_DIR, file), 'utf8');

    it(`${file} imports only relative ./ modules`, () => {
      const specifiers = [
        ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
        ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
      ].map((m) => m[1]);
      for (const spec of specifiers) expect(spec, `${file}: ${spec}`).toMatch(/^\.\//);
    });

    it(`${file} uses no browser globals`, () => {
      expect(source).not.toMatch(/\b(document|window|localStorage|sessionStorage)\s*[.[]/);
    });
  }
});
