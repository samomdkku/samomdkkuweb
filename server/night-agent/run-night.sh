#!/usr/bin/env bash
# ============================================================
# run-night.sh — work the NIGHT-TASKS queue while the 5-hour window is open.
#
# Fires from samo-night-agent.timer every 20 minutes (since 2026-10-13). Almost
# every tick is a GATE that ends in milliseconds without calling claude: the
# queue is finished (→ STOPPED, and systemd never starts this again), or the
# usage reporter's numbers say the 5-hour window is spent or the week is down
# to the owner's reserve (→ wait, silently). Only a tick with work, budget AND
# quota starts a run, and a run lasts at most one window.
#
# ⛔ IT DOES NOT POLL oauth/usage. That endpoint rate-limits, and the booking
# board already samples it every 15 minutes from samo-claude-usage.timer — a
# second poller would compete with the numbers everyone trusts. The run is
# bounded by the CLOCK, and by the only other honest signal: when the quota is
# gone `claude` says so, and that is treated as "stop", never as "retry".
#
# ⛔ THE MACHINERY LIVES OUTSIDE THE REPO. The first version kept the runner, the
# task file and the logs inside the clone, so `git add -A` swept all three into
# every commit — the log file included, mid-write, so it grew again in the next
# one. Found by the test run. $REPO holds nothing but the checkout.
#
# ⛔ IT IS NOT THE DEPLOY TREE. ~/samo-projects/samomdkkuweb is what deploy.sh
# git-pulls into; a dirty tree there breaks the next deploy or ships half-done
# work. Reading and writing it is denied outright in settings.local.json.
#
# ⛔ NOTHING REACHES PRODUCTION. The VM holds no GitHub credentials, so a push is
# impossible even if something tried; deploy.sh, sudo, systemctl and the GAS
# deploys are denied. Since 2026-10-13 the agent MAY run apply-migration,
# db-query and the proofs — against samo-dev ONLY: ~/samo-agent/.env.local holds
# samo-dev's URL, anon key and access token and nothing else, and that token
# answers 403 on the production project (measured). Work lands as commits on a
# branch for a human to read in the morning.
# ============================================================
set -uo pipefail

# NIGHT_REPO / NIGHT_HOME / NIGHT_QUIET exist for a REHEARSAL only: a scratch
# clone, a scratch home (its own lock, queue, STOPPED, usage/bookings copies)
# and no Discord — so a test run can never touch the real queue or checkout.
REPO="${NIGHT_REPO:-$HOME/samo-agent}"           # the checkout, and nothing else
NIGHT_HOME="${NIGHT_HOME:-$HOME/samo-night}"     # runner, task queue, logs
LOG_DIR="$NIGHT_HOME/logs"
MEM_DIR="$NIGHT_HOME/memory"   # the 51 memory files — read by every task, never committed
TASKS="${NIGHT_TASKS:-$NIGHT_HOME/NIGHT-TASKS.md}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/$STAMP.log"
USAGE="$NIGHT_HOME/usage.json"    # written by samo-claude-usage every 15 min
BOOKINGS="$NIGHT_HOME/bookings.json"  # same writer: the Claude booking board (times + %, no names)
STOPPED="$NIGHT_HOME/STOPPED"     # the service's ConditionPathExists=! — see below

# A run lasts at most ONE 5-hour window, measured from its own start: since
# 2026-10-13 runs start whenever a window has room, not at a fixed 22:41, so a
# wall-clock deadline would be wrong for every run but one.
# ⛔ THE HANDOFF IS RESERVED TIME, NOT THE LAST ITEM IN THE QUEUE.
# As the last task it would be the first thing lost when the queue overran — and
# a run whose work is undocumented is a run the owner cannot use. The main
# queue stops at RESERVE; everything after is handoff.
RUN_START="$(date -u +%s)"
RESERVE_EPOCH=$(( RUN_START + ${RUN_RESERVE_MIN:-245} * 60 ))
# ⛔ AND A HARD END INSIDE systemd's. The unit has TimeoutStartSec=5h, and the
# runner used to start a task up to minute 245 with a 90-minute timeout — and
# the handoff after it with another 90 — so a late task ran to ~minute 335 and
# systemd KILLED the whole run: nothing committed, the task left un-marked, and
# `spend` never reached, so the Budget (the stop that guarantees termination)
# was never decremented. Every call's timeout is now cut to the time left: a
# task to RESERVE_EPOCH, the handoff to HARD_END, 10 min inside systemd's.
HARD_END=$(( RUN_START + ${RUN_HARD_END_MIN:-290} * 60 ))

# (Bounds are epoch seconds, never "HH:MM" strings: a lexicographic compare
# broke the first version across midnight — docs/mistakes/tooling-proofs.md.)

# ⛔ ONLY the Claude webhook, from a file holding ONLY that value — never
# /etc/samo-notify.env, which also carries SUPABASE_SERVICE_ROLE_KEY. That key
# bypasses every RLS policy over real student records, and putting it in this
# process's environment would leave it one `env` away from the model.
# ⛔ PREFER ITS OWN CHANNEL. DISCORD_CLAUDE_WEBHOOK is the BOOKING board's
# channel — notifyClaudeBooking, the quota alerts and the monitoring switch all
# post there, and the team reads it to see who booked which window. Overnight
# build summaries are a different audience and would bury the signal. Set
# DISCORD_NIGHT_AGENT_WEBHOOK to a channel of its own; the booking webhook is
# only a fallback so the first night still reports somewhere.
WEBHOOK=""
if [ -r /etc/samo-agent.env ]; then
  # shellcheck disable=SC1091
  . /etc/samo-agent.env
  WEBHOOK="${DISCORD_NIGHT_AGENT_WEBHOOK:-${DISCORD_CLAUDE_WEBHOOK:-}}"
  # Plain shell vars from here on: never exported, so `claude` cannot read them.
  unset DISCORD_NIGHT_AGENT_WEBHOOK DISCORD_CLAUDE_WEBHOOK
