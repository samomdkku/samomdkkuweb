#!/usr/bin/env bash
# ============================================================
# run-night.sh — work the NIGHT-TASKS queue while the 5-hour window is open.
#
# Fires from samo-night-agent.timer at 15:41 UTC = 22:41 ICT, one minute after
# the subscription's 5-hour window resets.
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
# impossible even if something tried; deploy.sh, sudo, systemctl, apply-migration,
# db-query and the GAS deploys are denied. Work lands as commits on a branch for
# a human to read in the morning.
# ============================================================
set -uo pipefail

REPO="$HOME/samo-agent"           # the checkout, and nothing else
NIGHT_HOME="$HOME/samo-night"     # runner, task queue, logs
LOG_DIR="$NIGHT_HOME/logs"
MEM_DIR="$NIGHT_HOME/memory"   # the 51 memory files — read by every task, never committed
TASKS="${NIGHT_TASKS:-$NIGHT_HOME/NIGHT-TASKS.md}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="$LOG_DIR/$STAMP.log"
BRANCH="agent/$(date -u +%Y-%m-%d)"

# Stop 10 minutes before the window closes (03:40 ICT = 20:40 UTC) so a task
# cannot be cut off mid-edit and leave the tree in a state nobody chose.
HARD_STOP_UTC="${HARD_STOP_OVERRIDE:-20:30}"
# ⛔ THE HANDOFF IS RESERVED TIME, NOT THE LAST ITEM IN THE QUEUE.
# As the last task it would be the first thing lost when the queue overran — and
# a night whose work is undocumented is a night the owner cannot use. The main
# queue stops here; everything after is handoff.
RESERVE_UTC="${RESERVE_UTC_OVERRIDE:-19:40}"

# ⛔ COMPARE INSTANTS, NOT STRINGS. The first version tested
#     [[ "$(date -u +%H:%M)" > "$RESERVE_UTC" ]]
# which is a LEXICOGRAPHIC compare and is simply wrong once a run crosses
# midnight: starting at 23:25 with a deadline of 08:00, "23:25" > "08:00" is
# true, so the queue was abandoned before task 1 and it went straight to the
# handoff. It worked only because the original schedule (15:41 → 20:30) never
# crossed a day boundary — the bug was always there, hidden by the timetable.
# Resolve both bounds to epoch seconds ONCE, rolling to tomorrow when the target
# has already passed today.
to_epoch() {
  local hhmm="$1" today tomorrow now
  now=$(date -u +%s)
  today=$(date -u -d "today $hhmm" +%s 2>/dev/null) || today=0
  if [ "$today" -gt "$now" ]; then echo "$today"; else date -u -d "tomorrow $hhmm" +%s; fi
}

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
  local prompt="$1" out="$2" rc
  timeout 3600 claude -p "$prompt" --permission-mode bypassPermissions \
      --max-turns 120 --add-dir "$MEM_DIR" > "$out" 2>&1 < /dev/null
  rc=$?
  if grep -qiE '401|access token has expired|Failed to authenticate' "$out"; then
    echo "!! OAuth token expired — waiting 90s for the refresh timer, then retrying ONCE"
    sleep 90
    timeout 3600 claude -p "$prompt" --permission-mode bypassPermissions \
        --max-turns 120 --add-dir "$MEM_DIR" > "$out" 2>&1 < /dev/null
    rc=$?
    grep -qiE '401|access token has expired' "$out" \
      && echo "!! still expired after retry — the credential needs \`claude login\` on the VM"
  fi
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

RESERVE_EPOCH="$(to_epoch "$RESERVE_UTC")"
HARD_EPOCH="$(to_epoch "$HARD_STOP_UTC")"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG") 2>&1
echo "=== samo night agent — started $(date -u +%FT%TZ) (ICT $(TZ=Asia/Bangkok date +%H:%M)) ==="

# ⛔ SAY "I STARTED" BEFORE DOING ANYTHING. Without it, a run that dies early —
# OOM, a hung task, the box rebooting — is indistinguishable in the morning from
# a timer that never fired at all, and those two have completely different fixes.
post_discord "$(printf 'เริ่มทำงานแล้ว %s (ICT)\nคิวงาน: %s\nจะรายงานผลอีกครั้งตอนจบ' \
  "$(TZ=Asia/Bangkok date +'%d/%m %H:%M')" "$(grep -c '^## ' "$TASKS" 2>/dev/null || echo '?')")"

cd "$REPO" || { echo "!! no $REPO"; exit 1; }

