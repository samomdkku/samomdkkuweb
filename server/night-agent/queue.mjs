#!/usr/bin/env node
// ============================================================
// queue.mjs — the night agent's queue as STATE, not as a read-only prompt.
//
// WHAT THIS REPLACES. NIGHT-TASKS.md used to be input only: the runner read the
// `## ` headings and nothing ever wrote back. So the file could not say what had
// been done, and the agent worked the same six tasks on three consecutive
// nights (2026-09-15 → 09-18), each night branching from a `main` that already
// held the previous night's commits. Every run reported success, because it had
// genuinely done the tasks it was given.
//
// ⛔ THE VERDICT IS NOT THE AGENT'S. The obvious design — let the agent write
// `Status: done` — is the same bug wearing a schema: the agent is still the one
// asserting it. This repo has paid for that exact shape at the deploy step,
// where `DEPLOY_EXIT=0` was reachable with the docs publish skipped, and again
// in `confirm-modal.test.js`, satisfied by a COMMENT. So:
//
//   • the HUMAN writes `Done when: <shell command>` beside the task
//   • the RUNNER executes it and writes `Status:` from the exit code
//   • the AGENT may write only `Note:`, which nothing reads but a person
//
// ⛔ AND THE CHECK RUNS BEFORE THE TASK TOO. A check already passing beforehand
// has proved nothing about the work — it is the missing CONTROL, the thing this
// repo keeps relearning. Passing before means either the task was already done
// (skip it, say so) or the check is wrong. Either way the runner must not
// report the agent finished something.
//
// A task with no mechanical check is allowed, and must say so — `Done when:
// once` gets exactly one attempt and then `needs-review`. "Not checkable" then
// is a decision visible in the file, not a hole somebody forgot.
//
// TWO INDEPENDENT STOPS, because neither alone has to be perfect:
//   1. every task reaching a terminal status, and
//   2. `Budget: N nights`, written by the human, decremented by the runner,
//      which the agent cannot reach.
// A mistyped check breaks (1). Only (2) guarantees termination.
//
// ⛔ REFUSAL COSTS NOTHING. `gate` runs before any `claude -p`, so a finished or
// out-of-budget queue spends no tokens at all. That is why the timer can stay
// armed: there is nothing to disable.
//
//   node queue.mjs gate   <file> [usage.json] → exit 0 run · 10 STOP for good · 3 wait
//   node queue.mjs usage  <file> <usage.json> → exit 0 keep going · 3 stop this run
//   node queue.mjs list   <file>              → JSON: budget + every task
//   node queue.mjs set    <file> <n> <status> → write one task's verdict
//   node queue.mjs plan   <file> <n>          → skip | resume | fresh (what to do with task n)
//   node queue.mjs judge  <file> <n> <after 1|0|-> <before 0|1> <resumed 0|1>
//                                              → write the verdict from what was OBSERVED
//   node queue.mjs cut    <file> <n> <sha>    → task n was cut off by the quota
//   node queue.mjs report <file>              → one line per task, for the morning
//   node queue.mjs spend  <file>              → count one night against Budget
//
// ⛔ 2026-10-13: "ALL 6 DONE" WAS WRONG ABOUT ONE OF THEM. Task 2 was cut off by
// the quota twelve minutes in; the runner swept its edits into a WIP commit
// and gave it NO status. On the next run its check already passed against that
// WIP, so the "passed before" path wrote `done` — and every later run re-ran
// every finished task's check and overwrote its note with "passed before",
// erasing which tasks the agent had finished and which it had not. The handoff
// read six `done`s and wrote "nothing was skipped". Three rules came out of it:
//   1. a task cut off by the quota is `interrupted`, and an interrupted task is
//      RESUMED (the agent finishes and checks the WIP) — never skipped by a
//      check that the half-done work happens to satisfy;
//   2. a check passing before a task the agent never worked on is
//      `needs-review`, not `done` — nobody did it, so a person looks;
//   3. a terminal task is not touched again: its verdict is the record.
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';

export const TERMINAL = ['done', 'blocked', 'needs-review'];
export const MAX_ATTEMPTS = 2;

