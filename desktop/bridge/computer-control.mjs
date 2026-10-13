import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { assertPrivateFile, privateDirectory, snapshot, systemEnv } from './platform.mjs';

const [action, root, requestID] = process.argv.slice(2);
const resources = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const binary = path.join(resources, 'runtime/peekaboo/peekaboo');
const policyFile = path.join(root || '', 'computer-use.json');
function read(file) { try { assertPrivateFile(file); return JSON.parse(fs.readFileSync(file)); } catch { return null; } }
function write(policy) {
  const temporary = `${policyFile}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(policy), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, policyFile);
}
async function update(operation) {
  const lock = path.join(root, 'computer-update.lock');
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock, { mode: 0o700 }); break; }
    catch (e) { if (e.code !== 'EEXIST' || i > 100) throw new Error('电脑控制状态正在更新，请稍后重试。'); await delay(10); }
  }
  try {
    if (requestID && read(path.join(root, 'computer-intent.json'))?.id !== requestID) throw new Error('此操作已被更新的本机操作替换。');
    operation();
  } finally { fs.rmdirSync(lock); }
}
function permissions() {
  const result = JSON.parse(execFileSync(binary, ['permissions', 'status', '--no-remote', '--json'], {
    env: systemEnv(), encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
  if (!result.success || result.data?.source !== 'local') throw new Error('无法检查本机屏幕录制与辅助功能权限。');
  return result.data.permissions.map(p => ({ name: p.name, granted: p.isGranted === true }));
}
function current() {
  const policy = read(policyFile), rows = snapshot();
  const target = rows.get(policy?.target?.pid);
  const enabled = policy?.enabled === true && policy.expires > Date.now() && target?.started === policy.target.started && target?.executable === policy.target.executable;
  return { available: process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 24 && fs.existsSync(binary),
    enabled: !!enabled, targetName: enabled ? policy.targetName : null, expires: enabled ? policy.expires : null };
}
try {
  if (process.platform !== 'darwin' || !root || !path.isAbsolute(root) || !['status', 'permissions', 'enable', 'stop'].includes(action)) throw new Error('不支持的 Computer Use 操作。');
  privateDirectory(root);
  let grants;
  const ticket = randomUUID();
  if (action === 'enable') await update(() => {
    if (current().enabled) throw new Error('请先停止当前电脑控制。');
    write({ enabled: false, id: ticket });
  });
  if (action === 'stop') {
    await update(() => write({ enabled: false, id: ticket }));
    // The proxy polls revocation independently of a pending MCP request.
    for (let i = 0; i < 40; i++) {
      const state = read(path.join(root, 'sessions.json'));
      if (!state?.computerPID || !snapshot().has(state.computerPID)) break;
      if (i === 39) throw new Error('已禁止新操作，控制进程仍在退出；请稍后检查状态。已执行的操作不会撤销。');
      await delay(100);
    }
  }
  if (action === 'permissions' || action === 'enable') {
    if (!current().available) throw new Error('Computer Use 需要 macOS 15 或更新版本及完整运行包。');
    grants = permissions();
  }
  if (action === 'enable') {
    if (grants.some(p => ['Screen Recording', 'Accessibility', 'Event Synthesizing'].includes(p.name) && !p.granted) ||
        !['Screen Recording', 'Accessibility'].every(n => grants.some(p => p.name === n && p.granted))) throw new Error('请先在系统设置允许屏幕录制与辅助功能，再检查权限。');
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const target = snapshot().get(input.pid);
    if (!Number.isInteger(input.pid) || !target || typeof input.name !== 'string' || input.name.length > 200) throw new Error('目标应用已退出，请重新选择。');
    const sessions = read(path.join(root, 'sessions.json'));
    const proxy = snapshot().get(sessions?.proxyPID);
    if (!proxy || proxy.executable !== path.join(resources, 'runtime/bin/node') || Date.now() - Date.parse(sessions.updatedAt) > 15000) throw new Error('请先连接隧道。');
    if (sessions.computerPID) throw new Error('请先停止当前电脑控制，再切换应用。');
    await update(() => {
      if (read(policyFile)?.id !== ticket) throw new Error('开启操作已被停止或替换。');
      write({ enabled: true, id: ticket, target, targetName: input.name, expires: Date.now() + 15 * 60 * 1000 });
    });
  }
  console.log(JSON.stringify({ ...current(), ...(grants ? { permissions: grants } : {}) }));
} catch (error) { console.log(JSON.stringify({ available: false, enabled: false, error: error.message })); process.exitCode = 1; }
