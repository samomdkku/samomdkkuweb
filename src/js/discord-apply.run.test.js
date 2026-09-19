// ==============================================
// discord-apply.run.test.js — the apply tool RUN, against a stub guild.
//
// `discord-apply.test.js` reads the file and asserts things about its text.
// That is worth having and it is not enough: a swapped member id, an add
// issued as a remove, a refusal that prints and then falls through, a cap
// computed over the wrong denominator — every one of those has the same SHAPE
// as the correct code, so no regex over the source can see it.
//
// The real tool has been run against the live guild exactly once, read-only,
// and the diff was 0 add / 0 remove because one person is linked and already
// correct. So the two lines that actually write have never executed anywhere.
// A clean plan is not a green write path, and shipping a role-removal tool
// whose removal has never run is the shape this repo has paid for repeatedly.
//
// So: run the real file as a real child process against a stub that answers
// like Discord and like PostgREST, and assert the REQUESTS that come out.
// ⛔ Every test asserts the FULL list of writes, never "contains" — a call the
// tool should not make is only visible if the absence of extra calls is what
// is being checked.
// ==============================================
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { serve, run, world } from './discord-apply.fixture.js';

let w; let stub;
beforeEach(async () => { w = world(); stub = await serve(w); });
afterEach(async () => { await stub.close(); });

const PLAN = ['--add', '1', '--remove', '1'];

describe('the plan it computes from a known world', () => {
  it('finds exactly one person to change, and says why the others are not', async () => {
    const r = await run([], stub);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/PLAN: 1 role\(s\) to add, 1 to remove, across 1 of 6 people \(17%\)/);
    // carol holds a managed role and is NOT linked. Absence is UNKNOWN.
    expect(r.out).toMatch(/NOT LINKED: 3 of 6 \(1 of them WITHDRAWN/);
    // dave is linked with zero ตำแหน่ง — the leaver case, reported not stripped.
    expect(r.out).toMatch(/LEAVERS — linked, but ZERO ตำแหน่ง in ทีม SAMO: 1/);
    expect(r.out).toContain('dave');
  });

  it('writes NOTHING without --apply', async () => {
    const r = await run([], stub);
    expect(r.writes).toEqual([]);
    expect(r.out).toContain('PLAN ONLY — nothing was written.');
  });
});

describe('the write path — the part no source guard can see', () => {
  it('issues exactly one PUT and one DELETE, on the right member and roles', async () => {
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code).toBe(0);
    // ⛔ The whole assertion. alice gains ฝ่าย IT (R1) and loses ฝ่ายเอกสาร (R2).
    // If add and remove were ever transposed this list would still have two
    // entries and the tool would still exit 0 — which is exactly why the verbs
    // are pinned to the role ids and not merely counted.
    expect(r.writes).toEqual([
      'PUT /api/v10/guilds/G/members/U1/roles/R1',
      'DELETE /api/v10/guilds/G/members/U1/roles/R2',
    ]);
  });

  // ⛔ THE NEXT THREE EACH ASSERT `code === 0` AND THE FULL WRITE LIST, not just
  // "this id is absent". The first draft asserted only the absence — and when a
  // mutation made the tool treat every role as managed, the run REFUSED (the
  // counts no longer matched) so nothing was written, so the id was absent, so
  // the test passed while the bug was live. A deny-only probe cannot tell a
  // working guard from a broken service (.claude/rules/mistakes.md class 7); the
  // `code === 0` is the ALLOW half that makes the absence mean something.
  const CORRECT = [
    'PUT /api/v10/guilds/G/members/U1/roles/R1',
    'DELETE /api/v10/guilds/G/members/U1/roles/R2',
  ];

  it('never touches an UNMANAGED role the person holds', async () => {
    // alice holds Moderator (R9), which no ticked node owns. It is absent from
    // the mapping, so it is untouchable by construction rather than by an
    // exclusion list — and this is what proves the construction holds.
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code, 'the run must SUCCEED, or the absence below proves nothing').toBe(0);
    expect(r.writes).toEqual(CORRECT);
    expect(r.writes.some((x) => x.includes('/R9'))).toBe(false);
  });

  it('never touches an UNLINKED member, even one holding a managed role', async () => {
    // carol holds ฝ่าย IT and has no link. §5e: absence is UNKNOWN, never
    // "entitled to nothing".
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code).toBe(0);
    expect(r.writes).toEqual(CORRECT);
    expect(r.writes.some((x) => x.includes('/U3/'))).toBe(false);
    expect(r.writes.some((x) => x.includes('/U6/')), 'nor a WITHDRAWN one').toBe(false);
  });

  it('never strips a LEAVER while the ศิษย์เก่า rule is undecided', async () => {
    // dave is linked, holds ฝ่ายเอกสาร, and has zero ตำแหน่ง.
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code).toBe(0);
    expect(r.writes).toEqual(CORRECT);
    expect(r.writes.some((x) => x.includes('/U4/'))).toBe(false);
  });

  it('--only narrows the plan to one person', async () => {
    const r = await run(['--only', 'U2'], stub);
    expect(r.out).toMatch(/PLAN: 0 role\(s\) to add, 0 to remove/);
    expect(r.writes).toEqual([]);
  });
});

