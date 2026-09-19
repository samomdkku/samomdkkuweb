#!/usr/bin/env bash
# install.sh — push this directory's night-agent onto the VM and arm it.
# Run from the repo root WITH VPN UP:  bash server/night-agent/install.sh
# Add --run to also start a run immediately instead of waiting for the timer.
set -euo pipefail
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

# systemd units: stage as ubuntu first — `sudo -S` eats stdin, so piping a file
# THROUGH it silently installs an empty unit, which systemd then reports as masked.
ssh -o BatchMode=yes samo-vm 'cat > /tmp/na.service' < "$D/samo-night-agent.service"
ssh -o BatchMode=yes samo-vm 'cat > /tmp/na.timer'   < "$D/samo-night-agent.timer"
ssh -o BatchMode=yes samo-vm "printf '%s\n' '$PW' | sudo -S bash -c '
  install -m 0644 /tmp/na.service /etc/systemd/system/samo-night-agent.service
  install -m 0644 /tmp/na.timer   /etc/systemd/system/samo-night-agent.timer
  systemctl daemon-reload && systemctl enable --now samo-night-agent.timer' 2>&1" | grep -v '^\[sudo'

echo "armed. NEXT: $(ssh -o BatchMode=yes samo-vm 'systemctl show samo-night-agent.timer -p NextElapseUSecRealtime --value')"

if [ "${1:-}" = "--run" ]; then
  ssh -o BatchMode=yes samo-vm 'cd ~/samo-agent && git fetch -q origin main && git checkout -q -B main origin/main'
  ssh -o BatchMode=yes samo-vm "printf '%s\n' '$PW' | sudo -S systemctl start --no-block samo-night-agent.service 2>&1" | grep -v '^\[sudo'
  echo "started now — watch: ssh samo-vm 'tail -f \$(ls -t ~/samo-night/logs/*.log | head -1)'"
fi
