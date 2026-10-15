import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configuredMethods } from './method-library.mjs';
try {
  const state = process.argv[2];
  if (!state || !path.isAbsolute(state)) throw new Error('Invalid application state directory');
  const args = JSON.parse(fs.readFileSync(0, 'utf8'));
  const resources = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  console.log(JSON.stringify(configuredMethods(args, state, [state, path.join(resources, 'runtime')])));
} catch (error) { console.log(JSON.stringify({ error: error.message })); process.exitCode = 1; }
