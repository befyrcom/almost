# almost.sh

The signal layer for coding agents.

Your agent runs long tasks in a terminal you already switched away from.
`almost` hooks into its lifecycle and tells you the moment a run finishes or
needs a person: a native desktop banner and sound locally, and optionally a
message to your team.

MIT licensed. The CLI is the whole product for one developer, and it works with
no account, no key and no network.

## Install

```sh
npm install -g almost-sh
cd your-project
almost init
```

`almost init` writes the hooks into the project's own `.claude/settings.json`.
It backs that file up first, keeps everything already in it, and is safe to run
twice. The file holds no secret, so you can commit it and your team picks the
hooks up on clone.

## Commands

| Command | What it does |
| --- | --- |
| `almost init` | Install hooks into this project |
| `almost connect <key>` | Point this project at a team, then install |
| `almost status` | Show what is configured |
| `almost preview [event]` | Print exactly what would be sent, send nothing |
| `almost start` | Report that a run has begun |
| `almost stop` | Report that a run finished |
| `almost notification` | Report that a run needs a person |
| `almost idle` | Report that a run has gone quiet |
| `almost done` | Report that the work passed its real gate |

Event data may be piped in as JSON on stdin:

```sh
echo '{"message":"needs permission to push"}' | almost notification
```

## What it hooks

| Claude Code event | Fires when | The card |
| --- | --- | --- |
| `SessionStart` | A session begins | opens in **Running** |
| `Notification` | The agent is waiting on input or permission | moves to **Blocked** |
| `Stop` | The agent finishes its turn | moves to **Almost** |

Those three are the whole list, and they are why a board fills itself.

`SessionStart` matches `startup` and `clear`, not `compact`. Compaction
continues the same session, and a card is keyed to its session — firing `start`
there would pull a card that had already reached Almost back into Running while
nothing had actually resumed.

Nothing hooks **Done**, on purpose. An agent stopping is not the work being
finished, so the last column belongs to whatever actually checks it: call
`almost done` from CI, a merge hook or a review bot.

`almost idle` is a command rather than a hook for a duller reason: there is no
watchdog in the CLI, so nothing detects a run that has gone quiet on its own.
Run it from your own timer if you want that signal, and until you do, no idle
event is ever sent.

The desktop banner fires before anything touches the network, and network
delivery is capped at 4 seconds. An unreachable or slow endpoint can never fail
the hook or hold up a turn.

`almost init` also detects Codex, Gemini CLI and Cursor if they are set up on
the machine, and prints the one line each needs. Those are not written for you,
because none of them keeps its hooks in a file we can safely edit.

## Privacy

`almost` is a signal, not a logger. It needs to know THAT something happened,
almost never WHAT it was.

- The transcript is never opened. Claude Code hands hooks a `transcript_path`
  pointing at the full conversation on disk. `almost` drops that key on arrival
  and has no code path that reads a file.
- The default mode sends metadata only. The reason for a notification is turned
  into a category locally (`permission required`, `waiting for input`), so the
  agent's own words stay on your machine.
- A card is named after the current **branch**, because otherwise every card on
  the board reads `claude run` — no agent's hook payload carries a task name, so
  there is nothing else to call it. A branch is already written down in the
  checkout and is nowhere near the transcript, but it is not nothing: a branch
  called `fix-acme-billing` names a customer. It answers to the same switch the
  repository name does, so `sendRepo: false` withholds both.
- Nothing is sent anywhere unless you connect a team or configure a webhook.

Verify it rather than taking our word for it. `almost preview` renders the exact
request body and sends nothing:

```sh
echo '{"message":"can I force push?","transcript_path":"/tmp/x.jsonl"}' \
  | almost preview notification
```

Set `ALMOST_PRIVACY=full` to include the agent's own message, and to let a task
name piped in on stdin take the place of the branch.

## Configuration

Project config lives in `.almost/config.json`, machine-wide config in
`~/.almost/config.json`, and the project file wins. `almost connect` writes the
project file with `0600` permissions and adds `.almost/` to your `.gitignore`,
because the ingest key is a credential.

Every value can also come from the environment:

| Variable | Effect |
| --- | --- |
| `ALMOST_SLACK_WEBHOOK` | POST each event as `{"text": "..."}` to any receiver |
| `ALMOST_INGEST_KEY` | Report to a team board |
| `ALMOST_API_URL` | Where the team board lives (default `https://almost.sh`) |
| `ALMOST_ACTOR` | Name shown in team messages (default your username) |
| `ALMOST_PRIVACY` | `metadata` (default) or `full` |
| `ALMOST_SILENT=1` | No desktop banner, network only |

## Teams

Two ways to get an agent event off your machine, and the first one needs nothing
from us:

1. **Your own webhook.** Set `ALMOST_SLACK_WEBHOOK` to any endpoint that accepts
   `{"text": "..."}`. Slack, Discord via `/slack`, or something you wrote.
2. **The hosted board at [almost.sh](https://almost.sh).** Run
   `almost connect <key>` and runs from the whole team land on one board, with
   history, and every channel the team has added gets the event. That service
   is paid and closed source. See the split below.

## Open core

| In this repo, MIT | Hosted at almost.sh, proprietary |
| --- | --- |
| The `almost` CLI | The event relay and its API |
| Hook installers for every agent | The team board and run history |
| Desktop banners and sound | Slack, Discord and Telegram for the whole team |
| The privacy filter and `almost preview` | Invites, roles and per-project channel routing |
| Direct webhook delivery | Approvals from chat, audit log and SSO *(in build)* |

Rows marked *in build* are not built yet, and the pricing page says the same.

A project reaches every channel the team has until you tell it otherwise, so
nothing needs configuring to start. Its Settings tab is where that changes:
every channel, only the ones you pick, or nowhere at all and the board is the
only record.

The CLI never needs the hosted service. The hosted service is worth paying for
once more than one person needs to see the same run.

## Contributing

New agents ship constantly and each one wants its hooks somewhere different.
Adding support for one is the most useful contribution here, and
[CONTRIBUTING.md](CONTRIBUTING.md) walks through exactly where that code goes.

## Platforms

macOS, Windows and Linux, via `node-notifier`. Node 18 or newer.

## Uninstall

```sh
cp .claude/settings.json.almost-backup .claude/settings.json
rm -rf .almost
npm uninstall -g almost-sh
```

## License

MIT. See [LICENSE](LICENSE).
