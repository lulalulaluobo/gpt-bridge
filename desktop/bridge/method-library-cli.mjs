import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { configuredMethods } from './method-library.mjs';
import { windows } from './platform.mjs';
try {
  const state = process.argv[2];
  if (!state || !path.isAbsolute(state)) throw new Error('Invalid application state directory');
  const args = JSON.parse(fs.readFileSync(0, 'utf8'));
  const resources = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const home = os.userInfo().homedir;
  const protectedPaths = [state, resources, path.join(home, '.config/macbridge'), path.join(home, '.local/share/macbridge'),
    ...(windows ? [path.join(home, 'AppData/Roaming/Microsoft/Credentials'), path.join(home, 'AppData/Local/Microsoft/Credentials')] : [path.join(home, 'Library/Keychains')])];
  console.log(JSON.stringify(configuredMethods(args, state, protectedPaths)));
} catch (error) { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; }
