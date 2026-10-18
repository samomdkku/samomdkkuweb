// The night agent's queue state machine.
//
// It exists because the queue used to have NO state: the runner read the `## `
// headings and nothing wrote back, so the same six tasks ran three nights in a
// row against a `main` that already held the previous night's commits. Nobody
// caught it, because every run reported success — it had done what it was told.
//
// What these assertions are really pinning is the answer to "who says it is
// done". Not the agent. The human writes the check, the runner runs it, and
// the status is the exit code. Every test below is a way that could quietly
// turn back into the agent's own opinion.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseQueue, gate, verdict, writeTask, spendNight, pending, MAX_ATTEMPTS,
  usageGate, SESSION_SHARE_OF_WEEK, WEEK_SAFETY_PCT,
  plan, interrupted, report, NOTE_PASSED, NOTE_RESUMED,
  boardGate, quotaGate, allowanceAtStart, watchGate, classifyOutput, MIN_START_PCT, BOOKING_MARGIN_PCT,
  CUT_REASONS,
} from '../../server/night-agent/queue.mjs';

const Q = `# NIGHT-TASKS

Budget: 3 nights

## 1. build the thing
Done when: npm test

## 2. plan the other thing
Done when: once

## 3. already finished
Status: done
Done when: true
`;

describe('parseQueue', () => {
  it('reads the budget, the tasks and their checks', () => {
    const q = parseQueue(Q);
    expect(q.budget).toBe(3);
    expect(q.used).toBe(0);
    expect(q.tasks.map((t) => t.title)).toEqual([
      '1. build the thing', '2. plan the other thing', '3. already finished']);
    expect(q.tasks[0].check).toBe('npm test');
    expect(q.tasks[0].status).toBe('todo');
    expect(q.tasks[2].status).toBe('done');
  });

  it('a queue with NO Budget line gets ONE night, not forever', () => {
    // The old behaviour was unbounded, which is the bug this file ends. An
    // omitted field has to fail toward stopping.
    expect(parseQueue('## 1. x\n').budget).toBe(1);
  });
});

describe('gate — refusing costs nothing, so it is where the loop is stopped', () => {
  it('runs while work and budget remain', () => {
    expect(gate(parseQueue(Q)).run).toBe(true);
  });

  it('refuses a queue whose tasks are all terminal', () => {
    const done = Q.replace(/^Done when: npm test$/m, 'Done when: npm test\nStatus: done')
      .replace(/^Done when: once$/m, 'Done when: once\nStatus: blocked');
    const g = gate(parseQueue(done));
    expect(g.run).toBe(false);
    expect(g.why).toContain('ทำครบแล้ว');
  });

  it('refuses when the nights are spent even though work remains', () => {
    // The second stop, and the one that does not depend on the checks being
    // right. A mistyped `Done when:` never terminates on its own.
    const g = gate(parseQueue(Q.replace('Budget: 3 nights', 'Budget: 2 nights\nNights used: 2')));
    expect(g.run).toBe(false);
    expect(g.why).toContain('ใช้ครบ 2 คืน');
  });

  it('refuses an empty queue rather than treating it as finished work', () => {
    expect(gate(parseQueue('# nothing here\n')).run).toBe(false);
  });
});

describe('verdict — from what the runner observed, never from what the agent said', () => {
  const t = { attempts: 0 };

  it('a passing check is done', () => {
    expect(verdict(t, true).status).toBe('done');
  });

  it('a check that passed BEFORE the agent ran proves nothing about the agent', () => {
    // The missing control. Either the task was already done or the check is
    // wrong; in neither case did the agent finish something — so it is NOT
    // `done` (which reads as "the agent did it"), it is a person's call.
    const v = verdict(t, true, true);
    expect(v.status).toBe('needs-review');
    expect(v.note).toContain('ผ่านตั้งแต่ก่อนเริ่ม');
    expect(pending({ tasks: [{ status: v.status }] })).toEqual([]); // still ends the queue
  });

  it('no mechanical check means ONE attempt, then a human', () => {
    const v = verdict(t, null);
    expect(v.status).toBe('needs-review');
    // and never retried: that is what keeps an unjudgeable task from eating
    // every remaining night.
    expect(pending({ tasks: [{ status: v.status }] })).toEqual([]);
  });

  it('a failing check is retried once, then blocked', () => {
    expect(verdict({ attempts: 0 }, false).status).toBe('todo');
    expect(verdict({ attempts: MAX_ATTEMPTS - 1 }, false).status).toBe('blocked');
  });
});

