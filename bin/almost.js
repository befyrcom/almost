#!/usr/bin/env node
'use strict';

const notifier = require('node-notifier');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { settings, write, ensureIgnored, PROJECT_FILE } = require('../lib/config');
const { installAgents } = require('../lib/install');
const { buildEvent, NEVER_FORWARD } = require('../lib/privacy');

const EVENTS = new Set(['stop', 'notification', 'idle', 'start', 'done']);

const argv = process.argv.slice(2);
const command = argv[0] || 'stop';

if (command === 'init' || command === 'setup') {
  runInit();
} else if (command === 'connect') {
  runConnect(argv[1]);
} else if (command === 'status') {
  runStatus();
} else if (command === 'preview') {
  runPreview(argv[1]);
} else if (command === '--help' || command === '-h' || command === 'help') {
  usage();
} else {
  runEvent(EVENTS.has(command) ? command : 'stop');
}

// ── commands ──────────────────────────────────────────────────────────────

function usage() {
  process.stdout.write(
    [
      'almost — the signal layer for coding agents',
      '',
      '  almost init              Install hooks into this project',
      '  almost connect <key>     Point this project at a team, then install',
      '  almost status            Show what is configured',
      '  almost preview [event]   Print exactly what would be sent, send nothing',
      '',
      '  almost start             Report that a run has begun',
      '  almost stop              Report that a run finished',
      '  almost notification      Report that a run needs a person',
      '  almost idle              Report that a run has gone quiet',
      '  almost done              Report that the work passed its real gate',
      '',
      'init wires start, stop and notification. done is yours to call, from CI,',
      'a merge hook or a review bot — a card only reaches Done when something',
      'that actually checks the work says so.',
      '',
      'Event data may be piped in as JSON on stdin.',
      '',
    ].join('\n'),
  );
}

function runInit() {
  process.stdout.write(`Installing almost in ${process.cwd()}\n`);

  // One line per agent, whichever kind it is. An agent that can be wired says
  // what was written; one that cannot says what to write yourself, and only
  // when it is actually present — a hint for an agent nobody here uses is
  // noise on every install.
  for (const result of installAgents()) {
    const name = result.agent.label;

    if (!result.agent.hooks) {
      if (result.detected) {
        process.stdout.write(`  ${name}: detected, ${result.agent.hint}\n`);
      }
      continue;
    }

    if (!result.ok) {
      process.stderr.write(`  ${name}: ${result.error}\n`);
      process.exitCode = 1;
      continue;
    }

    const where = path.relative(process.cwd(), result.file);
    process.stdout.write(
      result.added === 0
        ? `  ${name}: already installed (${where})\n`
        : `  ${name}: ${where}${result.backedUp ? ' (backed up)' : ''}\n`,
    );
  }

  const cfg = settings();
  process.stdout.write(
    cfg.ingestKey
      ? '\nThis project reports to your team. Desktop notifications are on.\n'
      : '\nDesktop notifications are on. Run `almost connect <key>` to add your team.\n',
  );
}

function runConnect(key) {
  if (!key || !key.startsWith('alm_')) {
    process.stderr.write(
      'Pass the ingest key from your board, for example:\n  almost connect alm_xxxxxxxx\n',
    );
    process.exit(1);
  }

  const file = write({ ingestKey: key });
  process.stdout.write(`Saved to ${file}\n`);

  const ignored = ensureIgnored();
  if (ignored) process.stdout.write('Added .almost/ to .gitignore\n');
  process.stdout.write('\n');

  runInit();
}

/**
 * Prints the exact JSON that would be transmitted, and sends nothing.
 *
 * This is the point: the privacy claim is checkable rather than promised.
 * Pipe a real agent payload in and see precisely what would leave.
 */
function runPreview(kind) {
  readStdin((payload) => {
    const cfg = settings();
    const event = kind && EVENTS.has(kind) ? kind : 'notification';
    const body = eventBody(cfg, event, payload);

    const dropped = Object.keys(payload || {}).filter((k) => NEVER_FORWARD.has(k));

    process.stdout.write(
      [
        `mode        ${cfg.privacy === 'full' ? "full (the agent's own words included)" : 'metadata (default)'}`,
        `names       ${cfg.sendRepo === false ? 'no repo, no branch — cards take the agent name' : 'cards are named after the branch'}`,
        `destination ${cfg.ingestKey ? `${cfg.apiUrl}/api/events` : 'nowhere — not connected to a team'}`,
        `channels    ${cfg.slackWebhook ? 'one webhook configured' : 'none'}`,
        '',
        'This is the complete request body. Nothing else is sent:',
        '',
        JSON.stringify(body, null, 2),
        '',
        dropped.length
          ? `Dropped before sending: ${dropped.join(', ')}`
          : 'Nothing in this payload needed dropping.',
        '',
        'The transcript is never opened. almost has no code path that reads it.',
        '',
      ].join('\n'),
    );
    process.exit(0);
  });
}

function runStatus() {
  const cfg = settings();
  process.stdout.write(
    [
      `project     ${process.cwd()}`,
      `config      ${PROJECT_FILE()}`,
      `team        ${cfg.ingestKey ? `${cfg.ingestKey.slice(0, 12)}...` : 'not connected'}`,
      `api         ${cfg.apiUrl}`,
      `actor       ${cfg.actor}`,
      `slack       ${cfg.slackWebhook ? 'configured' : 'not set'}`,
      `desktop     ${cfg.silent ? 'silent' : 'on'}`,
      `privacy     ${cfg.privacy === 'full' ? 'full' : 'metadata only'}`,
      '',
    ].join('\n'),
  );
}

