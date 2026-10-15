import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configuredMethods } from '../bridge/method-library.mjs';
import { windows, privateDirectory, runPowerShell } from '../bridge/platform.mjs';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'library-config-')));
if (windows) privateDirectory(root);
try {
  const state = path.join(root, 'state'), docs = path.join(root, 'docs');
  fs.mkdirSync(state); fs.mkdirSync(docs);
  const config = path.join(state, 'method-library.json');
  const save = directories => fs.writeFileSync(config, JSON.stringify({ schemaVersion: 1, directories }), { mode: 0o600 });
  const call = args => configuredMethods(args, state, [state]);
  assert.deepEqual(call({ action: 'list' }).directories, []);
  assert.throws(() => call({ action: 'search' }));
  save([docs]);
  for (let i = 0; i < 24; i++) {
    const folder = path.join(docs, `method-${i}`); fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'SKILL.md'), `Method ${i}`);
  }
  const first = call({ action: 'search' });
  assert.equal(first.results.length, 20); assert.equal(first.matched, 24); assert.equal(first.nextOffset, 20);
  const second = call({ action: 'search', offset: first.nextOffset });
  assert.equal(second.results.length, 4); assert.equal(second.nextOffset, null);
  const row = first.results[0];
  if (windows) assert.equal(call({ action: 'search', library_path: docs.toUpperCase() }).matched, 24);
  assert(call({ action: 'read', library_path: row.library_path, document_path: row.document_path }).text.startsWith('Method'));
  assert.throws(() => call({ action: 'search', library_path: root }));
  save([]);
  assert.throws(() => call({ action: 'read', library_path: row.library_path, document_path: row.document_path }));
  save([state]); assert.equal(call({ action: 'list' }).errors.length, 1);
  if (windows) {
    runPowerShell(`$p = [Console]::In.ReadToEnd() | ConvertFrom-Json;
      $acl = [IO.File]::GetAccessControl($p);
      $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new('S-1-1-0'), 'Read', 'Allow'));
      [IO.File]::SetAccessControl($p, $acl);`, config);
  } else fs.chmodSync(config, 0o644);
  assert.throws(() => call({ action: 'list' }));
  console.log('PASS: shared configuration, discovery, search paging, readonly document access, immediate revocation, protected paths and private config');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
