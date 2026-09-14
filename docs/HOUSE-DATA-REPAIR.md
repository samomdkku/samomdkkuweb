# ซ่อมข้อมูลนักศึกษาในระบบบ้าน — ใครทำอะไรได้ ตามแต่ละช่องที่ผิดหรือหาย

What a student can fix themselves, what needs an admin, and what has to go back
to ฝ่ายข้อมูล — for every combination of ชื่อ · นามสกุล · รหัสนักศึกษา · kkumail ·
สายรหัส being **missing** or **wrong**.

Written against the live system on 2026-09-14 (migrations 0188–0192). Every
"can" and "cannot" below was read off the actual function bodies, not assumed;
where a claim was checked by running it, it says so.

---

## 1. Why this is not 32 cases

Five fields, each either fine, missing, or wrong, is a table nobody can use. It
collapses, because **the five fields are not peers — each gates something
different, and two of them gate nothing at all.**

| Field | What it gates |
|---|---|
| **kkumail** | *Existence.* `students.kkumail` is NOT NULL and is the upsert's conflict target, so the row cannot exist without one — and `get_my_student_record()` joins on it alone, so it is also the entire login match. |
| **รหัสนักศึกษา** | *Self-service.* Factor 1 of `claim_my_student_seat`. Also derives **รุ่น** (`cohort_from_student_id`), and therefore ชั้นปี. |
| **ชื่อ** | *Self-service.* Factor 2 of the claim. Nothing else. |
| **สายรหัส** | *บ้าน.* It is the last digit. Nothing else reads it. |
| **นามสกุล** | **Nothing.** No gate, no derivation, no uniqueness. |

So:

- **นามสกุล drops out entirely.** Wrong or missing, alone or with anything else,
  it never changes what anyone has to do. Fix it whenever you are next in the
  form. 32 cases → 16.
- **The remaining 16 are decided by ONE question asked first**: is the kkumail
  right? Everything else is downstream of the answer, because without the right
  address there is no record to edit and no person to attach an edit to.

That gives three cases, and only one of them is dangerous.

---

## 2. Case A — kkumail is right

You have a `students` row and you can see it. **Every other field, in every
combination, is fixable without ฝ่ายข้อมูล.** Two mechanisms cover all sixteen:

| Broken | Who fixes it | How |
|---|---|---|
| ชื่อ · นามสกุล · รหัสนักศึกษา · สาขา — missing or wrong, any combination | **the student, immediately** | ข้อมูลของฉัน → แก้ไข. `update_my_identity` writes ระบบบ้าน, ทีม SAMO and the registry in one call, and stamps `self_edited` so no re-import can undo it (0125). |
| **สายรหัส** — missing or wrong | the student **asks**, an admin **decides** | แจ้งข้อมูลไม่ถูกต้อง → `request_my_change` → คำขอแก้ไข in the admin pane. |
| รุ่น / ชั้นปี | **nobody, directly** | Derived from the รหัส. Fix the รหัส and it follows. Editing it separately would be editing a calculation. |

**Why สายรหัส is the one exception.** It decides บ้าน, so it is the only field
with a reason to lie about. `update_my_student_record` has no `sai_code` branch
at all — deliberately, since 0125 — so this is not a UI restriction that a
crafted request could go around.

**Admin's job in Case A: approve สาย requests. That is all.**

---

## 3. Case B — kkumail is missing

You are not in `students` at all. You are a **held row**
(`student_import_unresolved`), and what you can do depends on exactly two
fields, because those are the two the claim matches on.

| รหัส | ชื่อ | The student can | The admin must |
|:---:|:---:|---|---|
| ✓ | ✓ | **Fix it themselves.** Sign in with kkumail → หน้าแรก → type รหัส + ชื่อ → the seat is theirs, with its สาย and บ้าน. → then Case A. | nothing |
| ✓ | ✗ or wrong | nothing — the claim needs both | Search the held list by **รหัส**, type their address into that row (`กรอกอีเมล`). |
| ✗ or wrong | ✓ | nothing | Search the held list by **ชื่อ**, same. |
| ✗ | ✗ | nothing | Only นามสกุล and สาย remain. If นามสกุล identifies them, promote by hand; otherwise **→ ฝ่ายข้อมูล**. |
| — | — | nothing | **Empty seat** — a สายรหัส with no person on it. Nothing to act on. **→ ฝ่ายข้อมูล.** |

