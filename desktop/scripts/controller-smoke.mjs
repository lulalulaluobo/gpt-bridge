import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const resources = path.resolve(process.argv[2]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'MacBridge-controller-'));
const input = { id: '00000000-0000-0000-0000-000000000001', name: 'invalid test', tunnelID: 'invalid', workspace: root };
try {
  const lock = path.join(root, 'control.lock');
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 99999999, started: 'never', executable: '/no-such-process' }));
  const result = spawnSync(path.join(resources, 'runtime/bin/node'), [path.join(resources, 'bridge/control.mjs'), 'start', root],
    { encoding: 'utf8', input: JSON.stringify(input), env: { HOME: os.homedir(), PATH: '/usr/bin:/bin', MACBRIDGE_RUNTIME_KEY: 'synthetic-not-a-real-key' } });
  assert.equal(result.status, 1);
  assert(JSON.parse(result.stdout).error.includes('格式无效'));
  assert(!result.stdout.includes('synthetic-not-a-real-key'));
  assert(!fs.existsSync(lock));
  assert(!fs.existsSync(path.join(root, 'active.json')));
  console.log(JSON.stringify({ passed: true, malformedInputRejected: true, staleLockRecovered: true, noSecretEcho: true, noRuntimeStarted: true }));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
