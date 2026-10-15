import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queryMethods } from '../bridge/methods.mjs';
import { FilePermissions } from '../bridge/permissions.mjs';
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'methods-test-')));
try {
  const library = path.join(root, 'library'), outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(library, 'writing'), { recursive: true }); fs.mkdirSync(outside);
  const file = path.join(library, 'writing', 'SKILL.md');
  fs.writeFileSync(file, '---\nname: writing\ndescription: 中文写作规范\n---\nRead the task.\nDo not invent facts.');
  fs.writeFileSync(path.join(outside, 'SKILL.md'), 'secret');
  fs.symlinkSync(outside, path.join(library, 'escape'));
  fs.writeFileSync(path.join(library, 'officecli'), 'not a method');
  const permissions = new FilePermissions({ grants: [{ path: library, access: 'readOnly' }], protectedPaths: [path.join(root, 'private')] });
  const call = args => queryMethods({ library_path: library, ...args }, permissions);
  const result = call({ action: 'search', query: '写作' });
  assert.equal(result.results.length, 1); assert.equal(result.results[0].kind, 'method_document');
  let offset = 0, collected = [];
  do {
    const page = call({ action: 'read', document_path: result.results[0].document_path, offset, length: 2 });
    collected.push(page.text); offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(collected.join('\n'), fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, 'updated_unique_method');
  assert.equal(call({ action: 'search', query: 'updated_unique_method' }).matched, 1);
  assert.equal(call({ action: 'search', query: '写作' }).matched, 0);
  fs.writeFileSync(file, '---\nname: "Writing"\ndescription: >-\n  First line\n  second line\n---\nContent');
  const multiline = call({ action: 'search' }).results[0];
  assert.equal(multiline.title, 'Writing'); assert.equal(multiline.preview, 'First line second line');
  for (const args of [{ action: 'execute' }, { action: 'search', command: 'anything' },
    { action: 'search', limit: 0 }, { action: 'read', document_path: '../outside/SKILL.md' },
    { action: 'read', document_path: 'escape/SKILL.md' }, { action: 'read', document_path: 'officecli' },
    { action: 'read', document_path: 'writing/SKILL.md', offset: -1 }]) assert.throws(() => call(args));
  assert.throws(() => queryMethods({ action: 'search', library_path: root }, permissions));
  fs.writeFileSync(file, 'x'.repeat(256 * 1024 + 1));
  assert.throws(() => call({ action: 'read', document_path: 'writing/SKILL.md' }), /256 KiB/);
  assert.equal(call({ action: 'search' }).skipped, 2);
  console.log('PASS: method search, complete paged reading, live refresh, readonly grants, outside/symlink denial, no CLI indexing, invalid arguments and size limits');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
