import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FilePermissions, PermissionError, loadPolicy, canonicalPath, within } from './permissions.mjs';
import { windows, snapshot, terminateTracked } from './platform.mjs';
import { applicationTool, launchApplication } from './application-launch.mjs';
import { obsidianTool, queryObsidian } from './obsidian.mjs';
import { methodsTool, queryMethods } from './methods.mjs';

const [entry, config, policyFile, sessionsFile] = process.argv.slice(2);
const require = createRequire(pathToFileURL(entry));
const sdk = suffix => import(pathToFileURL(require.resolve(`@modelcontextprotocol/sdk/${suffix}`)));
const [{ Server }, { StdioServerTransport }, { Client }, { StdioClientTransport }, types] = await Promise.all([
  sdk('server/index.js'), sdk('server/stdio.js'), sdk('client/index.js'), sdk('client/stdio.js'), sdk('types.js')
]);
const policy = loadPolicy(policyFile), permissions = new FilePermissions(policy);
const recordPath = canonicalPath(sessionsFile);
if (!policy.protectedPaths.some(p => within(recordPath, p))) throw new Error('Session records must be inside protected application state.');
const { toolArgSchemas } = await import(pathToFileURL(path.join(path.dirname(entry), 'tools/schemas.js')));
const commandTools = new Set(['start_process', 'read_process_output', 'interact_with_process', 'force_terminate', 'list_sessions']);
const userPlatform = windows ? 'Windows' : 'Mac';
const safeTools = new Set(['read_file', 'read_multiple_files', 'write_file', 'create_directory', 'list_directory',
  'move_file', 'start_search', 'get_more_search_results', 'stop_search', 'list_searches', 'get_file_info', 'edit_block', ...commandTools]);
