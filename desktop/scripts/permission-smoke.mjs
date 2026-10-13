import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { FilePermissions, loadPolicy } from '../bridge/permissions.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gpt-bridge permissions ' ")));
const rw = path.join(root, 'project'), ro = path.join(rw, 'reference'), outside = path.join(root, 'outside');
const protectedDirectory = path.join(rw, 'private-state');
for (const directory of [rw, ro, outside, protectedDirectory]) fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(rw, 'working.txt'), 'working');
fs.writeFileSync(path.join(ro, 'notes.txt'), 'notes');
fs.writeFileSync(path.join(protectedDirectory, 'sensitive.txt'), 'private');
fs.symlinkSync(outside, path.join(rw, 'escape'));
fs.symlinkSync(path.join(outside, 'missing'), path.join(rw, 'dangling'));
fs.symlinkSync(ro, path.join(rw, 'ro-link'));
const policyFile = path.join(root, 'policy.json');
fs.writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1, workspaceID: 'tests', workspaceRoot: rw,
  allowCommands: false, grants: [{ path: rw, access: 'readWrite' }, { path: ro, access: 'readOnly' }],
  protectedPaths: [protectedDirectory] }), { mode: 0o600 });
let checks = 0;
const rejected = fn => { assert.throws(fn); checks++; };
try {
  const permissions = new FilePermissions(loadPolicy(policyFile));
  assert.equal(permissions.authorize(path.join(ro, 'notes.txt')), path.join(ro, 'notes.txt')); checks++;
  assert.equal(permissions.authorize(path.join(rw, 'new/nested.txt'), 'write'), path.join(rw, 'new/nested.txt')); checks++;
  rejected(() => permissions.authorize(path.join(ro, 'new.txt'), 'write'));
  rejected(() => permissions.authorize(path.join(rw, 'ro-link/new.txt'), 'write'));
  rejected(() => permissions.authorize(path.join(outside, 'file.txt')));
  rejected(() => permissions.authorize(path.join(rw, 'escape/new/deep.txt'), 'write'));
  rejected(() => permissions.authorize(path.join(rw, 'dangling/new.txt')));
  rejected(() => permissions.authorize(path.join(protectedDirectory, 'sensitive.txt')));
  rejected(() => permissions.authorize('https://example.com'));
  rejected(() => permissions.authorize('working.txt'));
  rejected(() => permissions.move(path.join(ro, 'notes.txt'), path.join(rw, 'moved.txt')));
  rejected(() => permissions.move(path.join(rw, 'working.txt'), path.join(ro, 'moved.txt')));
  rejected(() => permissions.move(rw, path.join(rw, 'copy')));
  const listed = permissions.list(rw, 3);
  assert(listed.includes('reference/notes.txt') && !listed.includes('sensitive.txt') && !listed.includes('private-state') && !listed.includes('escape')); checks++;
  rejected(() => permissions.searchRoot(rw));
  assert.equal(permissions.searchRoot(ro), ro); checks++;
  fs.linkSync(path.join(rw, 'working.txt'), path.join(outside, 'linked.txt'));
  rejected(() => permissions.authorize(path.join(rw, 'working.txt')));
  fs.chmodSync(policyFile, 0o644); rejected(() => loadPolicy(policyFile));
  console.log(JSON.stringify({ passed: true, checks, nestedReadOnlyOverrides: true, realAncestorResolution: true,
    symlinkEscapeDenied: true, hardLinkDenied: true, protectedSubtreeHidden: true, moveBothSidesChecked: true }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
