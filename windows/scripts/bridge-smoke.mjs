// Exercise the Windows controller with the real proxy/DC and a local-only tunnel fixture.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { windows, systemEnv, privateDirectory, snapshot, terminateTracked } from '../../desktop/bridge/platform.mjs';

assert(windows, 'Run the Windows bridge smoke test on Windows.');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = path.resolve(process.argv[2] || path.join(project, 'dist/gpt-bridge/resources'));
const fixtureBinary = path.join(project, 'build/fake-runtime/tunnel-client.exe');
assert(fs.existsSync(fixtureBinary), 'Compile the local fixture with python windows/scripts/package.py --test first.');
const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gpt-bridge Windows's 中文 % & ")));
privateDirectory(temporary);
const fixture = path.join(temporary, 'resources');
const root = path.join(temporary, 'private');
const workspace = path.join(temporary, 'project');
const secondRoot = path.join(temporary, 'other');
for (const directory of [root, workspace, secondRoot, path.join(fixture, 'runtime/bin')]) fs.mkdirSync(directory, { recursive: true });
fs.copyFileSync(path.join(resources, 'runtime/bin/node.exe'), path.join(fixture, 'runtime/bin/node.exe'));
fs.copyFileSync(fixtureBinary, path.join(fixture, 'runtime/bin/tunnel-client.exe'));
fs.copyFileSync(fixtureBinary + '.config', path.join(fixture, 'runtime/bin/tunnel-client.exe.config'));
fs.symlinkSync(path.join(resources, 'runtime/dc'), path.join(fixture, 'runtime/dc'), 'junction');
fs.cpSync(path.join(resources, 'bridge'), path.join(fixture, 'bridge'), { recursive: true });
const controller = path.join(fixture, 'bridge/control.mjs');
fs.writeFileSync(controller, fs.readFileSync(controller, 'utf8').replace(/}\s*catch\s*{\s*fail\(`隧道/,
  "} catch (error) {\n    console.error(JSON.stringify({ code: error.code, output: error.stdout, diagnostic: error.stderr }));\n    fail(`隧道"));
const node = path.join(fixture, 'runtime/bin/node.exe');
const id = '00000000-0000-0000-0000-000000000001';
const workspaceID = '00000000-0000-0000-0000-000000000002';
const secondID = '00000000-0000-0000-0000-000000000003';
const connection = { id, name: 'local smoke', tunnelID: 'tunnel_Test123', selectedWorkspaceID: workspaceID,
  workspaces: [{ id: workspaceID, root: workspace, rootAccess: 'readWrite', directories: [], allowCommands: false },
    { id: secondID, root: secondRoot, rootAccess: 'readWrite', directories: [], allowCommands: false }] };
const secret = 'synthetic-not-a-real-key';
let checks = 0;
function call(action, input) {
  const result = spawnSync(node, [path.join(fixture, 'bridge/control.mjs'), action, root], {
    input: input ? JSON.stringify(input) : '', encoding: 'utf8', windowsHide: true, timeout: 120000,
    env: { ...systemEnv(), ...(input ? { MACBRIDGE_RUNTIME_KEY: secret } : {}) }
  });
  assert(!result.error, result.error?.message); assert(!result.stdout.includes(secret), 'Secret echoed'); checks++;
  assert(!result.stderr, result.stderr);
  return { code: result.status, ...JSON.parse(result.stdout) };
}
const waitFor = async predicate => {
  for (let i = 0; i < 40; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.fail('Local fixture did not reach the expected state.');
};
try {
  assert.equal(call('status').running, false); checks++;
  const lock = path.join(root, 'control.lock'); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 99999999, started: 'never', executable: 'missing.exe' }));
  const invalid = call('start', { ...connection, tunnelID: 'invalid' });
  assert.equal(invalid.code, 1); assert(invalid.error.includes('格式无效')); assert(!fs.existsSync(lock)); checks += 3;
  const started = call('start', connection);
  assert.equal(started.code, 0, started.error + (fs.existsSync(path.join(root, 'fixture-error.txt')) ? fs.readFileSync(path.join(root, 'fixture-error.txt'), 'utf8') : ''));
  assert(started.running && started.healthy && started.ready); checks += 2;
  await waitFor(() => fs.existsSync(path.join(root, 'sessions.json')) && JSON.parse(fs.readFileSync(path.join(root, 'sessions.json'))).dcPID > 0);
  const firstPID = started.pid;
  assert.equal(call('start', connection).pid, firstPID, 'Repeated connect duplicated runtime'); checks++;
  const launch = JSON.parse(fs.readFileSync(path.join(root, 'launch.json')));
  const config = JSON.parse(fs.readFileSync(launch.configPath));
  assert.equal(config.defaultShell, 'powershell.exe'); assert.equal(config.telemetryEnabled, false); checks += 2;
  for (const file of ['active.json', 'policy.json', 'launch.json', 'fixture-command.txt', 'events.ndjson']) {
    assert(!fs.readFileSync(path.join(root, file), 'utf8').includes(secret), 'Secret persisted to ' + file); checks++;
  }
  fs.writeFileSync(path.join(root, 'task.request'), 'start local dummy task');
  await waitFor(() => [...snapshot().values()].filter(row => row.parent === firstPID && row.executable === node).length >= 2);
  const blocked = call('stop'); assert.equal(blocked.code, 1); assert(blocked.error.includes('活动任务')); checks += 2;
  const switching = call('start', { ...connection, selectedWorkspaceID: secondID });
  assert.equal(switching.code, 1); assert(switching.error.includes('活动任务')); checks += 2;
  assert.equal(call('status').activeWorkspaceID, workspaceID); checks++;
  fs.unlinkSync(path.join(root, 'task.request'));
  await waitFor(() => [...snapshot().values()].filter(row => row.parent === firstPID && row.executable === node).length === 1);
  const switched = call('start', { ...connection, selectedWorkspaceID: secondID });
  assert.equal(switched.code, 0, switched.error); assert.equal(switched.activeWorkspaceID, secondID); checks += 2;
  await waitFor(() => call('status').activeTasks === 0);
  const sessions = JSON.parse(fs.readFileSync(path.join(root, 'sessions.json')));
  const stopped = call('stop'); assert.equal(stopped.code, 0, stopped.error + JSON.stringify({ switched, sessions })); assert.equal(stopped.running, false); checks += 2;
  const rows = snapshot(); assert(!rows.has(switched.pid) && !rows.has(sessions.proxyPID) && !rows.has(sessions.dcPID), 'Idle process tree was orphaned'); checks++;
  console.log(JSON.stringify({ passed: true, checks, localFixture: true, realProxy: true, activeTasksBlockStopAndSwitch: true,
    idleTreeReaped: true, unicodeAndShellCharacters: true, repeatedConnectIsIdempotent: true, noSecretPersistence: true }));
} finally {
  // Only terminate test executables within this uniquely generated fixture, checking start identity before killing.
  const owned = [...snapshot().values()].filter(row => row.executable && row.executable.toLowerCase().startsWith(fixture.toLowerCase() + path.sep));
  terminateTracked(owned);
  assert(temporary.startsWith(fs.realpathSync(os.tmpdir()) + path.sep + 'gpt-bridge Windows'));
  fs.rmSync(temporary, { recursive: true, force: true });
}