fi
[ -n "${NIGHT_QUIET:-}" ] && WEBHOOK=""



# ── run_claude <promptfile-or-text> <outfile> — one call, with ONE retry on an
# expired OAuth token.
#
# ⛔ THIS IS WHAT KILLED THE FIRST REAL NIGHT (2026-09-15). Tasks 1 and 2 ran
# fine; task 3 died on
#     Failed to authenticate. API Error: 401 OAuth access token has expired.
# and so did 4 and 5. It was not quota — the log contains no "session limit" and
# the 5-hour window was barely touched.
#
# The access token lives ~2 hours. `samo-claude-usage.timer` owns the refresh but
# only renews when under 10 minutes of life remain, running every 15 minutes — so
# there is a window in which the token is dead and nothing has yet renewed it. A
# long unattended run walks into that window roughly every two hours.
#
# The retry costs one refused call and clears it, because starting a fresh
# `claude` re-reads the credential file that the timer has since rotated.
run_claude() {
  local prompt="$1" out="$2" deadline="${3:-$RESERVE_EPOCH}" allow="${4:--}" rc
  claude_capped "$prompt" "$out" "$deadline" "$allow"; rc=$?
  # A task the watcher stopped is not an auth failure: never re-run it.
  [ -e "$out.yield" ] && return $rc
  # Only the CLI's own short error line counts (classifyOutput) — a task whose
  # REPORT mentions "401" is finished, and re-running it would redo the work.
  if [ "$(node "$QUEUE" classify "$out")" = "auth" ]; then
    echo "!! OAuth token expired — waiting 90s for the refresh timer, then retrying ONCE"
    sleep 90
    claude_capped "$prompt" "$out" "$deadline" "$allow"; rc=$?
    [ "$(node "$QUEUE" classify "$out")" = "auth" ] \
      && echo "!! still expired after retry — the credential needs \`claude login\` on the VM"
  fi
  return $rc
}

# claude_capped <prompt> <out> <deadline-epoch> <allowance-json|-> — one call,
# its timeout cut to the time left before <deadline>. Under a minute left → not
# called at all (rc 124, as if timed out), so a late retry cannot start past the
# hard end.
#
# ⛔ AND, WITH AN ALLOWANCE, A WATCHER (2026-10-18). The allowance is what the
# booking board said this task may take WHEN IT STARTED (`queue.mjs
# allowance`) — fixed, so a booking made afterwards does not move it ("they
# book too soon"), while a booking it already knew about keeps its share. Once
# a minute the watcher asks `queue.mjs watch` (local files only: no network, no
# tokens). It answers no when the measured use reaches the allowance, or at a
# 5-hour reset whose new window is booked; then the reason goes to
# "$out.yield" and the task is stopped (`timeout` forwards the TERM). The
# runner keeps the work and RESUMES it, exactly as for a quota cut. With nobody
# booked the allowance has no line and the watcher never fires.
claude_capped() {
  local left=$(( $3 - $(date -u +%s) )) tmo="${TASK_TIMEOUT_SEC:-5400}" allow="$4" pid wpid="" rc
  [ "$left" -lt "$tmo" ] && tmo="$left"
  rm -f "$2.yield"
  if [ "$tmo" -lt 60 ]; then
    echo "(no time left before this run's deadline — not calling claude)" > "$2"
    return 124
  fi
  timeout "$tmo" claude -p "$1" --permission-mode bypassPermissions \
      --max-turns "${TASK_MAX_TURNS:-200}" --add-dir "$MEM_DIR" > "$2" 2>&1 < /dev/null &
  pid=$!
  if [ "$allow" != "-" ]; then
    (
      while kill -0 "$pid" 2>/dev/null; do
        sleep "${BOOKING_POLL_SEC:-60}"
        kill -0 "$pid" 2>/dev/null || break
        if ! why="$(node "$QUEUE" watch "$TASKS" "$USAGE" "$BOOKINGS" "$allow" 2>&1)"; then
          printf '%s\n' "$why" > "$2.yield"
          echo "!! giving the window back: $why"
          kill -TERM "$pid" 2>/dev/null
          break
        fi
      done
    ) &
    wpid=$!
  fi
  wait "$pid"; rc=$?
  if [ -n "$wpid" ]; then kill "$wpid" 2>/dev/null; wait "$wpid" 2>/dev/null; fi
  return $rc
}

# ── post_discord <text> ──────────────────────────────────────────────────────
# Always SILENT (flags 4096 = SUPPRESS_NOTIFICATIONS): it appears in the channel
# but pings nobody and raises no badge. These land between 22:41 and 03:30.
# ⛔ The User-Agent is load-bearing — Discord's edge answers 403 to urllib's
# default, which reads exactly like a dead webhook.
post_discord() {
  [ -n "$WEBHOOK" ] || return 0
  WEBHOOK="$WEBHOOK" BODY="$1" python3 - <<'PYEOF' 2>/dev/null || echo "(discord post failed — the log is on disk)"
import json, os, urllib.request
req = urllib.request.Request(
    os.environ["WEBHOOK"],
    data=json.dumps({"content": os.environ["BODY"][:1900],
                     "flags": 4096,
                     "allowed_mentions": {"parse": []}}).encode(),
    headers={"Content-Type": "application/json",
             "User-Agent": "samo-night-agent (https://samo.md.kku.ac.th, 1.0)"})
urllib.request.urlopen(req, timeout=20)
print("discord: posted")
PYEOF
}

