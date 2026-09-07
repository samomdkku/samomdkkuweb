# Mistakes — the recurring classes

Every bug this repo has paid for is written up. **This file is loaded into every
session, so it holds the recurring CLASSES and nothing else that grows.** The
write-ups live in `docs/mistakes/*.md`, read on demand.

**To find one**: `grep -rin "<phrase>" docs/mistakes/` — it searches the
write-ups themselves, not just their titles, and it is the fastest path once you
have a symptom. To SCAN headings instead, read `docs/mistakes/INDEX.md`, the
generated one-line-per-entry list. Read near-matches; most of these recurred
elsewhere in different clothes.

**Read the matching file BEFORE touching** `auth.js` · `db.js` · anything
calling supabase-js · any RLS policy, `current_user_*` helper or definer
function · `server/deploy.sh` · `appscript/*.gs`.

---

## The seven classes

What has bitten this repo twice or more. If you read nothing else, read this —
it is the part that generalises to code not yet written.

1. **A per-row UPDATE policy is not a column policy.** `for update using (<col> =
   auth.uid())` gates *which row*, then grants *every column in it*. On `users`
   (0028), `vs_tickets` (0096), `shop_orders` (0100) — incomplete by construction;
   pair it with a column guard.
2. **An unresolvable reference fails OPEN.** `coalesce(flag, false)`, a `left
   join`, `if not found then` and `null in (...)` all answer "allowed" for an id
   that no longer resolves. A DELETE on reference data first creates that input.
3. **Scoped is not full.** A narrow branch added *beside* an unconditional one
   (`has_permission('x')`, `using (true)`, a role list) is decorative — permissive
   policies are OR'd — the broad grant wins. Make them exclusive.
4. **Authorization is per-PATH, not per-table.** Sanitising one reader leaves
   `select=*`, the other RPC, the view without `security_invoker` and the
   audience lookup leaking. Mirror image: a correct restriction mistaken for a
   complete design — an admin's decision note went into admin-only
   `student_change_requests`, which the student it addressed could not read
   (0128). A form collecting a message for a named person promises that person
   can read it. A gate on the WIDGET is not a gate on the ROUTE: the sidebar hid
   sections an account could not use, but the HASH was unchecked, so `/admin/#vs`
   opened VitalSound with no VS grant. Enumerate every way in — click, hash,
   query string, deep link, GESTURE (`pointerdown` starts every gesture a scroll
   surface supports; release on `pointercancel`).
   **DISCLOSURE has input paths too**: text truncated with `text-overflow` and
   "recovered" via a `title` tooltip DOES NOT EXIST on a phone — `แยกตามระบบ`
   cut the one thing its panel exists to say (`frontend-ui.md`). **A message a
   renderer can turn ON must be turned OFF by every other outcome it reaches**:
   `ไม่พบใครที่ตรงกับ "<old query>"` was written on the empty branch and
   withdrawn on neither rows-found nor query-too-short, so it sat above the
   results contradicting it. The tell is a UI string inside an `if` with no
   `else`.
   **AN ISOLATED FRAME INHERITS NOTHING** — a `srcdoc` sandbox is a BLANK
   document, so a block styled with Bootstrap looks perfect in the editor (which
   sits in the styled admin page) and unstyled where it is read. The place a
   thing is COMPOSED is not the place it is READ; same for email, PDF and shadow
   DOM (`frontend-ui.md`).
   **A rule held in every MESSAGE instead of at the transport is the same
   shape**: `@here` was removed from three VS builders and two branches kept
   no test, while `data.role` / a display name could still carry `@everyone`
   in from DATA. `allowed_mentions:{parse:[]}` in `postOnce` closes both
   (`integrations.md`). Non-security twin: a handler guarded on state the CALLER
   sets misses every other entry point. COPY too — one claim lived in the
   sign-in caption, the signup link AND the home strip. A LABEL, a CHART and a
   DERIVED value each claim something about every case they cover (org chart,
   `frontend-ui.md`).
