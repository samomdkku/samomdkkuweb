#!/usr/bin/env bash
# Nightly whole-database backup of the live Supabase Postgres project.
#
# WHY THIS EXISTS, SEPARATE FROM year-export.mjs. The per-year export
# (tools/year-export.mjs) is an APPLICATION-level artifact: one system, one
# year, the columns an admin screen already shows. It cannot answer "what did
# the ENTIRE database look like last Tuesday" — a row in a table this queue
# never touched, a policy, a trigger body, all vanish from that view. This
# script is the OTHER half docs/YEAR-ROLLOVER.md § Backup names: Supabase's
# own point-in-time recovery (unconfirmed whether it is enabled on this
# project's tier) restores the WHOLE database to an instant; this is the
# OFFLINE copy that survives even if the Supabase project itself is deleted,
# same reason server/vaultwarden/backup.sh exists for the vault.
#
# SAME DISCIPLINE AS server/vaultwarden/backup.sh, on purpose — read that
# file's header before changing this one:
#   1. verify the COPY, not a hope ("a backup you have never restored is a
#      hypothesis");
#   2. a structurally valid but EMPTY dump passes a naive check, so assert
#      content, not just "pg_dump exited 0";
#   3. exit non-zero on ANY failure, so a systemd timer surfaces it as a
#      FAILED unit instead of a silent success;
#   4. never prune the OLD backups until the NEW one is verified.
#
# ⚠️ WRITTEN, NEVER RUN. This night agent has no SUPABASE_DB_URL (only a
# samo-dev Management-API PAT, which cannot run pg_dump — see
# skills/build-the-dev-database.md) and no access to the VM. Install and
# first-run verification is the owner's job; see skills/backup-and-export.md.
#
# ⚠️ THE IPv6 QUESTION — DECIDED HERE, NOT TESTED HERE. `SUPABASE_DB_URL`'s
# direct host (`db.<ref>.supabase.co`) is IPv6-ONLY (confirmed by
# skills/build-the-dev-database.md running from a machine WITH IPv6 egress).
# Whether the KKU VM has IPv6 egress is UNKNOWN — nobody has run `curl -6` or
# `dig AAAA` from it in this queue. Decision: this script tries the DIRECT
# host first (it is the simpler, already-working path on any network that
# has IPv6), and if that fails, the installer should switch
# SUPABASE_DB_URL in /etc/supabase-backup.env to Supabase's SESSION POOLER
# connection string instead (dashboard → Project Settings → Database →
# Connection pooling → "Session mode", which listens on IPv4 by design — this
# is Supabase's own documented answer to an IPv4-only network, not a
# workaround invented here). skills/build-the-dev-database.md records ONE
# earlier pooler attempt failing with "tenant/user not found" against
# `aws-0-ap-southeast-1.pooler.supabase.com` — that region string may simply
# be wrong for THIS project (the error is a username/tenant lookup failure,
# not a connection-refused), so it is not evidence the pooler mechanism
# itself does not work. Whoever installs this must run the verification
# command in skills/backup-and-export.md and record which path worked.
set -Eeuo pipefail

DB_URL=${SUPABASE_DB_URL:-}
DEST_DIR=${BACKUP_DIR:-/var/backups/supabase}
KEEP=${BACKUP_KEEP:-14}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

die() { echo "!! $*" >&2; exit 1; }

[ -n "$DB_URL" ] || die "SUPABASE_DB_URL not set (see /etc/supabase-backup.env)"
command -v pg_dump >/dev/null || die "pg_dump not installed — see skills/build-the-dev-database.md for the libpq-keg-only trap"
mkdir -p "$DEST_DIR"

echo "==> dump (custom format, --no-owner — this is a DIFFERENT PROJECT'S restore target, never this one in place)"
DUMP="$WORK/samo-db.dump"
pg_dump "$DB_URL" --no-owner --format=custom --file="$DUMP" \
  || die "pg_dump failed — if this is a connection error on an IPv6-only network, see this script's header"

# Verify the COPY. `pg_restore --list` reads the dump's table of contents
# without touching any database — the equivalent of vaultwarden's
# `PRAGMA integrity_check` for a custom-format pg_dump archive.
echo "==> verify the dump is readable and not empty"
TOC=$(pg_restore --list "$DUMP" 2>&1) || die "pg_restore --list could not read the dump: $TOC"
TABLE_COUNT=$(printf '%s\n' "$TOC" | grep -c '^[0-9]\+; .* TABLE ' || true)
[ "$TABLE_COUNT" -ge 50 ] || die "dump lists only $TABLE_COUNT table(s) — this project has 200+ migrations behind it; a near-empty dump is a bad connection string, not a clean database"
echo "    $TABLE_COUNT table(s) in the dump's table of contents"

ARCHIVE="$DEST_DIR/samo-db-$STAMP.dump"
cp "$DUMP" "$ARCHIVE"
chmod 600 "$ARCHIVE"

echo "==> re-verify the file that actually landed on disk (not the temp copy)"
pg_restore --list "$ARCHIVE" >/dev/null || die "the archived copy is unreadable: $ARCHIVE"
size=$(stat -c %s "$ARCHIVE")
[ "$size" -ge 4096 ] || die "archive suspiciously small: $size bytes"
echo "    $ARCHIVE ($(numfmt --to=iec "$size"))"

echo "==> rotate (keep $KEEP)"
ls -1t "$DEST_DIR"/samo-db-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) \
  | while read -r old; do echo "    rm $old"; rm -f "$old"; done

echo "==> OK $STAMP"