describe('writeTask / spendNight — the runner owns the file', () => {
  it('puts the state under the heading, where a person scanning sees it', () => {
    const out = writeTask(Q, 0, { status: 'done', attempts: 1, note: 'ok' });
    const lines = out.split('\n');
    const at = lines.findIndex((l) => l.startsWith('## 1.'));
    expect(lines.slice(at + 1, at + 4).join('\n')).toContain('Status: done');
    expect(parseQueue(out).tasks[0].status).toBe('done');
    expect(parseQueue(out).tasks[0].attempts).toBe(1);
  });

  it('rewrites a status rather than adding a second one', () => {
    const once = writeTask(Q, 0, { status: 'todo', attempts: 1, note: '' });
    const twice = writeTask(once, 0, { status: 'blocked', attempts: 2, note: '' });
    expect(twice.match(/^Status:/gm).length).toBe(2); // task 1 and task 3, not 3
    expect(parseQueue(twice).tasks[0].status).toBe('blocked');
  });

  it('does not disturb the other tasks', () => {
    const out = writeTask(Q, 0, { status: 'done', attempts: 1, note: 'x' });
    expect(parseQueue(out).tasks[1].title).toBe('2. plan the other thing');
    expect(parseQueue(out).tasks[2].status).toBe('done');
  });

  it('counts nights, and keeps counting after the first', () => {
    const one = spendNight(Q);
    expect(parseQueue(one).used).toBe(1);
    expect(parseQueue(spendNight(one)).used).toBe(2);
  });

  it('the whole loop terminates: three nights of failure end blocked, not running', () => {
    // The property, end to end: a task whose check never passes must stop the
    // queue rather than consume every night. Both stops are exercised.
    let text = Q.replace(/^Done when: once$/m, 'Done when: false');
    for (let night = 0; night < 5; night += 1) {
      const q = parseQueue(text);
      if (!gate(q).run) break;
      for (const t of pending(q)) {
        const v = verdict(t, false);
        text = writeTask(text, t.index, { status: v.status, attempts: t.attempts + 1, note: v.note });
      }
      text = spendNight(text);
    }
    const end = parseQueue(text);
    expect(gate(end).run).toBe(false);
    expect(end.tasks.slice(0, 2).every((t) => t.status === 'blocked')).toBe(true);
    expect(end.used).toBeLessThanOrEqual(end.budget);
  });
});

// ── 2026-10-13: several 5-hour windows in a row, one session kept for the owner ──
describe('the header: a hard end, the reserve, one branch for the whole queue', () => {
  const H = `# q\nBudget: 6 runs\nUntil: 2026-10-14T08:00:00Z\nReserve sessions: 1\nBranch: agent/2026-10-13\n\n## 1. a\nDone when: false\n`;
  it('reads them', () => {
    const q = parseQueue(H);
    expect(q.until).toBe(Date.parse('2026-10-14T08:00:00Z'));
    expect(q.reserveSessions).toBe(1);
    expect(q.branch).toBe('agent/2026-10-13');
  });
  it('past Until the queue stops FOR GOOD, finished or not', () => {
    const q = parseQueue(H);
    expect(gate(q, Date.parse('2026-10-14T07:59:00Z')).run).toBe(true);
    const g = gate(q, Date.parse('2026-10-14T08:00:00Z'));
    expect(g.run).toBe(false);
    expect(g.why).toMatch(/หยุดถาวร/);
  });
  it('an omitted reserve keeps ONE session back, never zero', () => {
    expect(parseQueue('Budget: 1\n\n## a\nDone when: once\n').reserveSessions).toBe(1);
  });
  it('a branch line that is not agent/<name> is ignored, not trusted', () => {
    expect(parseQueue('Branch: main\n\n## a\nDone when: once\n').branch).toBe(null);
  });
});

describe('usageGate — the owner\'s session is never the one spent', () => {
  const now = Date.parse('2026-10-13T00:00:00Z');
  const snap = (o) => ({ sampled_at: '2026-10-12T23:55:00Z', five_hour_pct: 10,
    five_hour_resets_at: '2026-10-13T03:00:00Z', seven_day_pct: 13,
    seven_day_resets_at: '2026-10-14T08:59:59Z', ...o });
  const cap = 100 - SESSION_SHARE_OF_WEEK - WEEK_SAFETY_PCT;

  it('runs with room in the window and the week (the real numbers on 2026-10-13)', () => {
    expect(usageGate(snap(), now, 1).run).toBe(true);
  });
  it('stops starting work a safety margin BEFORE the reserve, not at it', () => {
    expect(cap).toBeGreaterThan(75);
    expect(cap).toBeLessThan(85.72);           // 100 − one session
    expect(usageGate(snap({ seven_day_pct: cap - 0.1 }), now, 1).run).toBe(true);
    expect(usageGate(snap({ seven_day_pct: cap }), now, 1).run).toBe(false);
  });
  it('two sessions reserved stops earlier than one', () => {
    expect(usageGate(snap({ seven_day_pct: cap - 5 }), now, 2).run).toBe(false);
  });
  it('a spent 5-hour window waits for its reset, then runs again', () => {
    expect(usageGate(snap({ five_hour_pct: 95 }), now, 1).run).toBe(false);
    expect(usageGate(snap({ five_hour_pct: 95, five_hour_resets_at: '2026-10-12T23:00:00Z' }), now, 1).run).toBe(true);
  });
  it('NO numbers, or stale numbers, means wait — the reserve cannot be honoured blind', () => {
    expect(usageGate(null, now, 1).run).toBe(false);
    expect(usageGate(snap({ sampled_at: '2026-10-12T22:00:00Z' }), now, 1).run).toBe(false);
  });
});