describe('an account that WAS linked is not a stranger (0187)', () => {
  // Unlinking used to be a permanent role grant: the link row was deleted, so
  // the person vanished from the target set, so `if (!t) continue` treated them
  // as never-linked and nothing could ever take their ฝ่าย roles back. 0187
  // records the withdrawal; this asserts the tool reads it.

  it('names the withdrawn account and the roles it still holds', async () => {
    const r = await run([], stub);
    expect(r.out).toMatch(/WITHDRAWN, AND STILL HOLDING ฝ่าย ROLES: 1/);
    expect(r.out).toContain('frank');
    expect(r.out).toContain('unlinked-or-person-deleted');
    expect(r.out).toContain('ฝ่าย IT');
  });

  it('…and still does NOT touch them — the policy is undecided', async () => {
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code).toBe(0);
    expect(r.writes).toEqual([
      'PUT /api/v10/guilds/G/members/U1/roles/R1',
      'DELETE /api/v10/guilds/G/members/U1/roles/R2',
    ]);
    expect(r.writes.some((x) => x.includes('/U6/'))).toBe(false);
  });

  it('a stranger holding no managed role is not reported as withdrawn', async () => {
    // carol (U3) holds ฝ่าย IT and never linked. She must stay in NOT LINKED,
    // never in the withdrawn list — that is the distinction 0187 exists to make,
    // and a report that blurred it would justify stripping a stranger.
    const r = await run([], stub);
    expect(r.out).toMatch(/WITHDRAWN, AND STILL HOLDING ฝ่าย ROLES: 1/);
    expect(r.out.split('WITHDRAWN')[1].split('NOT LINKED')[0]).not.toContain('carol');
  });

  it('withdrawn with no managed role left is not worth reporting', async () => {
    w.members.find((m) => m.user.id === 'U6').roles = [];
    const r = await run([], stub);
    expect(r.out).not.toMatch(/WITHDRAWN, AND STILL HOLDING/);
  });
});

describe('the refusals actually refuse — exit non-zero AND write nothing', () => {
  // A refusal that prints and falls through is worse than none: the operator
  // reads the warning, sees exit 0, and concludes it was handled.

  it('an EMPTY target set is never a diff', async () => {
    w.targets = [];
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.out).toMatch(/returned NO ROWS/);
  });

  it('counts that no longer match the plan', async () => {
    const r = await run(['--apply', '--add', '9', '--remove', '0'], stub);
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.out).toMatch(/the plan changed since you read it/);
  });

  it('a role sitting AT OR ABOVE the bot — the failure Discord reports as success', async () => {
    // Drop the bot below ฝ่ายเอกสาร. Discord would answer 204 to the DELETE and
    // change nothing; §7 step 4 is the drag that fixes it.
    w.roles.find((x) => x.id === 'RB').position = 5;
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.out).toMatch(/sit at or above the bot/);
    expect(r.out).toContain('ฝ่ายเอกสาร');
  });

  it('a bot without Manage Roles', async () => {
    w.roles.find((x) => x.id === 'RB').permissions = '0';
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
    expect(r.out).toMatch(/does not hold Manage Roles/);
  });

  it('ADMINISTRATOR satisfies Manage Roles but does NOT skip the hierarchy', async () => {
    const bot = w.roles.find((x) => x.id === 'RB');
    bot.permissions = '8';            // ADMINISTRATOR alone
    bot.position = 5;                 // …and below ฝ่ายเอกสาร
    const r = await run(['--apply', ...PLAN], stub);
    expect(r.out).toMatch(/Manage Roles: yes/);   // administrator implies it
    expect(r.code).toBe(1);                        // …and it still refuses
    expect(r.writes).toEqual([]);
  });
});

