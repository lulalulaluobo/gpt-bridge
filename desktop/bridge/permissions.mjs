import fs from 'node:fs';
import path from 'node:path';

export class PermissionError extends Error {
  constructor(message) { super(message); this.name = 'PermissionError'; }
}
const deny = message => { throw new PermissionError(message); };
export const within = (candidate, root) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

function absolute(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\0\r\n]/.test(value) || /^\w+:\/\//.test(value)) {
    deny('An absolute local filesystem path is required.');
  }
  return path.normalize(value);
}

// Resolve the closest existing ancestor, not just the immediate parent. A new
// nested path can otherwise hide an escaping or dangling symbolic link.
export function canonicalPath(value) {
  const requested = absolute(value);
  let current = requested;
  const suffix = [];
  for (;;) {
    try {
      fs.lstatSync(current);
      return path.join(fs.realpathSync(current), ...suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') deny('Unable to safely resolve this filesystem path.');
      // lstat detects dangling symlinks, which realpath must never ignore.
      try {
        if (fs.lstatSync(current).isSymbolicLink()) deny('Dangling symbolic links are not accessible.');
      } catch (inner) { if (inner instanceof PermissionError) throw inner; }
      const parent = path.dirname(current);
      if (parent === current) deny('Unable to resolve an existing filesystem ancestor.');
      suffix.unshift(path.basename(current)); current = parent;
    }
  }
}

export function loadPolicy(file) {
  const info = fs.lstatSync(file);
  if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600) {
    deny('The permission policy must be an owner-only regular file (0600).');
  }
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || typeof value.workspaceID !== 'string' || !value.workspaceID ||
      typeof value.allowCommands !== 'boolean' || !Array.isArray(value.grants) || !value.grants.length ||
      !Array.isArray(value.protectedPaths) || !value.protectedPaths.length) deny('Invalid permission policy.');
  const workspaceRoot = canonicalPath(value.workspaceRoot);
  if (workspaceRoot === path.sep || !fs.statSync(workspaceRoot).isDirectory()) deny('Invalid workspace root.');
  const seen = new Set();
  const grants = value.grants.map(grant => {
    if (!['readOnly', 'readWrite'].includes(grant.access)) deny('Invalid directory permission.');
    const directory = canonicalPath(grant.path);
    if (directory === path.sep || directory !== absolute(grant.path) || seen.has(directory) ||
        !fs.statSync(directory).isDirectory()) deny('Access directories must be unique existing canonical directories.');
    seen.add(directory);
    return Object.freeze({ path: directory, access: grant.access });
  });
  if (!grants.some(g => g.path === workspaceRoot)) deny('The workspace root must have an explicit directory permission.');
  const protectedPaths = value.protectedPaths.map(p => canonicalPath(p));
  if (protectedPaths.some(p => within(workspaceRoot, p))) deny('The workspace cannot be inside application-private files.');
  return Object.freeze({ schemaVersion: 1, workspaceID: value.workspaceID, workspaceRoot,
    allowCommands: value.allowCommands, grants: Object.freeze(grants), protectedPaths: Object.freeze(protectedPaths) });
}

export class FilePermissions {
  constructor(policy) { this.policy = policy; }
  mostSpecific(candidate) {
    return this.policy.grants.filter(g => within(candidate, g.path)).sort((a, b) => b.path.length - a.path.length)[0];
  }
  authorize(value, operation = 'read') {
    const requested = absolute(value);
    const resolved = canonicalPath(requested);
    for (const protectedPath of this.policy.protectedPaths) {
      if (within(requested, protectedPath) || within(resolved, protectedPath)) deny('Application-private files are not accessible through file tools.');
    }
    const lexical = this.mostSpecific(requested), real = this.mostSpecific(resolved);
    if (!lexical || !real) deny('This path is outside the active workspace access directories.');
    for (const grant of [lexical, real]) {
      if (canonicalPath(grant.path) !== grant.path) deny('An access directory changed; select it again in the app.');
      if (operation === 'write' && grant.access !== 'readWrite') deny('This directory is read-only.');
    }
    try {
      const info = fs.statSync(resolved);
      if (!info.isFile() && !info.isDirectory()) deny('Special filesystem objects are not accessible.');
      // A hard link could refer to a protected/outside inode while its pathname
      // appears permitted. This conservative rule avoids that ambiguity.
      if (info.isFile() && info.nlink > 1) deny('Files with multiple hard links are not accessible through file tools.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return resolved;
  }
  searchRoot(value) {
    const root = this.authorize(value);
    if (this.policy.protectedPaths.some(p => within(p, root))) {
      deny('This search root contains application-private files. Select a narrower access directory.');
    }
    return root;
  }
  move(source, destination) {
    const from = this.authorize(source, 'write'), to = this.authorize(destination, 'write');
    if (this.policy.protectedPaths.some(p => within(p, from) || within(p, to)) ||
        this.policy.grants.some(g => g.access === 'readOnly' && within(g.path, from))) {
      deny('Moving this directory would modify a read-only or application-private descendant.');
    }
    let visited = 0;
    const walk = current => {
      if (++visited > 10000) deny('This directory move is too large to safely validate in one request.');
      const target = path.join(to, path.relative(from, current));
      this.authorize(current, 'write'); this.authorize(target, 'write');
      const info = fs.lstatSync(current);
      if (info.isSymbolicLink()) deny('Directory moves containing symbolic links are not supported.');
      if (info.isDirectory()) for (const entry of fs.readdirSync(current)) walk(path.join(current, entry));
    };
    walk(from);
    return { source: from, destination: to };
  }
  list(value, depth = 2) {
    const root = this.authorize(value), output = [];
    if (!Number.isInteger(depth) || depth < 1 || depth > 20) deny('Directory depth must be between 1 and 20.');
    let visited = 0;
    const walk = (directory, remaining) => {
      const entries = fs.readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (++visited > 10000) { output.push('[LIMIT] Listing stopped after 10000 entries.'); return; }
        const item = path.join(directory, entry.name);
        try { this.authorize(item); } catch (error) { if (error instanceof PermissionError) continue; throw error; }
        const label = path.relative(root, item);
        output.push(`${entry.isDirectory() ? '[DIR]' : '[FILE]'} ${label}`);
        // Do not follow symlinks while traversing a directory tree.
        if (entry.isDirectory() && remaining > 1) {
          try { walk(item, remaining - 1); } catch (error) { output.push(`[DENIED] ${label}`); }
        }
        if (visited > 10000) return;
      }
    };
    walk(root, depth);
    return output.join('\n') || '[EMPTY] No accessible entries.';
  }
}
