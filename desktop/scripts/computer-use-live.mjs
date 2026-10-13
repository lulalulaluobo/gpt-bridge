// Local integration only: dedicated fixture window; never uses the live tunnel or user applications.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const resources = path.resolve(process.argv[2]), fixture = path.resolve(process.argv[3]);
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cu-live-')));
const state = path.join(root, 'state'), workspace = path.join(root, 'workspace');
fs.mkdirSync(state, { mode: 0o700 }); fs.mkdirSync(workspace);
const env = { HOME: os.homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };
const ready = path.join(root, 'ready'), result = path.join(root, 'result.json');
const gui = spawn(fixture, [], { env: { ...env, CU_VISUAL_CODE: 'CU-ABCDEF12', CU_RESULT_PATH: result, CU_READY_PATH: ready }, stdio: 'ignore' });
const modules = path.join(resources, 'runtime/dc/node_modules');
const sdk = suffix => import(pathToFileURL(path.join(modules, '@modelcontextprotocol/sdk/dist/esm', suffix)));
const { Client } = await sdk('client/index.js'), { StdioClientTransport } = await sdk('client/stdio.js');
const node = path.join(resources, 'runtime/bin/node');
const entry = path.join(modules, '@wonderwhy-er/desktop-commander/dist/index.js');
const home = path.join(state, 'home');
fs.mkdirSync(path.join(home, '.claude-server-commander'), { recursive: true });
const config = path.join(home, '.claude-server-commander/config.json'), policy = path.join(state, 'policy.json');
fs.writeFileSync(config, JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(resources, 'bridge/dc-defaults.json'))), allowedDirectories: [workspace] }), { mode: 0o600 });
fs.writeFileSync(policy, JSON.stringify({ schemaVersion: 1, workspaceID: 'test', workspaceRoot: workspace, allowCommands: false,
  grants: [{ path: workspace, access: 'readWrite' }], protectedPaths: [state, resources] }), { mode: 0o600 });
const transport = new StdioClientTransport({ command: node, args: [path.join(resources, 'bridge/proxy.mjs'), entry, config, policy, path.join(state, 'sessions.json')],
  env: { ...env, HOME: home, DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', MACBRIDGE_NO_BROWSER_DOWNLOAD: '1' }, stderr: 'pipe' });
transport.stderr?.on('data', () => {});
const client = new Client({ name: 'cu-live-test', version: '1' });
const call = (name, args = {}) => client.callTool({ name, arguments: args }, undefined, { timeout: 60000 });
const control = (action, payload) => JSON.parse(execFileSync(node, [path.join(resources, 'bridge/computer-control.mjs'), action, state],
  { env, input: payload ? JSON.stringify(payload) : '', encoding: 'utf8', timeout: 20000 }));
async function observe() {
  const r = await call('computer_observe', { app: `PID:${gui.pid}` });
  assert(!r.isError, JSON.stringify(r)); assert(r.content.some(c => c.type === 'image'));
  return JSON.parse(r.content[0].text);
}
try {
  for (let i = 0; i < 100 && !fs.existsSync(ready); i++) await delay(50);
  assert(fs.existsSync(ready));
  await client.connect(transport);
  assert((await client.listTools()).tools.some(t => t.name === 'computer_observe'));
  assert((await call('computer_observe')).isError);
  assert(control('enable', { pid: gui.pid, name: 'Dedicated test window' }).enabled);
  let o = await observe();
  const input = o.elements.find(e => e.role === 'textField');
  assert(input, JSON.stringify(o));
  const typed = await call('computer_type', { observation: o.observation, element: input.id, text: 'CU-ABCDEF12' });
  assert(!typed.isError, JSON.stringify(typed));
  o = await observe();
  const button = o.elements.find(e => e.role === 'button' && e.title === '验证点击'); assert(button);
  await call('computer_click', { observation: o.observation, element: button.id });
  await observe();
  const recorded = JSON.parse(fs.readFileSync(result)); assert(recorded.passed); assert.equal(recorded.clickCount, 1);
  assert.equal(control('stop').enabled, false);
  assert((await call('computer_observe')).isError);
  const file = path.join(workspace, 'after-stop.txt');
  assert(!(await call('write_file', { path: file, content: 'file-tools-still-work', mode: 'rewrite' })).isError);
  assert.equal(fs.readFileSync(file, 'utf8'), 'file-tools-still-work');
  console.log('PASS: packaged backend → dedicated native window observe/type/click; one click verified; stop denies CU while file tools continue.');
} finally {
  try { control('stop'); } catch {}
  await client.close(); gui.kill('SIGTERM');
  fs.rmSync(root, { recursive: true, force: true });
}
