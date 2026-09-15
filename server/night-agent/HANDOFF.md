# Handoff — this ALWAYS runs, whatever happened tonight

This is reserved time, not the last item in a queue. Whatever came before —
finished, overran, failed, or never started — write the record now.

Three environment variables tell you how the night actually went:
`AGENT_UNRUN` (tasks that never started), `AGENT_STOP` (why the queue ended),
`AGENT_ASKS` (tasks that ended by asking a question instead of acting). Read
them with `echo`, and read `git log --oneline main..HEAD` for what was committed.

Append a block to the **TOP** of `docs/state/phuriphatma.md`, headed
`## ▶ HANDOFF 2026-09-16 (night agent)`, matching the style of the blocks
already there. It must answer, in this order:

1. **What the owner should do FIRST.** One action, concrete — a command to run
   or a file to open. Not a summary. This is the line they read on their phone.
2. **What is READY TO USE versus what is still a DESIGN.** Be blunt. Something
   half-built described as done costs more than something honestly unfinished.
3. **What did not happen and why** — every task in `AGENT_UNRUN`, and anything
   in `AGENT_ASKS`, which means it ended by asking a question nobody was awake
   to answer. For each of those, state the question and your best recommendation
   so the owner can decide in one read instead of re-deriving it.
4. **What needs a human decision**, with the options and what you would pick.
5. **What you could NOT verify**, and why — you had no database and no Google
   credentials all night. Be specific about which claims rest on assumption.

Then update `STATE.md` only if real state changed — keep it under ~200 lines and
do not append a narrative. Add a `PENDING` entry to `src/data/changelog.js` for
anything a student or admin would NOTICE: plain Thai, no table names, no
identifiers.

Finish with ONE paragraph as your final message. It becomes the Discord report
read on a phone before any laptop is open. Lead with the single most important
thing. If the night went badly, say so plainly in the first sentence — a
reassuring summary of a bad night is the worst possible output.