/**
 * PURE. Parse the queue into its header and its tasks.
 *
 * A task is a `## ` heading plus the lines under it. `Done when:`, `Status:`
 * and `Attempts:` are read out of that block; everything else is the prompt and
 * is passed to the agent untouched.
 */
export function parseQueue(text) {
  const lines = String(text ?? '').split('\n');
  const starts = [];
  lines.forEach((l, i) => { if (/^## /.test(l)) starts.push(i); });

  const headerEnd = starts.length ? starts[0] : lines.length;
  const header = lines.slice(0, headerEnd).join('\n');
  const budgetM = header.match(/^Budget:\s*(\d+)/mi);
  const usedM = header.match(/^Nights used:\s*(\d+)/mi);
  const untilM = header.match(/^Until:\s*(\S+)/mi);
  const reserveM = header.match(/^Reserve sessions:\s*(\d+)/mi);
  const branchM = header.match(/^Branch:\s*(agent\/[\w.-]+)\s*$/mi);

  const field = (block, name) => {
    const m = block.match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'mi'));
    return m ? m[1].trim() : null;
  };

  const tasks = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const block = lines.slice(start, end).join('\n');
    const status = (field(block, 'Status') || 'todo').toLowerCase();
    return {
      index: i,
      line: start,
      endLine: end,
      title: lines[start].replace(/^##\s*/, '').trim(),
      check: field(block, 'Done when'),
      status,
      attempts: Number(field(block, 'Attempts') || 0) || 0,
      note: field(block, 'Note') || '',
      block,
    };
  });

  return {
    header,
    // No Budget line at all means ONE night. The old behaviour was "for ever",
    // and a default that keeps running is the bug this file exists to end —
    // an omitted field must fail toward stopping.
    budget: budgetM ? Number(budgetM[1]) : 1,
    used: usedM ? Number(usedM[1]) : 0,
    // A hard end. Past it the queue STOPS for good, finished or not — the
    // quota after that instant is somebody else's (next week's, the owner's).
    until: untilM && Number.isFinite(Date.parse(untilM[1])) ? Date.parse(untilM[1]) : null,
    // 5-hour sessions of the WEEKLY pool kept back for the humans. Absent → 1:
    // an omitted field fails toward leaving the owner something.
    reserveSessions: reserveM ? Number(reserveM[1]) : 1,
    // One branch for the whole queue, so run 2 builds on run 1. Absent → the
    // runner names one by date, as before.
    branch: branchM ? branchM[1] : null,
    tasks,
  };
}

/** Tasks still worth spending a night on. */
export function pending(q) {
  return q.tasks.filter((t) => !TERMINAL.includes(t.status));
}

/**
 * PURE. Should tonight run at all, and if not, why — in words a person reads
 * off a Discord post at 22:41 without opening anything.
 */
export function gate(q, nowMs = Date.now()) {
  if (!q.tasks.length) return { run: false, why: 'ไม่มีงานในคิว' };
  if (q.until != null && nowMs >= q.until) {
    return { run: false, why: `เลยเวลาสิ้นสุดของคิวนี้แล้ว (${new Date(q.until).toISOString()}) — หยุดถาวร ยังเหลือ ${pending(q).length} งาน` };
  }
  const left = pending(q);
  if (!left.length) {
    const done = q.tasks.filter((t) => t.status === 'done').length;
    return {
      run: false,
      why: `คิวนี้ทำครบแล้ว (เสร็จ ${done}/${q.tasks.length}) — เขียนคิวใหม่ก่อนถึงจะรันได้อีก`,
    };
  }
  if (q.used >= q.budget) {
    return {
      run: false,
      why: `ใช้ครบ ${q.budget} คืนแล้ว แต่ยังเหลือ ${left.length} งาน — ต่ออายุด้วยการแก้ Budget ถ้าต้องการ`,
    };
  }
  return { run: true, why: `เหลือ ${left.length} งาน · คืนที่ ${q.used + 1} จาก ${q.budget}` };
}

