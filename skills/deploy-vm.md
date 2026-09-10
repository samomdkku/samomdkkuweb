# Deploying to the KKU VM (prod)

`samo.md.kku.ac.th` is the real host. `server/deploy.sh` runs **on the VM** and
pulls from GitHub, so deploying is: commit → push `main` → run the script over
ssh.

## Prerequisites

- **VPN must be connected.** Without it `ssh samo-vm` times out at
  `10.101.111.181:22` with no useful error. If ssh hangs, that is the reason —
  ask the user to connect rather than debugging the key.
- `SAMO_VM_SUDO_PASSWORD` in `.env.local` (gitignored). Sudo on the VM is **not**
  passwordless.


⚠️ **Added 2026-08-27 — check this BEFORE you deploy, not after:**

```bash
npm run migrate:status        # PENDING must be 0 on production
```

A bundle that reads a column the live database does not have is 0129's
20-minute outage in the other direction. Order is unchanged: **ADD before the
code that reads it ships; DROP only after the new bundle is confirmed SERVED**
(`skills/ship-a-migration.md`).

## ⛔ THE DOCS STEP IS INTERMITTENT — AND IT CAN EXIT 0

**Run tally: 27 runs, 23 completed the docs step, 4 did not.**
(4 on 2026-08-31: 2 ok, 2 not. 5 on 2026-09-01: the first two skipped docs and
**both returned exit 0**, one of them after `pgrep deploy.sh` already showed the
script gone while ssh had still not returned; the last three — every run since
the log and trace landed — took between 30 and 35 seconds and published
everything. 10 on 2026-09-02: all ~31 s, docs published, roots ~17 s apart.
3 on 2026-09-04: all complete (`<== exit 0 — ran to the end`), docs published,
roots agreeing — but **123 s, 389 s and 347 s**, 4×–13× baseline. ⚠️ Four clean runs still prove nothing about the fifth.) The count only grows — a run that works is not evidence, and this
file said "the hang did not reproduce" once already.

⚠️ **A SLOW RUN IS NOT AUTOMATICALLY THE DOCS FAULT — measured, 2026-09-04.**
All three runs sat past the ~2-minute line this file calls "already the fault",
and all three were clean end-to-end. Per-step timing off the trace:

| Step | Baseline | 389 s run | 347 s run |
|---|---|---|---|
| web `npm ci` | 6 s | **326 s** | 37 s |
| web `npm run build` | 7 s | 9 s | 9 s |
| passport `npm ci` | 3 s | 23 s | **287 s** |
| **`npm run docs:build`** | **10 s** | **11 s** | **11 s — normal** |

**`npm ci` is the entire anomaly and the docs build was untouched in all three**
(10–11 s every time), so duration alone does not identify the documented fault.

⚠️ **And it is not a particular `npm ci` — exactly ONE of the two goes slow per
run, and WHICH one alternates.** The 389 s run lost 326 s on web with passport
healthy at 23 s; the very next run lost 287 s on passport with web healthy at
37 s. So do not "fix" this by looking at one project's lockfile or
`node_modules`: the property to explain is *one arbitrary `npm ci` per run
stalling for ~5 minutes*, which points at something shared and intermittent
(registry-side stall, cache lock) rather than at either repo. **Two data points
— do not treat the alternation as established.**

Read the trace for WHICH line is slow first. To get per-step times, filter the
keepalive out — `deploy.sh:90 sleep 45` interleaves into the trace and is NOT a
step:

```bash
ssh samo-vm 'grep -v "deploy.sh:90" ~/samo-deploy-logs/latest.trace' | grep -E "npm|rsync"
```

⚠️ **The cause of the slow `npm ci` is NOT known, and the obvious theories are
already falsified.** Measured minutes after the 389 s run, on the same box:
disk fine (8% used, no iowait, 0 D-state), memory fine (1.9 G available),
registry fast (12 ms connect, 1.6 MB/s tarball), CPU 96–99% idle. Only oddity
is a load average that sits at 5–6 while nothing is running, which no direct
measurement corroborates — likely a virtualization artifact, not a real
bottleneck. **Do not write this up as understood.** If a deploy is slow again,
capture the per-step table DURING the run, not after.

✅ **Run 7 is the first one whose evidence survived.** `deploy.sh` now writes
every run in full to `~/samo-deploy-logs` on the VM, with a separate xtrace
naming the line it reached, because until then the docs step's own output was
being discarded by the `grep` in the command below — **the reason six runs
produced no diagnosis is that nobody was ever shown one.** Run 7 was healthy, so
it did not catch the fault; what it DID buy is the healthy baseline below, which
reclassifies the two "clean" runs the hang was declared dead on.

