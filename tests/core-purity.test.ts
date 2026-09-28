import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_DIR = fileURLToPath(new URL('../src/core', import.meta.url));
const coreFiles = existsSync(CORE_DIR)
  ? (readdirSync(CORE_DIR, { recursive: true, encoding: 'utf8' }) as string[])
      .filter((f) => f.endsWith('.ts'))
  : [];

describe('src/core purity', () => {
  it('scans the real core directory', () => {
    // If src/core moves, this fails instead of the purity checks silently scanning nothing.
    expect(existsSync(CORE_DIR)).toBe(true);
  });

  for (const file of coreFiles) {
    const filePath = join(CORE_DIR, file);
    const source = readFileSync(filePath, 'utf8');

    it(`${file} imports only modules inside src/core`, () => {
      const specifiers = [
        ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
        ...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g),
        ...source.matchAll(/\bimport\s+['"]([^'"]+)['"]/g),
        ...source.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]/g),
      ]
        .map((m) => m[1])
        .filter((s): s is string => s !== undefined);
      const coreDirResolved: string = resolve(CORE_DIR);
      for (const spec of specifiers) {
        expect(spec, `${file}: ${spec}`).toMatch(/^\.\.?\//);
        const resolved: string = resolve(dirname(filePath), spec);
        const rel = relative(coreDirResolved, resolved);
        expect(
          rel.startsWith('..') || isAbsolute(rel),
          `${file}: ${spec} escapes src/core`,
        ).toBe(false);
      }
    });

    it(`${file} uses no browser globals`, () => {
      expect(source).not.toMatch(/\b(document|window|localStorage|sessionStorage)\s*[.[]/);
    });
  }
});
