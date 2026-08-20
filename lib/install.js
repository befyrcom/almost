'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * The agents this command knows about, and how each one is wired.
 *
 * One table rather than a first-class agent plus a list of also-rans. It used
 * to be `installClaude()` beside `detectOthers()`, which said in its shape that
 * Claude Code was the product and everything else was a footnote. Nothing here
 * is the default now: adding an agent that can be wired automatically is a row
 * with `hooks`, and adding one that cannot is a row with `hint`.
 *
 * A row with `hooks` keeps its config somewhere we can safely edit, so `almost
 * init` writes it. A row with `hint` does not — its config is a TOML file, a
 * rules document or a settings UI we would have to guess the shape of — so the
 * install prints the one line that agent needs and leaves the file alone.
 *
 * Hooks are installed per project, into the repo's own settings file. That file
 * carries no secret (just a command), so it can be committed and the whole team
 * picks the hooks up on clone. The ingest key lives separately in
 * .almost/config.json, which is gitignored.
 */
const AGENTS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    settings: () => path.join(process.cwd(), '.claude', 'settings.json'),
    /**
     * SessionStart matches `startup|clear` and deliberately NOT `compact`.
     * Compaction continues the same session, so it keeps the same session id,
     * and the board keys one card per session: firing `start` there would drag
     * a card that had already reached Almost back into Running while nothing
     * had actually resumed. Startup and clear each begin a genuinely new
     * session, which is what a run starting means.
     */
    hooks: [
      { event: 'SessionStart', matcher: 'startup|clear', command: 'start' },
      { event: 'Notification', matcher: '', command: 'notification' },
      { event: 'Stop', matcher: '', command: 'stop' },
    ],
  },
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

function hookEntry(matcher, command) {
  return {
    matcher,
    hooks: [{ type: 'command', command: `npx almost-sh ${command}`, timeout: 10 }],
  };
}

/**
 * Write one agent's hooks into its settings file.
 *
 * The command each hook runs is listed in the table rather than derived from
 * the event name. It used to be `event.toLowerCase()`, which happened to work
 * while every event was one word and would silently have produced
 * `sessionstart` — not a command — the moment one was not.
 */
function installHooks(agent) {
  const file = agent.settings();
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
        error: `${path.relative(process.cwd(), file)} is not valid JSON (${err.message})`,
      };
    }
    fs.writeFileSync(`${file}.almost-backup`, raw);
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  settings.hooks = settings.hooks || {};
  let added = 0;

  for (const { event, matcher, command } of agent.hooks) {
    settings.hooks[event] = settings.hooks[event] || [];
    const present = settings.hooks[event].some(
      (h) => h.hooks && h.hooks.some((i) => i.command && i.command.includes('almost-sh')),
    );
    if (!present) {
      settings.hooks[event].push(hookEntry(matcher, command));
      added += 1;
    }
  }

  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { ok: true, added, backedUp: existed, file };
}

/**
 * Wire every agent that can be wired, and report on the ones that cannot.
 *
 * An agent with hooks is installed unconditionally rather than only when it is
 * detected: `almost init` is run inside a repo to set that repo up, and the
 * settings file is committed, so it has to be written whether or not the person
 * running the command happens to have that agent open right now.
 */
function installAgents() {
  return AGENTS.map((agent) =>
    agent.hooks
      ? { agent, ...installHooks(agent) }
      : { agent, detected: (agent.probes || []).some((p) => fs.existsSync(p)) },
  );
}

/** Agents whose config is present but which have to be wired by hand. */
function detectAgents() {
  return AGENTS.filter(
    (a) => !a.hooks && (a.probes || []).some((p) => fs.existsSync(p)),
  );
}

/** Where a hook-installing agent keeps the file `init` writes. */
function settingsPathFor(id) {
  const agent = AGENTS.find((a) => a.id === id);
  return agent && agent.settings ? agent.settings() : null;
}

module.exports = { AGENTS, installAgents, installHooks, detectAgents, settingsPathFor };
