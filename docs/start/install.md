# Install and run

One-time setup, about 15 minutes. Do the steps in order — each one assumes the one before it.

::: warning Two things before the first command
1. **Install everything listed under [Software to install](/start/prerequisites#software)** — Node.js 22 or newer, Git, a GitHub account and an editor. Nothing on this page works without them, and Node 20 fails in a way that does not say "wrong Node". Check with `node -v` first.
2. **Open a terminal.** Every grey box below is typed there — not in your editor, not in a browser. [How to open one on macOS, Windows or inside VS Code](/start/prerequisites#terminal).
:::

## 1. Sign in to GitHub

```bash
gh auth login
```

It asks four questions, one at a time. The answers, in order:

```
? Where do you use GitHub?                                        GitHub.com
? What is your preferred protocol for Git operations on this host?  HTTPS
? Authenticate Git with your GitHub credentials?                    Y
? How would you like to authenticate GitHub CLI?      Login with a web browser
```

The third one you **type** — `Y`, then Enter. The others are lists you move
through with the ↑ ↓ arrow keys and choose with Enter. The last one looks like
this, and the `>` marks where you are:

```
? How would you like to authenticate GitHub CLI?  [Use arrows to move, type to filter]
> Login with a web browser
  Paste an authentication token
```

Then it hands you a code and waits:

```
! First copy your one-time code: 1A2B-3C4D
Press Enter to open https://github.com/login/device in your browser...
```

**Copy that code**, press Enter, and paste it into the GitHub page that opens.
Approve, come back to the terminal, and it finishes by itself:

```
✓ Authentication complete.
✓ Logged in as your-username
```

::: tip The code is yours and it is different every time
Never reuse one from a guide, a screenshot or an older terminal window. Read it
off the line above each time — that is why it is printed rather than sent to you.
:::

::: tip Follow the terminal, not this page
If your `gh` is a different version it may ask the questions in a different
order or add one. The terminal is always right; this page is only here so the
sequence is not a surprise.
:::

No `gh`? Skip this step. Step 2 has a plain-git alternative.

## 2. Get the project onto your machine

First move to wherever you keep projects — your Documents folder is fine:

```bash
cd ~/Documents
```

Then copy the project down:

```bash
gh repo clone samomdkku/samomdkkuweb
```

**You should see** a progress line ending in something like `Receiving objects: 100%`, and then your prompt back.

::: tip Nobody has to let you in — this repository is public
`samomdkku/samomdkkuweb` is a **public** repository, so this clone works for
anybody with a GitHub account. If it fails with `Repository not found`, it is
almost always one of two boring things: a typo in the name, or `gh` is not
signed in (step 1). It is not a permission problem — there is no permission to
have.

**Permission starts mattering one step later**, when you send a change back.
Pushing a branch *into* this repository needs an invitation. Without one you
push to your own copy of it instead, which you can make at any time:

```bash
gh repo fork samomdkku/samomdkkuweb --clone
```

Both roads end in a pull request that gets reviewed and merged. The one real
difference is that **a fork gets no automatic preview site**, because GitHub
will not hand a fork the project's secrets —
[the two roads side by side](/start/prerequisites#two-roads).
:::

::: tip No `gh`?
```bash
git clone https://github.com/samomdkku/samomdkkuweb.git
```
:::

::: tip What just happened
A folder named `samomdkkuweb` now exists inside the folder you were in. It contains the whole project **and its entire history** — every change anyone has ever made. That is what git is: not just the current files, but how they got that way.
:::

## 3. Go into the folder and install the dependencies

```bash
cd samomdkkuweb
npm ci
```

`npm ci` downloads the exact library versions recorded in `package-lock.json`. It usually finishes in well under a minute — a couple of minutes on a slow connection — and prints a lot on the way.

**You should see** something close to this. Yellow warnings, a vulnerability
count, no `ERR!`:

```
npm warn deprecated backbone-undo@0.2.6: Package no longer supported.
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead
npm warn deprecated glob@10.5.0: Old versions of glob are not supported...

added 507 packages, and audited 508 packages in 12s

155 packages are looking for funding
  run `npm fund` for details

6 vulnerabilities (4 moderate, 2 high)

To address issues that do not require attention, run:
  npm audit fix
```

**Your numbers will not match exactly** — they move whenever a dependency is
updated, and a different npm version words things differently. That is fine.
The two paragraphs below explain both kinds of scary output, because between
them they are the most alarming-looking thing in the whole setup.

::: tip `npm warn deprecated` is not about our code, and you cannot fix it
Each line names a package that one of *our* packages depends on — not something
this project chose, and not something anyone here can change. The only person
who can is the author of the package in the middle.

They were all checked on 2026-09-06, and each is a dead end on purpose:

| The warning | Comes from | Why it stays |
|---|---|---|
| `backbone-undo` | `grapesjs`, the visual page editor | We are already on grapesjs's newest release. There is nowhere to upgrade to |
| `node-domexception`, `glob` | `@google/clasp`, the Apps Script command-line tool | A build-time tool only a few people ever run. It never reaches a browser |

⛔ **Do not "fix" them** by editing `package.json` or `package-lock.json`. A
deprecation warning means *the author stopped maintaining it*, not *it is
broken* and not *it is dangerous*. Ignoring it is the correct response here.
:::

::: tip The vulnerability count is real, but it is not about the live site
Almost every JavaScript project prints one. Every entry behind this number is a
**build-time or maintainer-only tool** — the development server, the docs site
builder, the Apps Script uploader. None of them is shipped to a browser, so
none of them is code a student runs.

⛔ **Do not run `npm audit fix`.** It rewrites `package-lock.json` — the file
whose entire job is pinning exact versions so everyone builds the same thing —
and you would be opening a change nobody asked for, touching thousands of lines,
that a reviewer cannot sensibly read.

**The only word that means failure here is `ERR!`.** If you do not see `ERR!`,
the install worked, whatever the numbers say.
:::

Use `npm ci`, not `npm install` — `ci` installs the exact versions CI uses, so "works on my machine" means something.

From here on, **every command on these pages is run from inside this folder.**
If a command says "not found" or "no such file", check where you are before
anything else:

```bash
pwd
```

**You should see** a path whose last part is `samomdkkuweb`:

```
/Users/you/Documents/samomdkkuweb
```

On Windows PowerShell the same check is `pwd` too, and it prints
`C:\Users\you\Documents\samomdkkuweb`.

If the last part is anything else, you are in the wrong folder. `cd samomdkkuweb`
moves in from just outside it; `cd ~/Documents/samomdkkuweb` gets you there from
anywhere, as long as that is where you cloned it in step 2.

## 4. Add the database credentials

This is the step people get stuck on, so it is spelled out in full.

### 4a. What the file is

You are creating one file called **`.env.local`**, directly inside
`samomdkkuweb/` — the same folder that contains `package.json`. Not in `src/`,
not in `docs/`.

**Check you are in the right folder before you create anything:**

```bash
ls package.json
```

**You should see** the name echoed back, and nothing else:

```
package.json
```

If instead you get `ls: package.json: No such file or directory`, you are
somewhere else — run `pwd` and go back to the end of step 3.

::: danger The leading dot is the single most common mistake on this page
The file is `.env.local`, **not** `env.local`. A filename that starts with `.`
is **hidden by default** on both macOS and Windows, so after you create it you
will look in Finder or Explorer, not see it, assume it did not work, and make a
second one with the wrong name. It is there. Both systems are just refusing to
show it to you.

**To make hidden files visible:**

- **macOS Finder** — press `⌘ + Shift + .` (command, shift, full stop). Press it
  again to hide them. Hidden files show up greyed out.
- **Windows 11 File Explorer** — the **View** button in the toolbar → **Show** →
  tick **Hidden items**.
- **Windows 10 File Explorer** — the **View** tab on the ribbon → tick
  **Hidden items**.
- **VS Code** — no setting needed. Its file sidebar shows `.env.local` already,
  which is the easiest way to confirm it exists.
:::

### 4b. Create it

The project ships an example with the right names already in it. Copy that, from the terminal, in the project folder:

```bash
cp .env.local.example .env.local     # macOS / Linux
```

```powershell
Copy-Item .env.local.example .env.local    # Windows PowerShell
```

Then open your new file in an editor:

```bash
code .env.local         # VS Code
open -e .env.local      # macOS TextEdit
notepad .env.local      # Windows
```

**Confirm both files are there before you edit** — `ls` hides dotfiles unless
you ask for them:

```bash
ls -a | grep env        # macOS / Linux
```

```powershell
Get-ChildItem -Force -Filter "*env*"        # Windows PowerShell
```

**You should see** two names, the example you copied and your new file:

```
.env.local
.env.local.example
```

Only `.env.local.example`? The copy did not happen — you were in the wrong
folder, or the command errored above where you are looking. Scroll up.

### 4c. Replace the placeholders with the values you were given

Either from the one-time link somebody sent you, or from the `Dev` folder in
[SAMO's password vault](/start/prerequisites#_1-ask-for-the-database-credentials-now)
if you have an account there.

The file you copied already has the four names in it, each with an obvious placeholder value. Replace the values, keeping the names exactly as they are:

- `SUPABASE_DEV_URL` — the address of the development database
- `SUPABASE_DEV_ANON_KEY` — the public key the browser uses
- `SUPABASE_DEV_ACCESS_TOKEN` — used by the migration tools
- `SUPABASE_DEV_DB_URL` — the direct database connection

One `NAME=value` per line. **No spaces around the `=`, and no quotation marks** — a value in quotes is read as a value that includes the quotes. Save the file. Nothing else has to be told about it — the project reads it automatically the next time it starts.

::: danger Two rules, both non-negotiable
**`.env.local` is already listed in `.gitignore`, so git ignores it. Never change that**, and never move these values into a file that is tracked. A key committed once stays in the history for ever, and this repository is public.

**`samo-dev` is a copy of real student data, not fake data.** Click, submit, and delete freely — that is what it is for. But never publish its URL, never copy records out of it, and never paste its contents into a chat or an issue.
:::

### 4d. Check it worked

```bash
npm run env:check
```

**You should see:**

```
✓ all four SUPABASE_DEV_* values are present and filled in
✓ the development database answered

You are set up. Run `npm run dev` and open the address it prints.
```

Anything else names the problem and what to do about it. The three that actually happen: the file is in the wrong folder, one line got wrapped in two when you pasted it, or one value is still the placeholder because you pasted three of the four.

::: warning Not `npm run dev:check` — the two names look almost the same
`env:check` is yours. `dev:check` is a different command with a different job:
it compares the development database against **production**, so it only works
for the two or three people who hold production credentials and deploy the live
site. That is not a rank or a title in SAMO — it is simply who has those keys,
and a contributor should never be sent them.

Run it anyway and it stops with `✗ PRODUCTION: URL or anon key missing`, which
reads like *your* keys are wrong when they are perfectly fine.
:::

### 4e. If you do not have the credentials yet

`npm run dev` still starts and the site still loads. You will get the layout, the styling and the navigation, and **empty lists wherever data would be**, sometimes with an error in the browser console. That is enough for a pure CSS or copy change. It is not enough to test a form, a login, or anything that saves.

## 5. Run it

```bash
npm run dev
```

It prints something like:

```
  VITE v6.3.5  ready in 412 ms

  ➜  Local:   http://localhost:5174/
```

**Always open the address it printed**, not one you remember. Your browser usually opens it for you.

You should get this — the real site, running on your own machine:

![The portal running at localhost:5174](/start/local-running.png)

::: tip Passport is at `/passport/`, on the same address
`npm run dev` starts **both** apps and serves them under one address, the same
way the real site does:

- `http://localhost:5174/` — the portal
- `http://localhost:5174/passport/` — SAMO Passport

![SAMO Passport running under the same dev address](/start/local-passport.png)

You do not need a second command or a second port. Under the hood it runs two
Vite servers and proxies `/passport` to the second one — passport needs its own
build settings — but that is an implementation detail you can ignore.

⚠️ **This changed on 2026-09-04.** Before that, `npm run dev` served the portal
only and `/passport/` answered **200 with the portal's own page** — the wrong
app wearing the right URL, with nothing to tell you. If you find a guide or a
note anywhere saying Passport is unavailable in development, it is out of date.

`npm run dev:web` still starts the portal alone, and `npm run dev:passport`
starts Passport alone, if you ever want one without the other.
:::

::: warning The port is 5174 — until it is not
`5174` is the port the project asks for. If something else on your machine is already using it — most often a second copy of this same project, left running in another terminal window — **Vite quietly moves to the next free port** and tells you:

```
Port 5174 is in use, trying another one...
➜  Local:   http://localhost:5175/
```

Everything works exactly the same on 5175. Read the address off the terminal each time and you will never be caught by this.

To use 5174 instead, find the other process and stop it. The usual fix is to press `Ctrl + C` in whichever terminal window is still running it. If you cannot find it:

```bash
lsof -ti:5174 | xargs kill      # macOS / Linux
```

```powershell
netstat -ano | findstr :5174    # Windows — note the PID, then:
taskkill /PID <the-pid> /F
```
:::

**If the SAMO site loads, you are done.** Edit any file under `src/` and the page updates by itself — no rebuild, no refresh. Press `Ctrl + C` in the terminal to stop the server.

::: tip Two terminal windows is the comfortable setup
Leave `npm run dev` running in one window and type everything else in a second. Otherwise you are stopping and restarting the server all day.
:::

## Commands you will use

| Command | What it does |
|---|---|
| `npm run dev` | Runs the site on your machine, usually at `localhost:5174` |
| `npm test` | Runs the test suite. CI runs this exact one on your pull request |
| `npm run build` | Builds the production files — proves nothing is broken before you push |
| `npm run env:check` | Checks your `.env.local` credentials work |
| `npm run preview:url` | Prints the preview address for the branch you are on |

## Where things live

| To change | Edit |
|---|---|
| Pages, tabs, dialogs | `src/html/` |
| Colours, spacing, layout | `src/css/` |
| Behaviour, buttons, forms | `src/js/` |
| Text of the release notes | `src/data/changelog.js` |

Next — [Where the site runs](/start/where-it-runs)
