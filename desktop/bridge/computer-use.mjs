import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertPrivateFile, snapshot } from './platform.mjs';

const empty = { type: 'object', properties: {}, additionalProperties: false };
const fields = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export const computerTools = [
  { name: 'computer_apps', description: 'List running applications. Requires global computer control enabled locally.', inputSchema: empty, annotations: { readOnlyHint: true } },
  { name: 'computer_open', description: 'Launch an application by its name or bundle ID in the background. No per-app local approval is required. Do not retry an uncertain launch; inspect applications/windows instead.', inputSchema: fields({ app: { type: 'string' } }) },
  { name: 'computer_windows', description: 'List windows of an application (name, bundle ID or PID:123). Select an exact window before observing.', inputSchema: fields({ app: { type: 'string' } }), annotations: { readOnlyHint: true } },
  { name: 'computer_observe', description: 'Observe an application window. Supply app (name, bundle ID or PID:123) and optionally windowID from computer_windows. Switching targets needs no local approval. Returns screenshot and element IDs; observe before every action.', inputSchema: { ...empty, properties: { app: { type: 'string' }, windowID: { type: 'integer', minimum: 1 } } }, annotations: { readOnlyHint: true } },
  { name: 'computer_click', description: 'Click one element from the latest observation once. Always observe afterward; never retry an uncertain action.', inputSchema: fields({ observation: { type: 'string' }, element: { type: 'string' } }) },
  { name: 'computer_type', description: 'Type text into one element from the latest observation, replacing its content. Always observe afterward.', inputSchema: fields({ observation: { type: 'string' }, element: { type: 'string' }, text: { type: 'string', maxLength: 4000 } }) }
];

