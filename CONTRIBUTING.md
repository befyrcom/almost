# Contributing

The most useful thing you can add here is support for another agent. Everything
else in this CLI is deliberately small.

## Local setup

```sh
git clone https://github.com/befyrcom/almost.git
cd almost
npm install
npm link          # puts your working copy behind the global `almost`
almost status
```

Check your change without sending anything anywhere:

```sh
echo '{"message":"can I force push?"}' | almost preview notification
```

## Adding an agent

There are two levels, and the first one is a five line change.

**1. Detect it and print the line it needs.** If the agent keeps its hooks in a
format we should not rewrite for people (a TOML file they hand-maintain, a rules
file, an editor setting), add an entry to `DETECT` in `lib/install.js`:

```js
{
  id: 'youragent',
  label: 'Your Agent',
  probes: ['.youragent', path.join(os.homedir(), '.youragent')],
  hint: 'run  npx almost-sh stop  from your task-complete hook',
}
```

`probes` are paths that only exist if the agent is actually set up. `hint` is one
line a person can paste. Nothing is written to disk.

**2. Install it properly.** If the agent keeps hooks in a JSON file we can merge
into safely, write an installer next to `installClaude()` and call it from
`runInit()` in `bin/almost.js`. Match what `installClaude()` guarantees:

- Back the file up before the first write (`.almost-backup`).
- Preserve every key already in the file. Never rewrite a config you did not
  write.
- Be idempotent. Running twice must not add a second hook. Detect an existing
  entry by looking for `almost-sh` in the command.
- Fail soft. Return `{ ok: false, error }`, never throw into someone's terminal.

Your agent should also be detectable at event time, so messages say which agent
fired. That is `detectAgent()` in `bin/almost.js`, keyed off an environment
variable the agent sets in its own hook process.

## Two rules that are not negotiable

**A hook must never fail the terminal it runs in.** Every network call is
wrapped, timed out, and swallowed. Every filesystem read that might not exist is
guarded. If your code can throw on a user's machine mid-run, it is not finished.

**Nothing new leaves the machine without going through the privacy filter.** The
object sent over the network is built in exactly one place, `buildEvent()` in
`lib/privacy.js`, and `almost preview` renders that same object. If you add a
field, add it there, and confirm `almost preview` shows it. A field that reaches
the network without appearing in `preview` is a bug of the worst kind here,
because the whole privacy claim rests on `preview` being complete.

If you add a key that could ever carry file contents, a path, or a prompt, it
belongs in `NEVER_FORWARD` instead.

## Style

Plain CommonJS, no build step, no transpiler, no framework. `node-notifier` is
the only runtime dependency and it should stay that way. Comments explain why a
constraint exists, not what a line does.

## Scope

This repo is the local CLI. The hosted team service (the relay, the board,
chat routing, approvals, audit) is a separate closed source product and is out
of scope here. A pull request that adds an account system, a database, or a
server to this CLI will be declined, however good it is. Direct webhook
delivery, local behaviour and new agents are all fair game.

## Licensing of contributions

By opening a pull request you agree that your contribution is licensed under the
MIT license that covers this repository, and that you have the right to license
it.
