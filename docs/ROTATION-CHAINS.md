# แลกต่อเนื่อง — chain swaps for แลก Rotation (DESIGN ONLY)

**Status: BUILT 2026-10-24 (0255 + the page) with the recommended answers to §7; see HANDOFF §32g for what is deployed.** Owner asked: *"what
if i want to be able to swap continuous, like if no one in B swaps with E, i'll
have to E → A → B — design it"*. Builds on `docs/ROTATION-SWAP.md` (read that
first). Two decisions in §7 are the owner's / the faculty's.

> ⚠️ `docs/` is public. No names, รหัส or GPA here.

## 1. The problem, precisely

You are in **E** and want **B**. Nobody in B will swap 1:1 with you. Today you
*can* already do it by hand: swap E ↔ A with someone, then A ↔ B with someone
else. The flaw is the middle: after the first swap you are in **A**, and if the
B person changes their mind you are **stuck in a group you never wanted**.

So the feature is not "more swaps". It is **several swaps that happen all
together or not at all.**

```
before            after
me   E  ──────►   B
a1   A  ──────►   E      (a1 takes my old seat)
b1   B  ──────►   A      (b1 takes a1's old seat)
```

A 3-person cycle. Every group keeps its size, as with a 1:1 swap.

## 2. Why would a1 and b1 agree? — wishes

In a 1:1 swap both people get the group they asked for. In a chain, a1 ends up in
**E** and b1 in **A**. They only say yes if they *want* that. So the chain needs
to know what people want, and that is the missing piece today:

- **อยากไปกลุ่ม…** — every student may mark the groups they would move to (zero
  or more, optionally ranked). Public within the cohort, like requests are now.
  It also helps 1:1 swaps: "3 คนในกลุ่ม B อยากมากลุ่มคุณ" beats asking blindly.

With wishes, the page can find the chain where **everybody gets what they
wanted**: me (E) wants B, someone in B wants A, someone in A wants E.

## 3. The legality rule — chosen so the faculty's rule needs no change

> **A chain is allowed when it could have been done as consecutive legal 1:1
> swaps by the person who started it.**

E → A → B is "me ↔ a1, then me ↔ b1". So check **`rotation_pair_allowed(me,
a1)` and `rotation_pair_allowed(me, b1)`**: same gender, and GPA same band or
≤ 0.20 apart, each against **me**. The function the faculty's rule lives in is
reused unchanged. Nobody can use a chain to reach a swap that the 1:1 rules
would refuse. a1 and b1 are not compared with each other, because they never
swap with each other. ⚠️ So group A's replacement is unchecked. §7 decision 1
offers the stricter per-seat variant; it is the faculty's call.

Also required, as now: nobody in the chain is `staying`; all are different
people; each is still in the group the chain was written about.

## 4. How it runs

1. **Find a route.** In หาคนแลก, "อยากไปกลุ่ม B" opens a route finder:
   - **ตรง** E ⇄ B: people in B you may ask; those who *wish* E first.
   - **ผ่าน 1 กลุ่ม** E → X → B for each other X: *n* people in X you may ask
     who wish E, *m* people in B you may ask who wish X. Routes where both
     counts are > 0 are marked **ทุกคนได้กลุ่มที่อยากไป**.
2. **Propose.** Choose a route; for each hop pick a named person or "anyone in
   X who wants to come to E". The confirm sheet draws the cycle (three people,
   three arrows) and compares *your* timetable E vs B — the only one that
   changes for you.
3. **Commit, don't move.** Each participant sees an offer card: "แลกต่อเนื่อง
   (3 คน): คุณ A → E · จะเกิดขึ้นเมื่อทุกคนตอบรับ (1/2)". Accepting is a
   **commitment**, not a move. For an "anyone in X" hop the first person to
   accept takes the seat (the same "taken" rule as broadcasts).
4. **Execute atomically.** The LAST commitment runs the whole chain in one
   transaction under the round lock (`pg_advisory_xact_lock`, as every write
   does now). It re-checks everything in §3 against the live rows; if anything
   changed, **nobody moves**, the chain is marked failed and everyone in it is
   told why.
5. **Afterwards** every open request and chain naming any of the three closes
   (`superseded`), exactly as after a 1:1 swap.

## 5. Edge cases

