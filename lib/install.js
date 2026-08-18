'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Hooks are installed per project, into the repo's own .claude/settings.json.
 *
 * That file carries no secret (just a command), so it can be committed and the
 * whole team picks up the hooks on clone. The ingest key lives separately in
 * .almost/config.json, which is gitignored.
 */
const claudeSettingsPath = () =>
  path.join(process.cwd(), '.claude', 'settings.json');

const DETECT = [
  {
    id: 'codex',
    label: 'Codex',
    probes: ['.codex', path.join(os.homedir(), '.codex')],
    hint: 'set  notify = ["npx", "almost-sh", "stop"]  in .codex/config.toml',
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    probes: ['.gemini', path.join(os.homedir(), '.gemini')],
    hint: 'run  npx almost-sh stop  from your task-complete hook',
  },
  {
    id: 'cursor',
    label: 'Cursor',
    probes: ['.cursor', path.join(os.homedir(), '.cursor')],
    hint: 'run  npx almost-sh stop  as an afterward command in your rules',
  },
];

function hookEntry(event) {
  return {
    matcher: '',
    hooks: [{ type: 'command', command: `npx almost-sh ${event}`, timeout: 10 }],
  };
}

function installClaude() {
  const file = claudeSettingsPath();
  let settings = {};
  let existed = false;

  if (fs.existsSync(file)) {
    existed = true;
    const raw = fs.readFileSync(file, 'utf8');
    try {
      settings = JSON.parse(raw);
    } catch (err) {
      return {
        ok: false,
        error: `.claude/settings.json is not valid JSON (${err.message})`,
      };
    }
    fs.writeFileSync(`${file}.almost-backup`, raw);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  settings.hooks = settings.hooks || {};
  let added = 0;

  for (const event of ['Notification', 'Stop']) {
    settings.hooks[event] = settings.hooks[event] || [];
    const present = settings.hooks[event].some(
      (h) => h.hooks && h.hooks.some((i) => i.command && i.command.includes('almost-sh')),
    );
    if (!present) {
      settings.hooks[event].push(hookEntry(event.toLowerCase()));
      added += 1;
    }
  }

  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, added, backedUp: existed, file };
}

/** Only reports agents whose config is actually present. */
function detectOthers() {
  return DETECT.filter((d) => d.probes.some((p) => fs.existsSync(p)));
}

module.exports = { installClaude, detectOthers, claudeSettingsPath };
