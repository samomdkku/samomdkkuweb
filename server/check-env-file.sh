#!/bin/bash
# check-env-file.sh — is a secret env file on the VM well-formed?
#
# ⛔ THIS SCRIPT CANNOT PRINT FILE CONTENT, BY CONSTRUCTION. That is its whole
# design, and it is not caution — it is a bug that was already paid for. On
# 2026-09-12 an ad-hoc inspector masked secrets with `sed 's/=.*/=<redacted>/'`
# and printed a bot token into a chat transcript, because the file's DEFECT was
# a bare value with no `=`, so the substitution matched nothing and passed the
# line straight through. The masking was conditional on the file being
# well-formed, and the reason to run it was that it might not be.
#
# So there is no code path below that echoes a line. Only derived facts:
# lengths, counts, booleans. Test any change to this file against a MALFORMED
# input, never a healthy one (docs/mistakes/tooling-proofs.md).
#
#   sudo bash server/check-env-file.sh /etc/samo-discord-bot.env DISCORD_TOKEN
set -u
f=${1:?usage: check-env-file.sh <file> <EXPECTED_KEY>}
key=${2:?usage: check-env-file.sh <file> <EXPECTED_KEY>}

[ -f "$f" ] || { echo "MISSING: $f does not exist"; exit 1; }
[ -r "$f" ] || { echo "UNREADABLE: run with sudo"; exit 1; }

echo "file:        $f"
echo "mode/owner:  $(stat -c '%a %U:%G' "$f")   (want 600 root:root)"

n=0; good=0; blank=0; other=0; crs=0
while IFS= read -r line || [ -n "$line" ]; do
  n=$((n+1))
  case "$line" in *$'\r') crs=$((crs+1));; esac
  if [ -z "${line//[[:space:]]/}" ]; then blank=$((blank+1)); continue; fi
  case "$line" in
    "$key"=*) good=$((good+1)); echo "line $n: $key= present, value length ${#line}"  ;;
    \#*)      : ;;
    *=*)      other=$((other+1)); echo "line $n: a DIFFERENT key (length ${#line})" ;;
    *)        other=$((other+1)); echo "line $n: NOT key=value — a bare value? (length ${#line})" ;;
  esac
done < "$f"

echo "summary:     $n line(s), $good matching '$key=', $blank blank, $other unusable"
[ "$crs" -gt 0 ] && echo "⚠️  $crs line(s) end in CR — pasted through Windows/a terminal that added \\r"
if [ "$good" -eq 1 ] && [ "$other" -eq 0 ]; then
  echo "✓ WELL-FORMED — systemd EnvironmentFile= will set $key"
else
  echo "✗ BROKEN — systemd will NOT set $key. It must be exactly one line: $key=<value>"
  exit 1
fi
