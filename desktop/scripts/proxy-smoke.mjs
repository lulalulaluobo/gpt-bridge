import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { windows, binaryName, privateDirectory, systemEnv, assertPrivateFile, snapshot } from '../bridge/platform.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resources = process.argv[2] ? path.resolve(process.argv[2]) : path.join(desktop, 'build');
const bridge = fs.existsSync(path.join(resources, 'bridge/proxy.mjs')) ? path.join(resources, 'bridge') : path.join(desktop, 'bridge');
const modules = path.join(resources, 'runtime/dc/node_modules');
const dcVersion = JSON.parse(fs.readFileSync(path.join(modules, '@wonderwhy-er/desktop-commander/package.json'))).version;
const sdkVersion = JSON.parse(fs.readFileSync(path.join(modules, '@modelcontextprotocol/sdk/package.json'))).version;
assert.equal(dcVersion, '0.2.52'); assert.equal(sdkVersion, '1.32.1');
const { Client } = await import(pathToFileURL(path.join(modules, '@modelcontextprotocol/sdk/dist/esm/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(path.join(modules, '@modelcontextprotocol/sdk/dist/esm/client/stdio.js')));
const node = path.join(resources, 'runtime/bin', binaryName('node'));
const entry = path.join(modules, '@wonderwhy-er/desktop-commander/dist/index.js');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "gpt-bridge proxy's ")));
if (windows) privateDirectory(root);
const workspace = path.join(root, 'project'), ro = path.join(workspace, 'reference'), outside = path.join(root, 'outside');
const state = path.join(root, 'state'), home = path.join(state, 'home');
for (const dir of [workspace, ro, outside, path.join(home, '.claude-server-commander')]) fs.mkdirSync(dir, { recursive: true });
const source = path.join(ro, 'source.txt'); fs.writeFileSync(source, 'permission-test-nonce');
fs.writeFileSync(path.join(outside, 'outside.txt'), 'outside-secret');
fs.symlinkSync(outside, path.join(workspace, 'escape'), windows ? 'junction' : 'dir');
const defaults = { ...JSON.parse(fs.readFileSync(path.join(bridge, 'dc-defaults.json'))), ...(windows ? { defaultShell: 'powershell.exe' } : {}) };
const config = path.join(home, '.claude-server-commander/config.json'), policyFile = path.join(state, 'policy.json');
const sessions = path.join(state, 'sessions.json');
fs.writeFileSync(config, JSON.stringify({ ...defaults, allowedDirectories: [workspace, ro] }), { mode: 0o600 });
let checks = 0;
async function run(allowCommands) {
  fs.writeFileSync(config, JSON.stringify({ ...defaults, allowedDirectories: [workspace, ro] }), { mode: 0o600 });
  fs.chmodSync(config, 0o600);
  fs.writeFileSync(policyFile, JSON.stringify({ schemaVersion: 1, workspaceID: allowCommands ? 'commands-on' : 'files-only',
    workspaceRoot: workspace, allowCommands, grants: [{ path: workspace, access: 'readWrite' }, { path: ro, access: 'readOnly' }],
    protectedPaths: [state, path.join(resources, 'runtime')] }), { mode: 0o600 });
  const transport = new StdioClientTransport({ command: node,
    args: [path.join(bridge, 'proxy.mjs'), entry, config, policyFile, sessions], cwd: workspace,
    env: { ...systemEnv(home), PATH: [path.dirname(node), path.join(modules,
      `@vscode/ripgrep-${windows ? 'win32-x64' : 'darwin-arm64'}/bin`), systemEnv(home).PATH].join(path.delimiter),
      DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', MACBRIDGE_NO_BROWSER_DOWNLOAD: '1' }, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', c => { stderr += c; });
  const client = new Client({ name: 'gpt-bridge-proxy-smoke', version: '0.10' });
  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const good = async (name, args) => { const result = await call(name, args); assert(!result.isError, `${name}: ${JSON.stringify(result)} ${stderr}`); checks++; return result; };
  const denied = async (name, args) => { const result = await call(name, args); assert.equal(result.isError, true, `${name} was not denied`); checks++; return result; };
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    assert(tools.some(t => t.name === 'workspace_info')); checks++;
    assert(tools.some(t => t.name === 'method_library')); checks++;
    fs.writeFileSync(path.join(ro, 'SKILL.md'), 'Reference method smoke test');
    fs.writeFileSync(path.join(state, 'method-library.json'), JSON.stringify({ schemaVersion: 1, directories: [ro] }), { mode: 0o600 });
    const libraries = await good('method_library', { action: 'list' });
    assert.deepEqual(JSON.parse(libraries.content[0].text).directories, [ro]); checks++;
    const methods = await good('method_library', { action: 'search', library_path: ro, query: 'Reference' });
    assert.equal(JSON.parse(methods.content[0].text).matched, 1); checks++;
    await good('method_library', { action: 'read', library_path: ro, document_path: 'SKILL.md' });
    await denied('method_library', { action: 'search', library_path: outside });
    fs.writeFileSync(path.join(state, 'method-library.json'), JSON.stringify({ schemaVersion: 1, directories: [] }), { mode: 0o600 });
    await denied('method_library', { action: 'read', library_path: ro, document_path: 'SKILL.md' });
    if (windows || process.platform === 'darwin') {
      assert(tools.some(t => t.name === 'obsidian_query')); checks++;
      assert(tools.some(t => t.name === 'open_application')); checks++;
      await denied('obsidian_query', { action: 'status', vault_path: outside });
      await denied('open_application', { app: 'bad/path' });
      if (!allowCommands) await denied('open_application', { app: 'Notepad' });
    }
    for (const name of ['set_config_value', 'get_config', 'write_pdf', 'kill_process', 'list_processes', 'get_recent_tool_calls', 'track_ui_event']) {
      assert(!tools.some(t => t.name === name)); checks++;
    }
    assert(tools.every(t => !t._meta)); checks++;
    assert(tools.some(t => t.name === 'start_process')); checks++;
    const info = await good('workspace_info'); assert(JSON.stringify(info).includes(allowCommands ? `current ${windows ? 'Windows' : 'Mac'} user` : 'disabled')); checks++;
    const controlLock = path.join(state, 'control.lock');
    const lockedTarget = path.join(workspace, `lock-probe-${allowCommands}.txt`);
    fs.mkdirSync(controlLock);
    try {
      const lockedWrite = await denied('write_file', { path: lockedTarget, content: 'must-not-be-written', mode: 'rewrite' });
      assert(JSON.stringify(lockedWrite).includes('connection is changing')); checks++;
      const lockedCommand = await denied('start_process', { command: 'printf must-not-start', timeout_ms: 1000 });
      assert(JSON.stringify(lockedCommand).includes('connection is changing')); checks++;
      assert(!fs.existsSync(lockedTarget)); checks++;
      assert.equal(JSON.parse(fs.readFileSync(sessions)).pendingToolCalls, 0); checks++;
      await good('workspace_info');
    } finally { fs.rmdirSync(controlLock); }
    await good('write_file', { path: lockedTarget, content: 'unlocked', mode: 'rewrite' });
    assert.equal(fs.readFileSync(lockedTarget, 'utf8'), 'unlocked'); checks++;
    if (!allowCommands) {
      const read = await good('read_file', { path: source }); assert(JSON.stringify(read).includes('permission-test-nonce')); checks++;
      await denied('write_file', { path: source, content: 'wrong' }); assert.equal(fs.readFileSync(source, 'utf8'), 'permission-test-nonce'); checks++;
      await denied('edit_block', { file_path: source, old_string: 'permission', new_string: 'changed' });
      await denied('create_directory', { path: path.join(ro, 'new') });
      await denied('move_file', { source, destination: path.join(workspace, 'moved.txt') });
      await denied('read_file', { path: path.join(outside, 'outside.txt') });
      await denied('read_file', { path: path.join(workspace, 'escape/outside.txt') });
      await denied('write_file', { path: path.join(workspace, 'escape/new/deep.txt'), content: 'wrong' });
      await denied('read_file', { path: policyFile });
      await denied('read_file', { path: 'https://example.com', isUrl: true });
      await denied('read_file', { path: source, options: { path: path.join(outside, 'outside.txt') } });
      await denied('start_process', { command: 'printf should-not-run', timeout_ms: 1000 });
      await denied('interact_with_process', { pid: process.pid, input: 'bad' });
      await denied('set_config_value', { key: 'allowedDirectories', value: ['/'] });
      await denied('unknown_execute', { command: 'bad' });
      const target = path.join(workspace, 'created.txt');
      await good('write_file', { path: target, content: 'exact-rw', mode: 'rewrite' }); assert.equal(fs.readFileSync(target, 'utf8'), 'exact-rw'); checks++;
      await denied('move_file', { source: target, destination: path.join(ro, 'moved.txt') });
      await good('move_file', { source: target, destination: path.join(workspace, 'renamed.txt') });
      const list = await good('list_directory', { path: workspace, depth: 3 }); assert(!JSON.stringify(list).includes('escape')); checks++;
      const search = await good('start_search', { path: ro, pattern: 'source', searchType: 'files', timeout_ms: 1000 });
      const searchID = JSON.stringify(search).match(/search_\d+_\d+/)?.[0]; assert(searchID); checks++;
      let searchResult;
      let searchOutput = JSON.stringify(search);
      for (let i = 0; i < 30; i++) {
        searchResult = await good('get_more_search_results', { sessionId: searchID });
        searchOutput += JSON.stringify(searchResult);
        if (JSON.stringify(searchResult).includes('Search completed')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(searchOutput.includes('source.txt'), searchOutput); checks++;
      await denied('get_more_search_results', { sessionId: 'search_0_0' });
      await denied('start_search', { path: outside, pattern: '.', searchType: 'files' });
      await denied('start_search', { path: ro, pattern: 'source', additionalArgs: ['--follow'] });
      for (const searchType of ['files', 'content']) {
        const escaped = await good('start_search', { path: workspace, pattern: searchType === 'files' ? 'outside.txt' : 'outside-secret', searchType, timeout_ms: 1000 });
        const escapedID = JSON.stringify(escaped).match(/search_\d+_\d+/)?.[0]; assert(escapedID); checks++;
        let final;
        for (let i = 0; i < 30; i++) {
          final = await good('get_more_search_results', { sessionId: escapedID });
          if (JSON.stringify(final).includes('Search completed')) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        assert(!JSON.stringify(final).includes('outside.txt') && !JSON.stringify(final).includes('outside-secret')); checks++;
        await good('stop_search', { sessionId: escapedID });
        await good('get_more_search_results', { sessionId: escapedID });
      }
      await good('list_searches');
      assert.equal(JSON.parse(fs.readFileSync(sessions)).activeSearchIDs.length, 0); checks++;
    } else {
      const command = await good('start_process', { command: windows ? 'Write-Output gpt-bridge-command-ok' : 'printf gpt-bridge-command-ok',
        timeout_ms: 1000, shell: windows ? 'powershell.exe' : '/bin/bash' });
      const text = JSON.stringify(command); assert(text.includes('gpt-bridge-command-ok')); checks++;
      const pid = command.content[0].text.match(/PID (\d+)/)?.[1]; assert(pid); checks++;
      await good('read_process_output', { pid: Number(pid), timeout_ms: 1000 });
      await denied('force_terminate', { pid: process.pid });
      await good('list_sessions');
      const quotedNode = `'${node.replaceAll("'", "'\\''")}'`;
      const long = await good('start_process', { command: windows ? `& '${node.replaceAll("'", "''")}' -e 'setInterval(() => {}, 1000)'`
        : `exec ${quotedNode} -e 'setInterval(() => {}, 1000)'`, timeout_ms: 1000, shell: windows ? 'powershell.exe' : '/bin/bash' });
      const longPID = Number(long.content[0].text.match(/PID (\d+)/)?.[1]); assert(longPID > 0); checks++;
      assert(JSON.parse(fs.readFileSync(sessions)).activeSessionPIDs.includes(longPID)); checks++;
      const commandChildren = windows ? [...snapshot().values()].filter(p => p.parent === longPID) : [];
      await good('force_terminate', { pid: longPID });
      if (windows) {
        const remaining = snapshot();
        assert(commandChildren.length > 0 && commandChildren.every(p => remaining.get(p.pid)?.started !== p.started)); checks++;
      }
      let finalOutput;
      for (let i = 0; i < 20; i++) {
        finalOutput = await good('read_process_output', { pid: longPID, timeout_ms: 1000, offset: -100, length: 100 });
        if (JSON.stringify(finalOutput).includes('Process completed')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert(JSON.stringify(finalOutput).includes('Process completed')); checks++;
      assert.equal(JSON.parse(fs.readFileSync(sessions)).activeSessionPIDs.length, 0); checks++;
      const virtual = await good('start_process', { command: 'node:local', timeout_ms: 1000 });
      const virtualPID = Number(virtual.content[0].text.match(/PID (-\d+)/)?.[1]); assert(virtualPID < 0); checks++;
      assert(JSON.parse(fs.readFileSync(sessions)).activeSessionPIDs.includes(virtualPID)); checks++;
      const virtualSessions = await good('list_sessions'); assert(JSON.stringify(virtualSessions).includes(`${virtualPID}`)); checks++;
      const clear = await good('force_terminate', { pid: virtualPID }); assert(JSON.stringify(clear).includes('Cleared virtual Node.js session')); checks++;
      assert.equal(JSON.parse(fs.readFileSync(sessions)).activeSessionPIDs.length, 0); checks++;
    }
    const record = JSON.parse(fs.readFileSync(sessions));
    assert(record.proxyPID === transport.pid && record.dcPID > 0 && record.pendingToolCalls === 0); checks++;
    assertPrivateFile(sessions); checks++;
  } catch (error) { console.error(stderr.slice(-5000)); throw error; }
  finally { await client.close(); }
}
try {
  await run(false); await run(true);
  console.log(JSON.stringify({ passed: true, checks, pinnedDC: dcVersion, pinnedSDK: sdkVersion, readOnlyEnforced: true,
    inactivePathsDenied: true, commandsOffDenied: true, commandsOnExecuted: true, safeSearch: true,
    symlinkSearchEscapeDenied: true, cancelTracked: true, completedSearchesCleared: true, sessionRecord: true,
    controllerLockStopsOperations: true, unlockRestoresOperations: true, virtualNegativePIDTracked: true }));
} finally { fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 }); }
