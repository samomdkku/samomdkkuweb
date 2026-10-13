# Handoff — this ALWAYS runs at the end of a run, whatever happened

This is reserved time, not the last item in a queue. Whatever came before —
finished, overran, failed, or never started — write the record now.

Three environment variables tell you how the run actually went:
`AGENT_UNRUN` (tasks that never started), `AGENT_STOP` (why the queue ended),
`AGENT_ASKS` (tasks that ended by asking a question instead of acting). Read
them with `echo`, and read `git log --oneline origin/main..HEAD` for what was
committed on this branch so far (earlier runs of the same queue included).
`cat ~/samo-night/NIGHT-TASKS.md` shows every task's Status as the RUNNER
judged it — quote those, never your own opinion of whether a task is done.

⛔ `AGENT_QUEUE_REPORT` is the runner's one-line-per-task verdict. **Paste it
verbatim** at the start of section 2. A line starting `!` is a task that did
NOT finish normally in one run — it was cut off by the quota and resumed
(`ถูกตัดกลางทาง…`), its check passed before anyone worked on it
(`needs-review`), it is `blocked`, or it is still `interrupted`. Every `!` task
goes in section 3 by name, with what happened to it. You may write "clean",
"nothing was skipped" or "all done" ONLY if every line starts with `✓` — on
2026-10-13 a handoff said exactly that about a task the quota had cut off.

Append a block to the **TOP** of `docs/state/night-agent.md` (create it if it
does not exist; it is the night agent's own notes file — never write in another
person's `docs/state/<handle>.md`), headed
`## ▶ HANDOFF <today's date and UTC time> (night agent, branch <branch>)`.
It must answer, in this order:

1. **What the owner should do FIRST.** One action, concrete — a command to run
   or a file to open. Not a summary. This is the line they read on their phone.
2. **What is READY TO USE versus what is still a DESIGN.** Be blunt. Something
   half-built described as done costs more than something honestly unfinished.
   Say which migrations were WRITTEN but NOT APPLIED (you cannot apply any).
3. **What did not happen and why** — every task in `AGENT_UNRUN`, and anything
   in `AGENT_ASKS`, which means it ended by asking a question nobody was awake
   to answer. For each, state the question and your recommendation.
4. **What needs a human decision**, with the options and what you would pick.
5. **What you could NOT verify**, and why — you had no database and no Google
   credentials. Be specific about which claims rest on assumption.

Then update `STATE.md` only if real state changed — keep it under its line
budget and do not append a narrative. Add a `PENDING` entry to
`src/data/changelog.js` for anything a student or admin would NOTICE: plain
Thai, no table names, no identifiers — only if a task did not already add it.

Finish with ONE paragraph as your final message. It becomes the Discord report
read on a phone. Lead with the single most important thing. If the run went
badly, say so plainly in the first sentence.
