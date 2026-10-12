# Night agent — its own notes

The unattended agent on the VM (`skills/night-agent.md`) writes a handoff block
at the TOP of this file at the end of every run, newest first. It is the night
agent's file: people do not edit it, and the agent writes in no one else's
`docs/state/<handle>.md`.

What a block claims is the agent's account. What is actually DONE is the
runner's verdict per task in `~/samo-night/NIGHT-TASKS.md` on the VM, decided
by each task's `Done when:` command — read that first.

Its work lives on a branch on the VM that cannot push; the checklist for
bringing it in is `docs/state/HANDOFF.md` §20.
