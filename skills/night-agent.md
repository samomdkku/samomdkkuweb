# The night agent — unattended Claude Code on the VM

Runs `claude -p` through a queue of tasks while the subscription's 5-hour window
is open, on the KKU VM, with nobody's laptop on. Built 2026-09-15.

## Why it exists

The 5-hour window resets at a fixed time and unused quota is lost. The owner
sleeps before the reset. `/loop`, `CronCreate` and Desktop tasks all need the
machine on; Cloud Routines run against a fresh clone with no `.env.local`, no
VPN and no VM. The VM already held a `claude login` credential (kept fresh every
15 min by `samo-claude-usage.timer`) and `claude` is installed there, so it is
the only option with real reach.

## Where everything is

| | |
|---|---|
| `~/samo-agent/` | the repo clone, and NOTHING else |
| `~/samo-night/run-night.sh` | the runner |
| `~/samo-night/NIGHT-TASKS.md` | the queue — **edit this** |
| `~/samo-night/logs/` | one log per run, one `.out` per task |
| `~/samo-night/memory/` | the 51 memory files, read by every task |
| `/etc/samo-agent.env` | root:ubuntu 0640 — the webhook, and nothing else |
| `samo-night-agent.{service,timer}` | fires 15:41 UTC = 22:41 ICT |

**The machinery is deliberately OUTSIDE the clone.** v1 kept it inside and
`git add -A` swept the runner, the task file and the growing log into every
commit.

## Writing tasks

One `## ` heading per task; everything under it is one `claude -p` prompt.
**Everything above the first `## ` is a shared preamble prepended to every
task** — put standing constraints there.

Each task is a COLD run with no memory of the previous one, so each must name
its own files and say what done looks like. Bounded and checkable beats
ambitious: an unattended agent given a vague goal produces something plausible
and wrong, and you find out in the morning.

## What it can and cannot do

Broad by design — read/write/edit its clone, bash, npm, git, vitest, builds,
WebSearch/WebFetch, subagents. Denied, and each verified by making it try:

| blocked | by what |
|---|---|
| `sudo`, `deploy.sh`, `git push`, `systemctl`, `curl`/`wget`, `apply-migration`, `db-query`, `deploy-gas`, `npm run release`, the one-shot house repairs | deny rules in `~/samo-agent/.claude/settings.local.json` |
| reading `~/samo-projects/**` (the deploy tree, whose `.env.local` holds `SUPABASE_SERVICE_ROLE_KEY`) | **systemd `InaccessiblePaths=`** |
| publishing anything | the VM holds no GitHub credentials |
| OOM-ing the live site | `MemoryMax=1200M` (the box has 2 GB) |

⛔ **`Read(path)` deny rules only cover the Read TOOL.** A `cat` through Bash
walks straight past them — the agent found this itself and reported it. Anything
that must truly be unreachable needs `InaccessiblePaths`, not a deny rule.

⛔ **`Write(path)` deny rules are silently ignored.** Only `Edit(path)` applies
to file writes, and Edit covers every editing tool.

⛔ **Use `--permission-mode bypassPermissions`, not `dontAsk`.** `dontAsk` is
deny-by-default: the agent cannot write anything and spends every task saying so.
`bypassPermissions` grants broadly **and still honours deny rules** — measured.

## Operating it

```bash
ssh samo-vm 'cat ~/samo-night/NIGHT-TASKS.md'          # the queue
ssh samo-vm 'systemctl show samo-night-agent.timer -p NextElapseUSecRealtime --value'
ssh samo-vm 'cd ~/samo-agent && git log --oneline main..HEAD'   # what it did
ssh samo-vm 'ls -t ~/samo-night/logs/ | head'
# run now, against a scratch queue, without disturbing tonight's:
ssh samo-vm 'cd ~/samo-night && NIGHT_TASKS=$HOME/samo-night/my-test.md ./run-night.sh'
```

⛔ **`enable` is not `schedule`.** Read `NextElapseUSecRealtime`, never
`is-enabled` — a timer can report enabled with no next elapse.

## Reporting

Two SILENT Discord posts per run (`flags: 4096`): one at START, one at the end.
The start ping matters — without it, a run that died early is indistinguishable
in the morning from a timer that never fired, and those have different fixes.

⛔ The **User-Agent is load-bearing**: Discord's edge answers 403 to urllib's
default, which reads exactly like a dead webhook. The URL was valid all along.

Its channel is `DISCORD_NIGHT_AGENT_WEBHOOK`, deliberately NOT
`DISCORD_CLAUDE_WEBHOOK` — that one belongs to the booking board
(`notifyClaudeBooking`, quota alerts, the monitoring switch) and the team reads
it to see who booked which window.

## Bounds

No `oauth/usage` polling — it rate-limits and `samo-claude-usage.timer` already
samples it every 15 min for the booking board. The run is bounded by the clock
(hard stop 20:30 UTC / 03:30 ICT) and by the one honest signal: if `claude`
reports a usage limit, the runner STOPS rather than retries.

`Persistent=false` on purpose: a missed run must not fire late and spend a window
somebody is awake to use.

## ⛔ IT SHARES ONE QUOTA POOL WITH EVERY HUMAN ON THE ACCOUNT

**This is the failure mode that wasted the first real night (2026-09-15).** The
run fired at 22:41 ICT into a freshly reset window and got almost nothing done —
two tasks returned "no changes", three exited 1 — because the owner's own
session and the maintainer's were spending the SAME 5-hour pool at the same time.
The agent is not allocated a window; it draws from the one pool, and a human at
a laptop will always win the race.

So the window only belongs to the agent once **everyone has actually stopped**.
"I'm going to sleep at 9pm" is not the same as the session ending at 9pm — on the
night this was learned, the laptop was still working at 23:32.

Two ways to know before trusting a night:
- the booking board at `/admin#claude` — which is exactly what it was built for;
- the next morning's log: `grep -c "session limit" ~/samo-night/logs/<run>.log`.

⛔ **And the runner must DETECT it.** The first version's pattern matched
"usage limit" but Claude's real words are **"You've hit your session limit"**, so
nothing matched, nothing stopped, and it churned six revision passes and the
handoff against an empty quota — each returning the same refusal in under a
second. The pattern now matches `session limit` too, and the check lives inside
`run_one()` as well as the main loop, because the revise and handoff passes go
through `run_one()` and had no check at all.

## Cost

One full window ≈ 14% of the weekly pool (`session_pool_pct` 100,
`week_pool_pct` 700). A night cannot exhaust the week.

## Reviewing the morning after

The branch is `agent/<date>` on the VM and **cannot be pushed**. Review it there,
or pull it to a laptop. Nothing it produced has been verified against the live
database — by construction, it has none.
