// cmc — syntax check for every module (no dependencies, no build). Author: Peterson Sena (r3v3rs3).
import { spawnSync } from 'node:child_process';
import { readdirSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['plugins', 'test', 'test-support', 'scripts'];

function modulesIn(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return modulesIn(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const files = ROOTS.flatMap(modulesIn);
const failed = files.filter((file) => {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) process.stderr.write(result.stderr);
  return result.status !== 0;
});

process.stdout.write(`lint: ${files.length} modules checked, ${failed.length} failed\n`);
process.exit(failed.length === 0 ? 0 : 1);
