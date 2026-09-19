#!/usr/bin/env bash
# install.sh — push this directory's night-agent onto the VM and arm it.
# Run from the repo root WITH VPN UP:  bash server/night-agent/install.sh
# Add --run to also start a run immediately instead of waiting for the timer.
set -euo pipefail
# ⛔ A SUDO FILTER MUST NOT DECIDE THIS SCRIPT'S EXIT CODE. `| grep -v '^[sudo'`
# exits 1 when it filtered EVERYTHING — which is the successful case, because a
# clean `systemctl daemon-reload` says nothing — so a working install reported
# failure and `install.sh && something` never ran the something. Same shape as
# the deploy whose verdict was `tail`'s (`docs/mistakes/deploy-hosting.md`):
# a pipeline's status belongs to its LAST command, not to the work.
# Every such filter below is wrapped in `{ … || true; }`.
cd "$(dirname "$0")/../.."
PW="$(grep -m1 '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')"
D=server/night-agent

ssh -o BatchMode=yes samo-vm 'mkdir -p ~/samo-night/logs ~/samo-agent/.claude'
# ⛔ queue.mjs IS NOT OPTIONAL. run-night.sh calls it to gate the night, to read
# each task's `Done when:` and to write the verdicts back. Left off this list it
# would be missing on the VM and every night would fall back to running the whole
# queue again — which is precisely the behaviour it was written to end.
for f in run-night.sh queue.mjs NIGHT-TASKS.md REVISE.md HANDOFF.md; do
  ssh -o BatchMode=yes samo-vm "cat > ~/samo-night/$f" < "$D/$f"
done
ssh -o BatchMode=yes samo-vm 'chmod +x ~/samo-night/run-night.sh && bash -n ~/samo-night/run-night.sh'
ssh -o BatchMode=yes samo-vm 'cat > ~/samo-agent/.claude/settings.local.json' < "$D/settings.local.json"

# ── THE MEMORY, EVERY TIME ────────────────────────────────────────────────────
# ⛔ THE AGENT'S MEMORY IS NOT IN THE REPO, SO NOTHING SYNCS IT BY ITSELF. Found
# on 2026-09-19: the VM's copy was 51 files dated Sep 11 while the laptop had 55.
# The four it was missing are the ones written to say that earlier numbers had
# CHANGED — "13 unplaced" is now 0, "18 สาย problems" is now 5 — so an unattended
# run would have read the superseded figures as current and acted on them.
#
# That is the worst version of a stale copy: the file exists, reads fluently and
# is wrong. Nothing in a night's output would have looked odd.
#
# It rsyncs on EVERY install and is not optional or flagged, because a sync you
# have to remember is a sync that is sometimes not done — and the failure is
# silent. `--delete` too: a memory deleted for being WRONG has to disappear
# there as well, or the VM keeps consulting it for ever.
MEM_LOCAL="$HOME/.claude/projects/$(pwd | sed 's|/|-|g')/memory"
if [ -d "$MEM_LOCAL" ]; then
  rsync -az --delete -e 'ssh -o BatchMode=yes' "$MEM_LOCAL/" samo-vm:'~/samo-night/memory/'
  echo "memory: $(ls "$MEM_LOCAL" | wc -l | tr -d ' ') files synced"
else
  echo "⛔ NO MEMORY DIRECTORY at $MEM_LOCAL — the agent would run with none."
  echo "   Refusing rather than arming a run that reads nothing." >&2
  exit 3
fi

# systemd units: stage as ubuntu first — `sudo -S` eats stdin, so piping a file
# THROUGH it silently installs an empty unit, which systemd then reports as masked.
ssh -o BatchMode=yes samo-vm 'cat > /tmp/na.service' < "$D/samo-night-agent.service"
ssh -o BatchMode=yes samo-vm 'cat > /tmp/na.timer'   < "$D/samo-night-agent.timer"
ssh -o BatchMode=yes samo-vm "printf '%s\n' '$PW' | sudo -S bash -c '
  install -m 0644 /tmp/na.service /etc/systemd/system/samo-night-agent.service
  install -m 0644 /tmp/na.timer   /etc/systemd/system/samo-night-agent.timer
  systemctl daemon-reload' 2>&1" | { grep -v '^\[sudo' || true; }

# ⛔ INSTALLING IS NOT ARMING, since 2026-09-19. This used to
# `systemctl enable --now` every time, so syncing the memory or shipping a fix
# would silently re-arm a timer the owner had deliberately disabled — and the
# reason it is disabled is that a queue must be WRITTEN before a night is worth
# spending. `--arm` is the word for that, and it has to be typed.
if [ "${1:-}" = "--arm" ] || [ "${2:-}" = "--arm" ]; then
  ssh -o BatchMode=yes samo-vm "printf '%s\n' '$PW' | sudo -S systemctl enable --now samo-night-agent.timer 2>&1" | { grep -v '^\[sudo' || true; }
  echo "armed. NEXT: $(ssh -o BatchMode=yes samo-vm 'systemctl list-timers --all --no-pager | grep samo-night-agent | awk "{print \$1, \$2, \$3}"')"
else
  echo "installed (NOT armed). Write a queue, then: bash server/night-agent/install.sh --arm"
  echo "timer now: $(ssh -o BatchMode=yes samo-vm 'systemctl is-enabled samo-night-agent.timer 2>&1')"
fi

if [ "${1:-}" = "--run" ]; then
  ssh -o BatchMode=yes samo-vm 'cd ~/samo-agent && git fetch -q origin main && git checkout -q -B main origin/main'
  ssh -o BatchMode=yes samo-vm "printf '%s\n' '$PW' | sudo -S systemctl start --no-block samo-night-agent.service 2>&1" | { grep -v '^\[sudo' || true; }
  echo "started now — watch: ssh samo-vm 'tail -f \$(ls -t ~/samo-night/logs/*.log | head -1)'"
fi
