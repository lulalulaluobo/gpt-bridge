import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { loadPolicy } from './permissions.mjs';
import { assertPrivateFile } from './platform.mjs';
const [entry, config, policyFile] = process.argv.slice(2);
try {
  assertPrivateFile(config);
  const value = JSON.parse(fs.readFileSync(config, 'utf8'));
  const policy = loadPolicy(policyFile);
  const directories = policy.grants.map(g => g.path);
  const actualConfig = path.join(process.env.HOME, '.claude-server-commander/config.json');
  if (fs.realpathSync(actualConfig) !== fs.realpathSync(config) || value.telemetryEnabled !== false ||
      JSON.stringify(value.allowedDirectories) !== JSON.stringify(directories) ||
      !value.blockedCommands?.length) throw new Error('invalid configuration');
} catch { console.error('gpt-bridge DC configuration guard failed'); process.exit(1); }
process.argv = [process.execPath, entry, '--no-onboarding'];
await import(pathToFileURL(entry).href);