5. **A new access channel must be threaded through EVERY gate the old one used**
   — writes, reads, audience/directory lookups, definer-RPC `raise` guards and
   UI `role === 'x'` branches. The most repeated bug here
   (0089 → 0090 → 0091 → 0093 → 0102). A UI gate that honours the new channel
   hides the gap until someone tries to save. **A SECURITY DEFINER RPC that
   restates a policy is one of those gates** — `soft_delete_pr_ticket` kept the
   pr_staff/dev test 29 migrations after the policy learned `has_permission('pr')`
   while its VS twin was correct (0149). Check the SECOND twin. **A `role === 'x'` gate cannot see a PERMISSION**: a
   `master` holder is `role='user'`, so master opened every tab and RLS row but
   missed the ROLE-gated controls inside — the PR/VS skip-notify toggle,
   `isVsSuper()` (2026-08-17). Grep role literals too, and put `holdsMaster()`
   wherever `role==='dev'` grants power. **But a gate sweep misses the function
   that PRODUCES what gates read** — `projectSeatRole` has no role literal; 36 of
   41 masters got a blank หนังสือโครงการ (2026-08-18). Registry, not pattern: `master-mirrors.test.js`
   **AND THE MIRROR IMAGE — A GUARD THAT *DENIES* ON AN IDENTITY INVERTS WHEN
   ONE ACCOUNT HOLDS SEVERAL.** Widening a grant so `master` holds all three
   หนังสือโครงการ desks made `current_user_is_prof()` true for it. Every OTHER
   caller is an OR branch, where an extra `true` only widens — but the two prof
   COLUMN GUARDS restrict, so the extra desk read as a disqualification and all
   41 masters could change NOTHING on a หนังสือ but a comment, for 8 days, on
   one report (0176). Ask whether the identity is the ONLY reason the caller is
   here: `is_prof AND NOT is_project_actor`. When you add a role-folding grant,
   enumerate the RESTRICTIONS, not the grants — `pg_get_functiondef ~ 'raise
   exception'` over every trigger, then read which side of the `if` the raise
   is on. Exemption-first (`if <privileged> then return new`) never inverts.
