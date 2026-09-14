#!/usr/bin/env node
// ============================================================
// house-sync-registry.mjs — fill the holes an import left in the registry.
//
// WHY THIS EXISTS SEPARATELY FROM 0194. That migration fixes the TRIGGER, so no
// future import leaves a hole. It cannot fix the rows already in the table: the
// trigger fires on new rows, and the 1,611 that came in on 2026-09-14 are past.
// This is that one-off, written as a tool rather than as a migration for one
// reason — each registry write cascades through eleven triggers and takes about
// 0.9 s, so the whole set in a single statement times out against the
// Management API. It batches, and it is idempotent: run it again and it finds
// nothing to do.
//
// WHAT IT WILL NOT DO. It never overwrites a value the registry already holds —
// every column is `coalesce(REGISTRY, house)`, the same precedence 0189 set and
// 0194 now encodes in the trigger. A person whose ทีม SAMO record disagrees with
// the file is NOT touched here; that is an identity conflict and it has its own
// screen, because a disagreement is a question for the person, not a merge.
//
//   node tools/house-sync-registry.mjs            # DRY RUN — counts only
//   node tools/house-sync-registry.mjs --commit   # fills, in batches
// ============================================================
import { loadEnv, announceTarget, runSql } from './env-lib.mjs';

const COMMIT = process.argv.includes('--commit');
const BATCH = 25;
const target = announceTarget(loadEnv());
const ask = async (sql) => JSON.parse(await runSql(sql, target));

// The holes, counted the way a human would ask about them. `photo` is on the
// other side — the registry has it and the student does not — and it needs no
// write of its own: filling any column on `people` fires person_mirror_down,
// which carries the photo the rest of the way.
const COUNTS = `
select 'ชื่อ / นามสกุล'  as field, count(*)::int as n from public.people p
   join public.students s on s.person_id = p.id
  where (p.first_name_th is null and s.first_name_th is not null)
     or (p.last_name_th  is null and s.last_name_th  is not null)
union all select 'ชื่อเล่น', count(*)::int from public.people p
   join public.students s on s.person_id = p.id
  where p.nickname is null and s.nickname is not null
union all select 'รหัสนักศึกษา', count(*)::int from public.people p
   join public.students s on s.person_id = p.id
  where p.student_id is null and s.student_id is not null
union all select 'สาขา', count(*)::int from public.people p
   join public.students s on s.person_id = p.id
  where p.major is null and s.major is not null
union all select 'รุ่น', count(*)::int from public.people p
   join public.students s on s.person_id = p.id
  where p.cohort_year is null and s.cohort_year is not null
union all select 'รูป (registry → ระบบบ้าน, ตามหลังเอง)', count(*)::int from public.people p
   join public.students s on s.person_id = p.id
  where s.photo_url is null and p.photo_url is not null
order by field`;

// ⛔ The whole repair in one predicate, so the dry run and the write cannot
// describe different sets. `to_fill` is also what decides when to stop.
const TO_FILL = `
  select p.id from public.people p
    join public.students s on s.person_id = p.id
   where (p.first_name_th, p.last_name_th, p.nickname, p.student_id, p.major, p.cohort_year)
         is distinct from
         (coalesce(p.first_name_th, s.first_name_th),
          coalesce(p.last_name_th,  s.last_name_th),
          coalesce(p.nickname,      s.nickname),
          coalesce(p.student_id,    s.student_id),
          coalesce(p.major,         s.major),
          coalesce(p.cohort_year,   s.cohort_year))`;

// The other direction, declared up here because the early exit below has to ask
// about BOTH phases. An exit that knew only phase 1 would skip phase 2 whenever
// the registry happened to be full — which is the same shape as the bug this
// tool exists to repair, and it did exactly that on its first run.
const PHOTO_TODO = `
  select p.id from public.people p
    join public.students s on s.person_id = p.id
   where s.photo_url is null and p.photo_url is not null`;

const show = async (title) => {
  console.log(`\n${title}`);
  for (const r of await ask(COUNTS)) {
    console.log(`  ${String(r.n).padStart(5)}  ${r.field}`);
  }
};

await show('ก่อน — ช่องที่ยังว่างในทะเบียนกลาง (people):');
const [{ n: todo }] = await ask(`select count(*)::int as n from (${TO_FILL}) x`);
console.log(`\n  ต้องเติมทั้งหมด ${todo} คน`);

const [{ n: photosTodo }] = await ask(`select count(*)::int as n from (${PHOTO_TODO}) x`);
if (photosTodo) console.log(`  รูปที่ต้องส่งต่อไปยังระบบบ้าน ${photosTodo} คน`);