// ── the quota ─────────────────────────────────────────────────────────────
// One 5-hour session is 1/7 of the weekly pool on this plan (claude_settings:
// session_pool_pct 100, week_pool_pct 700 — measured, 2026-10-13).
export const SESSION_SHARE_OF_WEEK = 100 / 7;
// A task can run up to an hour between two looks at the numbers, and the
// numbers are up to 15 minutes old. Heavy use spends ~4-6% of the week per
// hour, so stop starting work this far BEFORE the reserve, or the reserve is
// what gets spent.
export const WEEK_SAFETY_PCT = 6;
export const FIVE_HOUR_CEIL_PCT = 90;
export const SNAPSHOT_MAX_AGE_MIN = 45;

/**
 * PURE. May work START (or continue) right now, given the usage reporter's
 * latest snapshot? Never a permanent stop — a full window or week resets, so
 * the answer is "wait", and waiting costs nothing.
 *
 * ⛔ NO SNAPSHOT MEANS WAIT, NOT GO. Without the numbers the reserve cannot be
 * honoured, and the reserve is the owner's.
 */
export function usageGate(snap, nowMs, reserveSessions = 1) {
  const sampled = snap && Date.parse(snap.sampled_at);
  if (!snap || !Number.isFinite(sampled)) {
    return { run: false, why: 'ยังไม่มีข้อมูลการใช้งาน Claude ล่าสุด — รอรอบหน้า' };
  }
  if (nowMs - sampled > SNAPSHOT_MAX_AGE_MIN * 60000) {
    return { run: false, why: `ข้อมูลการใช้งานเก่าเกิน ${SNAPSHOT_MAX_AGE_MIN} นาที — รอรอบหน้า` };
  }
  const weekCap = 100 - reserveSessions * SESSION_SHARE_OF_WEEK - WEEK_SAFETY_PCT;
  const weekLive = Date.parse(snap.seven_day_resets_at) > nowMs;
  if (weekLive && Number(snap.seven_day_pct) >= weekCap) {
    return { run: false, why: `ใช้โควตาสัปดาห์ไป ${snap.seven_day_pct}% แล้ว — เก็บที่เหลือไว้ให้เจ้าของ ${reserveSessions} รอบ (หยุดที่ ${weekCap.toFixed(0)}%)` };
  }
  const windowLive = Date.parse(snap.five_hour_resets_at) > nowMs;
  if (windowLive && Number(snap.five_hour_pct) >= FIVE_HOUR_CEIL_PCT) {
    return { run: false, why: `รอบ 5 ชั่วโมงนี้ใช้ไป ${snap.five_hour_pct}% แล้ว — รอรีเซ็ต ${snap.five_hour_resets_at}` };
  }
  return { run: true, why: `สัปดาห์ ${snap.seven_day_pct ?? '?'}% (หยุดที่ ${weekCap.toFixed(0)}%) · รอบนี้ ${snap.five_hour_pct ?? '?'}%` };
}

/**
 * PURE. What the runner does with a task before calling anybody.
 *   skip   — terminal: its verdict is the record; do not re-run its check and
 *            never overwrite its note (that erased the 2026-10-13 history).
 *   resume — cut off by the quota last time: hand it back to the agent to
 *            FINISH. Its check is not consulted first, because the half-done
 *            work in the WIP commit can satisfy it.
 *   fresh  — never attempted: run the check first (the missing control).
 */
export function plan(t) {
  if (TERMINAL.includes(t.status)) return 'skip';
  if (t.status === 'interrupted') return 'resume';
  return 'fresh';
}

export const NOTE_PASSED = 'ผ่านวิธีตรวจ';
export const NOTE_RESUMED = 'ถูกตัดกลางทางรอบก่อน แล้วทำต่อจนผ่านวิธีตรวจ';
export const NOTE_ALREADY = 'วิธีตรวจผ่านตั้งแต่ก่อนเริ่ม — agent ไม่ได้ทำงานนี้ ต้องให้คนดูว่าเสร็จอยู่แล้วจริง หรือวิธีตรวจหลวมไป';
// The agent DID work on it in an earlier run, whose check then failed; now it
// passes with nothing done in between. Either that run's work was fine and the
// check was flaky, or something else changed — a person decides which.
export const NOTE_LATE_PASS = 'วิธีตรวจผ่านตอนเริ่มรอบนี้ ทั้งที่รอบก่อน agent ทำแล้วไม่ผ่าน — ต้องให้คนดูว่างานรอบก่อนใช้ได้จริง หรือวิธีตรวจไม่นิ่ง';

