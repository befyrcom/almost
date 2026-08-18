'use strict';

const crypto = require('node:crypto');

/**
 * What leaves this machine.
 *
 * almost is a signal, not a logger. It needs to know THAT something happened,
 * almost never WHAT the something was. So the default mode sends metadata only
 * and derives a category for the reason instead of forwarding the agent's own
 * words.
 *
 * Two rules hold in every mode:
 *   1. The transcript is never opened. Claude Code hands hooks a
 *      `transcript_path` pointing at the full conversation on disk. almost
 *      drops that key on arrival and has no code path that reads a file.
 *   2. Nothing is sent anywhere unless the project is connected to a team, or
 *      a webhook is explicitly configured.
 */

// Keys that may appear in an agent payload and must never be forwarded,
// whatever mode is set. Paths and raw prompts are content, not signal.
const NEVER_FORWARD = new Set([
  'transcript_path',
  'transcript',
  'messages',
  'conversation',
  'prompt',
  'response',
  'content',
  'text',
  'cwd',
  'file_path',
  'tool_input',
  'tool_response',
]);

/**
 * Buckets a notification into a category without echoing its wording.
 * Matching happens locally; only the resulting label can be transmitted.
 */
function categorise(message) {
  if (typeof message !== 'string' || !message.trim()) return null;
  const m = message.toLowerCase();
  if (/permission|approve|allow|confirm/.test(m)) return 'permission required';
  if (/waiting|input|respond|answer|question/.test(m)) return 'waiting for input';
  if (/error|failed|failure|crash/.test(m)) return 'reported an error';
  if (/idle|quiet|timeout|timed out/.test(m)) return 'gone quiet';
  return 'needs attention';
}

/** Stable per session, but not reversible to the agent's own session id. */
function sessionRef(raw) {
  if (!raw) return null;
  return crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 16);
}

function stripUnsafe(payload) {
  const clean = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (!NEVER_FORWARD.has(k)) clean[k] = v;
  }
  return clean;
}

/**
 * Builds the exact object that will be transmitted.
 * `almost preview` renders this, so what the user inspects is what is sent.
 */
function buildEvent({ kind, payload, cfg, agent, repo }) {
  const safe = stripUnsafe(payload);
  const full = cfg.privacy === 'full';

  return {
    kind,
    agent,
    actor: cfg.actor,
    repo: cfg.sendRepo === false ? null : repo,
    session_ref: sessionRef(safe.session_id || safe.session_ref),
    // In metadata mode the agent's own words never leave the machine: the
    // reason is a category derived locally, and the task name is omitted.
    task: full ? safe.task || null : null,
    message: full ? safe.message || null : categorise(safe.message),
  };
}

module.exports = { buildEvent, categorise, sessionRef, stripUnsafe, NEVER_FORWARD };