# ⛔ ONE RUN AT A TIME. The timer will not start an ACTIVE oneshot, but a manual
# `./run-night.sh` beside a timer run would share one checkout and one queue.
exec 9>"$NIGHT_HOME/.lock"
flock -n 9 || { echo "another run holds $NIGHT_HOME/.lock — not starting a second"; exit 0; }

# ⛔ ASK THE QUEUE, THEN THE QUOTA — BEFORE any `claude -p`, before a log file
# exists, before Discord hears anything. Most ticks end here.
#   rc 1  the queue is OVER (all done / budget spent / past Until). Write
#         STOPPED: the unit carries ConditionPathExists=!STOPPED, so from now on
#         systemd does not even start this script. Said on Discord ONCE, because
#         there is no next time. `install.sh --arm` with a new queue removes it.
#   rc 3  not now — the 5-hour window is spent, the week is down to the
#         owner's reserve, or somebody's Claude booking is on RIGHT NOW
#         (bookingGate in queue.mjs). SILENT: a post every 20 minutes would
#         bury the channel.
#   rc 4  not now — the booking board copy is missing or stale, so the gate
#         cannot tell whether somebody is booked. Waits like rc 3, but says so
#         on Discord ONCE per fault: unlike a full quota it does not fix itself,
#         and a silent wait here would park the queue for ever.
# ⛔ ABSOLUTE. `dirname "$0"` is "." for `./run-night.sh` — the manual command
# the playbook documents — and the script cd's into the repo below, so a
# relative path then named ~/samo-agent/queue.mjs, which does not exist
# (caught by the 2026-10-13 rehearsal; systemd's absolute ExecStart hid it).
QUEUE="$(cd "$(dirname "$0")" && pwd)/queue.mjs"
[ -r "$QUEUE" ] || QUEUE="$NIGHT_HOME/queue.mjs"
[ -r "$QUEUE" ] && [ -r "$TASKS" ] || { echo "!! missing $QUEUE or $TASKS"; exit 1; }
GATE_WHY="$(node "$QUEUE" gate "$TASKS" "$USAGE" "$BOOKINGS" 2>&1)"; GATE_RC=$?
BOARD_ERR="$NIGHT_HOME/.board-error"
if [ "$GATE_RC" -eq 10 ]; then
  echo "queue over: $GATE_WHY — writing $STOPPED"
  printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$GATE_WHY" > "$STOPPED"
  post_discord "$(printf 'หยุดตัวเองแล้ว %s (ICT) — จะไม่ปลุกอีกจนกว่าจะติดตั้งคิวใหม่\n%s' \
    "$(TZ=Asia/Bangkok date +'%d/%m %H:%M')" "$GATE_WHY")"
  exit 0
elif [ "$GATE_RC" -eq 3 ]; then
  echo "not now: $GATE_WHY"
  rm -f "$BOARD_ERR"
  exit 0
elif [ "$GATE_RC" -eq 4 ]; then
  echo "not now (board unreadable): $GATE_WHY"
  if [ ! -e "$BOARD_ERR" ]; then
    printf '%s\n' "$(date -u +%FT%TZ)" > "$BOARD_ERR"
    post_discord "$(printf 'night agent: รอก่อน — อ่านตารางจอง Claude ไม่ได้ จึงไม่รู้ว่ามีใครจองอยู่หรือไม่\n%s\nตรวจ: journalctl -u samo-claude-usage -n 20' "$GATE_WHY")"
  fi
  exit 0
elif [ "$GATE_RC" -ne 0 ]; then
  # Not a verdict — the gate itself broke. Do not run, and say so ONCE per
  # failure kind rather than every 20 minutes.
  echo "!! gate failed (rc $GATE_RC): $GATE_WHY"
  ERR_STAMP="$NIGHT_HOME/.gate-error"
  if [ ! -e "$ERR_STAMP" ] || [ "$(cat "$ERR_STAMP")" != "$GATE_RC" ]; then
    printf '%s' "$GATE_RC" > "$ERR_STAMP"
    post_discord "$(printf 'night agent: ตัวตรวจคิวทำงานผิดพลาด (rc %s) — ไม่ได้เริ่มงาน\n%s' "$GATE_RC" "$(printf '%s' "$GATE_WHY" | tail -3)")"
  fi
  exit 1
fi
rm -f "$NIGHT_HOME/.gate-error" "$BOARD_ERR"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG") 2>&1
echo "=== samo night agent — started $(date -u +%FT%TZ) (ICT $(TZ=Asia/Bangkok date +%H:%M)) ==="
echo "queue: $GATE_WHY"

# ⛔ THE QUEUE-FINGERPRINT GUARD (2026-09-19) IS GONE, ON PURPOSE (2026-10-13).
# It refused a queue whose file had not changed since the last completed run —
# but it stamped the file AFTER that run rewrote it, so the NEXT run always saw
# "unchanged" and refused: a `Budget: 3 nights` queue could never use night 2.
# What it guarded against (re-running finished work) is now answered by the
# queue itself — `gate` refuses when every task is terminal, and a task whose
# check already passes is skipped before claude is called.