/**
 * PURE. The verdict for one task, from facts the runner OBSERVED.
 *
 * @param {object} t          the task
 * @param {boolean|null} passed  the check's result after the attempt; null when
 *                               the task carries no mechanical check
 * @param {boolean} passedBefore was it already passing before the agent ran
 * @param {boolean} resumed      this attempt finished a task the quota cut off
 * @returns {{status: string, attempts: number, note: string}}
 */
export function verdict(t, passed, passedBefore = false, resumed = false) {
  // Nobody worked on it, so nobody may be credited with it. A person decides
  // whether it was done already or the check is too loose to tell.
  if (passedBefore) {
    return { status: 'needs-review', attempts: t.attempts, note: t.attempts > 0 ? NOTE_LATE_PASS : NOTE_ALREADY };
  }
  const attempts = t.attempts + 1;
  if (passed === true) return { status: 'done', attempts, note: resumed ? NOTE_RESUMED : NOTE_PASSED };
  // No check to run. ONE attempt, then a human looks — never retried, because
  // retrying something nothing can judge is how a night gets spent on nothing.
  if (passed === null) return { status: 'needs-review', attempts, note: 'ไม่มีวิธีตรวจอัตโนมัติ — ต้องให้คนอ่าน' };
  if (attempts >= MAX_ATTEMPTS) {
    return { status: 'blocked', attempts, note: `ลองแล้ว ${attempts} ครั้ง ยังไม่ผ่านวิธีตรวจ — หยุดลองแล้ว` };
  }
  return { status: 'todo', attempts, note: `ลองแล้ว ${attempts} ครั้ง ยังไม่ผ่าน` };
}

/**
 * PURE. A task the quota cut off. NOT an attempt (two windows that each ran
 * out must not block it), NOT terminal (the next run resumes it), and the note
 * names the WIP commit so the morning reviewer can read exactly what was left.
 */
export function interrupted(t, sha) {
  return {
    status: 'interrupted',
    attempts: t.attempts,
    note: `ถูกตัดกลางทางเพราะโควตาหมด (WIP ${sha || '?'}) — รอบหน้าต้องทำต่อ ห้ามข้าม`,
  };
}

/**
 * PURE. One line per task, in the runner's words — the part of the morning
 * report that does not depend on the agent describing its own night.
 * A task counts as clean ONLY when it is done AND passed its check in the run
 * that worked on it, uninterrupted.
 */
export function report(q) {
  const lines = q.tasks.map((t) => {
    const clean = t.status === 'done' && t.note === NOTE_PASSED;
    return `${clean ? '✓' : '!'} [${t.status}] ${t.title}${t.note ? ` — ${t.note}` : ''}`;
  });
  const flagged = q.tasks.filter((t) => !(t.status === 'done' && t.note === NOTE_PASSED)).length;
  lines.push(flagged
    ? `ต้องให้คนดู ${flagged} งาน (ไม่ได้จบแบบปกติในรอบเดียว) — อย่าสรุปว่าคืนนี้เรียบร้อย`
    : `ทุกงานผ่านวิธีตรวจในรอบที่ทำ ไม่มีงานไหนถูกตัดหรือถูกข้าม`);
  return lines.join('\n');
}

/** PURE. The queue text with one task's Status/Attempts/Note rewritten. */
export function writeTask(text, index, { status, attempts, note }) {
  const q = parseQueue(text);
  const t = q.tasks[index];
  if (!t) return text;
  const lines = text.split('\n');
  const body = lines.slice(t.line, t.endLine);

  const upsert = (name, value) => {
    const at = body.findIndex((l) => new RegExp(`^${name}:`, 'i').test(l));
    if (value == null) { if (at >= 0) body.splice(at, 1); return; }
    if (at >= 0) body[at] = `${name}: ${value}`;
    // Right under the heading, so a person scanning `## ` lines sees the state
    // without reading the prompt.
    else body.splice(1, 0, `${name}: ${value}`);
  };
  upsert('Status', status);
  upsert('Attempts', String(attempts));
  upsert('Note', note || null);

  return [...lines.slice(0, t.line), ...body, ...lines.slice(t.endLine)].join('\n');
}

