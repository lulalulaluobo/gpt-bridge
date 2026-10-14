import fs from 'node:fs';
import { readCatalog, updateCatalog } from './capabilities.mjs';
const [root, action] = process.argv.slice(2);
try {
  const result = action === 'read' ? readCatalog(root) : updateCatalog(root, action, JSON.parse(fs.readFileSync(0, 'utf8')));
  process.stdout.write(JSON.stringify(result));
} catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; }
