// A direct Node entry point avoids cmd.exe expansion of spaces, %, &, and Unicode paths.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemEnv, assertPrivateFile } from './platform.mjs';

const root = process.argv[2];
const file = path.join(root, 'launch.json');
assertPrivateFile(file);
const launch = JSON.parse(fs.readFileSync(file, 'utf8'));
const resources = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const environment = { ...systemEnv(launch.dcHome),
  PATH: [path.dirname(process.execPath), path.join(resources, 'runtime/dc/node_modules/@vscode/ripgrep-win32-x64/bin'),
    systemEnv(launch.dcHome).PATH].join(path.delimiter),
  TEMP: path.join(root, 'tmp'), TMP: path.join(root, 'tmp'),
  DESKTOP_COMMANDER_DISABLE_TELEMETRY: '1', MACBRIDGE_NO_BROWSER_DOWNLOAD: '1' };
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, environment);
process.chdir(launch.workspace);
process.argv = [process.execPath, path.join(resources, 'bridge/proxy.mjs'),
  launch.entry, launch.configPath, launch.policyFile, launch.sessionsFile];
await import('./proxy.mjs');
