#!/usr/bin/env bash
# deploy.sh — pull + build + publish both apps on the KKU VM, then bounce
# the notify service. Run from the samomdkkuweb repo root on the server:
#   cd ~/samo-projects/samomdkkuweb && ./server/deploy.sh
#
# Assumes the layout in docs/SELF-HOST.md:
#   ~/samo-projects/samomdkkuweb     (this repo, .env.local present)
#   /var/www/samo-web  and  /var/www/passport  (Nginx roots)
#
# Passport used to be a SECOND CLONE here (~/samo-projects/samomdkkupassport,
# pulled and built separately). Since the 2026-09-04 repo merge it is this
# repo's passport/ directory and `npm run build` emits it to dist/passport/, so
# there is one pull, one npm ci and one build. That old clone is now unused; it
# is left on disk rather than deleted, and nothing reads it.
set -euo pipefail

WEB_DIR="$HOME/samo-projects/samomdkkuweb"

# ---------------------------------------------------------------------------
# Pull FIRST, then re-exec ourselves.
#
# bash reads a script incrementally, by BYTE OFFSET — it does not slurp the
# whole file up front. This script `git pull`s the repo it lives in, so any
# commit that changes deploy.sh's length shifts every byte after the pull point
# and bash resumes mid-token in the new file, running a garbage fragment of a
# command as root. It usually "works" only because the file rarely changes.
#
# Re-executing after the pull guarantees the version that runs is the version
# that was just fetched, read from the top. The env var breaks the recursion.
if [ "${SAMO_DEPLOY_REEXEC:-}" != "1" ]; then
  echo "==> pull (then re-exec the updated script)"
  cd "$WEB_DIR"
  git pull --ff-only
  SAMO_DEPLOY_REEXEC=1 exec bash "$WEB_DIR/server/deploy.sh" "$@"
fi