/** PURE. The queue text with one more night counted against Budget. */
export function spendNight(text) {
  const q = parseQueue(text);
  const next = q.used + 1;
  if (/^Nights used:/mi.test(q.header)) {
    return text.replace(/^Nights used:.*$/mi, `Nights used: ${next}`);
  }
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^Budget:/i.test(l));
  const put = at >= 0 ? at + 1 : 1;
  lines.splice(put, 0, `Nights used: ${next}`);
  return lines.join('\n');
}

// ---- CLI ------------------------------------------------------------------
const [, , cmd, file, ...rest] = process.argv;
if (cmd && file) {
  const read = () => readFileSync(file, 'utf8');
  const readUsage = (p) => { try { return p ? JSON.parse(readFileSync(p, 'utf8')) : null; } catch { return null; } };
  if (cmd === 'gate') {
    // Exit codes are the contract with run-night.sh:
    //   0 run · 10 the queue is OVER (the runner writes STOPPED; systemd then
    //   never starts it again) · 3 not now (quota) — try at the next tick.
    // ⛔ "OVER" IS 10, NOT 1. A node crash also exits 1 — the rehearsal of
    // 2026-10-13 read a MODULE_NOT_FOUND as "queue finished" and wrote STOPPED
    // with a stack trace for a reason. Any code the runner does not know means
    // "something is wrong: do not run, say so", never "done".
    const q = parseQueue(read());
    const g = gate(q);
    if (!g.run) { console.log(g.why); process.exit(10); }
    if (rest[0]) {
      const u = usageGate(readUsage(rest[0]), Date.now(), q.reserveSessions);
      if (!u.run) { console.log(u.why); process.exit(3); }
      console.log(`${g.why} · ${u.why}`);
    } else {
      console.log(g.why);
    }
    process.exit(0);
  } else if (cmd === 'usage') {
    const q = parseQueue(read());
    const u = usageGate(readUsage(rest[0]), Date.now(), q.reserveSessions);
    console.log(u.why);
    process.exit(u.run ? 0 : 3);
  } else if (cmd === 'list') {
    const q = parseQueue(read());
    console.log(JSON.stringify({
      budget: q.budget,
      used: q.used,
      branch: q.branch,
      tasks: q.tasks.map(({ index, title, check, status, attempts }) =>
        ({ index, title, check, status, attempts })),
    }));
  } else if (cmd === 'set') {
    const [n, status, attempts, ...note] = rest;
    writeFileSync(file, writeTask(read(), Number(n),
      { status, attempts: Number(attempts || 0), note: note.join(' ') }), 'utf8');
  } else if (cmd === 'plan') {
    const t = parseQueue(read()).tasks[Number(rest[0])];
    console.log(t ? plan(t) : 'skip');
  } else if (cmd === 'judge') {
    // The ONE implementation of the verdict. run-night.sh used to restate it in
    // bash beside this function (mistakes class 6) — and the two disagreed
    // about nothing only because nobody had changed either yet.
    const [n, after, before, resumed] = rest;
    const t = parseQueue(read()).tasks[Number(n)];
    if (!t) process.exit(2);
    const v = verdict(t, after === '1' ? true : after === '0' ? false : null,
      before === '1', resumed === '1');
    writeFileSync(file, writeTask(read(), Number(n), v), 'utf8');
    console.log(`${v.status}\t${v.note}`);
  } else if (cmd === 'cut') {
    const [n, sha] = rest;
    const t = parseQueue(read()).tasks[Number(n)];
    if (!t) process.exit(2);
    writeFileSync(file, writeTask(read(), Number(n), interrupted(t, sha)), 'utf8');
  } else if (cmd === 'report') {
    console.log(report(parseQueue(read())));
  } else if (cmd === 'spend') {
    writeFileSync(file, spendNight(read()), 'utf8');
  } else {
    console.error(`unknown command: ${cmd}`);
    process.exit(2);
  }
}
