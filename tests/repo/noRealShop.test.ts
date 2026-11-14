import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

function filesMatching(re: RegExp): string[] {
  const hits: string[] = [];
  for (const dir of ['src', 'tests', 'supabase']) {
    const base = join(ROOT, dir);
    for (const f of readdirSync(base, { recursive: true, encoding: 'utf8' }) as string[]) {
      const path = join(base, f);
      if (path === SELF || !/\.(ts|tsx|sql|md|json|css|html)$/.test(f)) continue;
      if (re.test(readFileSync(path, 'utf8'))) hits.push(relative(ROOT, path));
    }
  }
  return hits.sort();
}

it('names no real business in shipped code, tests or SQL', () => {
  expect(filesMatching(/join\s*juice/i)).toEqual([]);
});
