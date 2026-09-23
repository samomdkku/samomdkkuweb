# Versioning and releases

> How version numbers work, and how to publish a release

How this project numbers its releases, why it numbers them that way, and the
exact steps to cut one.

Current version lives in **one place**: `package.json`. Everything else reads it.

---

## 1. The scheme

`MAJOR.MINOR.PATCH` — SemVer's shape, with MAJOR redefined for a product that
has no API consumers.

| Bump | When | Example |
|---|---|---|
| **MAJOR** | The portal's **scope** changed — it now does something categorically new, and a returning user would notice the product is a different thing. | `1.x → 2.0.0` when ร้านค้า + หนังสือโครงการ turned a set of forms into an operations platform |
| **MINOR** | A new feature or system **inside** the scope it already had. | `4.2.0 → 4.3.0` ผังองค์กรสาธารณะ |
| **PATCH** | Fixes and polish. Nothing new to learn. | `4.4.0 → 4.4.1` |

### Why MAJOR is redefined, and why that is not cheating

Classic SemVer defines MAJOR as *"incompatible API changes"* — it exists so a
library's **integrators** know an upgrade will break their build. This is a
website. Nobody integrates against it, so that trigger would never fire, and
under strict SemVer the portal would sit on `1.x` forever while growing from a
single form into seven systems. A number that never moves communicates nothing.

Redefining MAJOR against **user-visible scope** is the standard adaptation for
product software, and it is the difference between a version that means
something and a decoration.

The second reason to define it tightly: it stops **version inflation**. An
earlier draft of this scheme called nine of the first twenty-two releases MAJOR,
which would have put a three-month-old project at `v9.1.0`. Anyone who knows
software reads that as a team bumping the big number for attention. Under the
scope rule there are four, and each one has a sentence explaining what changed
(`MAJOR_STORY` in `src/data/changelog.js`).

### Why not CalVer

CalVer (`2026.08.04`) is a genuine alternative for continuously-deployed
products — Ubuntu, JetBrains and Sentry all use it, and this project's first
draft did too. It answers *"how old is this?"*, which is a real question.

It was dropped because it answers **only** that. A date cannot tell a reader
whether a release was a rewrite or a typo fix, and on a changelog page that
distinction is the main thing being communicated. `MAJOR.MINOR.PATCH` carries
significance in the number itself; the date is still shown next to it, so
nothing is lost.

### Pre-release and hotfix

- **Hotfix** — a PATCH cut off the release commit: `4.4.0 → 4.4.1`. No stub
  ceremony; one line in `changes` with `type: 'fixed'`.
- **Pre-release** — `4.5.0-rc.1`. Only if a release ever needs testing on the VM
  before it is announced. Not used to date; the version regex in
  `changelog.test.js` would need widening first.

---

## 2. Commit messages drive the bump

