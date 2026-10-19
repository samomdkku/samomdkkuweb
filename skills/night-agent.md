# The night agent — unattended Claude Code on the VM

Runs `claude -p` through a queue of tasks while the subscription's 5-hour window
is open, on the KKU VM, with nobody's laptop on. Built 2026-09-15.

## ⛔ SINCE 2026-10-18 IT USES THE BOOKING BOARD LIKE A PERSON WITHOUT A BOOKING

The evening the agent was re-armed for tasks 8–12, somebody had booked **100%,
21:30–00:00 ICT**, and the timer was due at 23:07. The runner read only the
quota numbers and would have started inside that booking. The owner asked for
a design that is "fair, … make use of the token the most, according to common
sense", and gave the cases:

| case (owner's words) | what the agent does |
|---|---|
| nobody booked | runs as before: the quota rules alone, no line inside the window |
| a booking 13:00–15:00 @70%; agent starts **08:00** | its window ends at 13:00, before the booking, so **all of it** is the agent's |
| same booking; agent starts **08:30** | its window reaches 13:30 and the booking lands inside it, so **30%** is the agent's: "the next 5hr reset will be ok for the booking person". The task is stopped when measured use reaches it, the work is kept and resumed later |
| a booking is ON | no new run and no new task. "let them use it, until the finished time" |
| someone books while a task runs ("they book too soon") | the task is NOT stopped: its allowance was fixed when it started. The booking counts from the next task on |
| the agent's next window holds a booking | that window is left to its booker. At the 5-hour reset the agent re-decides as if starting, and stops if the new window is booked |
| a booking has ENDED and did not use its 100% | the unused part is the agent's. The board drops an ended booking from the measured window, so it offers `100 − measured use` |
| the window is used up | wait for the reset |
| little left (< `MIN_START_PCT` 10%) | not worth a task's start-up cost: wait |
| the week | the board already holds back every future booking's share; the owner's `Reserve sessions:` comes off on top |

**One rule, not two.** Every row above is ALREADY the board's rule for people:
`claude_free_now()`, shown on the web as "ใช้ได้เลยตอนนี้ โดยไม่ต้องจอง". A
window is shared by whoever it covers (0159), the measured window counts
bookings "only from now forward" (0159 §1), and the week holds back what is
still booked (0158). So the agent does not re-derive any of it. It reads the
board's **rail** (`free_windows`: the answer for starting at each instant of
the week, which changes at every booking's start − 5 h), takes the band holding
the current minute, and obeys it. A second copy of that arithmetic would drift
from the copy that refuses people's bookings.

**Where it comes from.** After each sample, `samo-claude-usage` calls
`get_claude_board()` (it raises without the `claude` permission, so no
permission → no file → the agent waits) and writes `~/samo-night/bookings.json`:
the rail, this week's bookings, and `right_now`. It holds times and % only, no
names or purposes.

**The mechanics** (`queue.mjs`: `boardGate`, `allowanceAtStart`, `watchGate`;
tests in `src/js/night-queue.test.js`, one per row above):
- **start** (a run, or the next task): no booking ON, and the rail band for
  now offers ≥ 10% after the owner's reserve.
- **allowance**, taken just before each task and fixed for it: `stop =
  measured use + what the band offers − 5` (the margin covers the ≤15-min-old
  sample). It is `null` when only the window's own size binds; then the CLI's
  limit ends the task, as before.
- **watcher**: once a minute, from local files only (no network, no tokens).
  At `stop`, or at a reset whose new window has a booking ON or is fully
  booked, it stops the task. At any other reset it TAKES A NEW FIXED
  ALLOWANCE (`watch` exit 6), exactly as a task start does. Without that, the
  old window's line would never apply again, and a booking known to sit later
  in the new window would be eaten. The runner keeps the WIP, marks the task
  `interrupted` with the reason ("เพื่อให้คนที่จอง Claude ไว้ใช้"), and the next
  run resumes it. The model handoff is skipped then, because it would spend the
  booker's share; the runner's own Discord report still goes out. The same
  applies when the check BEFORE a task refuses for a booking (`usage` exit 5,
  vs 3 for the account's own spent quota). Such a run is **not counted against
  `Budget:`**, so a busy board cannot end the queue with quota unused;
  `Until:` still ends it for good.
- **a missing or stale board** at START exits 4 (wait, one Discord alert,
  `~/samo-night/.board-error`). Mid-task it never kills work.

**Latency, stated plainly.** The reporter samples every 15 min (:10/:25/:40/:55
on 2026-10-18; it drifts with manual starts) and the agent ticks at :07/:27/:47.
So a booking's END is acted on 2–30 min late, and a booking made less than
~15 min before a start can be missed. Both err toward waiting, never toward
taking someone's share.

Tonight, worked through: 23:07 → wait (booking ON). the first tick that
reads a board copy taken after 00:00 (~00:27, from the ~00:10 sample) → the
board offers 100 − what the booker used, so the agent runs on that until the
02:40 reset, then on a fresh window.

### Also fixed in the 2026-10-18 review of the runner

- **A task's REPORT was read as an error.** Every output was grepped for
  `quota|rate limit|429|…` and `401`. Tasks 9–10 are about the Claude quota
  tables, so a finished task's summary would have been filed as "cut off by
  the quota", and one mentioning "HTTP 401" re-ran a finished task.
  `classifyOutput` now recognises only the CLI's own short error lines,
  anchored to how they begin (`You've hit your session limit · resets …`,
  `Failed to authenticate. API Error: 401 …`).
- **systemd killed late runs.** `TimeoutStartSec=5h`, but a task could start
  at minute 245 with a 90-min timeout, and the handoff after it had another
  90. The run died mid-task: nothing committed, the task un-marked, `spend`
  never reached. Every call's timeout is now cut to the time left (tasks to
  the 245-min reserve, the handoff to `HARD_END` = 290 min), no task starts in
  the reserve's last 20 min, and a task cut by the run's own clock is
  `interrupted` and resumed, like a quota cut.
- **No commit identity = silent loss.** A checkout without `user.email` makes
  every `git commit --quiet` fail while the queue records "WIP <sha>". The
  runner now refuses to start (seen in the rehearsal, whose clone had none;
  the real `~/samo-agent` has a local identity).

### Rehearsing it (no real queue, checkout or Discord touched)

`NIGHT_HOME` (scratch home: its own lock, queue, STOPPED, usage/bookings
copies), `NIGHT_REPO` (a scratch clone, with a git identity) and `NIGHT_QUIET=1`
(no Discord). Put a stub `claude` first on `PATH`. The 2026-10-18 rehearsal ran
three scratch runs this way, covering a normal task, a quota cut and its
resume, a booking starting mid-task, a report full of "quota/429/401", and an
unreadable board.

## ⛔ SINCE 2026-10-13 IT RUNS BY THE WINDOW, NOT BY THE NIGHT — read this first

The owner asked for "as many 5-hour sessions as the work needs, but leave one
for me", and for a finished agent to stop waking up. What changed, and where
each older paragraph below is now WRONG:

| | before | now |
|---|---|---|
| timer | once, 15:41 UTC | **a tick every 20 min** (`*:07/20`) — the runner decides |
| a tick with nothing to do | posted "ไม่ได้เริ่มงาน" | **silent exit, no model call** |
| queue over (all terminal / Budget spent / past `Until:`) | gate refused every night | writes **`~/samo-night/STOPPED`**; the unit's `ConditionPathExists=!` means systemd never starts the script again. One Discord post. `install.sh --arm` clears it |
| quota | clock only (22:41 → 03:30) | **`~/samo-night/usage.json`**, left by `samo-claude-usage` every 15 min: no run while the 5-hour window is ≥90%, and none once the week is within `Reserve sessions:` (+6% margin) of full — checked at start AND between tasks. No file / older than 45 min → wait |
| run length | wall-clock 03:30 | ≤245 min from its own start, then the handoff |
| branch | `checkout -B agent/<date> origin/main` every run — a second run the same day DELETED the first's commits | `Branch:` in the queue header; a later run CONTINUES it and sweeps up uncommitted leftovers |
| task cut off by the quota | counted as an attempt | WIP committed, **`Status: interrupted`** (note names the WIP sha), no attempt counted — the next run RESUMES it: the agent audits the WIP against the brief and finishes it. Its check is NOT asked first — half-done work can pass it (2026-10-13, `docs/mistakes/tooling-proofs.md`) |
| revise passes | up to 6 when the queue finished early | **off** (`NIGHT_REVISE=1` to enable) — a finished queue stops |
| queue fingerprint guard | refused an unchanged queue | **removed**: it stamped AFTER the run rewrote the file, so a multi-night budget could never use night 2. `gate` + the per-task pre-check do its job |
| per task | 60 min, 120 turns | `TASK_TIMEOUT_SEC` 5400, `TASK_MAX_TURNS` 200 |
| handoff | wrote into `docs/state/phuriphatma.md` (the owner's own file) with a hardcoded date | `docs/state/night-agent.md` |

New queue header fields (`server/night-agent/queue.mjs`, tests in
`src/js/night-queue.test.js`):

```markdown
Budget: 6 runs              ← runs, not nights now; decremented per run
Until: 2026-10-14T08:00:00Z ← hard end: past it the queue STOPS for good
Reserve sessions: 1         ← 5-hour sessions of the WEEK kept for humans (absent → 1).
                              0 = run to 100%: no reserve, no 6% margin, no stop line
                              unless a booking is ahead (the CLI's limit ends the task)
Revise passes: 6            ← optional. After the tasks finish, keep doing REVISE.md
                              passes (bug scan of the branch), N per run, run after run
                              until Budget / Until / quota. Absent → a finished queue STOPS
Branch: agent/2026-10-13    ← one branch for every run of this queue
```

A mid-task stop says WHOSE share it protects: `watch` exits **3** for a
booking still ahead (a yield — no handoff, the run is not counted) and **7**
for the owner's reserve (cut like a quota stop — handoff runs, run counted).
Until 2026-10-19 every stop was called a booking yield.

Gate exit codes (the contract with `run-night.sh`): `0` run · `10` over →
STOPPED · `3` not now (quota or the booking board), silent · `4` not now, the board copy is unreadable (said once on Discord).

⚠️ If Claude monitoring is switched off on `/admin#claude`, the reporter writes
no `usage.json` and the agent WAITS. That is deliberate — the reserve cannot be
honoured blind.

**Security findings never go in the repo** (it and `docs/` are public): tasks
write them to `~/samo-night/reports/`. Pull them with
`scp samo-vm:samo-night/reports/* <somewhere private>`.

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

**Stopping it mid-run** (to take the window NOW): kill `run-night.sh` FIRST,
then its `timeout … claude -p` child. Killing only the child lets the runner
start the NEXT task within seconds. Then `touch ~/samo-night/STOPPED`; `bash
server/night-agent/install.sh --arm` clears it. Its checkout commits as it
goes, so check `git status` in `~/samo-agent` afterwards.

```bash
ssh samo-vm 'pkill -f run-night.sh; pkill -f "claude -p"; touch ~/samo-night/STOPPED'
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

---

## Writing a queue (2026-09-19 — the format the runner reads and WRITES)

`~/samo-night/NIGHT-TASKS.md` is **state**, not a prompt. The runner writes
`Status:` / `Attempts:` back into it, and reads them on the next night. That is
what stops the thing the first three nights did: run the same six tasks over and
over against a `main` that already held the previous night's work.

```markdown
# NIGHT-TASKS
Budget: 3 nights          ← YOU write this. The runner decrements it.

## 1. Build the CSV generator
Done when: node tools/house-year-sheets.mjs --help

## 2. Fix the ระบบบ้าน audit
Done when: npm test && node tools/house-gaps.mjs | grep -q 'สายที่มีปัญหา: 5'

## 3. Plan the multi-project engine — no code
Done when: once
```

### The one rule worth understanding

**`Done when:` is a shell command the RUNNER executes. Its exit code is the
status.** The agent never writes its own verdict — it may write `Note:`, which
nothing reads but a person.

The obvious alternative, letting the agent write `Status: done`, is the same bug
wearing a schema: the agent is still the one asserting it. This repo has paid
for that shape twice — `DEPLOY_EXIT=0` was reachable with the docs step skipped,
and `confirm-modal.test.js` was satisfied by a COMMENT.

### What the runner does with it

| when | what |
|---|---|
| before the night | `queue.mjs gate` — no work, or no budget → post why, **exit without calling claude at all** |
| before each task | `queue.mjs plan`: **terminal → skip untouched** (its verdict is the record; never re-checked, never overwritten) · **interrupted → resume** · otherwise run `Done when:` first: **already passing → `needs-review`**, not done — nobody did the work, so a person decides |
| after each task | run it again → `queue.mjs judge` (the ONE implementation; the bash copy is gone). pass → `done` · fail → `todo` (retry tomorrow) · fail twice → `blocked` |
| `Done when: once` | one attempt → `needs-review`. Never retried |
| end of night | `queue.mjs spend` — one night off `Budget` · `queue.mjs report` — one line per task in the RUNNER's words into the log, the Discord post and the handoff (`AGENT_QUEUE_REPORT`). `!` = did not finish normally in one run; the handoff may call the night clean only if every line is `✓` |

### Two stops, deliberately independent

1. every task reaching `done` / `blocked` / `needs-review`
2. `Budget: N nights`

A mistyped check breaks (1) and only (2) guarantees the loop ends. A queue with
**no `Budget:` line gets ONE night** — an omitted field fails toward stopping.

### Why the timer can stay armed

`gate` runs before any `claude -p`, so a finished queue costs nothing: the run
posts one line to Discord and exits. There is no timer to disable and no state
on the VM to clean up — **the queue file is the switch.**

Unit tests: `src/js/night-queue.test.js` (15, including a five-night loop that
must terminate). Rehearsed end to end with a fake `claude` before shipping.

⚠️ **`bash server/night-agent/install.sh` is what puts `queue.mjs` and the new
`run-night.sh` on the VM.** Until that runs, `~/samo-night/` still has the
versions that repeat.

### The memory is synced by the installer, and by nothing else

`~/samo-night/memory` is read by every task and is **not in the repo** — some
entries name real students and this repo is public. So nothing syncs it on its
own: on 2026-09-19 the VM was eight days and four files behind, and the missing
four were the ones saying earlier numbers had changed.

`install.sh` now rsyncs it every time, `--delete` included, and refuses to run
if the directory is missing. `run-night.sh` puts the file count and age in the
Discord start post, with a warning past three days — a stale memory reads
perfectly, so its date is the only tell.

**Run the installer after any session that wrote a memory**, which is most of
them. It does not arm anything: `--arm` is a separate word.
