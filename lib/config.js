'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_DIR = () => path.join(process.cwd(), '.almost');
const PROJECT_FILE = () => path.join(PROJECT_DIR(), 'config.json');
const GLOBAL_FILE = path.join(os.homedir(), '.almost', 'config.json');

function readFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Project config wins over the machine-wide file, so one repo can report to a
 * different team than another without either of them changing global state.
 */
function read() {
  return { ...readFile(GLOBAL_FILE), ...readFile(PROJECT_FILE()) };
}

function write(patch, { global = false } = {}) {
  const file = global ? GLOBAL_FILE : PROJECT_FILE();
  const next = { ...readFile(file), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  return file;
}

/**
 * The ingest key is a credential, so the file holding it must never be
 * committed. Adds the ignore rule once, only when the project has a .gitignore
 * or is a git repo.
 */
function ensureIgnored() {
  const root = process.cwd();
  const gitignore = path.join(root, '.gitignore');
  const isRepo = fs.existsSync(path.join(root, '.git'));
  if (!isRepo && !fs.existsSync(gitignore)) return null;

  let body = '';
  try {
    body = fs.readFileSync(gitignore, 'utf8');
  } catch {
    /* creating it below */
  }
  if (/^\.almost\/?$/m.test(body)) return null;

  const prefix = body.length && !body.endsWith('\n') ? '\n' : '';
  fs.appendFileSync(gitignore, `${prefix}\n# almost.sh — holds your team ingest key\n.almost/\n`);
  return gitignore;
}

function settings() {
  const cfg = read();
  return {
    ingestKey: process.env.ALMOST_INGEST_KEY || cfg.ingestKey || null,
    apiUrl: process.env.ALMOST_API_URL || cfg.apiUrl || 'https://almost.sh',
    actor:
      process.env.ALMOST_ACTOR || cfg.actor || os.userInfo().username || 'someone',
    slackWebhook: process.env.ALMOST_SLACK_WEBHOOK || cfg.slackWebhook || null,
    silent: process.env.ALMOST_SILENT === '1' || cfg.silent === true,
    // Metadata only unless explicitly widened.
    privacy: process.env.ALMOST_PRIVACY || cfg.privacy || 'metadata',
    sendRepo: cfg.sendRepo !== false,
  };
}

module.exports = {
  read,
  write,
  settings,
  ensureIgnored,
  PROJECT_FILE,
  GLOBAL_FILE,
};
