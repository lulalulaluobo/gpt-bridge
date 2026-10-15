import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queryObsidian } from '../bridge/obsidian.mjs';
import { FilePermissions } from '../bridge/permissions.mjs';
import { windows } from '../bridge/platform.mjs';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-probe-')));
try {
  const vault = path.join(root, 'Notes'), privateRoot = path.join(root, 'private');
  fs.mkdirSync(path.join(vault, '.obsidian'), { recursive: true }); fs.mkdirSync(privateRoot);
  fs.writeFileSync(path.join(vault, 'rule.md'), 'one\ntwo\nthree');
  fs.writeFileSync(path.join(root, 'outside.md'), 'not allowed');
  fs.mkdirSync(path.join(root, 'outside'));
  fs.writeFileSync(path.join(root, 'outside', 'rule.md'), 'not allowed');
  fs.symlinkSync(path.join(root, 'outside'), path.join(vault, 'escape'), windows ? 'junction' : 'dir');
  const permissions = new FilePermissions({ grants: [{ path: vault, access: 'readOnly' }], protectedPaths: [privateRoot] });
  const calls = [];
  const runner = async (exe, args, options) => {
    calls.push(args); assert.equal(options.shell, undefined); assert.equal(options.windowsHide, true);
    assert.equal(exe, 'official-cli-fixture');
    assert.equal(args[0], 'vault=Notes');
    if (args[1] === 'vault') return { stdout: vault + '\n' };
    if (args[1] === 'search') return { stdout: JSON.stringify(['rule.md', 'escape/rule.md', '../outside.md', '.obsidian/config.md']) };
    if (args[1] === 'read') return { stdout: 'one\ntwo\nthree\n' };
    throw new Error('Unexpected command');
  };
  const resolve = () => 'official-cli-fixture';
  const call = args => queryObsidian({ vault_path: vault, ...args }, permissions, runner, resolve);
  assert.equal((await call({ action: 'status' })).connected, true);
  assert.deepEqual((await call({ action: 'search', query: 'rules' })).paths, ['rule.md']);
  const result = await call({ action: 'read', note_path: 'rule.md', offset: 1, length: 1 });
  assert.equal(result.text, 'two'); assert.equal(result.nextOffset, 2);
  for (const args of [{ action: 'eval' }, { action: 'read', note_path: '../outside.md' },
    { action: 'read', note_path: 'escape/rule.md' }, { action: 'search', query: 'x\ncreate' },
    { action: 'search', query: 'x', limit: 100 }, { action: 'read', note_path: 'rule.md', command: 'delete' }]) {
    const before = calls.length;
    await assert.rejects(call(args)); assert.equal(calls.length, before);
  }
  await assert.rejects(queryObsidian({ action: 'status', vault_path: root }, permissions, runner, resolve));
  await assert.rejects(queryObsidian({ action: 'status', vault_path: vault }, permissions, async () => ({ stdout: root }), resolve));
  await assert.rejects(queryObsidian({ action: 'status', vault_path: vault }, permissions, async () => { throw new Error('timeout'); }, resolve), /CLI unavailable/);
  console.log('PASS: read-only Obsidian actions, paging, vault identity, path permissions, symlink escape, argument validation and CLI failure');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