# ⛔ SAY "I STARTED" BEFORE DOING ANYTHING. Without it, a run that dies early —
# OOM, a hung task, the box rebooting — is indistinguishable in the morning from
# a timer that never fired at all, and those two have completely different fixes.
# ⛔ SAY HOW OLD THE MEMORY IS, IN THE MESSAGE A HUMAN ACTUALLY READS.
# Nothing in the repo syncs `~/samo-night/memory` — `install.sh` does, and a
# sync that depends on somebody remembering is a sync that is sometimes skipped.
# On 2026-09-19 the VM's copy was EIGHT DAYS behind and four files short, and
# the missing ones were precisely those saying earlier figures had changed. A
# stale memory reads perfectly; the only way to notice is to be told its date.
MEM_N="$(ls "$MEM_DIR" 2>/dev/null | wc -l | tr -d ' ')"
MEM_AGE_D="$(( ( $(date +%s) - $(stat -c %Y "$MEM_DIR/MEMORY.md" 2>/dev/null || echo 0) ) / 86400 ))"
MEM_LINE="ความจำ: $MEM_N ไฟล์ (อัปเดตล่าสุด $MEM_AGE_D วันก่อน)"
[ "$MEM_AGE_D" -ge 3 ] && MEM_LINE="$MEM_LINE ⚠️ เก่าแล้ว — รัน install.sh เพื่อซิงก์"
echo "$MEM_LINE"

post_discord "$(printf 'เริ่มทำงานแล้ว %s (ICT)\nคิวงาน: %s\n%s\n%s\nจะรายงานผลอีกครั้งตอนจบ' \
  "$(TZ=Asia/Bangkok date +'%d/%m %H:%M')" "$(grep -c '^## ' "$TASKS" 2>/dev/null || echo '?')" \
  "$GATE_WHY" "$MEM_LINE")"

cd "$REPO" || { echo "!! no $REPO"; exit 1; }
# ⛔ NO COMMIT IDENTITY = EVERY COMMIT FAILS SILENTLY. The runner commits with
# `--quiet`, so a checkout with no user.email would lose every WIP sweep while
# the queue recorded "WIP <sha>" naming a commit that holds none of the work
# (seen in the 2026-10-18 rehearsal, whose fresh clone had no identity). Refuse
# before spending anything.
if [ -z "$(git config user.email)" ]; then
  echo "!! $REPO has no git user.email — commits would fail silently; not running"
  post_discord "night agent: ไม่ได้เริ่มงาน — checkout ไม่มี git user.email จึง commit ไม่ได้ (git -C $REPO config user.email …)"
  exit 1
fi

git fetch --quiet origin main 2>/dev/null || echo "(fetch failed — using the local clone)"
# ⛔ ONE BRANCH FOR THE WHOLE QUEUE, AND A LATER RUN CONTINUES IT. This used to
# be `checkout -B agent/<date> origin/main` every run: with several runs a day
# the second RESET the branch and threw away the first's commits — and the VM
# cannot push, so they existed nowhere else.
BRANCH="$(node "$QUEUE" list "$TASKS" 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).branch||"")}catch{}})')"
[ -n "$BRANCH" ] || BRANCH="agent/$(date -u +%Y-%m-%d)"
if git rev-parse --verify --quiet "refs/heads/$BRANCH" >/dev/null; then
  git checkout --quiet "$BRANCH"
  # A run cut off by the quota may have left edits it never committed.
  if [ -n "$(git status --porcelain)" ]; then
    git add -A && git commit --quiet -m "agent: work left uncommitted by the previous run" -m "Swept up at $STAMP."
  fi
  echo "branch: $BRANCH (continuing)  head: $(git log --oneline -1)"
else
  git checkout --quiet -B "$BRANCH" origin/main 2>/dev/null || git checkout --quiet -B "$BRANCH"
  echo "branch: $BRANCH (new)  base: $(git log --oneline -1)"
fi

[ -r "$TASKS" ] || { echo "!! no task file at $TASKS"; exit 1; }

