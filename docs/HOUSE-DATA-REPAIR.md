# ซ่อมข้อมูลนักศึกษาในระบบบ้าน — ใครทำอะไรได้ ตามแต่ละช่องที่ผิดหรือหาย

What a student can fix themselves, what needs an admin, and what has to go back
to ฝ่ายข้อมูล — for every combination of ชื่อ · นามสกุล · รหัสนักศึกษา · kkumail ·
สายรหัส being **missing** or **wrong**.

Written against the live system on 2026-09-14 (migrations 0188–0190). Every
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

> **The dead end to know about.** A student whose held row has a *wrong* รหัส or
> a mistyped ชื่อ types their real details, gets no match, and reads
> *"ฝ่ายข้อมูลยังไม่ได้ส่งชื่อของคุณมา"* — which is false. The message is
> deliberately identical for every miss so the form cannot be used to test one
> guess at a time against 165 real students' names, and that anti-enumeration
> property is worth more than a precise message. **The cost is real and it is
> paid by the admin**, who has to find these people by hand. See §6.

---

## 4. Case C — kkumail is present but WRONG

This is the only case that fails **open**, and it is the one to design against.
Everything in Cases A and B fails closed: you see nothing, which is obviously
broken and gets reported. Here, something works — for the wrong person.

| Sub-case | What actually happens | Detected? |
|---|---|---|
| **C1 — it duplicates another row in the same file** | The importer keeps neither: both are held, because line order cannot say whose address it is. If a human has named the owner (`MAIL_OWNER` in `tools/clean-house-csv.mjs`), the owner imports and the other is held with a blank address. | **Yes**, at import time, by name. |
| **C2 — it is another real student's address, and they are not in the file** | Your row imports under their address. **They sign in and see your ชื่อ, รหัส, สาย and บ้าน** — and can edit it. You look like you were never sent. Verified by construction on samo-dev: `get_my_student_record` joins on kkumail and nothing else. | **No.** Nothing flags it. |
| **C3 — a typo that belongs to nobody** (`kanokpron` for `kanokporn`) | The row imports. Nobody can ever sign into it. You look like you were never sent. Domain typos are repaired by the cleaner; a **local-part** typo is unrepairable and indistinguishable from a real address. | **No**, not directly — but see below. |

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
3. **The admin types an address in** — a held row that carries neither, or one
   whose รหัส/ชื่อ is wrong.
4. **The admin approves a สาย change** — the only field a student cannot set.
5. **Back to ฝ่ายข้อมูล** — an empty seat, a missing person, a duplicate address
   whose owner is unknown, or a สายรหัส nobody can vouch for. **Never invent a
   สาย**: บ้าน is its last digit, and a guess puts a real student in the wrong
   house with nothing downstream able to tell.

---

## 6. Known gaps — what is NOT covered today

Stated plainly rather than left for someone to rediscover.

**G1. A student who cannot claim has no structured way to say so.** Cases B-row-2,
B-row-3 and "not in the file at all" all end at the same dead end, and the only
exit is the VitalSound link on the empty card. **VitalSound is the confidential
service desk**, not a data-entry queue — routing "my house record is missing"
there is a category error the empty card currently commits. What is missing is a
one-button report that carries the caller's verified kkumail plus what they
typed, landing in the admin pane beside the held list. That is exactly the
information an admin needs to match them by hand, and today they have to ask for
it in a ticket thread.

**G2. A student looking at somebody else's record (C2) has no report path at
all.** `request_my_change` is "change a field on *my* record"; there is no "this
whole record is not mine". Today: VitalSound, free text.

Both gaps want the same small mechanism, which is why they are listed together.
Neither is built. **Decide who owns the queue before building it** — a third
admin queue beside คำขอแก้ไข and รายชื่อที่ยังนำเข้าไม่ได้ needs a reason to
exist that "it was easy" does not supply.

---

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