6. **Two implementations of one rule drift** — but check both callers want the
   SAME answer, and SHARE THE ORDER, NOT THE GEOMETRY: one parentage for both org
   views made แผนผัง a 52,000px staircase; none left ระดับ drawn in one, ignored
   in the other. A change is NOT verified in a view you never opened. SQL↔JS mirrors, read path vs write path,
   an export and its import, a guard and its call sites. Write the differential
   test in the same commit — "keep in step" in a comment is not a mechanism.
   Also a hand-written list beside a shared constant (main.js's admin links vs
   `ADMIN_FEATURES`, 0113). Also TWO WRITABLE TABLES holding one fact: `students`
   and `team_members` each carried a person's identity, each editor writing its
   own copy — fixed by `public.people` (0132–0134).
   **A bidirectional mirror needs `is distinct from` on BOTH sides — that guard
   is the TERMINATION CONDITION, not an optimisation** — comparing the value a
   READER sees: for a GENERATED target compare the generated column while
   writing its source (ชื่อเล่น, 0134). **And a mirror is bidirectional only on
   the columns BOTH directions NAME**: `people.year` was pushed down, never
   carried up, so any registry touch reverted a person's own ชั้นปี edit (0145)
   — the guard reports a one-way column as settled, by construction.
   Also a DERIVED COLUMN vs the expression it came from: `cohort_year` filled
   `if <copy> is null`, so a corrected รหัสนักศึกษา never re-derived the รุ่น
   (0128) — fill-once means never-correct; same in FORMS: `{...row, student_id:
   typed}` keeps the stale copy (`yearBasis`, 0145). Also a rule
   applied to the writers you HAPPENED to be looking at (the portrait cleanup
   missed `my-seat.js`). **A TRIGGER belongs to the TABLE, not to the statement
   it was written for**: 0174's "moving a scan moves the points" also fired on
   the SIGNUP RE-KEY, where the profile has not moved yet — debiting the real
   row and crediting an id nothing lived at, so a carried student would have
   signed in to 0 km (0175). A multi-statement operation is ONE act to its
   author and N events to Postgres, so a trigger sees the row HALF-MOVED:
   restate the invariant at the end, do not try to out-order the trigger.
   Where a second copy is unavoidable,
   the guard is a DIFFERENTIAL test.
   **PROSE IS AN IMPLEMENTATION TOO.** `STATE.md` held six stale claims at once,
   five being a fact with TWO homes where only one was corrected — a proof
   called red that was green (3 homes), three different test counts, a budget
   warning contradicted 400 lines above it. A document has no compiler and every
   sentence looks equally authoritative. **Grep the WHOLE file for a claim's
   other homes before committing a correction**; give a decaying fact ONE home;
   keep the LESSON in an old block, never the counts (`state-handoff.test.js`).
   **WORST WHEN THE STALE COPY IS THE INSTRUMENT**: the deployed sha had FOUR
   homes and one was corrected, so STATE.md's own "check, do not trust this
   line" command named a sha two deploys back and printed 132 insertions of
   ALREADY-SHIPPED code — false evidence with a diffstat, which invites none
   of the doubt a sentence does. Delete the retyping, do not retype more
   carefully: `npm run deploy:owed` READS the one home (`tooling-proofs.md`).
   **Erasing a field a stronger grant "covers" — SCOPE or IDENTITY?** A scope
   has a widest value the grant IS (VS แผนก, Passport ฝ่าย); an identity names
   one of several roles, which access cannot answer. `master` nulled the
   หนังสือโครงการ seat — three DESKS at once — so "all" meant NOBODY, and that
   column is also who gets NOTIFIED.
   **A uid in JSON is a uid**: the purge rewrote every uid COLUMN and skipped
   `timeline[].by` ON PURPOSE, costing 42 of 43 comments their edit button — an
   uncosted trade-off (0166). Put the number in the note.
   Ask whether an id RESOLVES, never whether it is `null` (§D4 asked `is null`).
   **A SENTINEL IS NOT A VALUE, AND A TIMESTAMP IS NOT AN EVENT.** A quota
   dashboard was about to report 83% of a ceiling that was really at 7%:
   `file_url is not null` counted `ไม่มีไฟล์แนบ` and a PASTED link as uploads
   (98 real → 157), and its "25 calls in one minute" was a bulk IMPORT — 2.86 s
   apart at ~65 ms, rows written for files already in Drive, no call made.
   **Before shipping an aggregate, print the ROWS behind its most extreme value
   and look at them**; ask what else the column can hold, and what a bulk write
   would look like (`tooling-proofs.md`).
   **A prediction of where a row LANDS must ask the function the VIEW asks** —
   the NULL branch is where a prediction and the real filter part first (the ปีงบ
   move, `frontend-ui.md`).
   **A "LATEST READING" WITH NO TTL LOOKS LIKE A FACT.** 0156 bounded the week
   CARD's sample to the week on screen; the HERO kept `order by sampled_at
   desc limit 1` unbounded, so a dead reporter froze the weekly remainder
   ACROSS the reset, for ever. Its 5-hour twin self-healed only because every
   reader tested `resets_at > now()`. Ask what a reader returns when nothing
   has written for a week (0167, `app-state.md`).
   **"ONE HOME" MEANS ONE FUNCTION, NOT ONE TIER**: `claude_free_now` took the
   5-hour window from the CLOCK, the trigger's `claude_window_loads` from the
   booking chain — the rail offered 100% where the guard refused 25% (0161).
   Also a GUARD vs the DERIVED STATE it checks — **tell: the same rows legal or
   illegal depending on TYPING ORDER**; re-derive WITH the candidate in it
   (`claude_booking_guard`, 0159, `postgres-schema.md`).
   **NEVER SLICE SOURCE BY LINE NUMBER** — a CSS block lifted out of a deleted
   commit began mid-comment, so the unclosed `/*` swallowed the next three
   rules and the page rendered *plausibly* (names centred, dot 0×0). Slice by
   structure, and check the output parses. Guard the property, not the rules:
   every class the renderer EMITS must have a live rule (`frontend-ui.md`).
   **A WARNING THAT FIRES ON THE HEALTHY CASE IS WORSE THAN NO WARNING** — and
   one that cannot be WITHDRAWN is worse still. A boot watchdog on a bare 8 s
   timer fired on a slow-but-working load and never left; the remedy it offered
   then looked broken too. Trigger on a DEFINITE signal (`load`, an `error`
   event), keep the timer as a backstop, and always leave a path back. Test the
   SLOW-BUT-FINE case, not only the broken one (`frontend-ui.md`).
   **A MODULE THAT NEVER LOADS LEAVES A PAGE DEAD AND ANIMATED.** Bootstrap is a
   classic CDN script so every menu still opens; ~90 inline `onclick="global()"`
   handlers die at once, silently. Cause is ANY failed fetch of the entry
   bundle (a >7-day-old cached HTML naming a pruned chunk, or flaky wifi).
   Something that is NOT your module must be able to say so — boot watchdog,
   `boot-watchdog.test.js`, and now a browser smoke on every preview asking the
   page's OWN signal (`window.__samoBooted`), because `npm test` and
   `npm run build` both pass for a build that never reaches the browser. **And a bug in one iOS browser but not another is
   never the browser** — all iOS browsers are WebKit, so the variable is STATE;
   disprove with a fresh context first (`frontend-ui.md`).
   Also a SELECTOR vs the MARKUP, both ways: a descendant selector styles content
   not written yet (`.list b` made every inline bold a heading); a child
   combinator stops matching after a refactor. CSS fails SILENTLY — a dead rule
   looks like a feature nobody built. **And a rule you did not WRITE is borrowed,
   not implemented**: `[hidden]` worked only because Bootstrap's CDN reboot ships
   it `!important` (`frontend-ui.md`). The instrument is the COMPUTED style, never
   the stylesheet; for a PAINT/OVERLAP bug, the PAINTED BOXES. Also TWO PASSES over one DOM property, and one listener
   per re-render (`docs/mistakes/frontend-ui.md`): touch only what THIS pass set,
   keep state in a variable and listeners on the nodes this paint made.
7. **Verify from the authority, and test BOTH directions.** Read the ACL from
   `pg_proc.proacl`, not the `revoke` you just wrote; grep the SERVED bundle,
   not the local file; read the LIVE function body, not the migration that first
   defined it.

   **`enable` IS NOT `schedule`** — a systemd timer whose only triggers are
   `OnBootSec` + `OnUnitActiveSec` comes back from a `disable` reporting
   `enabled` and `active` with `NextElapseUSecMonotonic=infinity`. Read `NEXT`
   from `list-timers`, and anchor one trigger to the TIMER's own activation
   (`deploy-hosting.md`).

   Every DELETE needs `return=representation` + a `data.length` check — RLS
   returns zero rows, not an error (`delete-guard.test.js`). **So does every
   UPDATE whose success triggers something OUTWARD** — a refused PATCH answers
   204 and would have posted "measurement paused" to Discord having paused
   nothing (0167).

   **Guards fail GREEN — `skills/write-a-guard.md`.** Two quantities in one
   SUBTRACTION must share an INSTANT (0156/0158).
   **A guard's INSTRUMENT needs a guard too**: four tests hand-rolled one
   block-comment regex and `'image/*'` opened a "comment" that blanked 13,839
   chars before any assertion ran (one shared `strip-comments.js` now).
   Two more in `frontend-ui.md`: never measure a container to size the content
   that sizes it — **invisible across a FRAME boundary**, where the two halves
   sit in different documents and neither line looks wrong (a tool reporting
   `documentElement.scrollHeight` was measuring the iframe the host had just
   sized, so it could never shrink; tell = dead space that GROWS WITH THE
   WINDOW, and jsdom has no layout engine to see it); read the RENDERED dialog — a label is unambiguous only beside
   the other buttons. **An ALERT is a dialog too**: a `detail` composed at the
   call site told a human to run `claude setup-token` while the same embed's
   fixed วิธีแก้ said `claude login`, and setup-token is what CAUSES that 403
   (`integrations.md`). Two authors of one instruction, neither able to see the
   contradiction from where it sits.
   **AND THE INSTRUMENT CAN DELETE THE WITNESS.** Four skipped-docs deploys
   resisted three theories because the invocation piped the script through
   `grep -E "==>|error"`, discarding everything the failing step said; the
   documented verdict (`DEPLOY_EXIT=0`) is reachable with the step skipped, and
   its ABSENCE scored as success because the pipeline's status is `tail`'s.
   An intermittent fault that survives three theories is usually an EVIDENCE
   problem: ask what the failing step may say and who is listening, and get a
   HEALTHY BASELINE — "30 s" showed the two runs that "cleanly" took 7 min were
   sick too (`deploy-hosting.md`).
   The ways, each paid for here: it cannot SEE the hazard (0146 — and
   `deploy-owed` v1, whose `<sha>..HEAD` could not see the WORKING TREE) ·
   its EXEMPTION outlived the absence ("PLANNED, not written" for a file that
   then arrived, so the sweep skipped a REAL path) · its
   CONTROL finds nothing either (0147) · satisfied by PROSE
   (`confirm-modal.test.js` matched a *comment*) · its SUBJECT is a hardcoded
   name that rotted (`proj0092`, `house0116`) — **or its SCENARIO needs live
   geometry that RAN OUT**: two rail proofs searched the remainder of the quota
   week for a slot and errored for six days once the week was nearly over. If
   the thing a proof needs can run out, CREATE it (move the setting that defines
   the geometry) — do not relax what the scenario asks for. **A scenario can need
   an ABSENCE just as silently**: claude0167 deleted only its OWN samples while
   its comment claimed "by construction", so it was green while the reporter was
   PAUSED and went red 15 min after measurement resumed — green while broken,
   red on recovery. Ask what a proof assumes the environment will NOT do; a
   claim of "by construction" in a COMMENT is the tell, and the construction can
   assert it · it ERRORS rather than fails, and
   an aborted script is silence (`house0116`: 0 assertions for 23 migrations —
   when a migration drops a function or column, grep `tools/` in that commit).
   **A GUARD THAT NEEDS A SECRET CANNOT RUN WHERE GUARDS ARE ENFORCED** —
   three assertions read the maintainer's gitignored `.env.local`, so they were
   green on every laptop and red on CI for 19 consecutive pushes, unread,
   because local `npm test` kept saying 1848 passed; one of the three was green
   ON CI for the state it exists to catch (`not.toBe('production')` passes on
   `undefined`). Synthesise the artefact a real person creates; never read the
   one your machine happens to have. When CI names tests that pass locally, ask
   how long it has been red, not what you broke.
   **The ritual that catches all five: reintroduce the bug, watch it fail on the
   assertion you expect, restore.** Never write a guard from the SAME LIST the
   code came from — assert the PROPERTY that list was meant to produce, or a
   wrong list passes itself. **A LIST-VS-LIST GUARD PROVES ONLY THAT THE LISTS
   AGREE**: the contributor guide named four env vars, `.env.local.example`
   declared the same four, the guard compared them and was green — while
   NOTHING mapped them to the two names `db.js` actually reads, so a correct
   setup produced a dead portal and a passport pointed at PRODUCTION (its
   fallback is hardcoded live). Both lists were right; the thing BETWEEN them
   did not exist. Feed in the artefact a real person creates and assert what
   must come out. Same entry, the other half: **ask what each credential in a
   named "block" OPENS** — two of those four were an address and a public key,
   two could delete the project and bypass every permission rule over real
   student data (`tooling-proofs.md`). A centralised flag is that list: `wantsSilence`
   knew two spellings and its test asserted ONE of them, taken from the
   function itself, while the only caller of `notifyVSConsult` sent a third
   (`isSilent`) from the OTHER build target — the Silent toggle pinged the ฝ่าย
   for 7 days, green. Assert against the SENDERS, and give the sweep a control
   so an empty result is red (`integrations.md`). **Nor against today's SHAPE**: an assertion that
   COUNTED `visible:false` literals ("one per kind") went red when four seeds
   folded into one insert, while the property held — and the fastest way to
   green is to edit the number, which is how a guard stops meaning anything.
   **A PROOF IS ONLY AS GOOD AS ITS RUNNER'S ABILITY TO READ IT**: a proof
   ending in a COUNT summary instead of per-case rows sent `run-proofs` to its
   text-scanning fallback, which found `FAIL` inside the proof's own
   `else '*** FAIL ***'` — green by hand, red under the runner, same database.
   That difference is never the subject; it is the instrument.
   **AND A DIAGNOSTIC MUST BE RUNNABLE BY THE PERSON IT DIAGNOSES** — the
   getting-started guide told contributors to run `dev:check`, which needs
   PRODUCTION credentials they must never be sent, so it failed on a CORRECT
   setup and blamed the reader (`tooling-proofs.md`).

   Pair every DENY with an ALLOW over the same rows — a table with policies but
   no GRANT denies everyone and reads like the policy working (0138); a deny-only
   probe cannot tell a working guard from a broken service.
   **Check the PROBE SUBJECT**, derived from the gate's own predicate:
   `current_user_has_permission()` reads the UNION of `permissions` AND
   `managed_permissions` (0081), so `permissions='{}'` may still hold `master`.
   **A SEARCH RESULT ABOUT A TOOL IS NOT A MEASUREMENT OF IT AGAINST YOUR
   DEPLOYMENT.** "The Bitwarden CLI expects a bare root, so our `/vault/`
   subpath rules it out" was written into the HANDOFF as a constraint, from a
   blog post; one command disproved it (`bw config server <subpath>` → saved;
   `bw login` → *auth* error, so it REACHED the endpoint — a wrong URL gives a
   CONNECTION error), and the vault had been publishing `"api":"…/vault/api"`
   at its own `/api/config` the whole time. An untested constraint in a doc
   closes off the right design for as long as it survives (`tooling-proofs.md`).
   **A PROBE ANSWERS THE QUESTION ITS DIRECTION ASKS, not the sentence you write
   around it.** An inbound port scan of the VM's public address proved nothing
   could connect IN, and that was written up as "the VM cannot do mail" — it
   sends fine through a relay on 587, never tested, while a `curl` returning 200
   from that box sat in the same session's evidence. Before generalising a
   negative, name the question it TESTED: "X cannot do Y" hides an unstated
   direction, endpoint or credential. And **resolve a hostname before reporting
   its port shut** — a typo and a firewall look identical from `connect()`
   (`smtp-brevo.com` does not exist; `smtp-relay.brevo.com` is open).
   **Check the INSTRUMENT can see it**: minified builds rename module-scope
   names (grep a STRING LITERAL or CSS class), code often lands in a SHARED chunk
   both entries import (0145), `curl -L` turns a GAS `/exec` POST into a GET, and
   a DB-side proof cannot see the FRONTEND half of a mirrored rule. **A string
   behind a build-time flag is DELETED, not renamed** — `import.meta.env` is
   substituted, so `if (!VITE_X)` folds away and its message greps 0 in every
   build where X is set (`deploy-hosting.md`). Pick a verification string from
   code that runs unconditionally, and grep a known-shipping control beside it.
   **Re-read a rule's stated JUSTIFICATION, not just its predicate** —
   `users_read_all` carried "needed for staff dashboards"; the need had ended
   years earlier (0147).

---

## Adding an entry

Write it in the matching `docs/mistakes/*.md` as **Symptom → Cause → Fix → Where
it lives now**, ending with the general rule and LEADING with the symptom as
REPORTED — that is what the next reader greps for. Run `npm run mistakes:index`
(never hand-edit the generated parts; if a line reads badly, fix the heading). A
new instance of one of the seven classes gets its site added to that class above.

**This file is charged to every session.** The per-entry index used to live here
and reached 18,533 of 30,000 bytes — bigger than the classes, growing with every
fix, and it finally blocked a write-up from being added at all. It now lives in
`docs/mistakes/INDEX.md`; what is left below is a nine-line directory that does
not grow. When `npm run check:context` fails, compress the CLASSES or move
detail into `docs/mistakes/` — never raise the budget, and never buy room by
shaving the classes, which are the only part that generalises.

---

## Where the write-ups are

<!-- BEGIN GENERATED INDEX — npm run mistakes:index -->

- `supabase-client.md` *(19)* — supabase-js, PostgREST & the session lifecycle. Open when: auth.js · db.js · anything calling supabase-js.
- `authz-rls.md` *(28)* — RLS policies, SECURITY DEFINER & read paths. Open when: any policy, `current_user_*` helper, or definer RPC.
- `authz-grants.md` *(19)* — The permission / seat / scope channel. Open when: adding an access channel, a scope, or a seat.
- `postgres-schema.md` *(25)* — Migrations, DDL, triggers & constraints. Open when: writing a migration.
- `frontend-ui.md` *(87)* — Bootstrap, CSS, DOM & the browser. Open when: markup, modals, layout, touch, icons.
- `app-state.md` *(20)* — Routing, read-state, caches & serialization. Open when: URL state, per-user "seen", import/export.
- `integrations.md` *(28)* — Notifications, Apps Script & Google Drive. Open when: notify, GAS handlers, Drive URLs.
- `deploy-hosting.md` *(22)* — Deploy, nginx & caching. Open when: deploy.sh, nginx, cache headers.
- `tooling-proofs.md` *(46)* — Proof scripts & verification discipline. Open when: writing or trusting a `tools/*.mjs` proof.
- `passport.md` *(39)* — The Passport app's own write-ups. Open when: anything under `passport/` — scan, stamps, certificates, the dashboard.

<!-- END GENERATED INDEX -->