mapfile -t STARTS < <(grep -n '^## ' "$TASKS" | cut -d: -f1)
TOTAL=${#STARTS[@]}

# ⛔ EVERYTHING ABOVE THE FIRST '## ' IS SHARED, AND MUST REACH EVERY TASK.
# Tasks are sliced from one heading to the next, so a constraints block written
# at the top of the file was being cut off and sent to NOBODY — the tasks would
# each have discovered "you have no database access" by trying and failing, one
# wasted task at a time. Caught before the first real night.
if [ "$TOTAL" -gt 0 ] && [ "${STARTS[0]}" -gt 1 ]; then
  SHARED="$(sed -n "1,$(( STARTS[0] - 1 ))p" "$TASKS")"
else
  SHARED=""
fi
[ -n "$SHARED" ] && echo "shared preamble: $(printf '%s' "$SHARED" | wc -l) lines, prepended to every task"
echo "tasks queued: $TOTAL"
[ "$TOTAL" -gt 0 ] || { echo "!! no '## ' headings in $TASKS"; exit 1; }

# Built ONCE, before the loop: run_one() uses it after the loop has ended, and
# a variable defined only inside the loop does not exist when the queue was empty.
preamble_base="Before doing anything else, read $MEM_DIR/MEMORY.md — it is an index
of $(ls "$MEM_DIR" 2>/dev/null | wc -l) memory files in that same directory holding context that is
NOT in this repo. Read every entry whose one-line description is relevant to the
task below, then follow the repo's own CLAUDE.md. These memories may name real
students: never copy their contents into any file under the repo, which is PUBLIC.

--- STANDING CONSTRAINTS FOR EVERY TASK TONIGHT ---
${SHARED}

--- YOUR TASK ---
"
done_n=0; fail_n=0; stop_reason="queue finished"; SUMMARY=""; UNRUN=0; NEEDS_DECISION=""; QUOTA_GONE=0; BOOKING_YIELD=0

for i in "${!STARTS[@]}"; do
  # 20 min short of the reserve, not at it: a task started with two minutes on
  # its capped timeout spends tokens on a start-up it cannot use.
  if [ "$(date -u +%s)" -ge $(( RESERVE_EPOCH - 20 * 60 )) ]; then
    stop_reason="stopped ${RUN_RESERVE_MIN:-245} min into the run to reserve time for the handoff"
    UNRUN=$(( TOTAL - i )); break
  fi
  # ⛔ THE RESERVE IS CHECKED BETWEEN TASKS TOO, not only at the start — a run
  # that began at 60% of the week would otherwise spend straight through the
  # owner's session. The numbers are ≤15 min old; usageGate keeps a margin.
  # ⛔ AND THE BOOKING BOARD, at the same point: a booking that STARTED while
  # the last task ran stops the NEXT one from starting. It never stops a task
  # already running — the owner's call (2026-10-18): "it doesn't have to stop
  # the task". A refusal here is a wait, like the quota: the next run resumes.
  if ! U_WHY="$(node "$QUEUE" usage "$TASKS" "$USAGE" "$BOOKINGS" 2>&1)"; then
    stop_reason="not starting another task: $U_WHY"
    UNRUN=$(( TOTAL - i )); QUOTA_GONE=1; break
  fi

  # ⛔ RE-READ THE HEADINGS EVERY TASK. The runner writes Status/Attempts/Note
  # lines UNDER each heading as verdicts land, so line numbers taken once at the
  # top go stale after the first verdict: the 2026-10-13 rehearsal handed task
  # 3 the prompt of task 2 (already done) and never ran task 3 — re-doing
  # finished work, the exact thing this runner exists to prevent. The NUMBER of
  # headings never changes, so the index `i` stays valid.
  mapfile -t STARTS < <(grep -n '^## ' "$TASKS" | cut -d: -f1)
  start="${STARTS[$i]}"
  if [ $((i+1)) -lt "$TOTAL" ]; then end=$(( STARTS[$((i+1))] - 1 )); else end=$(wc -l < "$TASKS"); fi
  title="$(sed -n "${start}p" "$TASKS" | sed 's/^## *//')"
  prompt="$(sed -n "${start},${end}p" "$TASKS")"

  echo ""
  echo "--- [$((i+1))/$TOTAL] $title  ($(date -u +%H:%M)Z) ---"
  before="$(git rev-parse HEAD)"

  out="$LOG_DIR/$STAMP-task$((i+1)).out"
  # `< /dev/null`: headless claude otherwise waits ~3s for stdin and warns.
  # ⛔ EVERY TASK GETS THE MEMORY, NOT JUST THE REPO'S TRACKED DOCS.
  # A fresh `claude -p` starts cold: it sees CLAUDE.md, .claude/rules/ and docs/
  # because those are checked in, but NOT the 51 accumulated memory files — which
  # hold the things that are true and nowhere in the repo, like "kkumail
  # identifies a person, never merge on name", "docs/ is PUBLISHED at
  # samo.md.kku.ac.th/docs", and which Supabase project is live. Without them an
  # unattended agent re-derives from scratch and repeats decided mistakes.
  #
  # They live OUTSIDE the clone on purpose: some name real students, and this
  # repo is PUBLIC — inside the tree, `git add -A` would commit them.
  # THE CHECK THE HUMAN WROTE, run BEFORE the agent. A check already passing is
  # the missing control: it has proved nothing about work that has not happened
  # yet, and reporting "done" off it would credit the agent with either an
  # already-finished task or a broken check.
  CHECK="$(node "$QUEUE" list "$TASKS" 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).tasks[+process.argv[1]];process.stdout.write(t&&t.check?t.check:"")})' "$i")"
  t_attempts="$(node "$QUEUE" list "$TASKS" 2>/dev/null \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const t=JSON.parse(d).tasks[+process.argv[1]];process.stdout.write(String(t?t.attempts:0))})' "$i")"
  t_attempts=${t_attempts:-0}
  # ⛔ WHAT TO DO WITH THIS TASK IS queue.mjs's ANSWER, NOT THIS SCRIPT'S.
  #   skip   — terminal. Its verdict is the record: the check is NOT re-run and
  #            the note is NOT rewritten. Re-checking every finished task every
  #            run cost ~2 min each and overwrote "passed its check" with
  #            "passed before start" on all six on 2026-10-13, erasing which
  #            ones the agent had actually finished.
  #   resume — the quota cut it off last time. The agent FINISHES it; the check
  #            is not asked first, because the half-done WIP can satisfy it —
  #            that is how task 2 was marked done without anyone finishing it.
  #   fresh  — never attempted: the check runs first, as the control.
  PLAN="$(node "$QUEUE" plan "$TASKS" "$i" 2>/dev/null)"
  # ⛔ NO ANSWER MEANS DO NOTHING, never "fresh": a crashed plan defaulting to
  # fresh re-ran the check of a FINISHED task and rewrote its verdict — the
  # exact history loss `skip` exists to prevent. Say so instead.
  case "$PLAN" in
    skip|resume|fresh) ;;
    *) echo "(queue.mjs plan gave no answer — task left untouched)"
       SUMMARY+="ERR  $title — queue.mjs plan failed; not run, not judged"$'\n'
       continue ;;
  esac
  RESUMED=0
  if [ "$PLAN" = "skip" ]; then
    echo "(ปิดไปแล้วตั้งแต่รอบก่อน — ไม่ตรวจซ้ำ ไม่เขียนทับผล)"
    SUMMARY+="--   $title — ปิดไปแล้วรอบก่อน"$'\n'
    continue
  fi
  if [ "$PLAN" = "resume" ]; then
    RESUMED=1
    WIP_NOTE="$(sed -n "${start},${end}p" "$TASKS" | grep -m1 '^Note:' | sed 's/^Note: *//')"
    echo "(ทำต่อจากรอบที่ถูกตัด: $WIP_NOTE)"
    prompt="⛔ THIS TASK WAS CUT OFF PART-WAY BY THE USAGE LIMIT IN AN EARLIER RUN.