const deniedArgs = new Set(['options']);
const textResult = text => ({ content: [{ type: 'text', text }] });
const errorResult = message => ({ ...textResult(`ACCESS_DENIED: ${message}`), isError: true });
const resultText = result => result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '';
let dcPID = null, pendingToolCalls = 0, stopping = false, refreshPending = false;
let activePIDs = new Set(), knownPIDs = new Set(), searchIDs = new Set(), knownSearchIDs = new Set();
function record() {
  const data = { schemaVersion: 1, workspaceID: policy.workspaceID, proxyPID: process.pid, dcPID,
    activeSessionPIDs: [...activePIDs], activeSearchIDs: [...searchIDs], pendingToolCalls, updatedAt: new Date().toISOString() };
  const temporary = `${recordPath}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data), { mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, recordPath);
}
const child = new StdioClientTransport({ command: process.execPath,
  args: [path.join(path.dirname(fileURLToPath(import.meta.url)), 'dc-entry.mjs'), entry, config, policyFile],
  cwd: policy.workspaceRoot, env: { ...process.env }, stderr: 'pipe' });
child.stderr?.on('data', chunk => process.stderr.write(chunk));
const client = new Client({ name: 'gpt-bridge-permission-proxy', version: '0.11' });
const server = new Server({ name: 'gpt-bridge', version: '0.11' }, { capabilities: { tools: {} },
  instructions: `Call workspace_info before working. Only the selected local workspace grants apply. File tools enforce directory read-only/read-write permissions. Commands, when enabled, run with the ${userPlatform} user privileges and are not isolated by directory permissions.` });
async function refreshSessions() {
  if (refreshPending || stopping) return;
  refreshPending = true;
  try {
    const result = await client.callTool({ name: 'list_sessions', arguments: {} }, undefined, { timeout: 10000 });
    if (!result.isError) {
      activePIDs = new Set([...resultText(result).matchAll(/PID:\s*(-?\d+)/g)].map(m => Number(m[1])));
      for (const pid of activePIDs) knownPIDs.add(pid);
      const searches = await client.callTool({ name: 'list_searches', arguments: {} }, undefined, { timeout: 10000 });
      if (!searches.isError) {
        searchIDs = new Set(resultText(searches).split(/(?=Session:\s*search_)/)
          .filter(block => /Status:\s*[^\n]*RUNNING/.test(block)).map(block => block.match(/Session:\s*(search_\d+_\d+)/)?.[1]).filter(Boolean));
      }
      record();
    }
  } catch { /* Retain the last known sessions instead of assuming they exited. */ }
  finally { refreshPending = false; }
}
function schemaFor(tool) {
  const schema = structuredClone(tool.inputSchema);
  if (schema.properties) for (const key of deniedArgs) delete schema.properties[key];
  schema.additionalProperties = false;
  return schema;
}
function parseArguments(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new PermissionError('Tool arguments must be an object.');
  const shape = toolArgSchemas[name];
  const parsed = shape.safeParse(args);
  if (!parsed.success) throw new PermissionError('Invalid tool arguments.');
  // Zod normally drops unknown keys silently; rejecting them closes unexpected
  // options/alternate path entry points when the upstream schema changes.
  for (const key of Object.keys(args)) {
    if (deniedArgs.has(key) || !(key in parsed.data)) throw new PermissionError(`Unsupported argument: ${key}.`);
  }
  return parsed.data;
}
async function prepare(name, raw) {
  const args = parseArguments(name, raw);
  if (commandTools.has(name)) {
    if (!policy.allowCommands) throw new PermissionError('Command execution is disabled for the active workspace.');
    if (name !== 'start_process' && name !== 'list_sessions' && !knownPIDs.has(args.pid)) {
      throw new PermissionError('Only process sessions created by this workspace can be accessed.');
    }
    return args;
  }
  switch (name) {
    case 'read_file':
      if (args.isUrl) throw new PermissionError('URL reads are disabled. Use an authorized local file.');
      args.path = permissions.authorize(args.path); break;
    case 'read_multiple_files':
      args.paths = args.paths.map(p => permissions.authorize(p)); break;
    case 'get_file_info': args.path = permissions.authorize(args.path); break;
    case 'write_file': case 'create_directory': args.path = permissions.authorize(args.path, 'write'); break;
    case 'edit_block': args.file_path = permissions.authorize(args.file_path, 'write'); break;
    case 'move_file': Object.assign(args, permissions.move(args.source, args.destination)); break;
    case 'start_search': args.path = permissions.searchRoot(args.path); break;
    case 'get_more_search_results': case 'stop_search':
      if (!knownSearchIDs.has(args.sessionId)) throw new PermissionError('Unknown search session for this workspace.'); break;
    case 'list_directory': args.path = permissions.authorize(args.path); break;
    case 'list_searches': break;
    default: throw new PermissionError('This tool is not enabled.');
  }
  return args;
}
let availableTools = [];
server.setRequestHandler(types.ListToolsRequestSchema, async () => ({ tools: [{
  name: 'workspace_info', description: 'Return the currently active local workspace, directory read/write permissions and command mode. Call this before accessing local files.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false }
}, ...availableTools, methodsTool, ...(process.platform === 'darwin' ? [applicationTool, obsidianTool] : [])] }));
server.setRequestHandler(types.CallToolRequestSchema, async request => {
  const name = request.params.name;
  if (name === 'workspace_info') {
    if (Object.keys(request.params.arguments || {}).length) return errorResult('workspace_info accepts no arguments.');
    return textResult(JSON.stringify({ ...policy, protectedPaths: undefined,
      workspaceName: path.basename(policy.workspaceRoot), permissionScope: 'file tools',
      commandMode: policy.allowCommands ? `enabled: current ${userPlatform} user privileges; directory rules do not sandbox commands` : 'disabled' }, null, 2));
  }
  const applicationLaunch = process.platform === 'darwin' && name === applicationTool.name;
  const obsidianQuery = process.platform === 'darwin' && name === obsidianTool.name;
  const methodQuery = name === methodsTool.name;
  if (!applicationLaunch && !obsidianQuery && !methodQuery && (!safeTools.has(name) || !availableTools.some(t => t.name === name))) return errorResult('This tool is not enabled by gpt-bridge.');
  // Register before inspecting the controller lock. If a call wins the race,
  // control.mjs observes pending work and refuses to stop. If control wins,
  // the call sees its lock and cannot begin an operation. There is no await
  // between this record and the lock check.
  pendingToolCalls++; record();
  try {
    if (fs.existsSync(path.join(path.dirname(policyFile), 'control.lock'))) {
      return errorResult('The connection is changing. Wait for the operation to finish before calling tools.');
    }
    if (applicationLaunch) return textResult(JSON.stringify(await launchApplication(request.params.arguments || {}, policy.allowCommands)));
    if (obsidianQuery) return textResult(JSON.stringify(await queryObsidian(request.params.arguments || {}, permissions)));
    if (methodQuery) return textResult(JSON.stringify(queryMethods(request.params.arguments || {}, permissions)));
    const args = await prepare(name, request.params.arguments || {});
    if (name === 'list_directory') return textResult(permissions.list(args.path, args.depth));
    let terminationTree = [];
    if (windows && name === 'force_terminate' && args.pid > 0) {
      const rows = snapshot();
      const descendants = pid => [...rows.values()].filter(p => p.parent === pid &&
        (!rows.has(pid) || p.started >= rows.get(pid).started)).flatMap(p => [p, ...descendants(p.pid)]);
      const session = rows.get(args.pid);
      if (session) {
        if (!descendants(dcPID).some(p => p.pid === session.pid)) throw new PermissionError('This process no longer belongs to the workspace session.');
        terminationTree = [session, ...descendants(session.pid)];
      }
    }
    const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 240000 });
    // DC kills the shell only on Windows. Reap its verified descendants before the shell's PID is lost.
    if (!result.isError && terminationTree.length) terminateTracked(terminationTree);
    const text = resultText(result);
    if (name === 'start_process' && !result.isError) {
      const pid = text.match(/(?:Process|Node\.js session) started with PID\s+(-?\d+)/i)?.[1];
      if (pid) { knownPIDs.add(Number(pid)); activePIDs.add(Number(pid)); record(); }
    }
    if (name === 'start_search' && !result.isError) {
      const id = text.match(/\bsearch_\d+_\d+\b/)?.[0];
      if (id) { knownSearchIDs.add(id); if (!/Status:\s*COMPLETED/i.test(text)) searchIDs.add(id); }
    }
    if (name === 'list_searches') await refreshSessions();
    if (name === 'stop_search') searchIDs.delete(args.sessionId);
    if (name === 'get_more_search_results' && /Search completed|Status:\s*(?:completed|stopped)|search (?:completed|stopped)/i.test(text)) searchIDs.delete(args.sessionId);
    if (commandTools.has(name)) await refreshSessions();
    // MCP App previews and their callable actions are deliberately not relayed.
    // This prevents widget tools or resources from reaching the DC outside this
    // checked tools/call route.
    const { _meta, ...clean } = result;
    clean.content = clean.content?.filter(c => ['text', 'image', 'audio'].includes(c.type)).map(({ _meta, ...item }) => item);
    return clean;
  } catch (error) { return errorResult(error.message); }
  finally { pendingToolCalls--; record(); }
});
async function stop() {
  if (stopping) return;
  stopping = true; clearInterval(monitor);
  await client.close(); await server.close(); process.exit(0);
}
let monitor;
try {
  await client.connect(child); dcPID = child.pid; record();
  const tools = await client.listTools();
  availableTools = tools.tools.filter(t => safeTools.has(t.name)).map(({ _meta, ...tool }) => ({ ...tool,
    inputSchema: schemaFor(tool), description: commandTools.has(tool.name)
      ? `[gpt-bridge: ${policy.allowCommands ? `enabled; commands use ${userPlatform} user privileges, outside file-directory rules` : 'disabled for this workspace'}] ${tool.description}`
      : `[gpt-bridge: active workspace file permissions apply] ${tool.description}` }));
  await refreshSessions();
  monitor = setInterval(() => { void refreshSessions(); }, 3000); monitor.unref();
  process.on('SIGINT', stop); process.on('SIGTERM', stop); process.stdin.on('end', stop);
  server.onclose = stop;
  client.onclose = () => { if (!stopping) { console.error('gpt-bridge execution service exited'); void stop(); } };
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(`gpt-bridge permission proxy failed: ${error.message}`);
  await client.close(); process.exit(1);
}
