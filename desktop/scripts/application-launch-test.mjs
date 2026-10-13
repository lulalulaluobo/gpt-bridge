import assert from 'node:assert/strict';
import { launchApplication } from '../bridge/application-launch.mjs';
let calls = [];
const launch = async (...args) => { calls.push(args); };
await assert.rejects(launchApplication({ app: 'Keynote' }, false, launch), /disabled/);
assert.equal(calls.length, 0);
for (const args of [{}, { app: '' }, { app: '/tmp/Test.app' }, { app: 'Keynote', command: 'id' }, { app: 'Keynote\n' }]) {
  await assert.rejects(launchApplication(args, true, launch));
}
assert.equal(calls.length, 0);
assert.equal((await launchApplication({ app: 'Keynote' }, true, launch)).status, 'launch_requested');
assert.deepEqual(calls[0].slice(0, 2), ['/usr/bin/open', ['-a', 'Keynote']]);
await launchApplication({ app: 'App;$(touch injected)' }, true, launch);
assert.deepEqual(calls[1][1], ['-a', 'App;$(touch injected)']);
await assert.rejects(launchApplication({ app: 'Missing' }, true, async () => { throw new Error('Application not found'); }), /not found/);
console.log('PASS: command gate, strict app name, shell-free argument array, launch receipt, errors preserved.');
