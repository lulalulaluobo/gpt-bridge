import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComputerUse } from '../bridge/computer-use.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cu-test-'));
const target = { pid: 12, started: 'original', executable: '/test/app' };
let live = target, calls = [], closes = 0, pending;
const policy = value => fs.writeFileSync(path.join(root, 'computer-use.json'), JSON.stringify(value), { mode: 0o600 });
const enable = () => policy({ id: 'session', enabled: true, target, expires: Date.now() + 60000 });
const backend = { pid: 13, close: async () => { closes++; pending?.({ isError: true }); }, callTool: async args => {
  calls.push(args);
  if (args.name === 'see') return { content: [{ type: 'image', mimeType: 'image/png', data: 'test' }],
    _meta: { snapshot_id: 's1', target_receipt: { pid: 12, window_id: 7 }, ui_elements: [{ id: 'e1', is_actionable: true, role: 'button', title: 'Test' }] } };
  return { isError: true, _meta: { mutation_dispatched: true, effect: 'unverifiable' } };
} };
const control = new ComputerUse({ root, connect: async () => backend, identity: () => live });
const observe = async () => {
  const r = await control.call('computer_observe', {});
  assert(!r.isError); assert.equal(r.content[1].type, 'image');
  return JSON.parse(r.content[0].text).observation;
};
try {
  policy({ enabled: false });
  assert((await control.call('computer_observe', {})).isError); assert.equal(calls.length, 0);
  enable();
  assert((await control.call('computer_observe', { pid: 99 })).isError);
  const observation = await observe();
  assert((await control.call('computer_click', { observation, element: 'outside' })).isError);
  const result = JSON.parse((await control.call('computer_click', { observation, element: 'e1' })).content[0].text);
  assert.equal(result.mutationDispatched, true); assert.equal(result.retrySafe, false); assert.equal(result.effect, 'unverifiable');
  assert((await control.call('computer_click', { observation, element: 'e1' })).isError);
  assert.equal(calls.filter(c => c.name === 'click').length, 1);
  await observe(); live = { ...target, started: 'reused' };
  assert((await control.call('computer_type', { observation: control.observation.id, element: 'e1', text: 'no' })).isError);
  await control.check(); assert.equal(control.backend, null); assert.equal(closes, 1);
  live = target; enable(); await observe();
  policy({ enabled: false }); await control.check();
  assert.equal(control.backend, null); assert.equal(control.windowID, null);
  assert((await control.call('computer_observe', {})).isError);
  enable(); await observe();
  policy({ enabled: true, id: 'session', target, expires: Date.now() - 1 }); await control.check();
  assert.equal(control.backend, null);
  // Revoking during backend startup must close it before any screen access.
  enable();
  let finishConnect;
  const starting = new ComputerUse({ root, identity: () => live,
    connect: () => new Promise(resolve => { finishConnect = resolve; }) });
  const opening = starting.call('computer_observe', {});
  await new Promise(resolve => setImmediate(resolve));
  policy({ enabled: false }); await starting.check();
  const previousCalls = calls.length;
  finishConnect(backend);
  assert((await opening).isError); assert.equal(calls.length, previousCalls);
  console.log('PASS: disabled gate, strict arguments, screenshot, target identity, stale observation, no action replay, stop, expiry.');
} finally { await control.revoke(); fs.rmSync(root, { recursive: true, force: true }); }