describe('the blast-radius cap, measured against the SERVER', () => {
  // Turn every linked person into a removal: 3 of 6 humans is 50%, over the
  // 25% cap, while being only 3 removals — well under the 50-removal cap. The
  // percentage is what catches a small server, and it is measured over HUMANS,
  // not over the linked set, where one person is always 100%.
  const turnover = (w) => {
    w.targets = [
      { discord_user_id: 'U1', person_id: 'p1', role_ids: [], role_names: [], pending: [], placements: 1 },
      { discord_user_id: 'U2', person_id: 'p2', role_ids: [], role_names: [], pending: [], placements: 1 },
      { discord_user_id: 'U3', person_id: 'p3', role_ids: [], role_names: [], pending: [], placements: 1 },
    ];
  };

  it('refuses a run over the cap, and writes nothing', async () => {
    turnover(w);
    const r = await run(['--apply', '--add', '0', '--remove', '3'], stub);
    expect(r.out).toMatch(/BLAST RADIUS: 3 removal\(s\) \(cap 50\) across 50% of the server \(cap 25%\)/);
    expect(r.code).toBe(1);
    expect(r.writes).toEqual([]);
  });

  it('--allow-large is what lets yearly turnover through, and it is a decision', async () => {
    turnover(w);
    const r = await run(['--apply', '--add', '0', '--remove', '3', '--allow-large'], stub);
    expect(r.code).toBe(0);
    expect(r.writes).toEqual([
      'DELETE /api/v10/guilds/G/members/U1/roles/R2',
      'DELETE /api/v10/guilds/G/members/U2/roles/R1',
      'DELETE /api/v10/guilds/G/members/U3/roles/R1',
    ]);
  });
});

describe('a mapped role that no longer exists in the guild', () => {
  it('is skipped rather than created, and says so', async () => {
    // A role adopted in Discord and later deleted there. The node still maps to
    // its id. Inventing it back would be provisioning, which is a decision a
    // person makes having read what it would do.
    w.roles = w.roles.filter((x) => x.id !== 'R1');
    w.ticked = w.ticked.map((t) => t);
    const r = await run([], stub);
    expect(r.out).toMatch(/mapped role id\(s\) do not exist in this guild any more/);
    expect(r.writes).toEqual([]);
  });
});

describe('--add-only gives and never takes (owner, 2026-09-19)', () => {
  it('plans the add, WITHHOLDS the removal, and says how many it withheld', async () => {
    const r = await run(['--add-only'], stub);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/ADD-ONLY: 1 removal\(s\) WITHHELD/);
    expect(r.out).toMatch(/PLAN: 1 role\(s\) to add, 0 to remove/);
    expect(r.writes).toEqual([]);
  });

  it('writes exactly the PUT — no DELETE — and exits 0', async () => {
    // code === 0 is the ALLOW half: a refusal would also write no DELETE.
    const r = await run(['--apply', '--add-only', '--add', '1', '--remove', '0'], stub);
    expect(r.code, r.out).toBe(0);
    expect(r.writes).toEqual(['PUT /api/v10/guilds/G/members/U1/roles/R1']);
  });

  it('control: WITHOUT --add-only the same world still removes', async () => {
    const r = await run(['--apply', '--add', '1', '--remove', '1'], stub);
    expect(r.writes).toContain('DELETE /api/v10/guilds/G/members/U1/roles/R2');
  });

  it('an add-only run passed the FULL plan\'s --remove count refuses and writes nothing', async () => {
    const r = await run(['--apply', '--add-only', '--add', '1', '--remove', '1'], stub);
    expect(r.code).not.toBe(0);
    expect(r.writes).toEqual([]);
  });
});

describe('a key with SERVER-WIDE power is never handed out on a rule (2026-09-19)', () => {
  // `📇 ฝ่ายเลขานุการนายกฯ` carries ADMINISTRATOR and `สมาชิก SAMO Buddy` can
  // manage every channel and role. Channel access was audited; this was not.
  const powered = () => { w.roles.find((r) => r.id === 'R1').permissions = String(1n << 28n); };

  it('lists the power key and who would get it, even in a plan', async () => {
    powered();
    const r = await run(['--add-only'], stub);
    expect(r.out).toMatch(/1 key\(s\) in this plan carry SERVER-WIDE power/);
    expect(r.out).toMatch(/ฝ่าย IT \[MANAGE_ROLES\] → alice/);
  });

  it('REFUSES to write it without --allow-power, and writes nothing', async () => {
    powered();
    const r = await run(['--apply', '--add-only', '--add', '1', '--remove', '0'], stub);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/REFUSED — would hand out server-wide power: ฝ่าย IT/);
    expect(r.writes).toEqual([]);
  });

  it('writes it when the owner named it', async () => {
    powered();
    const r = await run(['--apply', '--add-only', '--add', '1', '--remove', '0', '--allow-power', 'ฝ่าย IT'], stub);
    expect(r.code, r.out).toBe(0);
    expect(r.writes).toEqual(['PUT /api/v10/guilds/G/members/U1/roles/R1']);
  });

  it('control: a key with no server-wide power is not listed', async () => {
    const r = await run(['--add-only'], stub);
    expect(r.out).not.toMatch(/SERVER-WIDE power/);
  });
});