**The stopping point is STABLE across three days.** Run 6's captured output
ends, verbatim, at the same line the 2026-08-31 failure ended at:

```
==> samomdkkupassport: pull + build (subpath base)
==> docs site: build with base /docs/
[exited with code 0]
```

Nothing after that line had been observed from a failing run — no docs
rsync, no `fix permissions`, no notify restart, no nginx reload. So the fault
is INSIDE the docs build step or in what immediately follows it, not anywhere
earlier, and the exit code is written by the `; echo` in the ssh command rather
than by the script reaching its own end. ✅ **The diagnostic that was missing —
`set -x` INSIDE the script, after the re-exec — is now permanent**, writing to
`~/samo-deploy-logs/latest.trace`. The next failing run names its own line. Read
the log FIRST, before forming any theory: every theory so far was formed without
one.
The two that did not present DIFFERENTLY — three earlier attempts hung and were
killed; the fourth **returned exit 0 having published the app and skipped
`/docs` entirely.**

⛔ **NEVER trust the exit code for this.** The only reliable check is what is on
disk:

```bash
ssh samo-vm 'stat -c "%y %n" /var/www/samo-web /var/www/docs'
```

Same minute = the docs published. Hours apart = the step was skipped, whatever
the script said. On the failing run the captured output stopped at
`==> docs site: build with base /docs/` and the remote command ended before its
own final `echo`, while ssh still reported success.

**When it skips, publish the docs by hand** (below — ten seconds).

⚠️ **A CORRECTION, because I made it in this file.** After two clean runs
earlier the same day I wrote this section as "THE HANG DID NOT REPRODUCE" and
told the owner to treat `deploy.sh` as working. It reproduced two runs later.
**An intermittent fault is never disproven by successes — only a failure proves
anything.** Keep a COUNT here, never a verdict. Write-up:
`docs/mistakes/deploy-hosting.md`.

**Ruled out by measurement** (do not re-open): sudo expiry · a `timeout` ceiling
below the real ~7-minute duration · the `ssh -tt` PTY, since a control run
streamed output the documented way and completed.

⛔ **`bash -x` from outside CANNOT trace it**: the script `exec`s itself after
pulling, so tracing covers only the first two seconds. Use `set -x` INSIDE the
script, after the re-exec.

## The section that follows is KEPT FOR ITS EVIDENCE — the hang as first reported

**As of 2026-08-31, `./server/deploy.sh` goes silent right after
`==> docs site: build with base /docs/` and never finishes.** Three attempts
were killed at 300 s, 600 s and ~9 min. The **app half completes** before that
point, so the bundles do get published; what never runs is the docs publish,
`fix permissions`, the notify restart and the nginx reload.

**The cause is NOT known.** Ruled out by measurement: slow docs build (10 s),
slow rsync (<1 s), a too-low ceiling (three values), sudo expiry (a keep-alive
was added and the hang survived it). Evidence and the one diagnostic nobody has
run — instrumenting this script instead of measuring its steps standalone — are
in `docs/mistakes/deploy-hosting.md`.

**Publish the docs by hand until it is fixed.** Ten seconds, and this is how the
site was published on 2026-08-31:

```bash
ssh samo-vm   # then, with sudo already validated:
cd ~/samo-projects/samomdkkuweb
DOCS_BASE=/docs/ npm run docs:build
sudo mkdir -p /var/www/docs/assets
sudo rsync -a docs/.vitepress/dist/assets/ /var/www/docs/assets/
sudo rsync -a --delete --exclude=assets/ docs/.vitepress/dist/ /var/www/docs/
sudo chown -R www-data:www-data /var/www/docs
```

⚠️ **`deploy.sh` never installs nginx config**, hang or no hang. That is always
a separate step — see the header of `server/nginx-samo.conf`.

## The command

```bash
PW=$(grep -m1 '^SAMO_VM_SUDO_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^"//;s/"$//')
{ printf '%s\n' "$PW"; sleep 10; } | timeout 900 ssh -tt -o BatchMode=yes samo-vm \
  'sudo -v && cd "$HOME/samo-projects/samomdkkuweb" && ./server/deploy.sh; echo "DEPLOY_EXIT=$?"' 2>&1 \
  | grep -viE 'password|^\[sudo' | grep -E "DEPLOY_EXIT|<==|==>|error" | tail -12
```

