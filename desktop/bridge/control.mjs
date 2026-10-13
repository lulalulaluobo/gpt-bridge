import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const resources = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [action, root] = process.argv.slice(2);
const home = os.homedir();
const bin = path.join(resources, 'runtime/bin/tunnel-client');
const node = path.join(resources, 'runtime/bin/node');
const entry = path.join(resources, 'runtime/dc/node_modules/@wonderwhy-er/desktop-commander/dist/index.js');
const state = path.join(root || '', 'state');
const alias = 'macbridge-desktop';
const profile = path.join(root || '', 'profiles/desktop.yaml');
const activeFile = path.join(root || '', 'active.json');
const launcher = path.join(root || '', 'dc-launcher');
const policyFile = path.join(root || '', 'policy.json');
const sessionsFile = path.join(root || '', 'sessions.json');
const cleanEnv = { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8',
  TUNNEL_CLIENT_STATE_DIR: state, MCP_MAX_CONCURRENT_REQUESTS: '1', LOG_HTTP_RAW_UNSAFE: 'false' };
let locked = false;
function fail(message) { throw new Error(message); }
function privateDirectory(p) {
  fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  const s = fs.lstatSync(p);
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid()) fail('应用数据目录的类型或属主异常。');
  fs.chmodSync(p, 0o700);
}
function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function atomic(p, value, mode = 0o600) {
  const temp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(temp, value, { mode, flag: 'wx' });
  fs.renameSync(temp, p);
}
function native(verb, args = [], key) {
  try {
    return JSON.parse(execFileSync(bin, ['runtimes', verb, ...args, '--json'], {
      env: { ...cleanEnv, ...(key ? { MACBRIDGE_RUNTIME_KEY: key } : {}) },
      encoding: 'utf8', timeout: 45000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    }));
  } catch {
    fail(`隧道${verb === 'connect' ? '连接' : verb === 'stop' ? '停止' : '状态查询'}失败。请检查网络、Tunnel ID、组织权限与 Runtime key。没有自动重复启动。`);
  }
}
function snapshot() {
  const rows = new Map();
  const output = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,lstart=,comm='], { encoding: 'utf8' });
  for (const line of output.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/);
    if (m) rows.set(+m[1], { pid: +m[1], parent: +m[2], started: m[3], executable: m[4] });
  }
  return rows;
}
function children(rows, pid) {
  const out = [];
  for (const row of rows.values()) if (row.parent === pid) out.push(row, ...children(rows, row.pid));
  return out;
}
function nativeStatus() {
  if (!fs.existsSync(state)) return null;
  const listed = native('list');
  if (!listed.aliases?.some(a => (typeof a === 'string' ? a : a.alias) === alias)) return null;
  const s = native('status', [alias]);
  if (s.config_path !== profile || s.process?.target_value !== quote(launcher)) fail('运行记录与应用不匹配，请先检查已有实例。');
  return s;
}
function legacyRunning() {
  const legacyBin = path.join(home, '.local/share/macbridge/vendor/tunnel-client-v0.0.16/tunnel-client');
  return [...snapshot().values()].some(p => p.executable === legacyBin);
}
function status() {
  const s = nativeStatus();
  const active = fs.existsSync(activeFile) ? readJSON(activeFile) : null;
  const tasks = s?.process_running ? activity(s) : { count: 0 };
  return { running: s?.process_running === true, healthy: s?.healthy === true, ready: s?.ready === true,
    pid: s?.process?.pid || null, activeID: active?.id || null, legacyRunning: legacyRunning(),
    activeWorkspaceID: active?.activeWorkspace?.id || null,
    activeWorkspaceRoot: active?.activeWorkspace?.root || active?.workspace || null,
    activeWorkspace: active?.activeWorkspace || null,
    activeWorkspaceFingerprint: active?.fingerprint || null,
    allowCommands: active?.activeWorkspace?.allowCommands ?? true, activeTasks: tasks.count };
}
function validate(c) {
  if (!c || !/^[0-9a-f-]{36}$/i.test(c.id) || !/^tunnel_[A-Za-z0-9]+$/.test(c.tunnelID)) fail('连接资料格式无效。');
  const workspaces = c.workspaces || [{ id: c.id, root: c.workspace, rootAccess: 'readWrite', directories: [], allowCommands: true }];
  const workspace = workspaces.find(w => w.id === (c.selectedWorkspaceID || workspaces[0]?.id));
  if (!workspace || !/^[0-9a-f-]{36}$/i.test(workspace.id) || !Array.isArray(workspace.directories) ||
      !['readOnly', 'readWrite'].includes(workspace.rootAccess) || typeof workspace.allowCommands !== 'boolean') fail('工作区配置无效。');
  const canonical = p => {
    if (typeof p !== 'string' || !path.isAbsolute(p) || p === '/' || /[\n\r\0]/.test(p)) fail('目录路径无效。');
    let real;
    try { real = fs.realpathSync(p); if (!fs.statSync(real).isDirectory()) fail('路径不是文件夹。'); }
    catch { fail('工作区中的目录不存在或无法访问，请重新选择文件夹。'); }
    if (real === '/') fail('不能选择整个磁盘。');
    return real;
  };
  const normalized = { id: workspace.id, root: canonical(workspace.root), rootAccess: workspace.rootAccess,
    directories: workspace.directories.map(d => {
      if (!/^[0-9a-f-]{36}$/i.test(d.id) || !['readOnly', 'readWrite'].includes(d.access)) fail('访问目录配置无效。');
      return { id: d.id, path: canonical(d.path), access: d.access };
    }), allowCommands: workspace.allowCommands };
  const grants = [{ path: normalized.root, access: normalized.rootAccess }, ...normalized.directories.map(d => ({ path: d.path, access: d.access }))];
  if (new Set(grants.map(g => g.path)).size !== grants.length) fail('访问目录重复，请保留一条权限规则。');
  c.workspace = normalized.root;
  c.activeWorkspace = normalized;
  c.grants = grants;
  c.fingerprint = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return c;
}
function quote(s) { return `'${s.replaceAll("'", "'\\''")}'`; }
function prepare(c) {
  const dcHome = path.join(root, 'connections', c.id, 'workspaces', c.activeWorkspace.id, 'home');
  privateDirectory(path.join(dcHome, '.claude-server-commander'));
  privateDirectory(path.join(root, 'tmp'));
  privateDirectory(path.join(root, 'profiles'));
  privateDirectory(state);
  const configPath = path.join(dcHome, '.claude-server-commander/config.json');
  const defaults = readJSON(path.join(resources, 'bridge/dc-defaults.json'));
  const prior = fs.existsSync(configPath) ? readJSON(configPath) : {};
  atomic(configPath, JSON.stringify({ ...prior, ...defaults, allowedDirectories: c.grants.map(g => g.path) }, null, 2));
  atomic(policyFile, JSON.stringify({ schemaVersion: 1, workspaceID: c.activeWorkspace.id,
    workspaceRoot: c.workspace, allowCommands: c.activeWorkspace.allowCommands, grants: c.grants,
    protectedPaths: [root, resources, path.join(home, '.config/macbridge'), path.join(home, '.local/share/macbridge'),
      path.join(home, 'Library/Keychains')] }, null, 2));
  if (fs.existsSync(sessionsFile)) fs.unlinkSync(sessionsFile);
  const rgDir = path.join(resources, 'runtime/dc/node_modules/@vscode/ripgrep-darwin-arm64/bin');
  const envPath = `${path.dirname(node)}:${rgDir}:/usr/bin:/bin:/usr/sbin:/sbin`;
  const script = `#!/bin/bash\nset -euo pipefail\numask 077\ncd ${quote(c.workspace)}\nexec /usr/bin/env -i HOME=${quote(dcHome)} PATH=${quote(envPath)} TMPDIR=${quote(path.join(root, 'tmp/'))} LANG=en_US.UTF-8 DESKTOP_COMMANDER_DISABLE_TELEMETRY=1 MACBRIDGE_NO_BROWSER_DOWNLOAD=1 ${quote(node)} ${quote(path.join(resources, 'bridge/proxy.mjs'))} ${quote(entry)} ${quote(configPath)} ${quote(policyFile)} ${quote(sessionsFile)}\n`;
  atomic(launcher, script, 0o700);
}
function assertNoOther(s) {
  const others = [...snapshot().values()].filter(p => path.basename(p.executable) === 'tunnel-client' && p.pid !== s?.process?.pid);
  if (others.length) fail(`另一个隧道运行器仍在运行（PID ${others.map(p => p.pid).join(', ')}）。请先停止它，避免重复连接。`);
}
async function stop() {
  const s = nativeStatus();
  if (!s?.process_running) return status();
  const rows = snapshot();
  const tree = children(rows, s.process.pid);
  const tasks = activity(s, rows);
  if (tasks.count || !tasks.valid) fail('连接内仍有活动任务或进程结构异常。请先结束任务，再断开或切换工作区。');
  const tracked = [rows.get(s.process.pid), ...tree].filter(Boolean);
  native('stop', [alias]);
  for (let i = 0; i < 30; i++) {
    const now = snapshot();
    if (!tracked.some(p => now.get(p.pid)?.started === p.started && now.get(p.pid)?.executable === p.executable)) return status();
    await delay(200);
  }
  fail('旧进程仍未退出，已阻止启动新实例。');
}
function activity(s, rows = snapshot()) {
  const tree = children(rows, s.process.pid);
  const proxy = tree.filter(p => p.parent === s.process.pid && p.executable === node);
  const infrastructure = new Set(proxy.map(p => p.pid));
  let sessions = null;
  if (fs.existsSync(sessionsFile)) {
    const info = fs.lstatSync(sessionsFile);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) fail('任务状态文件权限异常。');
    try { sessions = readJSON(sessionsFile); } catch { fail('任务状态文件无效，请稍后重试。'); }
  }
  const matched = proxy.length === 1 && sessions?.proxyPID === proxy[0].pid;
  const dc = matched ? tree.find(p => p.pid === sessions.dcPID && p.parent === proxy[0].pid && p.executable === node) : null;
  if (dc) infrastructure.add(dc.pid);
  const other = tree.filter(p => !infrastructure.has(p.pid));
  // DC's in-process Node REPL sessions use negative virtual PIDs. They still
  // count as active sessions even though they have no separate OS process.
  const managed = matched ? (sessions.activeSessionPIDs || []).filter(pid => pid < 0 || rows.has(pid)) : [];
  const pending = matched ? Number(sessions.pendingToolCalls || 0) + (sessions.activeSearchIDs || []).length : 0;
  return { count: Math.max(other.length, managed.length, pending), valid: proxy.length === 1 && (!matched || !!dc) };
}
function stopLegacy(c) {
  if (!legacyRunning()) return;
  const base = path.join(home, '.local/share/macbridge');
  const tunnel = fs.readFileSync(path.join(base, 'config/tunnel-id'), 'utf8').trim();
  if (tunnel !== c.tunnelID) fail('旧脚本服务正在使用另一个隧道，请先通过旧 Stop.command 停止。');
  const controller = path.join(base, 'bin/macbridgectl');
  const metadata = fs.lstatSync(controller);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.uid !== process.getuid() || (metadata.mode & 0o022)) fail('旧控制器权限异常，无法自动迁移。');
  try { execFileSync(controller, ['stop', '--json'], { encoding: 'utf8', timeout: 50000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch { fail('旧服务未能停止，可能有活动任务。请先结束任务；尚未启动应用版。'); }
  if (legacyRunning()) fail('旧隧道仍在运行，未启动新实例。');
}
async function start(c) {
  validate(c);
  const key = process.env.MACBRIDGE_RUNTIME_KEY;
  if (!key || /[\n\r\0]/.test(key)) fail('钥匙串未提供有效 Runtime key。');
  for (const file of [node, bin, entry]) if (!fs.existsSync(file)) fail('应用运行包不完整，请重新安装。');
  const old = nativeStatus();
  const active = fs.existsSync(activeFile) ? readJSON(activeFile) : null;
  if (old?.process_running && active?.id === c.id && active.tunnelID === c.tunnelID && active.fingerprint === c.fingerprint) return status();
  if (old?.process_running) await stop();
  stopLegacy(c);
  assertNoOther(null);
  prepare(c);
  atomic(activeFile, JSON.stringify(c));
  native('connect', ['--alias', alias, '--profile', 'desktop', '--profile-dir', path.dirname(profile),
    '--tunnel-id', c.tunnelID, '--mcp-command', quote(launcher), '--runtime-api-key', 'env:MACBRIDGE_RUNTIME_KEY',
    '--control-plane-base-url', 'https://api.openai.com'], key);
  const result = status();
  if (!result.running || !result.healthy || !result.ready) fail('实例已创建但尚未就绪，请检查密钥及网络，或断开后重试。');
  return result;
}
try {
  if (!root || !path.isAbsolute(root) || !['start', 'stop', 'status', 'tasks'].includes(action)) fail('不支持的运行器操作。');
  privateDirectory(root);
  if (!['status', 'tasks'].includes(action)) {
    const lock = path.join(root, 'control.lock');
    if (fs.existsSync(lock)) {
      const ownerFile = path.join(lock, 'owner.json');
      if (!fs.existsSync(ownerFile)) fail('另一个操作刚开始或锁记录不完整，请稍后重试。');
      const owner = readJSON(ownerFile);
      const current = snapshot().get(owner.pid);
      if (current?.started === owner.started && current?.executable === owner.executable) fail('另一个连接操作正在执行，请稍后重试。');
      fs.unlinkSync(ownerFile); fs.rmdirSync(lock);
    }
    try { fs.mkdirSync(lock, { mode: 0o700 }); locked = true; }
    catch { fail('另一个操作正在执行，请稍后重试。'); }
    fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify(snapshot().get(process.pid)), { mode: 0o600, flag: 'wx' });
  }
  let output;
  if (action === 'start') output = await start(JSON.parse(fs.readFileSync(0, 'utf8')));
  if (action === 'stop') output = await stop();
  if (['status', 'tasks'].includes(action)) output = status();
  const log = path.join(root, 'events.ndjson');
  if (fs.existsSync(log) && fs.statSync(log).size > 1024 * 1024) fs.renameSync(log, `${log}.previous`);
  if (!['status', 'tasks'].includes(action)) fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), action, ...output }) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(output));
} catch (error) {
  console.log(JSON.stringify({ running: false, healthy: false, ready: false, error: String(error.message).replace(/sk-[\w-]+/g, '[redacted]') }));
  process.exitCode = 1;
} finally {
  if (locked) {
    fs.rmSync(path.join(root, 'control.lock/owner.json'), { force: true });
    fs.rmdirSync(path.join(root, 'control.lock'));
  }
}
