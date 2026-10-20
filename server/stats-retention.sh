#!/usr/bin/env bash
# Weekly retention run: prune_analytics(), prune_claude_usage_samples() and
# prune_notify_log() — three functions that already existed (0065, 0231, 0055)
# but were never SCHEDULED (docs/YEAR-ROLLOVER.md § Stats). pg_cron is NOT
# installed on this project (STATE.md, 2026-10-18), so this is the VM systemd
# timer alternative — same pattern and same credential as
# server/supabase-backup.sh (SUPABASE_DB_URL, the Postgres superuser: these
# three functions are `security definer` and REVOKED from anon/authenticated/
# public on purpose, so a plain PostgREST call — even with service_role —
# cannot run them; only a direct psql connection can).
#
# WRITTEN, NEVER RUN. This night agent has no VM access and no production
# SUPABASE_DB_URL — see skills/backup-and-export.md for why, and the
# IPv6/pooler note in server/supabase-backup.sh's own header (the same
# question applies here, unanswered for the same reason). Install and
# first-run verification is the owner's job.
#
# Each function already proves its own correctness (tools/stats0231-
# retention.sql) — this script's only job is to call them and fail loudly if
# any one of them raises, same discipline as supabase-backup.sh: exit
# non-zero on ANY failure so a systemd timer surfaces it as a FAILED unit
# instead of a silent partial run.
set -Eeuo pipefail

DB_URL=${SUPABASE_DB_URL:-}
ANALYTICS_RETAIN_DAYS=${ANALYTICS_RETAIN_DAYS:-90}
CLAUDE_RETAIN_WEEKS=${CLAUDE_RETAIN_WEEKS:-8}
NOTIFY_LOG_RETAIN_DAYS=${NOTIFY_LOG_RETAIN_DAYS:-30}

die() { echo "!! $*" >&2; exit 1; }

[ -n "$DB_URL" ] || die "SUPABASE_DB_URL not set (see /etc/stats-retention.env)"
command -v psql >/dev/null || die "psql not installed"

run() {
  local label=$1 sql=$2
  echo "==> $label"
  local out
  out=$(psql "$DB_URL" -X -q -t -A -v ON_ERROR_STOP=1 -c "$sql") \
    || die "$label failed — see psql's own error above"
  echo "    removed: ${out//[[:space:]]/}"
}

run "prune_analytics($ANALYTICS_RETAIN_DAYS)" \
  "select public.prune_analytics($ANALYTICS_RETAIN_DAYS);"
run "prune_claude_usage_samples($CLAUDE_RETAIN_WEEKS)" \
  "select public.prune_claude_usage_samples($CLAUDE_RETAIN_WEEKS);"
run "prune_notify_log($NOTIFY_LOG_RETAIN_DAYS)" \
  "select public.prune_notify_log($NOTIFY_LOG_RETAIN_DAYS);"

echo "==> OK $(date -u +%Y%m%dT%H%M%SZ)"