This repo already writes [Conventional Commits](https://www.conventionalcommits.org)
(`feat(team): …`, `fix(vs): …`, `docs(state): …`). That existing habit is what
makes the bump derivable — no new convention is being imposed.

| Prefix | Meaning | Effect on the next release |
|---|---|---|
| `feat:` | new user-facing capability | at least MINOR |
| `fix:` | bug fix | at least PATCH |
| `docs:` `chore:` `refactor:` `test:` `style:` | invisible to users | no release on its own |
| `feat!:` / `BREAKING CHANGE:` footer | breaking | **flagged for review, not auto-MAJOR** |

That last row is deliberate. A breaking internal refactor is invisible to
students; our MAJOR is about *their* experience, not ours. `tools/release.mjs`
prints those commits and asks a human to decide, rather than promoting them.

**Scope** goes in parentheses and should be the product area, not the file:
`feat(shop):`, `fix(projects):`, not `fix(inbox.js):`.

---

## 3. Cutting a release

```bash
npm run release                       # dry run — shows the bump + a draft stub
npm run release -- --write            # applies it
npm run release -- --write --tag      # …and tags it locally
npm run release -- --level major      # override the derived tier
```

What the tool does:

1. finds the last `v*` tag and reads every commit since,
2. classifies them by Conventional-Commit prefix,
3. derives the tier and computes the next version,
4. prints a `RELEASES` stub with one `TODO` line per commit,
5. with `--write`: bumps `package.json` and inserts the stub at the top of
   `src/data/changelog.js`.

**Then a human writes the words.** Every `TODO` must be rewritten in plain Thai
that a student could read — no table names, no migration numbers, no permission
keys. `changelog.test.js` fails the build if an identifier leaks through.

Finish with — and tag AFTER the commit:

```bash
npm test && npm run build
git add -A && git commit -m "chore(release): v4.5.0"
git tag -a v4.5.0 -m v4.5.0            # the RELEASE commit — see below
git push && git push origin v4.5.0     # tags are pushed deliberately, never automatically
```

⚠️ **Do not use `--write --tag` together** (found cutting 4.8.0): `--tag` tags
the current HEAD while the version bump and changelog are still UNcommitted,
so the tag lands one commit early and the release commit itself falls into the
NEXT release's range. Write, rewrite the TODOs, commit, then tag by hand.

### Why not `semantic-release`

`semantic-release` publishes automatically from CI and generates the changelog
from commit subjects. That is right for a library and wrong here for one
specific reason: **this project's changelog is curated.** A generated one reads
like a git log — which is precisely what `src/data/changelog.js` exists not to
be. The tool does the mechanical half; the writing stays human.

`npm version` was not used either: it bumps a number and knows nothing about
tiers or the changelog.

---

## 4. Where the version appears

| Surface | Source | Purpose |
|---|---|---|
| `package.json` | **the source of truth** | everything below reads it |
| `/build.json` | `vite.config.js` at build time | *"which release is deployed?"* — the question you ask when a user reports a bug |
| `__APP_VERSION__` | Vite `define` | available to any module without an import |
| Footer bar, every page | `LATEST.version` | quiet, always-visible; links to `/updates` |
| `/updates` release notes | `src/data/changelog.js` | the public record |
| `เบื้องหลังการพัฒนา` panel | `LATEST.version` | landing page |
| Git tag `v4.4.0` | `--tag` | ties a version to a commit, so `git log v4.3.0..v4.4.0` works |

**`src/data/changelog.js` and `package.json` must agree** — the newest release's
`version` is asserted equal to `pkg.version` in `changelog.test.js`. That test is
the mechanism; without it the two would drift the first time someone edits one
by hand.

---

## 5. What the tests enforce

`src/js/changelog.test.js`, so none of the above is merely documentation:

- versions are strictly increasing over time;
- **each bump matches its tier** — a `minor` must be `x.y+1.0`, a `major` must be
  `x+1.0.0`. This is the contract that keeps the number meaningful;
- the first release is `1.0.0` and is a `major`;
- `package.json` carries the newest version;
- every `major` has a `MAJOR_STORY` line, and no story is stranded on a version
  that no longer exists;
- no release leaks an engineering identifier into user-facing copy;
- the landing panel publishes no effort metrics and no cadence promise.

---

## 6. Version history

| Version | Date | What changed about the scope |
|---|---|---|
| **1.0.0** | 2026-04-30 | จุดเริ่มต้น — ฟอร์มออนไลน์ใบเดียว |
| **2.0.0** | 2026-05-26 | จากฟอร์ม สู่ระบบปฏิบัติการของสโมสร |
| **3.0.0** | 2026-07-22 | ย้ายมาอยู่บนโครงสร้างพื้นฐานของคณะ ใช้บัญชีเดียวทั้งระบบ |
| **4.0.0** | 2026-07-24 | สื่อสารสองทาง — นักศึกษาเห็นว่าปัญหาถูกแก้ถึงไหนแล้ว |
| 4.5.0 | 2026-08-06 | — |
| 4.6.0 | 2026-08-10 | — |
| 4.7.0 | 2026-09-05 | — |
| 4.8.0 | 2026-09-23 | current |

Versions `1.0.0`–`4.4.0` were assigned **retroactively** when this scheme was
adopted (2026-08-04), by replaying the release history against the rules above.
Only `v4.4.0` is tagged in git; earlier versions exist in the changelog but have
no tag, because retrofitting twenty-two tags onto historical commits would add
noise without adding information. Tagging starts from here.

⚠️ **Tag every release, or the next one replays it.** `v4.6.0` shipped untagged,
so when `4.7.0` was cut the tool walked back to `v4.5.0` and re-listed 702
commits — **248 TODO stubs spanning two releases**, most of them already
published in 4.6.0. The curated `PENDING` notes were correct and the stub around
them was not. `v4.6.0` has since been tagged retroactively at `7d6e9fe`. The
`--tag` step in §3 is not optional polish; skipping it corrupts the NEXT
release's derivation, which is the part nobody is looking at when they skip it.
