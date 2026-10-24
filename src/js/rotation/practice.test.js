// practice.test.js — the practice copy of the swap rules behaves like the
// database (tools/rotation0250-swaps.sql §C), and every scene does what its
// button says. If a rule changes in SQL and not here, this is where it shows.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createPractice } from './practice.js';
import { buildModel, diffBoards, swapPairs, REASON_TH } from './model.js';

const G = ['A', 'B', 'C', 'D', 'E', 'F'];
const fresh = (o = {}) => createPractice({ groups: G, gender: 'M', group: 'A', clock: () => 1_800_000_000_000, ...o });
const males = (p, g) => p._state().students.filter((s) => s.id !== 'me' && s.gender === 'M' && s.current_group === g && !s.staying);

describe('practice roster', () => {
  it('six groups of eight, you included, both genders in each; no GPA on anyone but you', async () => {
    const p = fresh();
    const b = await p.rpc('rotation_board');
    expect(b.students).toHaveLength(48);
    for (const g of G) {
      const m = b.students.filter((s) => s.current_group === g);
      expect(m.length, g).toBe(8);
      expect(new Set(m.map((s) => s.gender)).size, g).toBe(2);
    }
    expect(b.students.some((s) => 'gpa' in s)).toBe(false);
    expect(b.me.current_group).toBe('A');
  });
  it('copies your own row in when you are on the roster', async () => {
    const p = createPractice({ groups: G, realMe: { first_name: 'จริง', last_name: 'คน', gender: 'F', current_group: 'D', nickname: 'นิด', contact: 'LINE: x', gpa: 3.1 } });
    const b = await p.rpc('rotation_board');
    expect(b.me).toMatchObject({ first_name: 'จริง', gender: 'F', current_group: 'D', nickname: 'นิด', gpa: 3.1 });
    expect(b.students.filter((s) => s.can_swap).every((s) => s.gender === 'F' && s.current_group !== 'D')).toBe(true);
  });
});

describe('the rules, mirrored from the SQL proof', () => {
  it('different gender / own group / duplicate are refused', async () => {
    const p = fresh();
    const s = p._state().students;
    const f = s.find((x) => x.gender === 'F' && x.current_group === 'B');
    const mA = s.find((x) => x.id !== 'me' && x.gender === 'M' && x.current_group === 'A');
    const mB = males(p, 'B')[0];
    expect((await p.rpc('rotation_request', { p_target: f.id })).reason).toBe('not_eligible');
    expect((await p.rpc('rotation_request', { p_target: mA.id })).reason).toBe('not_eligible');
    expect((await p.rpc('rotation_request', { p_to_group: 'A' })).reason).toBe('same_group');
    expect((await p.rpc('rotation_request', { p_target: mB.id })).ok).toBe(true);
    expect((await p.rpc('rotation_request', { p_target: mB.id })).reason).toBe('duplicate');
  });

  it('accept swaps both, logs two moves, and closes every other ask naming either person', async () => {
    const p = fresh();
    const [b1] = males(p, 'B');
    const [c1] = males(p, 'C');
    const toB = await p.rpc('rotation_request', { p_target: b1.id });
    const toC = await p.rpc('rotation_request', { p_to_group: 'C' });
    const third = p._as.request(c1.id, b1.id, null);                // someone else's ask to b1
    const r = p._as.accept(b1.id, toB.id);
    expect(r).toMatchObject({ ok: true, my_group: 'A', requester_group: 'B', closed_other_requests: 2 });
    const st = p._state();
    expect(st.me.current_group).toBe('B');
    expect(st.students.find((s) => s.id === b1.id).current_group).toBe('A');
    expect(st.requests.find((q) => q.id === toC.id).status).toBe('superseded');
    expect(st.requests.find((q) => q.id === third.id).status).toBe('superseded');
    expect(st.moves).toHaveLength(2);
  });

  it('a broadcast is taken by the FIRST accept only; the second hears "taken"', async () => {
    const p = fresh();
    const [c1, c2] = males(p, 'C');
    const q = await p.rpc('rotation_request', { p_to_group: 'C' });
    expect(p._as.accept(c1.id, q.id).ok).toBe(true);
    expect(p._as.accept(c2.id, q.id).reason).toBe('taken');
  });

  it('an ask about where someone WAS is stale once they move', async () => {
    const p = fresh();
    const [b1] = males(p, 'B');
    const [c1] = males(p, 'C');
    const [d1] = males(p, 'D');
    const mine = await p.rpc('rotation_request', { p_target: c1.id });   // A → C
    const other = p._as.request(c1.id, d1.id, null);                    // c1 → D
    p._as.accept(d1.id, other.id);                                      // c1 moves to D
    expect(p._state().requests.find((q) => q.id === mine.id).status).toBe('superseded');
    // a fresh ask from b1 to me, then I move away first → b1's ask is stale
    const q = p._as.request(b1.id, 'me', null);
    const e1 = males(p, 'E')[0];
    const away = await p.rpc('rotation_request', { p_target: e1.id });
    p._as.accept(e1.id, away.id);
    expect(p._state().requests.find((x) => x.id === q.id).status).toBe('superseded');
  });

  it('only the named person declines; only the asker cancels', async () => {
    const p = fresh();
    const [b1, b2] = males(p, 'B');
    const q = p._as.request(b1.id, 'me', null);
    expect(p._as.respondNo(b2.id, q.id).reason).toBe('not_yours');
    expect((await p.rpc('rotation_respond_no', { p_request: q.id })).ok).toBe(true);
    expect(p._state().requests.find((x) => x.id === q.id).status).toBe('declined');
  });

  it('every reason the practice copy returns has Thai, like the real ones', () => {
    const src = readFileSync('src/js/rotation/practice.js', 'utf8');
    const reasons = [...src.matchAll(/reason: '([a-z_]+)'/g)].map((x) => x[1]);
    expect(reasons.length).toBeGreaterThan(8);
    for (const r of new Set(reasons)) if (r !== 'practice_only') expect(REASON_TH[r], r).toBeTruthy();
  });
});

