// cmc — the plugin manifest is loadable and points at files that exist. Author: Peterson Sena (r3v3rs3).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'cmc');
const readJson = (path) => JSON.parse(readFileSync(join(root, path), 'utf8'));

describe('plugin skeleton', () => {
  it('declares name, version and author in the manifest', () => {
    const manifest = readJson('.claude-plugin/plugin.json');
    assert.equal(manifest.name, 'cmc');
    assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
    assert.match(manifest.author.name, /Peterson Sena/);
  });

  it('only registers hook scripts that exist', () => {
    const { hooks } = readJson('hooks/hooks.json');
    const commands = Object.values(hooks).flatMap((groups) =>
      groups.flatMap((group) => group.hooks.map((hook) => hook.command)),
    );
    for (const command of commands) {
      const script = command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/)?.[1];
      assert.ok(script, `hook command does not use CLAUDE_PLUGIN_ROOT: ${command}`);
      assert.ok(existsSync(join(root, script)), `missing hook script: ${script}`);
    }
  });
});
