#!/usr/bin/env bash
# Invite people to the SAMO vault, in bulk, from your own machine.
#
#   ./server/vaultwarden/invite.sh somchai@kkumail.com nattaya@kkumail.com
#   ./server/vaultwarden/invite.sh --file team.txt        # one address per line
#
# WHAT THIS DOES: creates the account and sends the invitation email. Any domain
# works — an admin invite bypasses SIGNUPS_DOMAINS_WHITELIST by design, which is
# how the @gmail.com role accounts get in.
#
# WHAT IT DOES NOT DO: put anyone in a collection. Deciding who sees Infra
# versus Team is the one step that should stay a human decision, so it is left
# in the web vault: Members -> the person -> Collections.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

if [ "${1:-}" = "--file" ]; then
  [ -f "${2:-}" ] || { echo "!! no such file: ${2:-}" >&2; exit 1; }
  EMAILS=$(grep -vE '^\s*(#|$)' "$2" | tr -d '[:space:]' | paste -sd, -)
else
  [ $# -gt 0 ] || { echo "usage: $0 <email> [email...]   |   $0 --file <list>" >&2; exit 1; }
  EMAILS=$(printf '%s,' "$@" | sed 's/,$//')
fi

[ -f .env.local ] || { echo "!! run from the repo root; .env.local not found" >&2; exit 1; }
SUDO_PW=$(grep -m1 '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
[ -n "$SUDO_PW" ] || { echo "!! SAMO_VM_SUDO_PASSWORD missing from .env.local" >&2; exit 1; }

echo "Inviting:"
printf '  %s\n' "${EMAILS//,/$'\n  '}"
read -rp "proceed? [y/N] " ok
case "$ok" in y|Y) ;; *) echo "aborted"; exit 1;; esac
echo

RP=/tmp/vw-invite-$$.sh
scp -q server/vaultwarden/_invite-remote.sh "samo-vm:$RP"
printf '%s\n%s\n' "$SUDO_PW" "$EMAILS" | ssh samo-vm "bash $RP; rc=\$?; rm -f $RP; exit \$rc"

echo
echo "Next, in the web vault — this part is deliberately manual:"
echo "  https://samo.md.kku.ac.th/vault/  ->  samomdkku  ->  Members"
echo "  1. Confirm each person once they have set their master password"
echo "  2. Give each one their collections (Infra / Dev / Team)"
echo
echo "     Infra = the VM, the database, this vault's own admin password."
echo "             1-3 people, never a whole department."
echo "     Dev   = the samo-dev credentials anyone writing code needs."
echo "     Team  = the shared logins most of SAMO uses."
echo
echo "  Full guide: docs/start/vault.md"