| Case | Behaviour |
|---|---|
| A committed person accepts a different swap first | Allowed. Commitments do NOT lock anyone, because otherwise one person could freeze others by proposing chains. That swap wins; the chain fails at execution: "เส้นทางนี้ไม่สำเร็จ เพราะ a1 ย้ายไปก่อน". |
| Two chains share a person | Whichever completes first; the other fails. |
| A participant changes their mind before the end | Withdraws the commitment; the hop reopens (named hop → chain waits or the starter cancels). |
| Nobody answers | The chain expires after a set time (proposal: 48 h, or round close, whichever first). Nothing moved, so nothing to undo. |
| Someone in it switches on "อยู่กลุ่มนี้" | Their commitment drops; the chain cannot complete until the hop is refilled. |
| The GPA rule changes mid-chain | Re-checked at execution, as 1:1 accepts are now. |
| Spam | At most 1–3 open chains per starter, counted with `max_pending`. |
| Group sizes | Unchanged by construction (a cycle). |

## 6. What it would add (for whoever builds it)

- **Migration** (next free number): `rotation_wishes (student_id, to_group,
  rank)`; `rotation_chains (id, round_id, starter_id, status pending|done|
  failed|cancelled|expired, expires_at, …)`; `rotation_chain_legs (chain_id,
  seq, from_group, to_group, target_id null = anyone, taker_id, committed_at)`;
  `rotation_moves.chain_id`. RPCs `rotation_set_wishes`, `rotation_chain_propose`,
  `rotation_chain_commit` (executes on the last leg), `rotation_chain_withdraw`,
  `rotation_chain_cancel`. `rotation_board()` gains `wishes[]` and `chains[]`.
  `rotation_supersede_for` also fails chains naming the movers. Same security
  shape as 0250: no table readable directly, definer RPCs only, events ping.
- **Proof** (extend `tools/rotation0250-swaps.sql`): earlier commitments move
  nobody; the last one moves all three; a moved taker → nobody moves; two
  chains racing for one person → exactly one completes; per-leg pair rule and
  staying refused; group sizes constant; a bystander sees progress but not
  withdrawals.
- **Page**: wishes on my card; route finder in หาคนแลก; chain offers in the
  top banner; the chain drawn as a small cycle in แลกล่าสุด/ความเคลื่อนไหว;
  practice-mode scenes ("a chain completes", "a chain fails because someone
  moved first"). Practice re-states the rules — update `practice.test.js`.
- **Route finding** is tiny (6 groups, ~27 people each): try every middle group,
  count candidates. No graph library needed.

## 7. Decisions needed before building

1. **Legality (faculty).** The question depends on WHY the GPA rule exists. If
   it keeps each group's mix balanced, the default has a gap. Group A loses a1
   and gains b1, and nobody compared b1 with a1. Both are within 0.20 of *me*,
   so they can be up to 0.40 apart. **That gap exists today**: the same two 1:1
   swaps done by hand produce exactly this result, and they are allowed now.
   - **Default (looser):** each taker is checked against the starter. This is
     the same as consecutive 1:1 swaps, so it needs no new rule.
   - **Per seat (stricter):** whoever takes a seat must pass the rule against
     the person who left it: a1 ~ me (E), b1 ~ a1 (A), me ~ b1 (B). Every group
     then gets someone comparable to the person it lost. For a 3-person chain
     that means all three pairs. Fewer chains will qualify.

   Ask the faculty: *"Is the GPA rule about the two people swapping, or about
   keeping each group balanced?"* The first answer means default, the second
   means per-seat. If they choose per-seat, consider whether the two-swaps-by-
   hand route should be checked too. It cannot be blocked without remembering
   who swapped with whom.
2. **Length (owner).** Recommend **at most 3 people (one middle group)**. Every
   extra person is one more yes that must arrive before someone moves away; 4+
   rarely completes. Raising it later is a constant.
3. **Wishes public? (owner).** Recommended yes. Requests are already public, and
   a hidden wish cannot help anyone find you.
4. **Automatic matching (later, optional).** With wishes collected, the system
   could find cycles nobody started (a "top trading cycles"-style matcher) and
   PROPOSE them, with each person still confirming. It finds more swaps, but
   needs an agreed priority rule for conflicting wishes (who asked first?), and
   the faculty may want to see that rule. Build only if manual chains turn out
   too rare.

## 8. Recommended order

1. **Wishes first** (small, useful on its own: better 1:1 matching, and it shows
   whether chains are even needed: how many E→B wishes have no direct match).
2. **Atomic 3-person chains** with the route finder.
3. Automatic matching only if 1–2 show demand it cannot meet.
