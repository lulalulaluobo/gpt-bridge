import fs from 'node:fs';
import path from 'node:path';
import { FilePermissions, canonicalPath, within } from './permissions.mjs';
import { assertPrivateFile, diskRoot } from './platform.mjs';
import { methodsTool, queryMethods } from './methods.mjs';

export const libraryTool = structuredClone(methodsTool);
libraryTool.description = 'Read-only method reference library configured in the desktop app. Call action=list to discover directories; search without library_path searches all configured directories. Read relevant returned documents fully using nextOffset. These documents provide methods to the conversation model, not executable tools, CLI availability or execution authorization. No local generation is required merely to save locally. Config changes take effect immediately. Obsidian uses obsidian_query.';
libraryTool.inputSchema.properties.action.enum.push('list');
libraryTool.inputSchema.required = ['action'];
libraryTool.inputSchema.properties.offset.description = 'Zero-based search result offset or read line offset.';

export function configuredMethods(args, stateRoot, protectedPaths) {
  if (!args || typeof args !== 'object' || Array.isArray(args) ||
      Object.keys(args).some(k => !(k in libraryTool.inputSchema.properties))) throw new Error('Invalid method library arguments.');
  const file = path.join(stateRoot, 'method-library.json');
  let directories = [];
  if (fs.existsSync(file)) {
    assertPrivateFile(file);
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (config.schemaVersion !== 1 || !Array.isArray(config.directories) || config.directories.length > 30 || config.directories.some(p => typeof p !== 'string')) throw new Error('Invalid method library configuration.');
    directories = [...new Set(config.directories)];
  }
  const valid = [], errors = [];
  for (const directory of directories) {
    try {
      const real = canonicalPath(directory);
      if (real !== directory || diskRoot(real) || !fs.statSync(real).isDirectory() || protectedPaths.some(p => within(real, p) || within(p, real))) throw new Error('Directory unavailable, moved or protected.');
      valid.push(real);
    } catch { errors.push({ path: directory, error: '目录不可用、已移动或包含应用私有数据。' }); }
  }
  if (args.action === 'list') {
    if (Object.keys(args).length !== 1) throw new Error('list accepts only action.');
    return { directories, errors, mode: 'reference_only' };
  }
  if (!['search', 'read'].includes(args.action)) throw new Error('Invalid method library action.');
  const roots = args.library_path ? valid.filter(p => p === args.library_path) : valid;
  if (!roots.length) throw new Error('请先在桌面应用的方法库添加可用资料目录。');
  const permissions = new FilePermissions({ grants: valid.map(p => ({ path: p, access: 'readOnly' })), protectedPaths });
  if (args.action === 'read') {
    if (!args.library_path) throw new Error('Use the library_path returned by search.');
    return queryMethods(args, permissions);
  }
  if (Object.keys(args).some(k => !['action', 'library_path', 'query', 'limit', 'offset'].includes(k))) throw new Error('Unexpected search argument.');
  const offset = args.offset ?? 0, limit = args.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid search range.');
  let results = [], incomplete = false, skipped = 0, guidance;
  for (const root of roots) {
    const result = queryMethods({ action: 'search', library_path: root, query: args.query ?? '', limit: 5000 }, permissions, 5000);
    results.push(...result.results.map(row => ({ ...row, library_path: root })));
    incomplete ||= result.incomplete; skipped += result.skipped; guidance = result.guidance;
  }
  results.sort((a, b) => b.score - a.score || a.document_path.localeCompare(b.document_path));
  return { results: results.slice(offset, offset + limit), matched: results.length,
    nextOffset: offset + limit < results.length ? offset + limit : null,
    refreshed: true, incomplete, skipped, errors, guidance };
}