// ── event path ────────────────────────────────────────────────────────────

function runEvent(kind) {
  readStdin((payload) => {
    const cfg = settings();

    // The desktop banner is local: it never crosses the network, so it shows
    // the full detail the agent gave us.
    if (!cfg.silent) {
      const { title, message } = describe(kind, payload);
      notifier.notify({ title, message, sound: true, wait: false });
    }

    // Anything leaving the machine goes through the privacy filter first.
    const body = eventBody(cfg, kind, payload);

    const sends = [];
    if (cfg.ingestKey) sends.push(postEvent(cfg, kind, payload));
    if (cfg.slackWebhook) {
      sends.push(postJson(cfg.slackWebhook, { text: remoteSentence(body) }));
    }

    if (!sends.length) return process.exit(0);

    // The desktop banner already fired; network delivery must never hold a
    // hook past its timeout, so cap the whole batch and exit either way.
    const cap = setTimeout(() => process.exit(0), 4000);
    Promise.allSettled(sends).then(() => {
      clearTimeout(cap);
      process.exit(0);
    });
  });
}

/** The sentence a channel receives, built only from redacted fields. */
function remoteSentence(body) {
  const who = body.actor;
  const where = body.repo ? ` in ${body.repo}` : '';
  const what = body.task ? ` on "${body.task}"` : '';
  const why = body.message ? `: ${body.message}` : '';
  if (body.kind === 'stop') return `${who}'s ${body.agent} finished${what}${where}.`;
  if (body.kind === 'notification') return `${who}'s ${body.agent} needs you${what}${where}${why}`;
  if (body.kind === 'idle') return `${who}'s ${body.agent} has gone quiet${what}${where}.`;
  return `${who} started ${body.agent}${what}${where}.`;
}

function describe(kind, payload) {
  if (kind === 'notification') {
    return {
      title: 'almost | Attention needed',
      message:
        payload.message || 'Your agent is waiting for input or permission.',
    };
  }
  if (kind === 'idle') {
    return { title: 'almost | Gone quiet', message: payload.message || 'No output for a while.' };
  }
  if (kind === 'done') {
    return { title: 'almost | Verified', message: payload.message || 'Checks passed.' };
  }
  if (kind === 'start') {
    return { title: 'almost | Started', message: payload.message || 'A run has started.' };
  }
  return { title: 'almost | Agent finished', message: payload.message || 'The run has finished.' };
}

function eventBody(cfg, kind, payload) {
  return buildEvent({
    kind,
    payload,
    cfg,
    agent: payload.agent || detectAgent(),
    repo: repoName(),
    branch: branchName(),
  });
}

function postEvent(cfg, kind, payload) {
  return postJson(
    `${cfg.apiUrl.replace(/\/$/, '')}/api/events`,
    eventBody(cfg, kind, payload),
    { Authorization: `Bearer ${cfg.ingestKey}` },
  );
}

function postJson(url, body, extraHeaders) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(3500),
  }).catch(() => {
    /* A hook must never fail the terminal it runs in. */
  });
}

/**
 * The current branch, which is what a card ends up called.
 *
 * Without this every card on the board is named "<agent> run", because nothing
 * else supplies a name: `task` is only ever populated from JSON piped in on
 * stdin, and no agent's hook payload carries one. A branch is usually the task
 * — `axe/fix-retry-loop` — it is already written down in the repo, and it is
 * nowhere near the transcript.
 *
 * `symbolic-ref` rather than `rev-parse --abbrev-ref`: on a detached HEAD the
 * latter prints the literal string "HEAD", which would name a card "HEAD".
 * This fails instead, and the card falls back to the agent's name.
 */
function branchName() {
  try {
    const name = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 800,
    })
      .toString()
      .trim();
    return name || null;
  } catch {
    /* detached HEAD, not a repo, or no git */
    return null;
  }
}

/** Best effort: owner/repo from git, else the directory name. */
function repoName() {
  try {
    const remote = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 800,
    })
      .toString()
      .trim();
    const m = remote.match(/([^/:]+\/[^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  } catch {
    /* not a repo, or no git */
  }
  try {
    return path.basename(process.cwd());
  } catch {
    return null;
  }
}

function detectAgent() {
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE) return 'claude';
  if (process.env.CODEX_SANDBOX || process.env.CODEX_HOME) return 'codex';
  if (process.env.GEMINI_CLI) return 'gemini';
  return 'agent';
}

// ── stdin ─────────────────────────────────────────────────────────────────

function readStdin(done) {
  // Claude Code pipes a JSON payload and closes stdin. Run straight from a
  // terminal there is nothing to read and stdin never closes, so do not wait.
  if (process.stdin.isTTY) {
    process.stdin.pause();
    return done({});
  }

  let data = '';
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    try {
      done(data.trim() ? JSON.parse(data) : {});
    } catch {
      done({ message: data.trim().slice(0, 300) });
    }
  };

  process.stdin.on('data', (chunk) => {
    data += chunk;
  });
  process.stdin.on('end', finish);
  process.stdin.on('error', finish);
}