// ── 2026-10-13: the quota cut task 2 off, and the morning report said "all done" ──
describe('a task the quota cut off is RESUMED, never credited by a check its WIP passes', () => {
  const Q2 = `# NIGHT-TASKS
Budget: 6 runs

## 1. tags
Done when: true

## 2. every ฝ่าย
Done when: test -f the-migration.sql
`;

  it('cut → interrupted: not an attempt, not terminal, and the note names the WIP commit', () => {
    const t = parseQueue(Q2).tasks[1];
    const v = interrupted(t, '156d6e1');
    expect(v.status).toBe('interrupted');
    expect(v.attempts).toBe(0);
    expect(v.note).toContain('156d6e1');
    const text = writeTask(Q2, 1, v);
    expect(pending(parseQueue(text)).map((x) => x.index)).toContain(1);
    expect(gate(parseQueue(text)).run).toBe(true);
  });

  it('plan: an interrupted task is resumed; a never-tried one is checked first; a closed one is left alone', () => {
    expect(plan({ status: 'interrupted' })).toBe('resume');
    expect(plan({ status: 'todo' })).toBe('fresh');
    for (const s of ['done', 'blocked', 'needs-review']) expect(plan({ status: s })).toBe('skip');
  });

  it('replay of 2026-10-13: run 2 resumes task 2, and the report still flags it', () => {
    // Run 1: task 1 done; task 2 cut off by the quota.
    let text = Q2;
    let q = parseQueue(text);
    text = writeTask(text, 0, verdict(q.tasks[0], true));
    text = writeTask(text, 1, interrupted(parseQueue(text).tasks[1], '156d6e1'));

    // Run 2: the old runner ran task 2's check FIRST, it passed on the WIP,
    // and task 2 was marked done. Now: task 1 is skipped untouched, task 2 is
    // resumed — its check is asked only AFTER the agent has worked on it.
    q = parseQueue(text);
    expect(plan(q.tasks[0])).toBe('skip');
    expect(plan(q.tasks[1])).toBe('resume');
    text = writeTask(text, 1, verdict(q.tasks[1], true, false, true));

    const end = parseQueue(text);
    expect(end.tasks[0].note).toBe(NOTE_PASSED);   // run 1's verdict survived run 2
    expect(end.tasks[1].status).toBe('done');
    expect(end.tasks[1].note).toBe(NOTE_RESUMED);
    expect(gate(end).run).toBe(false);

    // The morning report cannot read as a clean night.
    const r = report(end);
    expect(r).toMatch(/^✓ \[done\] 1\. tags/m);
    expect(r).toMatch(/^! \[done\] 2\. every ฝ่าย — ถูกตัดกลางทาง/m);
    expect(r).toContain('ต้องให้คนดู 1 งาน');
    expect(r).not.toContain('ไม่มีงานไหนถูกตัด');
  });

  it('control: a night where every task passed in the run that did it IS reported clean', () => {
    let text = Q2;
    for (const i of [0, 1]) text = writeTask(text, i, verdict(parseQueue(text).tasks[i], true));
    const r = report(parseQueue(text));
    expect(r).not.toMatch(/^!/m);
    expect(r).toContain('ไม่มีงานไหนถูกตัดหรือถูกข้าม');
  });

  it('a check passing at the start AFTER an earlier failed attempt does not claim nobody worked on it', () => {
    const v = verdict({ attempts: 1 }, null, true);
    expect(v.status).toBe('needs-review');
    expect(v.note).not.toContain('agent ไม่ได้ทำงานนี้');
    expect(v.note).toContain('รอบก่อน');
  });

  it('a check that passed before anyone worked on it is flagged, not counted as done', () => {
    const text = writeTask(Q2, 0, verdict(parseQueue(Q2).tasks[0], true, true));
    expect(report(parseQueue(text))).toMatch(/^! \[needs-review\] 1\. tags/m);
  });
});

// The runner (bash) must ASK queue.mjs, not restate the rules — two copies of
// one verdict is mistakes class 6, and the bash copy is the one nobody tests.
describe('run-night.sh delegates every verdict to queue.mjs', () => {
  const sh = readFileSync(new URL('../../server/night-agent/run-night.sh', import.meta.url), 'utf8');
  it('asks plan / judge / cut / report', () => {
    for (const cmd of ['plan', 'judge', 'cut', 'report']) {
      expect(sh, `run-night.sh never calls queue.mjs ${cmd}`).toMatch(new RegExp(`node "\\$QUEUE" ${cmd} `));
    }
  });
  it('a plan with no answer leaves the task untouched — never defaults to fresh', () => {
    expect(sh).not.toMatch(/PLAN="\$\{PLAN:-fresh\}"/);
    expect(sh).toMatch(/skip\|resume\|fresh\) ;;/);
  });
  it('writes no status itself (no `queue.mjs set` left in the runner)', () => {
    expect(sh).not.toMatch(/node "\$QUEUE" set /);
  });
  it('marks a quota cut-off in the queue, in the same branch that commits the WIP', () => {
    const from = sh.indexOf('if [ "$CUT_BY" = "quota" ]; then');
    expect(from, 'the quota branch is not where this test looks for it').toBeGreaterThan(0);
    const quota = sh.slice(from, sh.indexOf('QUOTA_GONE=1; break', from));
    expect(quota).toContain('agent: WIP');
    expect(quota).toMatch(/node "\$QUEUE" cut /);
  });
});