The admin pane sorts on exactly this distinction: rows that **cannot** be
self-claimed come first, because nobody else will ever close them. The footer
says how many of each.

> **The near miss, and why the student is not told about it.** A student whose
> held row has a *wrong* รหัส or a mistyped ชื่อ types their real details and
> gets no match — and is told the same neutral sentence as somebody who is
> genuinely not in the file. That is deliberate: a message distinguishing "no
> such รหัส" from "wrong ชื่อ" would turn the form into a way to test one guess
> at a time against 165 real students.
>
> **They are not left to chase it, though.** The miss is recorded, with their
> verified address and what they typed, and lands in front of an admin with the
> near-miss held rows already picked out — see §6. Nobody has to describe their
> problem twice, and nobody is sent to a different team to do it.

---

## 4. Case C — kkumail is present but WRONG

This is the only case that fails **open**, and it is the one to design against.
Everything in Cases A and B fails closed: you see nothing, which is obviously
broken and gets reported. Here, something works — for the wrong person.

| Sub-case | What actually happens | Detected? |
|---|---|---|
| **C1 — it duplicates another row in the same file** | The importer keeps neither: both are held, because line order cannot say whose address it is. If a human has named the owner (`MAIL_OWNER` in `tools/clean-house-csv.mjs`), the owner imports and the other is held with a blank address. | **Yes**, at import time, by name. |
| **C2 — it is another real student's address, and they are not in the file** | Your row imports under their address. **They sign in and see your ชื่อ, รหัส, สาย and บ้าน** — and can edit it. You look like you were never sent. Verified by construction on samo-dev: `get_my_student_record` joins on kkumail and nothing else. | **Yes, if they say so** — ไม่ใช่ข้อมูลของฉัน on the card (§6). Nothing detects it automatically. |
| **C3 — a typo that belongs to nobody** (`kanokpron` for `kanokporn`) | The row imports. Nobody can ever sign into it. You look like you were never sent — so you land in §6 as a failed claim, and the held list will not contain you either. Domain typos are repaired by the cleaner; a **local-part** typo is unrepairable and indistinguishable from a real address. | **Indirectly** — you turn up in §6 with no candidates at all, which is itself the signal. |

### The detector for C2 and C3 already exists

A student whose record carries the wrong address can **never** confirm it —
they cannot reach it. So `identity_check_summary()`'s **ยังไม่ได้ตรวจ** count,
read some weeks after an import, is exactly the population of wrong addresses
plus the merely inattentive. It is already built, already in the admin pane, and
nobody has been framing it this way.

**Use it like this:** an import is only "done" when the unchecked count has
stopped falling. Whoever is left is the candidate list, and the ones whose
`people` row has no `identity_confirmed_at` *and* no `self_edited` after a
term are the ones to re-ask ฝ่ายข้อมูล about by name.

---

## 5. The escalation ladder, in one line each

1. **The student fixes it** — anything except สายรหัส, once they can see their
   record.
2. **The student claims it** — a held row that carries both รหัส and ชื่อ.
3. **The student tries and fails** — and that failure is the report (§6). No
   second form, no other team.
4. **The admin types an address in** — a held row that carries neither, or one
   whose รหัส/ชื่อ is wrong. The report above hands them the likely match.
5. **The admin approves a สาย change** — the only field a student cannot set.
6. **Back to ฝ่ายข้อมูล** — an empty seat, a missing person, a duplicate address
   whose owner is unknown, or a สายรหัส nobody can vouch for. **Never invent a
   สาย**: บ้าน is its last digit, and a guess puts a real student in the wrong
   house with nothing downstream able to tell.

---

## 6. Nobody is sent to VitalSound for this

**Owner's call, 2026-09-14:** *"i dont want everything to overload on vitalsound
too much."*

⚠️ **A correction, because the first version of this section got it wrong.** It
said VitalSound "is the confidential service desk" and that routing data problems
there was a category error. It is not: read off `vs_categories` on production,
**two of nine active categories are confidential** (`personal` and one custom);
the rest — including **`it — IT / เครือข่าย`** — are ordinary and publicly
eligible. VitalSound was never the wrong *place*.