git fetch --quiet origin main 2>/dev/null || echo "(fetch failed — using the local clone)"
git checkout --quiet -B "$BRANCH" origin/main 2>/dev/null || git checkout --quiet -B "$BRANCH"
echo "branch: $BRANCH  base: $(git log --oneline -1)"

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
done_n=0; fail_n=0; stop_reason="queue finished"; SUMMARY=""; UNRUN=0; NEEDS_DECISION=""; QUOTA_GONE=0

for i in "${!STARTS[@]}"; do
  if [ "$(date -u +%s)" -ge "$RESERVE_EPOCH" ]; then
    stop_reason="stopped at $RESERVE_UTC UTC to reserve time for the handoff"
    UNRUN=$(( TOTAL - i )); break
  fi

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
  run_claude "${preamble_base}${prompt}" "$out"
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

  if grep -qiE 'session limit|usage limit|rate limit|quota|exceeded your|429|Please try again later' "$out"; then
    stop_reason="claude reported a usage/rate limit — stopped rather than hammering it"
    fail_n=$((fail_n+1)); SUMMARY+="STOP $title — quota/rate limit"$'\n'; break
  fi

  if [ $rc -ne 0 ]; then
    echo "(task exited $rc)"; fail_n=$((fail_n+1)); SUMMARY+="FAIL $title (exit $rc)"$'\n'
  else
    done_n=$((done_n+1))
  fi

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
  local f="$1" label="$2" out
  [ -r "$f" ] || { echo "(no $f — skipping $label)"; return 0; }
  out="$LOG_DIR/$STAMP-$label.out"
  local b4; b4="$(git rev-parse HEAD)"
  echo ""
  echo "--- $label  ($(date -u +%H:%M)Z) ---"
  run_claude "${preamble_base}$(cat "$f")" "$out"
  local rc=$?
  tail -c 1200 "$out"
  # ⛔ THE QUOTA CHECK BELONGS HERE TOO. It used to live only in the main queue,
  # so when the window ran out the revise loop kept firing passes and the handoff
  # kept trying, each returning the same refusal in under a second. Seen for real
  # on 2026-09-15: six revision passes and a handoff, all "session limit".
  if grep -qiE 'session limit|usage limit|rate limit|quota|exceeded your|429' "$out"; then
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
pass=0
while [ "$(date -u +%s)" -lt "$RESERVE_EPOCH" ] && [ "$UNRUN" -eq 0 ] \
      && [ "$QUOTA_GONE" -eq 0 ] && [ -r "$NIGHT_HOME/REVISE.md" ]; do
  pass=$((pass+1))
  [ "$pass" -gt 6 ] && { echo "(stopping after 6 revision passes — diminishing returns)"; break; }
  run_one "$NIGHT_HOME/REVISE.md" "revise-$pass"
  SUMMARY+="REV  revision pass $pass"$'\n'
done

# ── THE HANDOFF ALWAYS RUNS, whatever happened above. ───────────────────────
# Even if the queue overran, even if a task died, even if nothing was built: an
# undocumented night is one the owner cannot use, and "what went wrong" is worth
# more than a clean-looking silence.
export AGENT_UNRUN="$UNRUN" AGENT_STOP="$stop_reason" AGENT_ASKS="$NEEDS_DECISION"
# The handoff still ATTEMPTS even with the quota gone — it costs one refused
# call, and if any quota remains it is the most valuable thing left to spend it on.
run_one "$NIGHT_HOME/HANDOFF.md" "handoff" && SUMMARY+="OK   handoff written"$'\n'

echo ""
echo "=== finished $(date -u +%FT%TZ) — $done_n ok, $fail_n failed. $stop_reason ==="
commits="$(git log --oneline origin/main.."$BRANCH" 2>/dev/null | wc -l)"
echo "commits on $BRANCH: $commits"

alert=""
[ "$UNRUN" -gt 0 ] && alert+="RAN OUT OF TIME — $UNRUN task(s) never started"$'\n'
[ -n "$NEEDS_DECISION" ] && alert+="NEEDS YOUR DECISION: $(printf '%s' "$NEEDS_DECISION" | tr '\n' ';')"$'\n'
[ -n "$alert" ] && echo "$alert"

post_discord "$(printf 'คืนนี้ Claude ทำอะไรไปบ้าง (%s)\n%s\n%s ok · %s failed · %s commits on %s\n%s\nstopped: %s\nlog: %s' \
  "$(TZ=Asia/Bangkok date +'%d/%m %H:%M')" "$alert" "$done_n" "$fail_n" "$commits" "$BRANCH" "$SUMMARY" "$stop_reason" "$LOG")"

echo "=== done ==="