The runner recorded: ${WIP_NOTE}
Its half-done work is already committed on this branch. Do NOT start over and
do NOT assume it is finished because files exist or tests pass. First read
\`git log --oneline origin/main..HEAD\` and \`git show --stat\` of the WIP
commit(s) for this task. Then go through the brief below point by point, say
for EACH point whether the WIP already does it (with the file that shows it)
or not, finish whatever is missing, run \`npm test\` and \`npm run build\`,
and commit. In \`docs/state/night-agent.md\`, label this task's block
\"RESUMED after a quota cut-off\" and list what the WIP had left undone.

${prompt}"
  fi

  PASSED_BEFORE=0
  if [ "$PLAN" = "fresh" ] && [ -n "$CHECK" ] && [ "$CHECK" != "once" ]; then
    if ( cd "$REPO" && eval "$CHECK" ) >/dev/null 2>&1; then
      PASSED_BEFORE=1
      echo "(วิธีตรวจผ่านตั้งแต่ก่อนเริ่ม — agent ไม่ได้ทำ ส่งให้คนดู)"
    fi
  fi

  if [ "$PASSED_BEFORE" -eq 1 ]; then
    node "$QUEUE" judge "$TASKS" "$i" 1 1 0 >/dev/null
    SUMMARY+="REVIEW $title — วิธีตรวจผ่านตั้งแต่ก่อนเริ่ม ไม่มีใครทำ ต้องให้คนดู"$'\n'
    continue
  fi

  # The allowance is taken NOW, as the task starts, and fixed for the task.
  ALLOW="$(node "$QUEUE" allowance "$TASKS" "$USAGE" "$BOOKINGS" 2>/dev/null)"
  [ -n "$ALLOW" ] || ALLOW="-"
  echo "allowance: $ALLOW"
  run_claude "${preamble_base}${prompt}" "$out" "$RESERVE_EPOCH" "$ALLOW"
  rc=$?
  tail -c 1500 "$out"

  # ⛔ A HEADLESS TASK CANNOT BE ANSWERED, SO A QUESTION IS A FAILED TASK.
  # There is no human at 2am. When the agent ends its turn asking permission or
  # asking which option to take, the task is "successful" by exit code and has
  # produced nothing — seen repeatedly while testing. Surface it by name so the
  # morning report says WHICH task needs a decision, instead of looking clean.
  if tail -c 600 "$out" | grep -qiE "let me know|could you (please )?(grant|confirm|clarify|tell)|would you like me to|shall I|which (option|one) (do you|would you)|I.ll need you to|waiting for your"; then
    NEEDS_DECISION+="$title"$'\n'
    SUMMARY+="ASK  $title — ended by asking a question; nobody was there"$'\n'
  fi

  # ⛔ CUT BY THIS RUN'S OWN CLOCK (the timeout was capped to RESERVE_EPOCH):
  # same bookkeeping as a quota cut — the agent did not get to finish, so it is
  # `interrupted` and RESUMED, not counted as a failed attempt.
  CUT_BY=""
  [ -e "$out.yield" ] && CUT_BY="board"
  [ -z "$CUT_BY" ] && [ "$(node "$QUEUE" classify "$out")" = "quota" ] && CUT_BY="quota"
  [ -z "$CUT_BY" ] && [ "$rc" -eq 124 ] && [ "$(date -u +%s)" -ge $(( RESERVE_EPOCH - 60 )) ] && CUT_BY="time"
  # ⛔ GAVE THE WINDOW BACK to somebody's booking: WIP kept, task `interrupted`,
  # the next run RESUMES it once the board has room again.
  if [ "$CUT_BY" = "board" ]; then
    Y_WHY="$(head -1 "$out.yield")"
    stop_reason="ให้คนที่จอง Claude ใช้ก่อน: $Y_WHY"
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit --quiet -m "agent: WIP $title (gave the window back to a Claude booking)" -m "Unattended run $STAMP. $Y_WHY"
    fi
    node "$QUEUE" cut "$TASKS" "$i" "$(git rev-parse --short HEAD)" board
    fail_n=$((fail_n+1)); SUMMARY+="YIELD $title — $Y_WHY (work kept as WIP, the next run RESUMES it)"$'\n'
    UNRUN=$(( TOTAL - i - 1 )); BOOKING_YIELD=1; break
  fi
  if [ "$CUT_BY" = "time" ]; then
    stop_reason="this run reached its ${RUN_RESERVE_MIN:-245}-min limit mid-task — the next run RESUMES it"
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit --quiet -m "agent: WIP $title (cut off by the run's time limit)" -m "Unattended run $STAMP."
    fi
    node "$QUEUE" cut "$TASKS" "$i" "$(git rev-parse --short HEAD)" time
    fail_n=$((fail_n+1)); SUMMARY+="STOP $title — run time limit (work kept as WIP, the next run RESUMES it)"$'\n'
    UNRUN=$(( TOTAL - i - 1 )); break
  fi
  if [ "$CUT_BY" = "quota" ]; then
    stop_reason="claude reported a usage/rate limit — stopped rather than hammering it"
    # No verdict: a task cut off by the quota was not ATTEMPTED, and counting
    # it would block it after two windows that each ran out. Keep what it did.
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit --quiet -m "agent: WIP $title (cut off by the quota)" -m "Unattended run $STAMP."
    fi
    # ⛔ AND SAY SO IN THE QUEUE. Leaving the status untouched let the next run
    # treat this as never started, and its check passed on the WIP. An
    # `interrupted` task is resumed, never skipped, and its note names the
    # commit that holds what it left.
    node "$QUEUE" cut "$TASKS" "$i" "$(git rev-parse --short HEAD)"
    fail_n=$((fail_n+1)); SUMMARY+="STOP $title — quota/rate limit (work kept as WIP, the next run RESUMES it)"$'\n'
    UNRUN=$(( TOTAL - i - 1 )); QUOTA_GONE=1; break
  fi

  if [ $rc -ne 0 ]; then
    echo "(task exited $rc)"; fail_n=$((fail_n+1)); SUMMARY+="FAIL $title (exit $rc)"$'\n'
  else
    done_n=$((done_n+1))
  fi

  # ⛔ THE VERDICT, AND IT IS NOT THE AGENT'S. `rc` is only "claude exited 0",
  # which is reachable with nothing produced — the same shape as a deploy
  # reporting DEPLOY_EXIT=0 with its docs step skipped. What decides the status
  # is the check the HUMAN wrote, run now, against the repo as it stands.
  #
  # `once` means "no mechanical check": one attempt, then a person reads it.
  # Never retried — retrying what nothing can judge is how a night is spent on
  # nothing.
  AFTER="-"
  if [ -n "$CHECK" ] && [ "$CHECK" != "once" ]; then
    if ( cd "$REPO" && eval "$CHECK" ) >/dev/null 2>&1; then AFTER=1; else AFTER=0; fi
  fi
  V="$(node "$QUEUE" judge "$TASKS" "$i" "$AFTER" 0 "$RESUMED")"
  V_STATUS="${V%%$'\t'*}"; V_NOTE="${V#*$'\t'}"
  echo "check: $AFTER → $V_STATUS ($V_NOTE)"
  case "$V_STATUS" in
    done)         SUMMARY+="DONE $title — $V_NOTE"$'\n' ;;
    blocked)      SUMMARY+="BLOCK $title — $V_NOTE"$'\n' ;;
    needs-review) SUMMARY+="REVIEW $title — $V_NOTE"$'\n' ;;
    *)            SUMMARY+="RETRY $title — $V_NOTE"$'\n' ;;
  esac

  # Count work as EITHER an uncommitted change we sweep up, OR commits the agent
  # made itself — it is told to commit, and only asking `git status` misses those.
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit --quiet -m "agent: $title" -m "Unattended run $STAMP. Review before merging."
  fi
  after="$(git rev-parse HEAD)"
  if [ "$after" != "$before" ]; then
    n_commits="$(git rev-list --count "$before..$after")"
    files="$(git diff --shortstat "$before..$after" | tr -d '\n')"
    echo "work: $n_commits commit(s) — $files"
    [ $rc -eq 0 ] && SUMMARY+="OK   $title — $n_commits commit(s),$files"$'\n'
  else
    echo "(no commits — nothing was produced)"
    [ $rc -eq 0 ] && SUMMARY+="--   $title (produced nothing)"$'\n'
  fi
done

# ── run_one <file> <label> — one prompt, same preamble, same commit discipline ──
run_one() {
  local f="$1" label="$2" deadline="${3:-$RESERVE_EPOCH}" allow="${4:-}" out
  [ -r "$f" ] || { echo "(no $f — skipping $label)"; return 0; }
  out="$LOG_DIR/$STAMP-$label.out"
  local b4; b4="$(git rev-parse HEAD)"
  echo ""
  echo "--- $label  ($(date -u +%H:%M)Z) ---"
  if [ -z "$allow" ]; then
    allow="$(node "$QUEUE" allowance "$TASKS" "$USAGE" "$BOOKINGS" 2>/dev/null)"
    [ -n "$allow" ] || allow="-"
  fi
  run_claude "${preamble_base}$(cat "$f")" "$out" "$deadline" "$allow"
  local rc=$?
  if [ -e "$out.yield" ]; then
    echo "!! $label gave the window back: $(head -1 "$out.yield")"
    BOOKING_YIELD=1
  fi
  tail -c 1200 "$out"
  # ⛔ THE QUOTA CHECK BELONGS HERE TOO. It used to live only in the main queue,
  # so when the window ran out the revise loop kept firing passes and the handoff
  # kept trying, each returning the same refusal in under a second. Seen for real
  # on 2026-09-15: six revision passes and a handoff, all "session limit".
  if [ "$(node "$QUEUE" classify "$out")" = "quota" ]; then
    echo "!! quota exhausted during $label — not retrying"
    QUOTA_GONE=1
    return 9
  fi
  if [ -n "$(git status --porcelain)" ]; then
    git add -A
    git commit --quiet -m "agent: $label" -m "Unattended run $STAMP. Review before merging."
  fi
  if [ "$(git rev-parse HEAD)" != "$b4" ]; then
    echo "work: $(git rev-list --count "$b4..HEAD") commit(s)"
  else
    echo "(no commits)"
  fi
  return $rc
}

# ── IT FINISHED EARLY. Keep improving rather than leave the window unspent. ──
# The queue is sized by guesswork; finishing at 01:00 wastes three hours of a
# window that is gone at 03:40 either way. Each pass is a fresh cold run that
# re-reads what the earlier tasks produced, so it reviews work rather than
# continuing half-remembered work.
# ⛔ OFF BY DEFAULT SINCE 2026-10-13 (owner: "i dont want my token to go to
# waste"). Six open-ended "improve it" passes are exactly that when the queue is
# done; with runs now starting every window, a finished queue should STOP.
# NIGHT_REVISE=1 turns them back on for a run that wants them.
pass=0
while [ "${NIGHT_REVISE:-0}" = "1" ] && [ "$(date -u +%s)" -lt "$RESERVE_EPOCH" ] && [ "$UNRUN" -eq 0 ] \
      && [ "$QUOTA_GONE" -eq 0 ] && [ "$BOOKING_YIELD" -eq 0 ] && [ -r "$NIGHT_HOME/REVISE.md" ] \
      && node "$QUEUE" usage "$TASKS" "$USAGE" "$BOOKINGS" >/dev/null 2>&1; do
  pass=$((pass+1))
  [ "$pass" -gt 6 ] && { echo "(stopping after 6 revision passes — diminishing returns)"; break; }
  run_one "$NIGHT_HOME/REVISE.md" "revise-$pass"
  SUMMARY+="REV  revision pass $pass"$'\n'
done

# ── THE HANDOFF ALWAYS RUNS, whatever happened above. ───────────────────────
# Even if the queue overran, even if a task died, even if nothing was built: an
# undocumented night is one the owner cannot use, and "what went wrong" is worth
# more than a clean-looking silence.
QUEUE_REPORT="$(node "$QUEUE" report "$TASKS" 2>&1)"
export AGENT_UNRUN="$UNRUN" AGENT_STOP="$stop_reason" AGENT_ASKS="$NEEDS_DECISION" AGENT_QUEUE_REPORT="$QUEUE_REPORT"
# The handoff still ATTEMPTS even with the quota gone — it costs one refused
# call, and if any quota remains it is the most valuable thing left to spend it on.
# ⛔ NOT AFTER GIVING THE WINDOW BACK. The handoff is a model call, and the
# quota left in this window is the booker's — writing notes in it would spend
# exactly the share the yield protected. The runner's own Discord report below
# still goes out (no model), and the next run's handoff reads the whole branch.
# Unwatched otherwise ("-"): it is the run's record, sized by HARD_END alone.
if [ "$BOOKING_YIELD" -eq 1 ]; then
  echo "(handoff skipped — the rest of this window belongs to a Claude booking; the next run's handoff covers this one)"
  SUMMARY+="SKIP handoff — ให้คนที่จอง Claude ใช้ก่อน รอบหน้าจะเขียนแทน"$'\n'
else
  run_one "$NIGHT_HOME/HANDOFF.md" "handoff" "$HARD_END" "-" && SUMMARY+="OK   handoff written"$'\n'
fi

echo ""
# Stamped HERE, at the end, and only here: a queue that was abandoned half way
# — quota gone, the box rebooted, a task hung — has NOT been done, and the next
# night must be allowed to pick it up. Writing this at the start would turn
# every interrupted night into a permanently skipped queue.
# One night against the budget — the stop that does not depend on the checks
# being written correctly. A mistyped `Done when:` never terminates on its own.
[ -r "$QUEUE" ] && [ -r "$TASKS" ] && node "$QUEUE" spend "$TASKS" 2>/dev/null || true

# Is the queue OVER now? Then stop here, rather than at the next tick: the
# STOPPED file makes systemd skip every later tick without running anything.
FINAL_WHY="$(node "$QUEUE" gate "$TASKS" 2>&1)"
if [ $? -eq 10 ]; then
  printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$FINAL_WHY" > "$STOPPED"
  stop_reason="$stop_reason · QUEUE OVER — stopped itself ($FINAL_WHY)"
fi

echo "=== finished $(date -u +%FT%TZ) — $done_n ok, $fail_n failed. $stop_reason ==="
commits="$(git log --oneline origin/main.."$BRANCH" 2>/dev/null | wc -l)"
echo "commits on $BRANCH: $commits"

alert=""
[ "$UNRUN" -gt 0 ] && alert+="RAN OUT OF TIME — $UNRUN task(s) never started"$'\n'
[ -n "$NEEDS_DECISION" ] && alert+="NEEDS YOUR DECISION: $(printf '%s' "$NEEDS_DECISION" | tr '\n' ';')"$'\n'
[ -n "$alert" ] && echo "$alert"

# ⛔ THE PER-TASK VERDICTS GO OUT IN THE RUNNER'S OWN WORDS, beside the agent's
# handoff, never only through it. On 2026-10-13 the handoff read six `done`s
# and told the owner "nothing was skipped" about a task the quota had cut off.
QUEUE_REPORT="$(node "$QUEUE" report "$TASKS" 2>&1)"
echo "$QUEUE_REPORT"
post_discord "$(printf 'คืนนี้ Claude ทำอะไรไปบ้าง (%s)\n%s\n%s ok · %s failed · %s commits on %s\n%s\nสถานะทุกงาน (ตามวิธีตรวจ ไม่ใช่ตามที่ agent บอก):\n%s\nstopped: %s\nlog: %s' \
  "$(TZ=Asia/Bangkok date +'%d/%m %H:%M')" "$alert" "$done_n" "$fail_n" "$commits" "$BRANCH" "$SUMMARY" "$QUEUE_REPORT" "$stop_reason" "$LOG")"

echo "=== done ==="
