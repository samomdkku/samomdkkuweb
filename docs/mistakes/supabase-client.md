# Mistakes — supabase-js, PostgREST & the session lifecycle

The client library and auth-session edges. **Read before touching `src/js/auth.js` or `src/js/db.js`** — these are the sharp ones.

Each entry: **Symptom → Cause → Fix → Where it lives now**. The always-loaded index of every entry across all nine files is `.claude/rules/mistakes.md`; add new entries here, then run `npm run mistakes:index`.

---

## Supabase Realtime in this app: token goes stale + RLS-gated events silently vanish (autoRefreshToken is OFF), and re-rendering on a remote event cancels an in-flight drag

**Symptom**: A live-collaboration feature (SAMO Team org tree) works for the
first ~hour, then remote edits stop arriving for long-lived tabs — no error.
Separately, while a user is mid-drag (SortableJS), a remote change repaints the
tree and the drag gesture dies.
**Cause**: Two coupled gotchas.
1. `src/js/db.js` creates the supabase-js client with `autoRefreshToken: false`
   (deliberate — see the autoRefresh-stall entry). The Realtime websocket
   authenticates with whatever JWT it had at `subscribe()` time and does NOT
   refresh it. After the ~1h TTL, reconnects present a stale token; Realtime
   re-checks RLS per subscriber, so `postgres_changes` events the user is no
   longer authorized for (stale token → null role) are silently dropped.
2. A full re-render (`innerHTML` rebuild) triggered by an incoming Realtime
   event while SortableJS is mid-gesture removes the dragged node from the DOM,
   cancelling the drag.
**Fix**:
- Re-push the token on an interval: `setInterval(() => db.realtime.setAuth(
  currentAccessToken()), 20*60*1000)` (and once before subscribe). Export
  `currentAccessToken()` from `db.js`. dbRest already keeps the stored token
  fresh on writes, so this just forwards it to the socket.
- Guard renders: set a `dragging` flag on SortableJS `onStart`, clear it at the
  top of `onEnd`; remote-change handler buffers (`pendingRender`) instead of
  rendering while `dragging`, and debounces bursts (~120ms).
- Also normalize realtime row payloads: a Postgres `text[]` column can arrive
  as the array LITERAL string `"{pr,vs}"` (not a JS array) on some realtime
  versions — coerce before use.
**Where**: `src/js/team/realtime.js` (`setAuth` interval),
`src/js/team/index.js` (`dragging`/`pendingRender`/`scheduleRemoteRender`,
`normalizeNodeRow`), `src/js/db.js` (`export function currentAccessToken`).
Realtime needs the table in the `supabase_realtime` publication +
`replica identity full` (migration 0048) or events never fire at all. Apply the
same pattern to any future Realtime subscription in this app.

---

---

## supabase-js `onAuthStateChange` deadlocks every subsequent call