describe('staying (0252), mirrored from the SQL proof §G', () => {
  it('closes what is in flight, nobody can name them, they cannot ask, a broadcast skips them; off = allowed', async () => {
    const p = fresh();
    const [b1] = males(p, 'B');
    const [c1] = males(p, 'C');
    const theirs = p._as.request(b1.id, 'me', null);
    const mine = await p.rpc('rotation_request', { p_target: c1.id });
    expect(await p.rpc('rotation_set_staying', { p_staying: true })).toMatchObject({ ok: true, declined: 1, cancelled: 1 });
    const st = p._state();
    expect(st.requests.find((q) => q.id === theirs.id).status).toBe('declined');
    expect(st.requests.find((q) => q.id === mine.id).status).toBe('cancelled');
    expect(p._as.request(c1.id, 'me', null).reason).toBe('staying');
    expect((await p.rpc('rotation_request', { p_target: c1.id })).reason).toBe('you_staying');
    expect(p.scene('many_ask_me').ok).toBe(false);
    expect(buildModel(await p.rpc('rotation_board')).incoming).toEqual([]);
    await p.rpc('rotation_set_staying', { p_staying: false });
    expect((await p.rpc('rotation_request', { p_target: c1.id })).ok).toBe(true);
  });
  it('a pretend classmate who stays shows staying and cannot be asked', async () => {
    const p = fresh();
    const b = await p.rpc('rotation_board');
    const stayer = b.students.find((s) => s.staying && s.gender === 'M' && s.current_group !== 'A');
    expect(stayer.can_swap).toBe(false);
    expect((await p.rpc('rotation_request', { p_target: stayer.id })).reason).toBe('staying');
  });
});

describe('scenes', () => {
  it('many_ask_me: three offers from three different groups, all shown as incoming', async () => {
    const p = fresh();
    const before = await p.rpc('rotation_board');
    expect(p.scene('many_ask_me').ok).toBe(true);
    const after = await p.rpc('rotation_board');
    const inc = buildModel(after).incoming;
    expect(inc).toHaveLength(3);
    expect(new Set(inc.map((q) => q.from_group)).size).toBe(3);
    expect(diffBoards(before, after).newIncoming).toHaveLength(3);
  });

  it('accepting one of several offers closes the rest', async () => {
    const p = fresh();
    p.scene('many_ask_me');
    const inc = buildModel(await p.rpc('rotation_board')).incoming;
    const r = await p.rpc('rotation_accept', { p_request: inc[1].id });
    expect(r.ok).toBe(true);
    expect(buildModel(await p.rpc('rotation_board')).incoming).toHaveLength(0);
  });

  it('broadcast_to_my_group then someone_beats_me: the offer vanishes and accepting says "taken"', async () => {
    const p = fresh();
    p.scene('broadcast_to_my_group');
    const [q] = buildModel(await p.rpc('rotation_board')).incoming;
    expect(q.target_id).toBe(null);
    expect(p.scene('someone_beats_me').ok).toBe(true);
    expect(buildModel(await p.rpc('rotation_board')).incoming).toHaveLength(0);
    expect((await p.rpc('rotation_accept', { p_request: q.id })).reason).toBe('taken');
  });

  it('they_accept_mine moves you; others_swap moves two others and shows as one new pair', async () => {
    const p = fresh();
    expect(p.scene('they_accept_mine').ok).toBe(false);              // nothing asked yet → says so
    await p.rpc('rotation_request', { p_to_group: 'D' });
    expect(p.scene('they_accept_mine').ok).toBe(true);
    expect(p._state().me.current_group).toBe('D');
    const before = await p.rpc('rotation_board');
    expect(p.scene('others_swap').ok).toBe(true);
    const after = await p.rpc('rotation_board');
    const d = diffBoards(before, after);
    expect(d.swaps).toHaveLength(1);
    expect(d.moved).toHaveLength(2);
    expect(swapPairs(after)).toHaveLength(2);
  });
});