# ---------------------------------------------------------------------------
# EVERY run writes its FULL output to a file on the VM's own disk.
#
# Why this exists: the ssh command in `skills/deploy-vm.md` pipes this script
# through `grep -E "DEPLOY_EXIT|==>|error"`, so everything a build says about
# itself — vitepress's stack trace, npm's error block — is DISCARDED AT THE
# OBSERVER. Four of six runs skipped the docs publish and nobody has ever seen
# what the docs step said, because the only copy went through that filter and
# the run's exit code is written by the `; echo` rather than by this script.
#
# A file here is outside the filter, survives the process being killed, and can
# be read afterwards over a fresh ssh. `latest.log` always points at the newest.
#   ssh samo-vm 'cat ~/samo-deploy-logs/latest.log'
#   ssh samo-vm 'cat ~/samo-deploy-logs/latest.trace | tail -40'   # which LINE
DEPLOY_LOG_DIR="$HOME/samo-deploy-logs"
mkdir -p "$DEPLOY_LOG_DIR"
DEPLOY_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEPLOY_LOG="$DEPLOY_LOG_DIR/$DEPLOY_STAMP.log"
DEPLOY_TRACE="$DEPLOY_LOG_DIR/$DEPLOY_STAMP.trace"
ln -sfn "$DEPLOY_LOG" "$DEPLOY_LOG_DIR/latest.log"
ln -sfn "$DEPLOY_TRACE" "$DEPLOY_LOG_DIR/latest.trace"
# Keep the last 20 runs of each; a deploy log is ~20 kB.
ls -1t "$DEPLOY_LOG_DIR"/*.log   2>/dev/null | tail -n +21 | xargs -r rm -f
ls -1t "$DEPLOY_LOG_DIR"/*.trace 2>/dev/null | tail -n +21 | xargs -r rm -f

exec > >(tee -a "$DEPLOY_LOG") 2>&1
echo "==> log: $DEPLOY_LOG"

# The xtrace goes to its OWN file, not to stdout: line-numbered and timestamped,
# so a run that dies silently still records the last line it reached. Keeping it
# out of stdout keeps the ssh stream readable and keeps the two files from
# interleaving into something nobody can follow.
# (The VM runs bash 5.3. The version guard is so a Mac's bash 3.2 degrades to
# log-only instead of dying on `{fd}>` — BASH_XTRACEFD needs 4.1+.)
if [ "${BASH_VERSINFO[0]:-0}" -ge 5 ] || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 1 ]; }; then
  exec {DEPLOY_XTRACE_FD}>>"$DEPLOY_TRACE"
  export BASH_XTRACEFD="$DEPLOY_XTRACE_FD"
  PS4='+ $(date -u +%H:%M:%S) deploy.sh:${LINENO}: '
  set -x
else
  echo "==> (bash ${BASH_VERSION} is too old for BASH_XTRACEFD — no trace file)"
fi

# ---------------------------------------------------------------------------
# Keep the sudo credential alive for the whole run.
#
# ⚠️ THIS DID NOT FIX THE HANG IT WAS WRITTEN FOR. Kept because refreshing a
# credential across a >5-minute run is correct regardless, and because failing
# fast when there is no cached credential beats prompting into a closed stdin.
# But do NOT read it as the explanation for the "silent after ==> docs site"
# hang — that is still unexplained, the evidence is in
# docs/mistakes/deploy-hosting.md, and the next step is to instrument THIS
# script rather than to measure its steps standalone again.
sudo -n true 2>/dev/null || {
  echo "no cached sudo credential — the caller must run 'sudo -v' first (see skills/deploy-vm.md)" >&2
  exit 1
}
while true; do sudo -n true; sleep 45; kill -0 "$$" 2>/dev/null || exit; done &
SUDO_KEEPALIVE=$!

# The EXIT trap also writes the VERDICT into the log, and HUP/INT/TERM are
# trapped so a signal reaches it too. This is what separates the two failure
# shapes that have so far looked identical from outside: a log ending in
# "<== exit 0 …" means this script really finished the step it stopped at; a log
# with NO "<==" line at all means the process was killed outright (SIGKILL, the
# OOM killer, the ssh channel dying) and never got to speak.
# ⚠️ `BASH_LINENO` inside an EXIT trap names the trap's own call site, not the
# command that failed — it printed `deploy.sh:1`. The FAILING line has to be
# captured when it fails, which is what the ERR trap is for.
DEPLOY_FAIL_LINE=""
on_exit() {
  local rc=$?
  kill "$SUDO_KEEPALIVE" 2>/dev/null || true
  if [ "$rc" -eq 0 ]; then
    echo "<== exit 0 — ran to the end ($(date -u +%H:%M:%SZ))"
  else
    echo "<== exit $rc at deploy.sh:${DEPLOY_FAIL_LINE:-unknown} ($(date -u +%H:%M:%SZ))"
  fi
}
trap 'DEPLOY_FAIL_LINE=$LINENO' ERR
trap on_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# ---------------------------------------------------------------------------
# publish() — add the new build WITHOUT yanking the old one out from under
# browsers that are still running it.
#
# A plain `rsync -a --delete dist/ <root>/` deletes the previous build's hashed
# chunks the instant the new ones land. Any tab that was already open then 404s
# the moment it fetches something lazily — this app really does that
# (`await import('./esign.js')` in projects/inbox.js, `./qr.js` in shop/admin.js)
# — and the app breaks with no obvious cause. Observed live 2026-07-30: a user
# mid-session reported "the web is down" ~12 minutes after a deploy, and it
# "came back" when they reloaded. src/js/build-check.js cannot rescue that case,
# because it only runs at PAGE LOAD and the tab in question never reloaded.
#
# So: assets are additive (hashed filenames never collide, so keeping the old
# ones is free and correct), everything else is mirrored with --delete. Old
# assets are pruned after a grace period long enough that no live tab is still
# holding them.
#
# NOTE `--exclude=assets/` also protects those files from --delete; rsync only
# removes excluded files if you additionally pass --delete-excluded.
ASSET_GRACE_DAYS=7
# Extra args after the two positional ones are passed to the MIRROR rsync only
# (the assets pass copies $src/assets/ and can never see a sibling directory).
publish() {
  local src="$1" root="$2"; shift 2
  sudo mkdir -p "$root/assets"
  sudo rsync -a "$src/assets/" "$root/assets/"                 # additive: keep old chunks
  sudo rsync -a --delete --exclude=assets/ "$@" "$src/" "$root/"   # mirror the rest
  sudo find "$root/assets" -type f -mtime +$ASSET_GRACE_DAYS -delete
}

echo "==> samomdkkuweb + passport: pull + build (one repo, one install)"
cd "$WEB_DIR"
git pull --ff-only
npm ci
# `npm run build` runs BOTH vite passes: the main app into dist/, then passport
# into dist/passport/ at base '/passport/' (passport/vite.config.js). No second
# clone, no second npm ci, no PASSPORT_BASE to remember.
npm run build

# Publish to the two nginx roots, unchanged — nginx still serves / from
# samo-web and /passport/ from passport, so the live layout is identical.
# ⚠️ --exclude=passport/ is LOAD-BEARING, not tidiness. dist/ CONTAINS
# dist/passport/ now. Without the exclude every passport file is ALSO mirrored
# into /var/www/samo-web/passport/ — and that breaks an assumption nginx-samo.conf
# states in writing: its `location = /passport { return 301 /passport/; }` exists
# because "there's no passport dir under /var/www/samo-web to trigger" nginx's
# own automatic directory redirect. Create one and that reasoning silently stops
# holding, on top of shipping a full second copy nothing serves.
publish dist /var/www/samo-web --exclude=passport/
publish dist/passport /var/www/passport

if [ ! -f /var/www/passport/index.html ]; then
  echo "!! /var/www/passport/index.html missing after publish — passport did not build" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The docs site, served at samo.md.kku.ac.th/docs.
#
# Same shape as the passport build above: one repo, a second build with a
# different base. GitHub Actions publishes the SAME docs to GitHub Pages with
# the default base — that copy is the backup, and the reason this VM is not a
# single point of failure for the documentation.
#
# THE DEPLOY IS THE ONLY TRIGGER, deliberately. A pull-based timer was built and
# then removed on 2026-08-31: the owner does not need /docs to update between
# deploys, so it was machinery bought with an argument nobody was making. One
# publishing mechanism beats two.
#
# ⚠️ WHAT THAT COSTS, so nobody is surprised by it: GitHub Pages republishes in
# ~40 s on any push to docs/, this copy waits for a deploy. The two can
# therefore disagree, with /docs being the OLDER one. If that ever matters, the
# fix is a webhook (this host is publicly reachable) rather than polling.
echo "==> docs site: build with base /docs/"
cd "$WEB_DIR"
DOCS_BASE=/docs/ npm run docs:build
publish docs/.vitepress/dist /var/www/docs

echo "==> fix permissions"
# Uniform again now that only this script writes /var/www/docs. It was briefly
# ubuntu:www-data so a timer running as `ubuntu` could rsync into it; that timer
# is gone, so the special case went with it rather than lingering as a rule with
# no reason — which is how a config grows things nobody dares touch.
sudo chown -R www-data:www-data /var/www/samo-web /var/www/passport /var/www/docs

echo "==> restart notify service + reload nginx"
sudo systemctl restart samo-notify || echo "  (samo-notify not installed yet — see docs/SELF-HOST.md)"
sudo nginx -t && sudo systemctl reload nginx

echo "==> discord sync: refresh + restart, ONLY if already enabled"
# ⛔ A deploy never ARMS a service (docs/mistakes/deploy-hosting.md, the night
# agent): if the owner switched the sync off, it stays off. When it is on, the
# unit file is refreshed from the repo (its allow-list of power keys lives there)
# and the process restarted onto the new code.
if systemctl is-enabled --quiet samo-discord-sync 2>/dev/null; then
  if ! cmp -s "$WEB_DIR/server/samo-discord-sync.service" /etc/systemd/system/samo-discord-sync.service; then
    sudo cp "$WEB_DIR/server/samo-discord-sync.service" /etc/systemd/system/samo-discord-sync.service
    sudo systemctl daemon-reload
    echo "  unit file refreshed"
  fi
  sudo systemctl restart samo-discord-sync || echo "  ⚠️ samo-discord-sync failed to restart — journalctl -u samo-discord-sync"
else
  echo "  (samo-discord-sync not enabled — left off; install: header of server/samo-discord-sync.service)"
fi

echo "==> done. Smoke test:"
echo "    curl -sk https://127.0.0.1/build.json"
echo "    curl -sk https://127.0.0.1/notify   # {\"ok\":true,...}"