**Symptom**: After signing in, the next ~1 supabase call works. The one after
that hangs forever. User refresh fixes it. Repeats every login.
**Cause**: Known supabase-js bug (auth-js #762, ~2yr old). Any **async call to
supabase** inside the `onAuthStateChange` callback acquires the GoTrue session
lock and never releases it from the next caller's perspective. Subsequent
supabase calls queue forever.
**Fix**: Wrap the work in `setTimeout(() => { ... }, 0)` so it runs on the
next macrotask, after the auth callback has released its lock.
**Where**: `src/js/auth.js` `initAuth()`. **Do not remove the setTimeout.**

```js
db.auth.onAuthStateChange((_event, session) => {
  setTimeout(async () => {
    currentUser = await buildCurrentUser(session);  // ← this is a supabase call
    notify();
  }, 0);
});
```

Reference: <https://github.com/supabase/auth-js/issues/762>

---

---

## supabase-js autoRefreshToken can stall, blocking subsequent requests

**Symptom**: Second form submit hangs 30s, times out. Reproduces ~hourly
(token TTL).
**Cause**: When the JWT nears expiry, supabase-js fires an inline refresh
before the next request. If that refresh stalls (network blip, Supabase
slowness), every queued request waits.
**Fix**: Disable `autoRefreshToken` in the client config and call
`db.auth.refreshSession()` on a 25-min `setInterval` instead.
**Where**: `src/js/db.js`.

```js
createClient(url, anon, {
  auth: {
    persistSession: true,
    autoRefreshToken: false,   // ← do not re-enable
    detectSessionInUrl: true,
  },
});
setInterval(() => db.auth.refreshSession().catch(...), 25 * 60 * 1000);
```

---

---

## supabase-js silent-success on RLS-blocked updates / deletes

**Symptom**: User clicks "Update announcement" → success message → opens the
announcement → old content. Update silently did nothing. Same shape for
staff status updates, ticket deletes, agent roster saves, user dept set.
**Cause**: `db.from().update().eq(...)` and `.delete().eq(...)` return
`{ data: null, error: null }` when zero rows are touched (RLS blocks, id
mismatch). No error to catch.
**Fix**: Use `dbRest()` from `db.js` with `prefer: 'return=representation'`
and check `data.length`. If 0, throw a real error.
**Where it lives now**: every write that matters is on dbRest —
- `src/js/announcements.js` `publishAnnouncement()`
- `src/js/pr-staff.js` `submitPRStaffAction()` / `deletePRStaffAction()` / `saveGlobalAgents()`
- `src/js/vs-staff.js` `submitStaffAction()`
- `src/js/vs-tracking.js` `submitUserRemark()`
- `src/js/auth.js` `setDepartment()`

**Don't bring back `db.from().update/delete` for any write that matters.**
If a new write site appears, use `dbRest()` and verify `data.length > 0`.

---

---

## supabase-js gets into a bad state — bypass with `dbRest()`

**Symptom**: After one supabase-js call succeeds, the next one hangs. Even
selects, even on different tables. autoRefresh disabled, deadlock workaround
in place, still hangs.
**Cause**: Unidentified residual state in the supabase-js client.
**Fix**: For any call that has to be reliable, use the `dbRest()` helper in
`src/js/db.js` — it's raw fetch + AbortController against PostgREST, with the
same auth headers supabase-js would send.
**Where**: Use `dbRest('/table?...', { method, body, prefer })` everywhere
that previously hung. PR tracking and announcements use it now.

---

---

## Android Chrome surfaces the supabase-js "bad state" hang on the FIRST call

**Symptom**: User on Android Chrome types username + password, taps
"เข้าสู่ระบบ", spinner shows "กำลังตรวจสอบ", then quietly returns to
the original button text with no error and no closed modal. iPad /
desktop / iOS Safari all work fine with the same credentials.
**Cause**: Android Chrome triggers the same supabase-js bad-state bug
documented above, but earlier in the session than other browsers —
specifically on the first `db.from('users').select(...).eq(...)`
inside the `onAuthStateChange` callback. `db.auth.signInWithPassword`
itself resolves cleanly (so `samoPasswordSignIn`'s `finally` runs and
the button text resets), but the post-login profile fetch hangs and
`currentUser` is never populated → the auth subscriber never closes
the modal → user looks signed-out. Same pattern affects
`trackWithTicketId` / `loginToViewHistory` on Android Chrome.
**Fix**: Convert `buildCurrentUser()` in `auth.js` to use `dbRest()` for
the `public.users` row fetch. Apply the same pattern to any read on
the post-auth path.
**Where**: `src/js/auth.js` `buildCurrentUser` and `src/js/vs-tracking.js`
`trackWithTicketId` + `loginToViewHistory`. If a new auth-related
fetch is added later, default it to dbRest — supabase-js's PostgREST
client is the unreliable axis here.

---

---

## `onAuthChange` fires on every refresh — "initial-routing" logic inside it must be gated by a one-shot flag

**Symptom**: User is on the admin app at, say, `#projects/PRJ-K3X7` looking
at a specific หนังสือโครงการ. They switch to another browser tab for a
few seconds, then switch back — and the app has jumped to ภาพรวม Admin
(landing). The hash has been wiped too. The user thinks "did something
crash?", but the network is fine; the UI just re-routed itself.
**Cause**: `onAuthChange(user => { ... showAdminSide(...) })` in
`src/js/admin-main.js` fires on:
1. initial subscription,
2. token refresh (every ~25 min via our setInterval, and also when the
   tab regains focus after being backgrounded — supabase-js wakes up
   and re-validates the session),
3. any other auth state change.
Inside the callback we were unconditionally running:
```js
const rawHash = location.hash.replace(/^#/, '');
showAdminSide(SECTION_META[rawHash] ? rawHash : 'landing');
```
which has two problems on each re-fire:
- `rawHash` for a deep link is `projects/PRJ-K3X7`, not `projects`, so
  `SECTION_META[rawHash]` is undefined → falls to `'landing'`.
- Even when the hash IS exactly `#projects`, `showAdminSide` overwrote
  the hash back to `#projects`, nuking any deep-link path the projects
  module had set via its own `history.replaceState`.
**Fix**:
1. Run "initial section setup" exactly once per session. A module-scope
   `let initialSectionApplied = false` flipped to true on first signed-in
   fire prevents subsequent token refreshes from re-routing the user.
2. Hash lookup uses the FIRST SEGMENT only: `rawHash.split('/')[0]` so
   deep links like `#projects/PRJ-K3X7/doc/DOC-AB2KX` resolve to the
   projects section.
3. `showAdminSide` no longer rewrites the hash when the existing hash
   already starts with `#<section>/…` — only when the section is
   genuinely different.
**Where**: `src/js/admin-main.js` — `initialSectionApplied` flag at module
scope, the `onAuthChange` block that reads `location.hash`, and the
`history.replaceState` call inside `showAdminSide`. Any new
`onAuthChange` callback that wants to do "initial routing" must use the
same one-shot pattern — never assume the callback fires only once.

---

---

## PostgREST 400s on unknown URL query params — never cache-bust via `?_=…`

**Symptom**: After adding a `&_=Date.now()` cache buster to every dbRest
GET, the whole app breaks. News doesn't load, the staff-section
dropdown is empty, projects + shop both fail with
`{"code":"PGRST100","message":"failed to parse filter (1780199700877)"}`.
**Cause**: PostgREST treats every URL query parameter (except a small
reserved set — `select`, `order`, `limit`, `offset`, `on_conflict`,
`or`, `and`, `not`) as a horizontal filter of the form `column=op.value`.
A bare `?_=1780199700877` is parsed as a filter on column `_` with no
operator → 400. There is no "ignored param" escape hatch.
**Fix**: Use `cache: 'no-store'` on the fetch (modern Safari / Chromium
/ Firefox honour it) or a custom request header — never a query string.
PostgREST already sends `Cache-Control: no-store` on its responses so
the browser shouldn't disk-cache them in the first place. The bfcache
in-memory restore case has to be handled at the app level — see
`projects/index.js` `pageshow` reload.
**Where**: `src/js/db.js` `dbRest()`. Don't reintroduce a URL-param
cache buster for any PostgREST call. If the underlying problem is a
specific old browser ignoring `cache: 'no-store'`, add a request
header (e.g. `Cache-Control: no-cache`) or change the URL via a
*reserved* param such as `select=`, never invent a new one.

---

---

## `PGRST303 JWT expired` mid-modal when the 25-min proactive refresh misses

**Symptom**: VP-Admin opens the "สร้างโครงการใหม่" modal, types the
name + description carefully for ~hour+ on iPad (or any mobile that
backgrounds the tab between thoughts), clicks "บันทึก" — get
`{"code":"PGRST303","message":"JWT expired"}` and the create fails.
Reload + immediate retry works. Reproduces only on slow-typing /
long-idle in a modal; never on quick-fire form submits.
**Cause**: `db.js` proactively refreshes the JWT on a 25-min
`setInterval`, which is well below the 1-hour Supabase TTL. But
`setInterval` is clamped or skipped entirely on backgrounded /
throttled tabs (Safari especially), so a user who opens the modal,
the tab gets backgrounded, and they come back ~1h later, the token
expired without ever getting refreshed.
**Fix**: `dbRest()` now detects `PGRST303 JWT expired` on a 401/403
response, calls `db.auth.refreshSession()` (single-flight: concurrent
expired writes share one refresh), and retries the request once. The
proactive refresh stays — this is just the safety net.
**Where**: `src/js/db.js` `dbRest()` + `refreshAccessTokenOnce()` /
`isJwtExpiredError()`. Don't add a duplicate "refresh before every
write" path elsewhere — the dbRest retry already covers it, and an
unconditional pre-write refresh would double network round-trips on
the 99% of requests that don't need it.

---

---

## Synchronous first `onAuthChange` fire flashes the sign-in gate before the session is restored (looks like "logged out on every refresh" on slow mobile)

**Symptom**: On a phone, signing into the admin app then refreshing
shows the sign-in screen again — the user thinks the session didn't
persist and re-enters username/password. iPad / desktop are fine with
the same account.
**Cause**: `onAuthChange(cb)` invokes `cb(currentUser)` **synchronously**
on subscribe. At that instant `initAuth()` hasn't awaited
`db.auth.getSession()` yet, so `currentUser` is `null` even for a
perfectly valid persisted session. The admin boot handler treated that
null as "signed out" and called `showAuthGate()` immediately. On a fast
connection `initAuth` resolves a few ms later and `showApp()` wins, so
the gate flash is invisible. On a slow mobile network the gate lingers
long enough that the user starts typing — and a stale/expired token that
needs a (slow) network refresh makes it worse.
**Fix**: Distinguish "we don't know yet" from "confirmed signed out".
`auth.js` exports `authReady` (a promise that resolves after the first
`getSession()` settles) and `hasPersistedSession()` (checks localStorage
for `sb-<ref>-auth-token`). The boot handler now: on a null fire, if
auth hasn't settled AND a token is persisted → stay on the boot spinner
(`return`, don't show the gate); `authReady.then()` shows the gate for
real only if the restored session turns out absent/stale. A 9s safety
timeout falls through to the gate so a wedged `getSession()` can't trap
the user on the spinner forever.
**Where**: `src/js/auth.js` (`authReady`, `hasPersistedSession`,
`markAuthReady` after the first `notify()`); `src/js/admin-main.js`
(`authSettled` flag, the null-branch boot-stay, the `authReady.then`
settle handler + fallback timer). Any future full-screen auth gate must
gate on `authReady` / `hasPersistedSession`, never on the first
synchronous `onAuthChange(null)`.

---

---

## Hardcoded reserved-username lists rot when new staff accounts are added

**Symptom**: Registration form lets a public visitor try
`samomdkkuradiology` (or any of the 9 VP usernames added in 0010/0011).
Backend uniqueness on `public.users.username` returns
"Username นี้มีผู้ใช้งานแล้ว" — but only IF the VP auth user has already
been seeded. If not, the visitor squats the name and the admin can't
seed the legitimate account.
**Cause**: `auth.js registerWithPassword` had a literal list of 6 reserved
usernames. Every time a new `samomdkku*` staff account is added (per-VP,
new dept, future role) the list goes out of date. `reserved_staff_usernames`
is reference-only (0011 itself comments "not load-bearing"), so the only
defence is the username unique constraint *if* the row exists.
**Fix**: Use a prefix check — `/^samomdkku/.test(lc) || lc === 'sastaff'`.
The repo's convention is that ALL staff accounts share the `samomdkku`
prefix; literal lists shouldn't be added.
**Where**: `src/js/auth.js` `registerWithPassword`. Don't reintroduce
the literal list. If a future non-prefix staff username is needed,
extend the regex / OR clause — don't fall back to literals.

---

---

## Synthetic email domain must be a real public TLD

**Symptom**: Registration fails with `Email address "x@samomdkku.local" is invalid`.
**Cause**: Supabase Auth rejects RFC 6762 reserved TLDs (`.local`, `.localhost`).
**Fix**: Use `samomdkku.app` (real public TLD; we don't actually own it but
the format passes validation; no mail delivers).
**Where**: `src/js/auth.js` `PASSWORD_EMAIL_DOMAIN` and
`supabase/migrations/0002_seed_staff_accounts.sql`. Do not switch back.

---

---

## Email confirmation must be OFF in Supabase for synthetic emails

**Symptom**: Registration hits `Email rate limit exceeded` after 3 attempts.
**Cause**: Supabase tries to send a confirmation email to `@samomdkku.app`
which doesn't deliver. Each attempt counts toward the rate limit (3/hour
on free tier built-in SMTP).
**Fix**: Supabase Dashboard → Authentication → Providers → Email →
toggle off "Confirm email". Synthetic emails don't need confirmation; Google
users come in via OAuth which is already verified.

**This applies to the profile email-add flow too — DO NOT flip "Confirm
email" ON to "make magic-link verification work".** The toggle is
project-wide, not per-call. Turning it ON would re-break signup at the
same rate limit because every new `samomdkkuvpa@samomdkku.app`-style
account sends a bounced confirmation. With it OFF,
`db.auth.updateUser({email})` updates the email *immediately* without
a verification step — that's accepted in this app because the
ownership proof is the subsequent `linkIdentity` Google OAuth round-
trip (Supabase will only link a Google identity whose email matches
the user's auth email). Users who only want a contact email skip the
proof step; that's the design tradeoff. See `STATE.md` "Supabase
config for the profile email-add flow (0026)" for the longer write-
up and the future OTP-via-Apps-Script path if real verification is
ever needed.

---

---

## Supabase `unlinkIdentity` requires ≥2 identities — `hasPassword` is NOT the check

**Symptom**: A Google-only user adds a password via the profile modal
(`setUsernameAndPassword` → `db.auth.updateUser({password})`), then taps
"ยกเลิกการเชื่อม Google". Server responds with
`single_identity_not_deletable`. The UI had let them click because
we trusted `hasPassword=true` as the green light.
**Cause**: Supabase's docs and source are explicit: "The user must have
at least 2 identities in order to unlink an identity"
(`@supabase/auth-js` GoTrueClient.js, error code
`single_identity_not_deletable`). `db.auth.updateUser({password})`
sets `auth.users.encrypted_password` but does NOT reliably create an
`email`-provider identity row. So a Google-only-then-password user
can have `hasPassword=true` while `auth.identities = [google]` — one
row. Unlinking that row is refused.
**Fix**: Gate unlink UI on both (a) `hasPassword` for the UX rule
("they still have a way in"), AND (b) `identities.length >= 2` for the
Supabase rule. Surface a specific Thai message on the server error
code so the user knows it's not a bug in their click.
**Where**: `src/js/auth.js unlinkGoogleIdentity` + `src/js/profile.js`
repaint of `#profileUnlinkGoogleBtn`. Don't ship a new "unlink"
flow without checking the post-unlink identity count.

---

---

## supabase-js `updateUser({password})` doesn't create an `email` identity

**Symptom**: A Google-only user opens the profile modal, sets a
username + password, hits Save, success. They close + reopen the
modal — the "Set password" form is still there. They try again,
same result. Confused.
**Cause**: `db.auth.updateUser({password})` writes
`auth.users.encrypted_password` but does NOT add an `email`-provider
identity row in `auth.identities`. So the
"check `authUser.identities` for `provider === 'email'`" heuristic
keeps returning `false` forever even though signInWithPassword
would now work for them.
**Fix**: Don't read "has password" off the identities array. Mirror
`auth.users.encrypted_password is not null` into
`public.users.has_password` via an AFTER-UPDATE trigger
(migration 0027), then read that column on the normal profile fetch.
The identity-array heuristic stays as a pre-0027 fallback.
**Where**: `supabase/migrations/0027_username_case_and_has_password.sql`
+ `src/js/auth.js buildCurrentUser`. The same `has_password` column
also lets the privilege-escalation guard (0028) treat
`has_password` as server-only.

---

---

## Account-switcher: capturing the OUTGOING session's tokens fire-and-forget races the session swap → first switch-back forces a password re-login

**Symptom**: Signed in as VPA, switch to dev (works), then tap back to
VPA → forced to re-enter VPA username/password. Every *subsequent*
switch (dev↔vpa, to other accounts) then works. Only the FIRST
switch-back to a given account fails.
**Cause**: `pickAccount()` snapshotted the outgoing account with
`rememberAccount(getUser())` (whose token capture is a fire-and-forget
`getCurrentSessionTokens().then(write)`), then `await sleep(80)`, then
`setAuthSession(targetTokens)`. The 80ms was a *hope* that the capture
flushed first. When it didn't, `getSession()` resolved AFTER the session
was already swapped to the target — so the **target's** tokens got
written onto the **outgoing** account's saved entry. Worse, those target
tokens were the pre-swap refresh_token, which `setAuthSession` had just
**rotated** (supabase refresh tokens are single-use) — so they were
already dead. Switching back replayed that dead token → `setAuthSession`
returns null → `clearSavedTokens` → password path. The re-login then
saved fresh, correct tokens, so every later switch worked.
**Fix**: Capture the outgoing tokens *synchronously awaited* while the
live session is still that account, BEFORE the swap. Split
`rememberAccount` into `writeAccountEntry()` (sync identity row) +
`stitchCurrentTokens(key)` (awaitable token capture); add
`rememberAccountAwait()` and call `await rememberAccountAwait(getUser())`
in `pickAccount` (dropping the 80ms sleep). The normal sign-in subscriber
path keeps the fire-and-forget `rememberAccount` (no swap racing it).
**Where**: `src/js/account-switch.js`. Never capture a session's tokens
fire-and-forget when the very next step replaces that session — the read
will race the write and snapshot the wrong (and already-rotated) tokens.

---

---

## (Passport repo) Forcing Google OAuth `hd=<workspace-domain>` redirects to the domain's SAML IdP — a broken IdP URL then hard-fails login with ERR_ADDRESS_INVALID

**Symptom**: SAMO Passport login broke — after clicking "Board Your Flight",
the browser showed `This site can't be reached` at
`https://ssonext-api.kku.ac.th/sso/SingleSignOnService/kkumail.com.m`,
`ERR_ADDRESS_INVALID`. Reproduced when signing in fresh / after logout.
**Cause**: `signInWithOAuth({ options: { queryParams: { hd: 'kkumail.com' } } })`
in `js/index.js` + `js/scanning.js` (added as a "pre-filter the Google chooser
to kkumail" UX hint). But `kkumail.com` is a Google **Workspace domain with
third-party SAML SSO** (KKU's IdP). Passing `hd` for such a domain makes Google
skip its normal chooser and redirect **straight to that domain's IdP SSO URL**,
which for KKU is malformed (`…/kkumail.com.m`) → Chrome can't navigate it →
`ERR_ADDRESS_INVALID`. `hd` is documented as only a hint, but for an SSO-federated
Workspace domain it changes the flow, not just the UI.
**Fix**: Remove `queryParams.hd` from every `signInWithOAuth` call. The normal
Google chooser routes a kkumail login through Google's own (working) SSO
handling; the real kkumail-only enforcement is the app-side gate
(`getPassportAccess` / `renderAccessBlock`), so nothing is weakened. If the
error persists with a REAL kkumail account after removing `hd`, the fault is
KKU's SSO endpoint (their infra), not our code.
**Where**: passport repo `js/index.js`, `js/scanning.js` (commit `33ddf07`).
Don't reintroduce `hd` for any OAuth call against an SSO-federated Workspace
domain — enforce the domain app-side instead.

---

## "when i login in the preview, i got {"code":400,…"Unsupported provider: provider is not enabled"}"

**Symptom.** Clicking the Google button on a preview left the app entirely and
landed the browser on a raw Supabase JSON error at
`…/auth/v1/authorize?provider=google&redirect_to=…`. Reported by the owner
2026-08-29. A contributor's first act on a preview is to sign in, so this is the
first thing anyone would hit.

**Cause.** Two separate things, and only one of them is a bug.

The configuration is expected: `external_google_enabled` is `false` on
`samo-dev` — read from the live config, and already recorded in `STATE.md` as
waiting on an OAuth client. `external_email_enabled` is `true` and
`uri_allow_list` already covers `https://*.samomdkkuweb.pages.dev/**`, so only
the provider is missing.

The bug is the handling. **`supabase.auth.signInWithOAuth()` does not validate
the provider** — it builds the `/authorize` URL and navigates. Our code checks
its returned `error`, but there is no error to check: the call succeeds, the
browser leaves, and Supabase renders the refusal. `try/catch` around it can
never see this. The only place to say anything is BEFORE the navigation.

**Fix.** Ask the public `GET /auth/v1/settings` endpoint (`external.google`)
before handing off, and refuse with a Thai sentence naming the alternative.
Two polarity rules, because both failure modes are worse than the bug:

- it **fails OPEN** — a non-ok response, a thrown fetch, or a missing key all
  mean "go ahead". A blocked sign-in beats an ugly error page, so "unknown"
  must never mean "no";
- it **does not run on production at all** (gated on `ribbonLabel()`), so the
  live site's main sign-in button gains no network dependency to improve a
  preview's wording.

**Where it lives now.** `src/js/auth.js`, guarded by
`src/js/google-provider-guard.test.js`, and explained for humans in
`skills/onboard-a-contributor.md` and `docs/TEAM-WORKFLOW.md` §3a.

⚠️ **The guard's first version was satisfied by a COMMENT.** Its
"production is untouched" assertion passed while the production bail-out was
deleted, because the identifier it searched for still appeared in a nearby
comment — the exact failure `.claude/rules/mistakes.md` already lists, committed
inside the test written to prevent a different one. It now runs
`stripComments()` first, like the other four tests that learned this.

⚠️ **AND THE FIRST WRITE-UP OF THIS ENTRY WAS WRONG ABOUT THE SECOND PATH.** A
scrutiny pass flagged `linkGoogleIdentity()` as a third unguarded route to the
same blank error page. It is not: `linkIdentity` is **not** `signInWithOAuth`.
Read from the library source (`GoTrueClient.js`), `linkIdentityOAuth` GETs
`/user/identities/authorize` with `skipBrowserRedirect: true` and only calls
`window.location.assign` **after** that request succeeds — so a disabled
provider comes back as a catchable error, and the browser never leaves.

The real defect there was different and smaller: one branch matched
`msg.includes('manual linking') || msg.includes('not enabled')`, and
`"Unsupported provider: provider is not enabled"` contains `not enabled`. So a
preview user was told to switch on **Manual linking** — a setting that was
already correct and had nothing to do with the failure. **An instruction naming
the wrong fix is worse than the raw error**: the raw one at least does not send
someone to change a production setting. Split into two branches, provider first,
guarded by order (`google-provider-guard.test.js`).

Two lessons from getting it wrong: **"same provider" is not "same code path"** —
two SDK methods for one provider differed on whether they ask the server before
navigating, and only the source settles it; and **grep the SDK, not the docs**,
because that difference is invisible from the call site.

**The general rule.** *An SDK call that NAVIGATES cannot report its own failure
to you — check the precondition before the handoff, or you are catching an error
that will never arrive.* And when a check gates a user-facing action, decide its
polarity explicitly and write the reason down: this one is only correct because
it fails open and skips production, and both are invisible from the code alone.

---

## Three fetchers of one API, three error strings, and all three showed the raw JSON body

**Symptom.** A bug report arrived as this, pasted out of the page:

```
{"code":"P0001", "details:null hint null message project_documents_prof_guard:
 professor may only add comments
```

It was legible to an engineer and meaningless to the person who hit it. Found
while fixing 0176; the sweep afterwards found the same string on the two
**guest-facing** forms, where the audience is a student with no staff context
at all: *"บันทึกไม่สำเร็จ: PostgREST 400: {"code":…}"*, rendered into the page.

**Cause.** Three places fetch PostgREST directly and each invented its own
error string:

| | what it put where a person reads it |
|---|---|
| `db.js` `dbRest` | `message: text` — the whole body |
| `vs-form.js` | `` `PostgREST ${status}: ${body.substring(0,200)}` `` |
| `pr-form.js` | identical copy of the vs-form line |

Every caller then does `alert(e.message || 'บันทึกไม่สำเร็จ')` or writes it into
`innerHTML`, so the braces reached the screen every time. Three copies of one
rule (class 6) — and none of them was *wrong* on its own terms, which is why
none of them was ever fixed: each looked like a reasonable local decision.

**The seam that makes this more than a cosmetic fix.** The obvious repair —
return `body.message` — silently breaks the JWT refresh-and-retry, because
`PGRST303` lives in the **`code`** field, not in `message`. `isJwtExpiredError`
matched it only because the whole body was being passed through. A fix to the
HUMAN half of a string can break the MACHINE half of the same string, and the
retry fails by simply not retrying — no error, just a session that logs itself
out on a backgrounded tab.

**Fix.** `src/js/rest-error.js` — one home. `parseRestError()` returns
`{status, message, code, details, hint, raw}`: the sentence for people, the
code and the raw body for the retry. `restErrorMessage()` is the user-facing
half and additionally refuses a wall of SQL (>200 chars, or anything still
starting with `{`), falling back to a Thai sentence **that carries the status**
— so a reporter still has something worth pasting. `db.js` re-exports
`parseRestError` rather than keeping a second copy.

Both display sites were also interpolating that string into `innerHTML`
unescaped, and a PostgREST error can echo the value just submitted (a
constraint message quotes the offending key). Now `escHtml`'d. Self-XSS only —
the submitter is the only viewer — but it is markup assembled from an
untrusted string, and the cost of escaping it is one call.

The console keeps `err.raw`. **Narrowing what the PAGE shows must not narrow
the DEBUGGING surface with it** — that is how a readable error becomes an
undiagnosable one, and it would have cost the very report that started this.

**Where it lives now.** `src/js/rest-error.js`, imported by `db.js`,
`vs-form.js`, `pr-form.js`. `rest-error.test.js` (16) pins both halves,
including the one that matters most: PGRST303 is still findable after
unwrapping.

**The general rule.** *An error message has two audiences, and a helper that
returns a string can only serve one.* Return the parts — the sentence, the
code, the raw — and let each caller take what it needs. And when you find the
same ad-hoc error formatting in a second place, look for the third: the number
of copies is set by how many entry points talk to the service, not by how many
you happened to open.

## "when i click ตั้งเป็นปีปัจจุบัน it got DELETE requires a WHERE clause" — and "เผยแพร่ปีนี้" had failed the same way for 2½ months

**Symptom.** On the year-rollover preview (2026-10-14), ทีม SAMO → ปีการศึกษา →
"ตั้งเป็นปีปัจจุบัน" answered `DELETE requires a WHERE clause`. The same
error was behind "เผยแพร่ปีนี้" in production since 0104 (2026-07-30): no term
there had ever been published, and nobody had reported it.

**Cause.** `publish_team_term` empties a scratch temp table with a bare
`delete from _pub_photos;`. PostgREST connects as `authenticator`, whose
`session_preload_libraries` includes `safeupdate`; that library refuses any
DELETE/UPDATE without WHERE — inside SECURITY DEFINER functions and the
triggers a site write fires, too. The handover (0224) calls publish, so it
inherited the failure. Every proof runs through the Management API, where
safeupdate is not loaded and CANNOT be (`LOAD 'safeupdate'` → "access to
library is not allowed"), so 30+ green proof runs said nothing.

**Fix.** 0225: `delete from _pub_photos where true;` (0153's body otherwise
verbatim). Reproduced first on samo-dev through PostgREST with a throwaway
anon RPC — bare DELETE → 21000, `where true` → ok — then dropped. A live sweep
of every API-callable function in production found no other case (the
`on conflict … do update` hits are not UPDATE statements).

**Where it lives now.** `supabase/migrations/0225_publish_team_term_survives_safeupdate.sql`;
guard `tools/safeupdate.test.js` reads the NEWEST body of every function in
the migrations and fails on a WHERE-less DELETE/UPDATE (shown red without
0225).

**Rule.** A proof run through the Management API is not a request from the
site: it skips PostgREST's role, its preloaded libraries and its timeouts. A
function the site calls needs one check that goes THROUGH PostgREST — or a
source guard for the rule PostgREST adds.