The real argument is narrower and survives: **a stuck student should not have to
re-type facts the system already holds.** Their Google-verified kkumail and the
รหัส and ชื่อ they just typed are exactly what an admin needs; sending them to
describe all of it again in free text loses the structure, loses the candidate
matching, and costs them the effort. That is about duplicated work, not about
which desk is allowed to help.

The fix is that **the claim form is the report**. A student who types their รหัส
and ชื่อ and gets no match has already handed over everything an admin needs:

- their **kkumail, verified by Google** — the one fact the handover file is
  missing, in every single one of these cases;
- the **รหัสนักศึกษา and ชื่อ they believe are theirs**, in their own words.

So the miss is kept instead of thrown away. The student is asked for nothing
more, and is told nothing more either: the same neutral sentence comes back for
every miss, because a message that distinguished "no such รหัส" from "wrong ชื่อ"
would turn the form into a way to test one guess at a time against 165 real
students. **Silence towards a guesser is not silence towards the admin.**

| | |
|---|---|
| **Where it lands** | ระบบบ้าน → ยังนำเข้าไม่ได้ → **คนที่ยืนยันตัวตนไม่ผ่าน**, under the held list — because the admin's job is matching the two, and they are two halves of one screen: *seats with no person* above, *people with no seat* below. |
| **What the admin sees** | The verified address, what the person typed, and **candidate held rows** — the ones agreeing on either the รหัส *or* the ชื่อ. Anything agreeing on both would have been claimed, so every candidate shown is a near miss, which is the exact shape of a typo in the file. |
| **How it closes** | By itself. Typing the person's address into the matching held row resolves both. A student who mistyped and then got it right closes their own. A queue that fills with already-solved problems is a queue nobody reads — which is the failure this replaces, not a new version of it. |
| **Abuse** | The key is the kkumail, so an account that tries ten times leaves **one** row with `attempts = 10`. No counter, no cleanup job; the shape is the rate limit. |

### "This record is not mine"

The one case that fails open (§4 C2) now has a path too: **ไม่ใช่ข้อมูลของฉัน**
on the card. It **files a sentence and changes nothing** — someone looking at a
stranger's record must not be able to act on it, because the rightful owner of
that address may still be the person shown, and an edit would overwrite a real
student's data on the word of whoever the wrong address happened to reach.

### The student can see it happened — and VitalSound is the follow-up

An invisible queue is indistinguishable from being ignored, and that was the one
thing a VitalSound ticket genuinely offered that this did not: a number and a
status. So the empty card now shows the person their own receipt —
*"ผู้ดูแลระบบบ้านได้รับเรื่องของคุณแล้ว เมื่อ …"* — and it disappears when the
request is resolved, so its presence always means something is still open.

It carries **nothing about the held list**. The admin's view computes near-miss
candidates; showing the same to the student would say "somebody with your ชื่อ
exists, with a different รหัส" — the membership oracle the neutral failure
message exists to prevent.

**After a week of waiting**, and only then, the card offers VitalSound (category
**IT**) for talking to a person. That is the right order: automatic first because
it costs the student nothing, a human second because by then they want one.

Bugs and website problems go straight to VitalSound as before — that link on the
populated card never moved, and it is correct.

## 7. What the file itself can do to you — fixed, listed for the record

Two failure modes in this area were live bugs, found by review on 2026-09-14 and
reproduced against samo-dev before being fixed. They are here because the shapes
recur, not because they are still open.

- **Two people, one รหัสนักศึกษา.** `students_sid_uniq` is a UNIQUE index, so the
  second row raised **23505** and took its whole 200-row chunk with it, partway
  through an import whose earlier chunks were already written. `io.js` only
  warned. It now **clears the รหัส on every row that shares it** — both people
  import, both see their บ้าน, and either can put their own number back
  (รหัส is self-editable and the index arbitrates). Only รุ่น is blank until
  they do.
- **A held row's สายรหัส was never seeded.** `student_import_unresolved.sai_code`
  carries the same FK to `sais` as `students.sai_code`, but `ensureSais()` was
  fed the imported rows only — so a สาย whose one member in the file has no
  kkumail 23503'd at the very end of the import. Both lists are seeded now
  (`saiCodesToSeed`).

Write-ups: `docs/mistakes/authz-grants.md`, `docs/mistakes/tooling-proofs.md`.