if (!todo && !photosTodo) { console.log('\n  ✓ ไม่มีอะไรต้องทำ\n'); process.exit(0); }
if (!COMMIT) {
  console.log(`\n  DRY RUN — ยังไม่เขียนอะไร ใส่ --commit เพื่อทำจริง `
    + `(ประมาณ ${Math.ceil(((todo + photosTodo) * 0.9) / 60)} นาที, ครั้งละ ${BATCH} คน)\n`);
  process.exit(0);
}

let done = 0;
for (let pass = 0; todo; pass += 1) {
  // Re-selected every pass rather than paged with an offset: the rows drop OUT
  // of `TO_FILL` as they are filled, so an offset would skip the ones that
  // shuffled up behind it — the classic paging-a-shrinking-set bug.
  const rows = await ask(`
    update public.people p
       set first_name_th = coalesce(p.first_name_th, s.first_name_th),
           last_name_th  = coalesce(p.last_name_th,  s.last_name_th),
           nickname      = coalesce(p.nickname,      s.nickname),
           student_id    = coalesce(p.student_id,    s.student_id),
           major         = coalesce(p.major,         s.major),
           cohort_year   = coalesce(p.cohort_year,   s.cohort_year)
      from public.students s
     where s.person_id = p.id
       and p.id in (select id from (${TO_FILL}) t order by id limit ${BATCH})
    returning p.id`);
  if (!rows.length) break;
  const after = (await ask(`select count(*)::int as n from (${TO_FILL}) x`))[0].n;
  if (after >= todo - done) {
    console.error(`\n  ⛔ หยุด: เขียน ${rows.length} แถวแล้วแต่จำนวนที่ค้างไม่ลดลง — อย่าวนต่อ\n`);
    break;
  }
  done = todo - after;
  console.log(`  …เติมแล้ว ${done}/${todo}`);
}

// ── phase 2: the other direction, which is the SAME stall ─────────────────
//
// `person_mirror_down` fires on an UPDATE of `people`, so a person whose
// registry row needed no filling never had one — and their ระบบบ้าน row never
// received the photo the registry was already holding. Phase 1 fixed this for
// everyone it touched; these are the rest.
//
// Nothing is computed here: the row's own photo is RE-ASSIGNED and the existing
// mirror does the work, so this cannot disagree with what a real registry edit
// would do.
//
// ⛔ `set photo_url = p.photo_url`, NOT `set updated_at = now()`. `people_mirror_down`
// is `AFTER UPDATE **OF** full_name, …, photo_url, …` — a column list — and
// `UPDATE OF` fires on the column being ASSIGNED, whether or not the value
// changes. A touch that names no listed column fires nothing at all: the first
// version of this loop did exactly that, so its predicate never shrank and it
// ran 1,000 no-op writes before the progress check below existed to stop it.
const photos = photosTodo;
if (photos) {
  console.log(`\n  รูปที่ต้องส่งต่อไปยังระบบบ้าน: ${photos} คน`);
  let sent = 0;
  for (let pass = 0; ; pass += 1) {
    const before = (await ask(`select count(*)::int as n from (${PHOTO_TODO}) x`))[0].n;
    if (!before) break;
    const rows = await ask(`
      update public.people p set photo_url = p.photo_url
       where p.id in (select id from (${PHOTO_TODO}) t order by id limit ${BATCH})
      returning p.id`);
    const after = (await ask(`select count(*)::int as n from (${PHOTO_TODO}) x`))[0].n;
    // ⛔ PROGRESS, not passes. This loop ends when the WORK is done, so its
    // termination depends on each write actually shrinking the predicate — and
    // when it did not, a pass counter let it run 1,000 times before stopping.
    // Ask the question the loop is really asking.
    if (after >= before) {
      console.error(`\n  ⛔ หยุด: เขียน ${rows.length} แถวแล้วแต่จำนวนที่ค้างไม่ลดลง `
        + `(${before} → ${after}). แปลว่าการเขียนไม่ได้ทำให้เงื่อนไขเปลี่ยน — อย่าวนต่อ\n`);
      break;
    }
    sent += before - after;
    console.log(`  …ส่งแล้ว ${sent}/${photos}`);
  }
}

await show('หลัง:');
const [{ n: left }] = await ask(`select count(*)::int as n from (${TO_FILL}) x`);
const [{ n: photoLeft }] = await ask(`select count(*)::int as n from (${PHOTO_TODO}) x`);
console.log(`\n  ${left === 0 && photoLeft === 0 ? '✓ ครบแล้ว'
  : `⚠️ ยังเหลือ ${left} ช่องว่าง · ${photoLeft} รูป`}\n`);