**THEN READ THE LOG — this stream is not the evidence.** Since 2026-09-01
`deploy.sh` writes every run in full to the VM's own disk, because this pipeline
throws away everything a build says about itself: the `grep -E` above keeps only
the `==>` headings, so four runs skipped the docs publish and nobody ever saw
what the docs step printed. The stream is a progress bar; the file is the record.

```bash
ssh samo-vm 'tail -40 ~/samo-deploy-logs/latest.log'      # what it said
ssh samo-vm 'tail -25 ~/samo-deploy-logs/latest.trace'    # which LINE it reached
```

**How to read the end of the log**, which is the distinction nobody could make
from outside before:

| The log ends with | It means |
|---|---|
| `==> done. Smoke test:` then `<== exit 0` | a real, complete run |
| `<== exit <n> after deploy.sh:<line>` | the script FAILED and said so — the trace names the line |
| **no `<==` line at all** | the process was **killed outright** — SIGKILL, the OOM killer, or the ssh channel dying. No trap ran, so nothing could be written |

⚠️ **`DEPLOY_EXIT` missing from the stream is not "exit 0".** The local exit code
belongs to `tail`, and the remote `; echo` only runs if the remote shell lived
long enough. A run with no `DEPLOY_EXIT` line has told you nothing about itself —
go to the log.

**RUN IT IN THE BACKGROUND, AND GIVE IT A GENEROUS CEILING.** These two go
together and getting them backwards truncated a real deploy on 2026-08-31.

The owner objected to a long `timeout` twice — *"why are you timeout for so
long"*, then *"timeout 30 is enough"* — and the objection is about WAITING, not
about the ceiling. `timeout` is a kill limit, not a duration. The fix for the
waiting is `run_in_background: true`: the command returns immediately, the VM
keeps working, and you are notified when it exits. Then the ceiling costs
nobody anything and should be generous.

⚠️ **MEASURED FROM THE TRACE, 2026-09-01 — and this is the number that matters,
because it is much smaller than anyone thought.** A complete, healthy run is
**30 seconds**, start to `==> done`:

| Step | Time |
|---|---|
| `git pull` + `npm ci` (web) | 1 s + 6 s |
| `npm run build` (web) | 7 s |
| `git pull` + `npm ci` (passport) | 1 s + 3 s |
| `npm run build` (passport) | 1 s |
| **`npm run docs:build`** | **10 s** |
| all four `publish()` rsyncs, chown, nginx reload | under 1 s each |

⛔ **So a run that takes MINUTES is ALREADY the fault, not a slow build.** This
file previously said "a full deploy needs MORE than five minutes", inferred from
a run that `timeout 300` killed — but that run was killed *inside a step that
takes ten seconds*. The two "clean ~7-minute runs" of 2026-08-31 that were used
to declare the hang not-reproducing were therefore **14× the healthy duration**;
they were degraded runs that happened to finish, not control runs. **Anything
past ~2 minutes should be treated as the failure presenting, and the log read.**

The ceiling stays at 900 anyway: `timeout` is a kill limit, and there is no
reason to make a stuck run fail faster than a person will notice it.

**What a truncated deploy leaves behind** — the reason the ceiling matters. The
kill landed after the three builds and before `fix permissions`, `restart
samo-notify` and `nginx -t && systemctl reload nginx`. That run happened to be
harmless: the app was already current, and `/var/www/docs` kept a complete,
self-consistent OLD build (every page still 200). Do not read that as "killing
it is safe" — `publish()` is an rsync, so a kill during the mirror step CAN
leave a half-written root, and the nginx reload never happening means a config
change silently does not take effect.

⚠️ **If you changed `server/nginx-samo.conf`, `deploy.sh` did NOT install it.**
That is a separate step, every time — see the header of that file. Test with
`nginx -t` BEFORE reloading and keep a `.bak` so a bad config can be put back.

**Always verify from outside afterwards**, VPN or no VPN — the public host is
reachable without it:

```bash
for p in / /admin/ /passport/ /pr /notify; do
  printf "%-12s " "$p"; curl -s -o /dev/null -m 15 -w "%{http_code}\n" "https://samo.md.kku.ac.th$p"
done
```

