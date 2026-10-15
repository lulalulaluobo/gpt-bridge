import assert from 'node:assert/strict';
import { launchApplication } from '../bridge/application-launch.mjs';
import { launchWindowsApplication } from '../bridge/windows-applications.mjs';
let calls = [];
const launch = async (...args) => { calls.push(args); };
const call = (args, enabled = true) => launchApplication(args, enabled, launch, 'darwin');
await assert.rejects(call({ app: 'Keynote' }, false), /disabled/);
assert.equal(calls.length, 0);
for (const args of [{}, { app: '' }, { app: '/tmp/Test.app' }, { app: 'Keynote', command: 'id' }, { app: 'Keynote\n' }]) {
  await assert.rejects(call(args));
}
assert.equal(calls.length, 0);
assert.equal((await call({ app: 'Keynote' })).status, 'launch_requested');
assert.deepEqual(calls[0].slice(0, 2), ['/usr/bin/open', ['-a', 'Keynote']]);
await call({ app: 'App;$(touch injected)' });
assert.deepEqual(calls[1][1], ['-a', 'App;$(touch injected)']);
await assert.rejects(launchApplication({ app: 'Missing' }, true, async () => { throw new Error('Application not found'); }, 'darwin'), /not found/);
const windowsCalls = [];
const win = (args, enabled = true) => launchApplication(args, enabled, launch, 'win32', app => {
  launchWindowsApplication(app, (script, value) => { assert(!script.includes(value)); windowsCalls.push(value); });
});
await assert.rejects(win({ app: 'Notepad' }, false), /disabled/);
for (const args of [{ app: '../notepad.exe' }, { app: 'Notepad', command: 'id' }, { app: 'Notepad\n' }]) await assert.rejects(win(args));
assert.equal(windowsCalls.length, 0);
assert.equal((await win({ app: 'notepad.exe' })).status, 'launch_requested');
await win({ app: '中文 app;$(injection)' });
assert.deepEqual(windowsCalls, ['notepad.exe', '中文 app;$(injection)']);
console.log('PASS: Mac/Windows command gate, strict app names, shell-free launch, JSON stdin, launch receipts and errors.');
