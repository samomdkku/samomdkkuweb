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
import {
  parseQueue, gate, verdict, writeTask, spendNight, pending, MAX_ATTEMPTS,
  usageGate, SESSION_SHARE_OF_WEEK, WEEK_SAFETY_PCT,
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
    // wrong; in neither case did the agent finish something.
    const v = verdict(t, true, true);
    expect(v.status).toBe('done');
    expect(v.note).toContain('ผ่านตั้งแต่ก่อนเริ่ม');
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