// install.sh ships fixes AND arms queues. Only arming may replace the live
// queue — it holds the runner's verdicts, which the repo's copy does not.
describe('install.sh replaces the live queue only with --arm', () => {
  const sh = readFileSync(new URL('../../server/night-agent/install.sh', import.meta.url), 'utf8');
  it('the always-copied file list does not include the queue', () => {
    const loop = sh.match(/^for f in ([^;]+); do/m);
    expect(loop, 'install.sh no longer has the copy loop this test reads').not.toBeNull();
    expect(loop[1]).toContain('queue.mjs');            // control: the list is the one we think
    expect(loop[1]).not.toContain('NIGHT-TASKS.md');
  });
  it('every write of NIGHT-TASKS.md sits inside the --arm branch', () => {
    const lines = sh.split('\n');
    const armAt = lines.findIndex((l) => /^if .*--arm/.test(l));
    const fiAt = lines.findIndex((l, i) => i > armAt && /^fi\b/.test(l));
    expect(armAt, 'no top-level --arm branch').toBeGreaterThan(-1);
    const writes = lines.map((l, i) => [l, i]).filter(([l]) => /cat > ~\/samo-night\/NIGHT-TASKS\.md/.test(l));
    expect(writes.length).toBeGreaterThan(0);
    for (const [, i] of writes) expect(i > armAt && i < fiAt, `write at line ${i + 1} is outside --arm`).toBe(true);
  });
  it('re-arming the SAME queue keeps its state (headings compared first)', () => {
    const arm = sh.slice(sh.search(/^if .*--arm/m));
    expect(arm.indexOf('LIVE_HEADS')).toBeGreaterThan(-1);
    expect(arm.indexOf('LIVE_HEADS')).toBeLessThan(arm.indexOf('cat > ~/samo-night/NIGHT-TASKS.md'));
  });
});

