# Merge checklist

> Steps for merging `refactor/modular` into `main`

> ## ⚠️ HISTORICAL. This merge happened.
>
> Status added 2026-08-12. `origin/refactor/modular` still EXISTS as a ref but is
> no longer used for anything — `main` is the only live branch, and the
> maintainer commits to it directly. Do not restart the two-branch flow because
> the ref is still there. The "only system in active campus use" line below is also out of
> date: SAMO Shop, ระบบบ้าน, ทีม SAMO and หนังสือโครงการ are all live now.
>
> Kept because the data-safety sequencing is a good model for the next big
> cutover. Not a checklist anyone should be working through today.

Goal: ship the refactor to production **without losing or contradicting
PR data**, which is the only system in active campus use right now.
Announcements and VitalSound have low-to-zero live volume.

## TL;DR — safe path

The refactor branch is **mostly backwards-compatible at the data
schema level**. The risky things are:

1. **Staff credentials changed** (frontend + backend).
2. **GAS URLs in `config.js` point at DEV deployments**, not prod.
3. **`Announcements` sheet got a new column 7** (thumbnail).

Don't merge until you've handled all three.

---

## Step 0 — Snapshot prod data

Before doing anything, take a copy:

- In the PR `Submissions` Google Sheet: File → Make a copy →
  rename `Submissions backup YYYY-MM-DD`.
- Same for `Announcements` sheet and the VS `Tickets` sheet.

This is your rollback. Don't skip this.

## Step 1 — Decide on staff credentials in prod

The refactor uses `samomdkkupr` / `samomdkkuvssound` / `samomdkkudev`.
Prod GAS has `prsamomdkku` (PR) and `samomdkku69` (VS) — different.

Options:

- **(A) Update prod GAS** to match refactor (recommended). After this,
  the existing staff need to be told the new login is
  `samomdkkupr` + `«disabled 2026-08-17»`.
- **(B) Update refactor frontend** to match prod creds, then merge.
  Set `STAFF_ACCOUNTS` in `src/js/auth.js` to the prod usernames; also
  update `handleVerifyPRStaffLogin` in `appscript/prform.gs` and
  `verifyStaffLogin` in `appscript/vssound.gs` to match.

Whichever you pick, the **frontend `STAFF_ACCOUNTS` keys and the
backend hardcoded strings must agree** — otherwise staff can't log in.

## Step 2 — Point `config.js` at prod GAS

⛔ **THIS STEP NO LONGER APPLIES — and both URLs it printed were wrong by
2026-09-10.** It described `config.js` as holding the DEV `/exec` URLs with prod
in a comment, which stopped being true long ago: the file exports one live
`GAS_API_URL` and nothing else. Checked 2026-09-10:

* the `GAS_API_URL` written here (`AKfycbw1iHE4ALCO…`) is **not** the endpoint
  the app calls (`AKfycbwomKii…`), and
* `GAS_VITAL_SOUND_URL` does not exist — `vssound.gs` was deleted when Discord
  moved to the `/notify` service, and the name has **0** references in `src/`.

**There is nothing to switch, so do not switch anything.** Read the live value
from its one home when you need it:

```bash
grep -A2 'export const GAS_API_URL' src/js/config.js
```

Kept rather than deleted because a checklist step that vanishes looks like one
somebody forgot. A copied URL is a decaying fact with a second home, and this is
the third place that bit: `skills/deploy-gas.md` printed the same stale URL.

Better long-term: wire `import.meta.env.VITE_GAS_API_URL` with the
production URLs configured per-environment in the Cloudflare Pages
dashboard, then this file never needs editing again. The 30-line change
is in `config.js` — say the word and it gets done.

## Step 3 — Deploy backend changes to prod GAS

Open `appscript/prform.gs` and `appscript/vssound.gs` in this repo,
copy each function that changed into the **prod** Apps Script editor
(not dev), then **Deploy → Manage deployments → Edit → New version**.
The prod `/exec` URLs stay the same.

Changes that need to land in prod GAS:

### `prform.gs`
- `handleVerifyPRStaffLogin` — staff cred per Step 1.
- `handleAddAnnouncement` + `handleEditAnnouncement` + `doGet
  getAnnouncements` — thumbnail column 7. **Backwards-compatible:**
  legacy rows just have no thumbnail; new rows write to col 7.
- `handlePRSubmission` — gated Discord call (`data.skipDiscord` short-
  circuits). Backwards-compatible: prod gets the gate but old clients
  never set the field, so behavior is identical.

### `vssound.gs`
- `verifyStaffLogin` — staff cred per Step 1.
- `handleVitalSoundSubmit` — gated Discord call. Same backwards-compat
  story as PR.
- `getUserHistory` — `trustClient` flag changes the empty-result wording
  but the success path is unchanged. Backwards-compatible.

### Announcements sheet
Add a header for column G manually: `Thumbnail`. The GAS will write to
G regardless, but a labeled header keeps the data readable.

## Step 4 — Verify PR data won't contradict

The refactor's PR submit path writes the **same columns** to the same
sheet schema. New fields, all in existing columns:

- `submitterEmail` (col 18) — previously held Google emails or "Guest".
  Now also holds `@<username>` strings for password users. Old rows
  unaffected; new rows just have a different identifier format. No
  contradiction; the value is treated as opaque.
- Status/dates/everything else: identical.

PR staff dashboard (read side): the kanban renderer buckets tickets by
status. Statuses not in the canonical list bucket into "รอ PR รับเรื่อง"
via the substring fallback in `pr-staff.js`. Old prod tickets with
arbitrary status strings (if any) won't break — they get a column.

**Conclusion:** PR data is safe. Old tickets readable, new tickets
written in compatible format.

## Step 5 — Verify announcement data

Refactor reads `post.thumbnail` and falls back to first content image
(existing behavior) when missing. Old announcements with no col 7
render unchanged.

**Conclusion:** Announcement data is safe.

## Step 6 — Verify VS data

The refactor's VS submit writes `vsUsername` + `vsPassword` for both
auth methods. Old prod rows with explicit username/password still work
in `getUserHistory`. **Caveat:** existing VS users who registered
under prod's `mode=create` flow and never submitted a ticket won't
appear; this was already true in prod.

**Conclusion:** VS data is safe; user experience for not-yet-submitted
users isn't worse than today.

## Step 7 — Test on Cloudflare Pages preview

Cloudflare auto-deploys every branch. Before merging:

1. Open the preview URL for `refactor/modular` (formed from the branch
   name in the Cloudflare dashboard).
2. With Step 2's prod URLs still pointing at **dev** GAS, smoke-test
   every flow: PR submit (then check the dev sheet), PR track, sign in
   as each staff role, kanban filter, announcement create/edit.
3. **Optional rehearsal**: temporarily set Cloudflare preview env vars
   to point at the **prod** GAS, smoke-test against real data, then
   flip back to dev. (No code changes needed.)

## Step 8 — Merge

```bash
# Make sure config.js points at prod URLs (Step 2)
# Make sure prod GAS has the new code deployed (Step 3)
git checkout main
git pull origin main
git merge --no-ff refactor/modular -m "merge: refactor/modular into main"
git push origin main
```

Cloudflare Pages auto-deploys `main` to production within ~60s.

## Step 9 — Watch for ~24h

- Check the PR Discord webhook is still firing for real submissions
  (the most visible failure mode).
- Spot-check the `Submissions` sheet a few times — does the new column
  format look right? Are timestamps correct?
- If a staff member can't log in, they're hitting the credentials
  change from Step 1 — communicate the new login.

## Rollback

If the merge breaks something critical:

```bash
git checkout main
git revert -m 1 <merge-commit-sha>
git push origin main
```

Cloudflare re-deploys the previous version. **GAS changes don't auto-
roll back** — manually revert the Apps Script deployments to the prior
version via Deploy → Manage deployments → Archive newest.

## What this checklist does NOT cover

- Migrating to Supabase. See `SUPABASE-MIGRATION.md`.
- Unifying the user data model. See `AUTH-MODEL.md`.
- Adding RLS / proper auth. Both above.