**`sleep 10`, not `sleep 420`.** The sleep exists only to hold stdin open long
enough for `sudo -v` to read the password — which happens in the first second.
It is NOT a timeout for the deploy. `sleep` never writes, so it never gets
SIGPIPE when ssh exits; bash therefore waits for the whole sleep, and a
`sleep 420` made every deploy sit idle for ~5 minutes after the VM had already
printed `==> done`. The deploy is bounded by `timeout`, not by the sleep — and
**do not restate its duration here**; the measured figure has ONE home, the
paragraph above, and the "~90 s" that used to sit on this line was the very
figure that paragraph was written to correct. Reported by the owner: *"you take too long timeout sleep"*.

Also run the asset MIME check, which asks the SERVED host what type each script
is. It exists because the VM served pdf.js's `.mjs` worker as
`application/octet-stream` for months and every browser silently refused it —
build, tests and the browser smoke were all green throughout:

```bash
npm run check:asset-mime -- https://samo.md.kku.ac.th
```

Then verify — **from the served artifact, never the local file**:

```bash
ssh samo-vm 'cd ~/samo-projects/samomdkkuweb && git log --oneline -1
             grep -c "<a string your change added>" /var/www/samo-web/assets/admin-*.js'
```

## Why it is shaped like that — three traps, each hit for real

1. **`-tt` is required.** `sudo`'s credential cache is per-TTY. Without a PTY,
   `sudo -S -v` authenticates but the timestamp does not carry to the sudo calls
   *inside* `deploy.sh` (which re-execs itself), and it dies at the end —
   after both builds — with `sudo: A terminal is required to authenticate`.
   `sudo -v` up front under `-tt` primes a cache the whole script then uses.

2. **Never combine a heredoc with a stdin pipe.** This
   ```bash
   printf '%s\n' "$PW" | ssh samo-vm 'bash -s' <<'REMOTE'   # ← WRONG
   ```
   leaks the password: the heredoc claims ssh's stdin, and the password line
   ends up executed as a remote command — it is then echoed in the error output
   (`bash: line 1: <the password>: command not found`) and into the transcript.
   Put the script in the ssh **argument** and let stdin carry only the password.
   *If this happens, tell the user to rotate the password immediately.*

3. **`sleep` keeps stdin open; the outer `timeout` will kill it.** The `sleep`
   holds the pipe after the deploy has finished, so the command can exit 143
   *after* a successful deploy — exit 143 from the wrapper is expected and not a
   failure. ⚠️ **`DEPLOY_EXIT=0` used to be called "the real verdict" here. It is
   not**, and that sentence is why four skipped-docs runs read as successes:
   `deploy.sh` can publish the app, skip `/docs` and still reach its own last
   line. The verdict is the LOG plus the root write times, both above.

## What deploy.sh does that you must not reimplement

- Publishes assets **additively** (`rsync` without `--delete` for `assets/`),
  pruning only files older than 7 days. A plain `rsync --delete` yanks the
  previous build's hashed chunks out from under tabs that are still open, and
  this app lazy-imports (`esign.js`, shop `qr.js`) — a user mid-session sees
  "the web is down" ~12 minutes after a deploy.
- Re-execs itself after `git pull`, because bash reads a script by byte offset
  and a pull that changes the file's length resumes mid-token.

Both are load-bearing. Deploy through the script, not by hand.

## Verifying from the served artefact — and the control is half of it

Two checks, always, after `<== exit 0`:

```bash
ssh samo-vm 'stat -c "%y %n" /var/www/samo-web /var/www/docs'   # must AGREE
```

then curl-grep a SERVED page for a string added in this deploy, **paired with a
string that was already on THAT PAGE before it** as the control:

```bash
U="https://samo.md.kku.ac.th/docs/mistakes/tooling-proofs.html"
curl -s "$U" | grep -c "<a phrase added today>"      # want 1
curl -s "$U" | grep -c "<a phrase that was there>"   # want 1 — the CONTROL
```

⛔ **A control that returns 0 makes the number beside it worthless — including a
1.** Both readings came from one instrument; if it cannot find something known
to be present, it has not established anything about the thing you are looking
for. Re-pick the control and re-run before reading either number.

⚠️ **Take the control from the SAME PAGE.** On 2026-09-10 the control was a
phrase from `docs/state/HANDOFF.md` §9 while the page being fetched was
`docs/mistakes/tooling-proofs.html`. It returned 0, which looked briefly like a
stale docs publish — the deploy was fine and the string had never been on that
page. A control chosen from the wrong file tests nothing but your memory of
where a sentence lives.