// ── 2026-10-18: the board. A 100% booking 21:30–00:00 ICT and the timer due at
// 23:07 — the runner read the quota numbers and nothing else. The agent is now
// an UNBOOKED USER: it takes what the board's rail says anyone may use without
// booking (claude_free_windows → claude_free_now), and the cases below are the
// owner's own examples, in UTC (ICT − 7).
describe('the board — the agent takes what an unbooked person would be offered', () => {
  const at = (iso) => Date.parse(iso);
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3600e3;
  // a board copy: bookings + rail bands [{from,to,free,week}]
  const board = (sampledMs, bookings = [], bands = [], extra = {}) => ({
    sampled_at: iso(sampledMs),
    bookings,
    free_windows: bands.map(([f, t, free, week = 476]) => ({
      starts_at: iso(f), ends_at: iso(t), free_pct: free, week_free_pct: week, bound_by: 'session' })),
    right_now: { session: { pool_pct: 100 }, week: { pool_pct: 700 } },
    ...extra,
  });
  const usage = (sampledMs, pct, resetsMs, week = 30) => ({ sampled_at: iso(sampledMs), five_hour_pct: pct,
    five_hour_resets_at: resetsMs == null ? null : iso(resetsMs), seven_day_pct: week,
    seven_day_resets_at: '2026-10-21T08:59:59Z' });
  const tonight = { starts_at: '2026-10-18T14:30:00+00:00', ends_at: '2026-10-18T17:00:00+00:00', pct: 100 };

  it('NOBODY booked: it runs, and no line is drawn inside the window', () => {
    const now = at('2026-10-19T03:07:00Z');
    const b = board(now - 5 * 60e3, [], [[now - 10 * 60e3, now + 4 * H, 75]]);
    const u = usage(now - 5 * 60e3, 25, now + 2 * H);
    expect(quotaGate(u, b, now, 1).run).toBe(true);
    expect(allowanceAtStart(u, b, now, 1).stop).toBe(null);   // the CLI's own limit ends a task
  });
  it('23:07 inside the 100% booking: WAIT, naming the booking', () => {
    const now = at('2026-10-18T16:07:00Z');
    const g = boardGate(board(now - 5 * 60e3, [tonight], [[now - 6e5, now + 3 * H, 0]]), now, 1);
    expect(g).toMatchObject({ run: false });
    expect(g.unreadable).toBeFalsy();
    expect(g.why).toContain('21:30');
  });
  it('00:07, booking over, it used only 38%: the LEFTOVER 62% is the agent\'s', () => {
    const now = at('2026-10-18T17:07:00Z');
    // the board, sampled after 00:00, offers 100 − 38 (the ended booking's share is released)
    const b = board(at('2026-10-18T17:05:00Z'), [tonight], [[at('2026-10-18T17:05:00Z'), at('2026-10-18T19:40:00Z'), 62]]);
    const u = usage(at('2026-10-18T17:05:00Z'), 38, at('2026-10-18T19:40:00Z'));
    expect(quotaGate(u, b, now, 1).run).toBe(true);
    expect(allowanceAtStart(u, b, now, 1).stop).toBe(null);   // 38 + 62 = the whole window
  });
  it('00:07 with the window burned: WAIT — and after the 02:40 reset, RUN', () => {
    const b = board(at('2026-10-18T17:05:00Z'), [tonight], [
      [at('2026-10-18T17:05:00Z'), at('2026-10-18T19:40:00Z'), 0],
      [at('2026-10-18T19:40:00Z'), at('2026-10-19T19:40:00Z'), 100]]);
    expect(boardGate(b, at('2026-10-18T17:07:00Z'), 1).run).toBe(false);
    const fresh = { ...b, sampled_at: '2026-10-18T19:45:00Z' };   // the first copy after the reset
    expect(boardGate(fresh, at('2026-10-18T19:47:00Z'), 1).run).toBe(true);
  });
  it('booking 13:00–15:00 @70%: start 08:00 → all of it; start 08:30 → 30%, stopped at 30', () => {
    const d = (h, m = 0) => at(`2026-10-20T${String(h - 7).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
    const k = { starts_at: iso(d(13)), ends_at: iso(d(15)), pct: 70 };
    // the rail: until 08:00 a start earns the full pot; from 08:00 the window reaches 13:00
    const b = (now) => board(now - 60e3, [k], [[d(7), d(8), 100], [d(8), d(13), 30]]);
    const none = (now) => usage(now - 60e3, 0, null);
    const early = d(7, 59);
    expect(allowanceAtStart(none(early), b(early), early, 1).stop).toBe(null);
    const late = d(8, 30);
    const a = allowanceAtStart(none(late), b(late), late, 1);
    expect(a.stop).toBe(30 - BOOKING_MARGIN_PCT);
    const w = (pct, now) => watchGate(usage(now - 60e3, pct, d(13, 30)), b(now), now, a, 1);
    expect(w(20, d(10)).run).toBe(true);
    expect(w(26, d(11)).run).toBe(false);                    // the rest is theirs
  });
  it('"they book too soon": a booking made AFTER the task started does not stop it', () => {
    const now = at('2026-10-20T01:00:00Z');
    const u0 = usage(now - 60e3, 10, now + 4 * H);
    const a = allowanceAtStart(u0, board(now - 60e3, [], [[now - H, now + 4 * H, 90]]), now, 1);
    expect(a.stop).toBe(null);
    // an hour later the board shows a new 70% booking inside this window
    const later = now + H;
    const soon = { starts_at: iso(later + 30 * 60e3), ends_at: iso(later + 2 * H), pct: 70 };
    const b2 = board(later - 60e3, [soon], [[later - 60e3, later + 3 * H, 0]]);
    expect(watchGate(usage(later - 60e3, 40, now + 4 * H), b2, later, a, 1).run).toBe(true);
    // …but it counts for the NEXT task
    expect(boardGate(b2, later, 1).run).toBe(false);
  });
  it('the 5-hour reset mid-task is a checkpoint: a booked new window stops the task', () => {
    const end = at('2026-10-20T05:00:00Z');
    const a = { stop: null, windowEnd: end };
    const after = end + 20 * 60e3;
    const k = { starts_at: iso(end + 10 * 60e3), ends_at: iso(end + 2 * H), pct: 100 };
    const u = usage(after - 60e3, 2, after + 5 * H);
    expect(watchGate(u, board(after - 60e3, [k], [[after - 60e3, after + H, 0]]), after, a, 1).run).toBe(false);
    // the board copy is still from BEFORE the reset → no decision yet, carry on
    expect(watchGate(u, board(end - 60e3, [k], [[end - 60e3, end + H, 0]]), after, a, 1).run).toBe(true);
    // a SMALL booking ON at the reset, plenty free: a reset is a start, and no
    // new work starts inside somebody's booking
    const small = { ...k, starts_at: iso(end + 5 * 60e3), pct: 10 };
    expect(watchGate(u, board(after - 60e3, [small], [[after - 60e3, after + H, 85]]), after, a, 1).run).toBe(false);
    // a new window nobody booked → carry on, but RE-TAKE the allowance (a reset is a start)
    const w = watchGate(u, board(after - 60e3, [], [[after - 60e3, after + 5 * H, 98]]), after, a, 1);
    expect(w).toMatchObject({ run: true, retake: true });
    // and the re-taken allowance protects a booking known to sit LATER in the new window
    const later = { starts_at: iso(after + 2 * H), ends_at: iso(after + 3 * H), pct: 70 };
    const nb = board(after - 60e3, [later], [[after - 60e3, after + 5 * H, 28]]);
    const a2 = allowanceAtStart(u, nb, after, 1);
    expect(a2.stop).toBe(2 + 28 - BOOKING_MARGIN_PCT);
    expect(watchGate(usage(after + H, 26, after + 5 * H), nb, after + H - 30e3, a2, 1).run).toBe(false);
  });
  it('a task is not worth starting under MIN_START_PCT, and the owner\'s week reserve is kept', () => {
    const now = at('2026-10-20T01:00:00Z');
    expect(boardGate(board(now - 60e3, [], [[now - H, now + H, MIN_START_PCT - 1]]), now, 1).run).toBe(false);
    expect(boardGate(board(now - 60e3, [], [[now - H, now + H, MIN_START_PCT + 1]]), now, 1).run).toBe(true);
    // week: 150 free of 700, keep one session (100) + safety (42) → 8 left → wait
    const g = boardGate(board(now - 60e3, [], [[now - H, now + H, 100, 150]]), now, 1);
    expect(g.run).toBe(false);
    expect(g.why).toContain('สัปดาห์');
  });
  it('NO board, a stale one or a malformed one is UNREADABLE at start — and never kills a running task', () => {
    const now = at('2026-10-20T01:00:00Z');
    expect(boardGate(null, now, 1)).toMatchObject({ run: false, unreadable: true });
    expect(boardGate(board(now - 2 * H), now, 1)).toMatchObject({ run: false, unreadable: true });
    expect(boardGate({ sampled_at: iso(now - 60e3), bookings: [] }, now, 1)).toMatchObject({ run: false, unreadable: true });
    const a = { stop: 20, windowEnd: now + H };
    expect(watchGate(usage(now - 60e3, 50, now + H), null, now, a, 1).run).toBe(false); // measured use still binds
    expect(watchGate(usage(now - 60e3, 10, now + H), null, now, a, 1).run).toBe(true);
  });
});

describe('run-night.sh asks the board wherever new work starts, and fixes a task\'s allowance at its start', () => {
  const sh = readFileSync(new URL('../../server/night-agent/run-night.sh', import.meta.url), 'utf8');
  it('the start gate and the between-task gate both pass the board file', () => {
    expect(sh).toMatch(/node "\$QUEUE" gate "\$TASKS" "\$USAGE" "\$BOOKINGS"/);
    expect(sh).toMatch(/node "\$QUEUE" usage "\$TASKS" "\$USAGE" "\$BOOKINGS"/);
    expect(sh).not.toMatch(/node "\$QUEUE" (gate|usage) "\$TASKS" "\$USAGE" 2>/);
  });
  it('the allowance is taken immediately before the task and handed to its watcher', () => {
    const at = sh.indexOf('ALLOW="$(node "$QUEUE" allowance');
    const call = sh.indexOf('run_claude "${preamble_base}${prompt}" "$out" "$RESERVE_EPOCH" "$ALLOW"');
    expect(at).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(at);
    expect(sh).toMatch(/node "\$QUEUE" watch "\$TASKS" "\$USAGE" "\$BOOKINGS" "\$allow"/);
  });
  it('a yield keeps the work and RESUMES the task; the handoff is skipped, unwatched otherwise', () => {
    const from = sh.indexOf('if [ "$CUT_BY" = "board" ]; then');
    expect(from).toBeGreaterThan(0);
    const y = sh.slice(from, sh.indexOf('BOOKING_YIELD=1; break', from));
    expect(y).toContain('agent: WIP');
    expect(y).toMatch(/node "\$QUEUE" cut /);
    expect(sh).toMatch(/if \[ "\$BOOKING_YIELD" -eq 1 \]; then\n\s+echo "\(handoff skipped/);
    expect(sh).toMatch(/run_one "\$NIGHT_HOME\/HANDOFF\.md" "handoff" "\$HARD_END" "-"/);
  });
  it('an unreadable board (exit 4) waits AND is said once', () => {
    const from = sh.indexOf('elif [ "$GATE_RC" -eq 4 ]');
    expect(from).toBeGreaterThan(0);
    const branch = sh.slice(from, sh.indexOf('exit 0', from));
    expect(branch).toContain('post_discord');
    expect(branch).toContain('BOARD_ERR');
  });
});

describe('queue.mjs CLI — the exit codes run-night.sh reads', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'nq-'));
  const qmjs = new URL('../../server/night-agent/queue.mjs', import.meta.url).pathname;
  const tasks = join(dir, 'q.md'); writeFileSync(tasks, '# Q\nBudget: 2 runs\n\n## 1. a\nDone when: false\n');
  const now = Date.now();
  const iso = (m) => new Date(now + m * 60000).toISOString();
  const usageF = join(dir, 'u.json');
  writeFileSync(usageF, JSON.stringify({ sampled_at: iso(-1), five_hour_pct: 10, five_hour_resets_at: iso(120),
    seven_day_pct: 10, seven_day_resets_at: iso(3000) }));
  const run = (args) => { try { return { rc: 0, out: execFileSync('node', [qmjs, ...args], { stdio: 'pipe' }).toString() }; } catch (e) { return { rc: e.status, out: String(e.stdout) }; } };
  const boardF = (bookings, free = 90, sampledMin = -1) => {
    const f = join(dir, `b${Math.random()}.json`);
    writeFileSync(f, JSON.stringify({ sampled_at: iso(sampledMin), bookings,
      free_windows: [{ starts_at: iso(-30), ends_at: iso(120), free_pct: free, week_free_pct: 500, bound_by: 'session' }],
      right_now: { session: { pool_pct: 100 }, week: { pool_pct: 700 } } }));
    return f;
  };
  it('usage (between tasks): 5 when the refusal is for a booking, 3 otherwise', () => {
    expect(run(['usage', tasks, usageF, boardF([{ starts_at: iso(-10), ends_at: iso(50), pct: 100 }])]).rc).toBe(5);
    expect(run(['usage', tasks, usageF, join(dir, 'missing.json')]).rc).toBe(3);
    expect(run(['usage', tasks, usageF, boardF([])]).rc).toBe(0);
  });
  it('gate: 0 nobody booked · 3 inside a booking · 3 too little free · 4 no board', () => {
    expect(run(['gate', tasks, usageF, boardF([])]).rc).toBe(0);
    expect(run(['gate', tasks, usageF, boardF([{ starts_at: iso(-10), ends_at: iso(50), pct: 100 }])]).rc).toBe(3);
    expect(run(['gate', tasks, usageF, boardF([], 3)]).rc).toBe(3);
    expect(run(['gate', tasks, usageF, join(dir, 'missing.json')]).rc).toBe(4);
    expect(run(['gate', tasks, usageF, boardF([], 90, -60)]).rc).toBe(4);
  });
  it('allowance → watch round-trips through the shell as one JSON argument', () => {
    const b = boardF([], 30);
    const a = run(['allowance', tasks, usageF, b]).out.trim();
    expect(JSON.parse(a).stop).toBe(10 + 30 - 5);
    expect(run(['watch', tasks, usageF, b, a]).rc).toBe(0);
    const hot = join(dir, 'hot.json');
    writeFileSync(hot, JSON.stringify({ sampled_at: iso(-1), five_hour_pct: 36, five_hour_resets_at: iso(120),
      seven_day_pct: 10, seven_day_resets_at: iso(3000) }));
    expect(run(['watch', tasks, hot, b, a]).rc).toBe(3);
  });
});

// ── 2026-10-18 review: the runner read every task REPORT as if it were an error ──
describe('classifyOutput — only the CLI\'s own short error line is an error', () => {
  it('the real lines from ~/samo-night/logs', () => {
    expect(classifyOutput("You've hit your session limit · resets 3:40pm (UTC)")).toBe('quota');
    expect(classifyOutput("You've hit your session limit · resets 5am (UTC)\n")).toBe('quota');
    expect(classifyOutput('Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.')).toBe('auth');
    expect(classifyOutput("You've hit your weekly limit · resets Oct 21, 4pm")).toBe('quota');
    expect(classifyOutput('Claude AI usage limit reached|1760000000')).toBe('quota');
    expect(classifyOutput('API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}')).toBe('quota');
  });
  it('a finished task that WRITES about the quota, 401 or 429 is ok', () => {
    const report = ('Task 10 done. Added prune_claude_usage_samples so the quota tables stay small; '
      + 'the claude quota proofs pass 12/12. The reporter now treats HTTP 429 (rate limit) as a skipped tick '
      + 'and a 401 as an expired token. Migration 0231 applied to samo-dev. ').repeat(4);
    expect(report.length).toBeGreaterThan(600);
    expect(classifyOutput(report)).toBe('ok');
    // SHORT reports too — under the size limit, so only the anchoring saves them
    for (const short of ['Fixed the rate limit handling; tests green.',
      'Done: usage limit reached message now shown in Thai.',
      'Done. The 401 path (Failed to authenticate) is now retried once.',
      "Task done — you've hit your session limit is now parsed by the reporter."]) {
      expect(classifyOutput(short), short).toBe('ok');
    }
  });
  it('empty or missing output is ok — the verdict check still decides', () => {
    expect(classifyOutput('')).toBe('ok');
    expect(classifyOutput(undefined)).toBe('ok');
  });
});

describe('run-night.sh never outlives systemd, and never greps a report for errors', () => {
  const sh = readFileSync(new URL('../../server/night-agent/run-night.sh', import.meta.url), 'utf8');
  const unit = readFileSync(new URL('../../server/night-agent/samo-night-agent.service', import.meta.url), 'utf8');
  it('HARD_END sits inside the unit\'s TimeoutStartSec', () => {
    const hours = Number(unit.match(/^TimeoutStartSec=(\d+)h/m)?.[1]);
    const hard = Number(sh.match(/RUN_HARD_END_MIN:-(\d+)/)?.[1]);
    const reserve = Number(sh.match(/RUN_RESERVE_MIN:-(\d+)/)?.[1]);
    expect(hours).toBeGreaterThan(0);
    expect(hard).toBeLessThan(hours * 60);
    expect(reserve).toBeLessThan(hard);
  });
  it('every claude call goes through the capped timeout, and the handoff gets HARD_END', () => {
    const calls = sh.match(/timeout "\$tmo" claude -p/g) || [];
    expect(calls.length).toBe(1);
    expect(sh).not.toMatch(/timeout "\$\{TASK_TIMEOUT_SEC:-5400\}" claude/);
    expect(sh).toMatch(/run_one "\$NIGHT_HOME\/HANDOFF\.md" "handoff" "\$HARD_END"/);
  });
  it('no error pattern is grepped out of an output any more — classify decides', () => {
    expect(sh).not.toMatch(/grep -qiE '[^']*(quota|401|429)/);
    expect((sh.match(/node "\$QUEUE" classify /g) || []).length).toBeGreaterThanOrEqual(3);
  });
  it('a task cut by the run\'s own clock is marked interrupted, like a quota cut', () => {
    const from = sh.indexOf('if [ "$CUT_BY" = "time" ]; then');
    expect(from).toBeGreaterThan(0);
    const branch = sh.slice(from, sh.indexOf('break', from));
    expect(branch).toContain('agent: WIP');
    expect(branch).toMatch(/node "\$QUEUE" cut /);
  });
});

describe('a cut-off task says WHY in the queue — the resume rule is the same, the reason is not', () => {
  const t = { attempts: 1 };
  it('quota (the default), the run\'s clock, and giving the window to a booking', () => {
    expect(interrupted(t, 'abc').note).toContain(CUT_REASONS.quota);
    expect(interrupted(t, 'abc', 'time').note).toContain(CUT_REASONS.time);
    expect(interrupted(t, 'abc', 'board').note).toContain(CUT_REASONS.board);
    expect(interrupted(t, 'abc', 'board').note).not.toContain(CUT_REASONS.quota);
    for (const w of ['quota', 'time', 'board']) expect(interrupted(t, 'abc', w).status).toBe('interrupted');
  });
  it('run-night.sh names the reason on the board and clock cuts', () => {
    const sh = readFileSync(new URL('../../server/night-agent/run-night.sh', import.meta.url), 'utf8');
    expect(sh).toMatch(/cut "\$TASKS" "\$i" "\$\(git rev-parse --short HEAD\)" board/);
    expect(sh).toMatch(/cut "\$TASKS" "\$i" "\$\(git rev-parse --short HEAD\)" time/);
  });
});

describe('quotaGate says WHEN a refusal is for somebody\'s booking (the handoff then stays out of their share)', () => {
  const now = Date.parse('2026-10-20T01:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3600e3;
  const u = (pct) => ({ sampled_at: iso(now - 60e3), five_hour_pct: pct, five_hour_resets_at: iso(now + 2 * H),
    seven_day_pct: 30, seven_day_resets_at: iso(now + 50 * H) });
  const b = (bookings, free) => ({ sampled_at: iso(now - 60e3), bookings,
    free_windows: [{ starts_at: iso(now - H), ends_at: iso(now + H), free_pct: free, week_free_pct: 500, bound_by: 'session' }],
    right_now: { session: { pool_pct: 100 }, week: { pool_pct: 700 } } });
  it('a booking ON → forBooking', () => {
    const on = [{ starts_at: iso(now - 60e3), ends_at: iso(now + H), pct: 10 }];
    expect(quotaGate(u(20), b(on, 70), now, 1)).toMatchObject({ run: false, forBooking: true });
  });
  it('little free because bookings hold it → forBooking; because the account spent it → not', () => {
    expect(quotaGate(u(30), b([], 5), now, 1)).toMatchObject({ run: false, forBooking: true });   // 65 held
    expect(quotaGate(u(88), b([], 8), now, 1)).toMatchObject({ run: false, forBooking: false });  // spent
  });
});

describe('run-night.sh — the scrutinize findings of 2026-10-18 stay fixed', () => {
  const sh = readFileSync(new URL('../../server/night-agent/run-night.sh', import.meta.url), 'utf8');
  it('a between-task refusal for a booking (exit 5) skips the handoff', () => {
    expect(sh).toMatch(/\[ "\$U_RC" -eq 5 \] && BOOKING_YIELD=1/);
  });
  it('the watcher re-takes the allowance at the reset (exit 6)', () => {
    const w = sh.slice(sh.indexOf('claude_capped() {'), sh.indexOf('wait "$pid"; rc=$?'));
    expect(w).toMatch(/"\$wrc" -eq 6[\s\S]*allow="\$\(node "\$QUEUE" allowance/);
  });
  it('a run that gave the window to a booking is not counted against Budget', () => {
    const at = sh.indexOf('node "$QUEUE" spend');
    expect(sh.slice(Math.max(0, at - 600), at)).toMatch(/if \[ "\$BOOKING_YIELD" -eq 1 \]; then/);
  });
  it('the missing-identity refusal comes BEFORE the "started" post, and is said once', () => {
    const ident = sh.indexOf('config user.email');
    const started = sh.indexOf("post_discord \"$(printf 'เริ่มทำงานแล้ว");
    expect(ident).toBeGreaterThan(0);
    expect(started).toBeGreaterThan(ident);
    expect(sh.slice(ident, started)).toContain('.identity-error');
  });
});
