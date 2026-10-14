// One routing contract for MCP initialization, discovery and workspace responses.
// Guidance for the calling model, not a claim about its available built-in tools.
export const taskRouting = {
  version: 1,
  role: 'gpt-bridge provides local files, installed executables and local SOP discovery. It is not the default executor for every task.',
  selection: 'Start with the requested outcome and modality. Use local discovery when the task needs local files, installed software, batch automation, or a user-requested local SOP. Do not search local skills merely because this plugin is selected.',
  images: 'For creative image generation or editing, prefer an image-generation tool actually available in the current conversation. A local imagegen skill does not expose that tool. If it is unavailable, explain the limitation; do not silently substitute Python/Pillow/SVG drawing for model-generated artwork. Programmatic drawing remains appropriate for charts, precise diagrams, or explicitly requested procedural graphics.',
  skills: 'Read relevant SOPs only after choosing a suitable route. Check required tools, runtimes, scripts, credentials and references against actual availability. Indexed means readable, not executable or compatible. Do not claim that reading a skill means following it. If a required dependency is missing, report it and obtain agreement before a materially different method; routine equivalent implementation choices need no extra confirmation.',
  execution: 'Use get_cli_info for candidate paths, then inspect supported usage before execution. Use start_process only for a justified local task and when enabled. Never invent host-only tools or assume Codex tools are available in ChatGPT.',
  completion: 'Check the requested deliverable, not just file existence. Report the actual method and unverified aspects. Format validation is not visual inspection; a file path is not an image preview.'
};
export const routingInstructions = Object.values(taskRouting).filter(v => typeof v === 'string').join(' ');
export const commandRouting = 'Use for local execution after selecting a method appropriate to the user outcome. Do not silently replace creative image generation with Python/Pillow drawing. A discovered Skill is not proof its dependencies are available.';
