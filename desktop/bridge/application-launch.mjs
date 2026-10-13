import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const applicationTool = {
  name: 'open_application',
  description: 'Open an installed macOS application by name, e.g. Keynote, Safari or Numbers. Use this for launching apps instead of AppleScript activate. Requires the current workspace command switch. This requests application launch only; modifying app documents through AppleScript still requires macOS Automation permission.',
  inputSchema: { type: 'object', properties: { app: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['app'], additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
};

export async function launchApplication(args, enabled, launch = execute) {
  if (!enabled) throw new Error('Command execution is disabled for the active workspace.');
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length !== 1 ||
      typeof args.app !== 'string' || !args.app.trim() || args.app.length > 200 || /[\x00-\x1f/\\]/.test(args.app)) {
    throw new Error('Supply one installed application name, without a path or additional arguments.');
  }
  const app = args.app.trim();
  // Argument array, no shell, no AppleScript: this does not request Apple Events control.
  await launch('/usr/bin/open', ['-a', app], { timeout: 15000, maxBuffer: 16384, env: { PATH: '/usr/bin:/bin' } });
  return { app, status: 'launch_requested', message: 'macOS accepted the launch request. This does not confirm application readiness or document changes.' };
}