// Separate backend and schemas: DC file permissions never authorize screen control.
export class ComputerUse {
  constructor({ root, connect, identity = pid => snapshot().get(pid), changed = () => {} }) {
    Object.assign(this, { root, connect, identity, changed });
    this.session = null; this.backend = null; this.observation = null; this.busy = false;
  }
  policy() {
    const file = path.join(this.root, 'computer-use.json');
    assertPrivateFile(file);
    const p = JSON.parse(fs.readFileSync(file));
    if (p.enabled !== true || typeof p.id !== 'string' || !(p.scope === 'desktop' && p.expires === null || Number.isFinite(p.expires) && p.expires > Date.now())) throw new Error('Computer Use is stopped or expired. Enable it locally.');
    if (p.scope === 'desktop') return p;
    const target = this.identity(p.target?.pid);
    if (!target || target.started !== p.target.started || target.executable !== p.target.executable) throw new Error('The authorized app exited or changed. Select it again locally.');
    return p;
  }
  async revoke() {
    const backend = this.backend;
    this.backend = null; this.session = null; this.observation = null; this.windowID = null; this.targetApp = null;
    await backend?.close().catch(() => {});
    this.changed(null);
  }
  async check() {
    try { if (this.session && this.policy().id !== this.session.id) await this.revoke(); }
    catch { await this.revoke(); }
  }
  async call(name, args) {
    if (this.busy) return { ...text({ error: 'A Computer Use call is in progress.' }), isError: true };
    this.busy = true;
    let dispatched = false;
    try {
      const tool = computerTools.find(t => t.name === name);
      const keys = Object.keys(tool?.inputSchema.properties || {});
      if (!tool || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => !keys.includes(k)) ||
          (tool.inputSchema.required || []).some(k => !(k in args)) || Object.entries(args).some(([k,v]) =>
            k === 'windowID' ? !Number.isInteger(v) || v < 1 : typeof v !== 'string' || !v.length)) throw new Error('Invalid Computer Use arguments.');
      if (args.text?.length > 4000) throw new Error('Text exceeds 4000 characters.');
      const policy = this.policy();
      if (this.session?.id !== policy.id) {
        await this.revoke();
        this.session = policy;
        let backend;
        try { backend = await this.connect(); } catch (error) { await this.revoke(); throw error; }
        if (this.policy().id !== policy.id || this.session?.id !== policy.id) { await backend.close(); throw new Error('Control was stopped during startup.'); }
        this.backend = backend; this.changed(backend.pid);
      }
      const backend = this.backend;
      if (!backend) throw new Error('Computer Use is stopped.');
      if (['computer_apps', 'computer_open', 'computer_windows'].includes(name)) {
        if (policy.scope !== 'desktop') throw new Error('Enable global computer control locally first.');
        this.observation = null; this.windowID = null;
        if (name === 'computer_open') dispatched = true;
        const result = await backend.callTool({ name: name === 'computer_windows' ? 'window' : 'app', arguments:
          name === 'computer_apps' ? { action: 'list' } : name === 'computer_windows' ? { action: 'list', app: args.app } :
          { action: 'launch', name: args.app, waitUntilReady: true, waitForWindow: true } });
        if (this.policy().id !== policy.id || this.backend !== backend) throw new Error('Control was stopped.');
        return result;
      }
      if (name === 'computer_observe') {
        this.observation = null;
        if (policy.scope !== 'desktop' && (args.app || args.windowID)) throw new Error('Scoped sessions cannot switch targets.');
        const app = policy.scope === 'desktop' ? args.app || this.targetApp : `PID:${policy.target.pid}`;
        if (!app) throw new Error('Choose an app using computer_apps and computer_windows, then supply app.');
        const windowID = args.windowID || (app === this.targetApp ? this.windowID : null);
        const result = await backend.callTool({ name: 'see', arguments: { app_target: app, include_elements: true,
          ...(windowID ? { window_id: windowID } : {}) } });
        if (this.policy().id !== policy.id || this.backend !== backend) throw new Error('Control was stopped.');
        const meta = result._meta, receipt = meta?.target_receipt;
        const images = result.content?.filter(c => c.type === 'image').map(c => ({ type: c.type, mimeType: c.mimeType, data: c.data }));
        if (result.isError) return result;
        const target = this.identity(receipt?.pid);
        if (!target || (policy.scope !== 'desktop' && receipt?.pid !== policy.target.pid) || !receipt?.window_id || !meta?.snapshot_id || !images?.length ||
            (windowID && receipt.window_id !== windowID)) throw new Error('No verified screenshot of the requested window.');
        this.targetApp = app;
        this.windowID = receipt.window_id;
        const elements = (meta.ui_elements || []).filter(e => e.is_actionable).map(e => ({ id: e.id, role: e.role, title: e.title, label: e.label, identifier: e.identifier }));
        this.observation = { id: randomUUID(), snapshot: meta.snapshot_id, target, elements, at: Date.now() };
        return { content: [...text({ observation: this.observation.id, windowID: this.windowID, elements }).content, ...images] };
      }
      const o = this.observation;
      if (!o || args.observation !== o.id || Date.now() - o.at > 60000 || !o.elements.some(e => e.id === args.element)) throw new Error('Observe again before acting; the element or observation is stale.');
      const live = this.identity(o.target.pid);
      if (!live || live.started !== o.target.started || live.executable !== o.target.executable) throw new Error('Observed application exited or changed. Observe again.');
      if (this.policy().id !== policy.id) throw new Error('Control was stopped.');
      // Consume before dispatch, including timeout/errors. No automatic replay.
      this.observation = null; dispatched = true;
      const result = await backend.callTool({ name: name === 'computer_click' ? 'click' : 'type', arguments: {
        snapshot: o.snapshot, on: args.element, ...(name === 'computer_type' ? { text: args.text, clear: true } : {}) } });
      return text({ mutationDispatched: result._meta?.mutation_dispatched ?? null,
        effect: result._meta?.effect ?? 'unknown', upstreamIsError: !!result.isError, retrySafe: false, next: 'computer_observe' });
    } catch (error) {
      return { ...text({ error: error.message, mutationDispatched: dispatched ? 'unknown' : false, retrySafe: false, next: 'computer_observe' }), isError: true };
    } finally { this.busy = false; }
  }
}
