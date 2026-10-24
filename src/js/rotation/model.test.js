// model.test.js — the page's reading of rotation_board().
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModel, buildFeed, parseGpa, reasonText, REASON_TH, displayName, matchesQuery, swapPairs, lastMoves, diffBoards, isRecent, criteriaTh, ruleNeedsGpa, chainPeople, chainOffers, myChains, routesTo, chainCycles, formatMissingGpaCopyText } from './model.js';
import { parseRosterText, compareNames, splitPrefix } from './roster-parse.js';

const S = (id, g, gender, can_swap = false) => ({ id, first_name: id, last_name: 'x', gender, current_group: g, original_group: g, can_swap });

const board = {
  state: 'ok',
  round: { groups: ['A', 'B', 'C'] },
  me: { id: 'me', current_group: 'A', gender: 'M' },
  students: [S('me', 'A', 'M'), S('b1', 'B', 'M', true), S('b2', 'B', 'F'), S('c1', 'C', 'M', true)],
  requests: [
    { id: 'q1', requester_id: 'b1', target_id: 'me', from_group: 'B', to_group: 'A', status: 'pending', created_at: '2026-10-24T01:00:00Z' },
    { id: 'q2', requester_id: 'c1', target_id: null, from_group: 'C', to_group: 'A', status: 'pending', created_at: '2026-10-24T02:00:00Z' },
    { id: 'q3', requester_id: 'b2', target_id: null, from_group: 'B', to_group: 'A', status: 'pending', created_at: '2026-10-24T03:00:00Z' },
    { id: 'q4', requester_id: 'me', target_id: 'c1', from_group: 'A', to_group: 'C', status: 'pending', created_at: '2026-10-24T04:00:00Z' },
    { id: 'q5', requester_id: 'me', target_id: 'b2', from_group: 'A', to_group: 'B', status: 'declined', created_at: '2026-10-23T04:00:00Z', resolved_at: '2026-10-23T05:00:00Z' },
  ],
  moves: [],
};

describe('buildModel', () => {
  const m = buildModel(board);
  it('incoming = named to me + broadcasts to my group from people the SERVER says I may swap with', () => {
    expect(m.incoming.map((q) => q.id).sort()).toEqual(['q1', 'q2']);   // q3: b2 is can_swap false
  });
  it('nothing is incoming while I chose to stay (0252)', () => {
    expect(buildModel({ ...board, me: { ...board.me, staying: true } }).incoming).toEqual([]);
  });
  it('outgoing = my open asks only', () => {
    expect(m.outgoing.map((q) => q.id)).toEqual(['q4']);
  });
  it('per-person lookups', () => {
    expect(m.askedByMe.get('c1').id).toBe('q4');
    expect(m.askedMe.get('b1').id).toBe('q1');
  });
  it('groups with counts', () => {
    expect(m.groupList.map((g) => `${g.group}:${g.members.length}:${g.eligible}:${g.isMine}`))
      .toEqual(['A:1:0:true', 'B:2:1:false', 'C:1:1:false']);
  });
});

describe('buildFeed', () => {
  it('shows open asks to everyone and my own closed ones to me', () => {
    const f = buildFeed(board);
    expect(f.map((i) => i.kind)).toEqual(['ask', 'ask', 'ask', 'ask', 'mine-closed']);
    expect(buildFeed({ ...board, me: null }).some((i) => i.kind === 'mine-closed')).toBe(false);
  });
});

describe('names', () => {
  it('displayName adds the registry nickname; search matches it too', () => {
    const s = { first_name: 'ก', last_name: 'ข', nickname: 'บอม', student_id: '653070001-1' };
    expect(displayName(s)).toBe('ก ข (บอม)');
    expect(displayName({ ...s, nickname: null })).toBe('ก ข');
    expect(matchesQuery(s, 'บอ')).toBe(true);
    expect(matchesQuery(s, '0700')).toBe(true);
    expect(matchesQuery(s, 'zz')).toBe(false);
  });
});

describe('who swapped with whom', () => {
  const swapped = {
    ...board,
    requests: [...board.requests,
      { id: 'q9', requester_id: 'b1', target_id: 'c1', from_group: 'B', to_group: 'C', status: 'accepted', accepted_by: 'c1', created_at: '2026-10-24T05:00:00Z', resolved_at: '2026-10-24T05:10:00Z' }],
    moves: [
      { student_id: 'b1', from_group: 'B', to_group: 'C', request_id: 'q9', kind: 'swap', at: '2026-10-24T05:10:00Z' },
      { student_id: 'c1', from_group: 'C', to_group: 'B', request_id: 'q9', kind: 'swap', at: '2026-10-24T05:10:00Z' },
      { student_id: 'b2', from_group: 'A', to_group: 'B', request_id: null, kind: 'admin', at: '2026-10-20T00:00:00Z' },
    ],
    students: board.students.map((s) => s.id === 'b1' ? { ...s, current_group: 'C' } : s.id === 'c1' ? { ...s, current_group: 'B' } : s),
  };
  it('swapPairs: one pair per accepted ask, each side with its direction', () => {
    expect(swapPairs(swapped)).toEqual([{ id: 'q9', at: '2026-10-24T05:10:00Z', aId: 'b1', aFrom: 'B', aTo: 'C', bId: 'c1', bFrom: 'C', bTo: 'B' }]);
  });
  it('lastMoves names the partner of a swap and none for an admin move', () => {
    const lm = lastMoves(swapped);
    expect(lm.get('b1')).toMatchObject({ from: 'B', to: 'C', partnerId: 'c1' });
    expect(lm.get('c1').partnerId).toBe('b1');
    expect(lm.get('b2')).toMatchObject({ kind: 'admin', partnerId: null });
  });
  it('diffBoards: who moved and the new pair; nothing on the first read', () => {
    const d = diffBoards(board, swapped);
    expect(d.moved.sort()).toEqual(['b1', 'c1']);
    expect(d.swaps.map((p) => p.id)).toEqual(['q9']);
    expect(diffBoards(null, swapped)).toEqual({ moved: [], swaps: [], newIncoming: [], newChainOffers: [], chainsDone: [] });
  });
  it('isRecent: within 24 h', () => {
    const now = Date.parse('2026-10-25T05:00:00Z');
    expect(isRecent('2026-10-24T05:10:00Z', now)).toBe(true);
    expect(isRecent('2026-10-24T04:00:00Z', now)).toBe(false);
  });
});

describe('chains (0255)', () => {
  const st = (id, g, extra = {}) => ({ id, current_group: g, can_swap: true, wishes: [], ...extra });
  const chain = {
    id: 'c1', status: 'pending', starter_id: 'me', from_group: 'E', via_group: 'A', to_group: 'B',
    legs: [{ seq: 1, from_group: 'A', to_group: 'E', target_id: null, taker_id: 'a1', can_take: false },
           { seq: 2, from_group: 'B', to_group: 'A', target_id: null, taker_id: null, can_take: true }],
  };
  it('a chain is three moves that close a cycle: E→B, A→E, B→A', () => {
    const p = chainPeople(chain);
    expect(p.map((x) => `${x.from}${x.to}`)).toEqual(['EB', 'AE', 'BA']);
    // every group gives one seat and takes one back
    const out = p.map((x) => x.from).sort().join(''); const inn = p.map((x) => x.to).sort().join('');
    expect(out).toBe(inn);
  });
  it('offers come from the server\'s can_take only', () => {
    expect(chainOffers({ chains: [chain] }).map((o) => o.leg.seq)).toEqual([2]);
    expect(chainOffers({ chains: [{ ...chain, status: 'failed' }] })).toEqual([]);
    expect(chainOffers({ chains: [{ ...chain, legs: chain.legs.map((l) => ({ ...l, can_take: false })) }] })).toEqual([]);
  });
  it('my chains: started vs said yes to', () => {
    expect(myChains({ me: { id: 'me' }, chains: [chain] }).started).toHaveLength(1);
    expect(myChains({ me: { id: 'a1' }, chains: [chain] }).committed).toHaveLength(1);
  });
  it('routes through one middle group; happy when both legs wish what they get', () => {
    const model = buildModel({
      round: { groups: ['A', 'B', 'E'] }, me: { id: 'me', current_group: 'E' },
      students: [st('me', 'E', { can_swap: false }), st('a1', 'A', { wishes: ['E'] }), st('b1', 'B', { wishes: ['A'] }), st('b2', 'B', { can_swap: false, wishes: ['E'] })],
      requests: [],
    });
    const r = routesTo(model, 'B');
    expect(r.direct).toEqual({ n: 1, wish: 0 });          // b2 wishes E but is not askable
    expect(r.routes).toEqual([{ via: 'A', n1: 1, n2: 1, w1: 1, w2: 1, possible: true, happy: true }]);
    expect(routesTo(model, 'E')).toBeNull();
  });
  it('a done chain is a cycle in the feed; a failed one is private (server-filtered)', () => {
    const done = { ...chain, status: 'done', resolved_at: '2026-10-24T10:00:00Z' };
    expect(chainCycles({ chains: [done, chain] }).map((c) => c.id)).toEqual(['c1']);
    expect(buildFeed({ chains: [done] }).map((i) => i.kind)).toEqual(['chain-done']);
  });
});

describe('criteria text', () => {
  it('names every gpa_rule the database allows (0253 check constraint)', () => {
    const sql = readFileSync('supabase/migrations/0253_rotation_gpa_band_or_close.sql', 'utf8');
    const allowed = sql.match(/check \(gpa_rule in \(([^)]*)\)\)/)[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1));
    expect(allowed).toEqual(['off', 'same_band', 'band_or_close']);
    expect(new Set(allowed.map(criteriaTh)).size).toBe(3);             // each says something different
    expect(criteriaTh('band_or_close')).toMatch(/0\.20/);
    expect(allowed.filter(ruleNeedsGpa)).toEqual(['same_band', 'band_or_close']);
  });
});

describe('parseGpa', () => {
  it.each([['3.5', 3.5], ['3,25', 3.25], [' 4 ', 4], ['', null]])('%s', (raw, v) => {
    expect(parseGpa(raw)).toEqual({ value: v, error: null });
  });
  it.each(['4.5', '3.555', 'abc', '-1'])('refuses %s', (raw) => {
    expect(parseGpa(raw).error).toBeTruthy();
  });
});

describe('reasons', () => {
  it('every reason an RPC in 0250–0255 can return has Thai', () => {
    const sql = readFileSync('supabase/migrations/0250_rotation_swap.sql', 'utf8')
      + readFileSync('supabase/migrations/0251_rotation_gpa_owner_only_nickname_contact.sql', 'utf8')
      + readFileSync('supabase/migrations/0252_rotation_stay_here.sql', 'utf8')
      + readFileSync('supabase/migrations/0255_rotation_wishes_and_chains.sql', 'utf8')
      + readFileSync('supabase/migrations/0259_rotation_chain_kick_taker.sql', 'utf8');
    const reasons = [...sql.matchAll(/'reason', '([a-z_]+)'/g)].map((x) => x[1]);
    expect(reasons.length).toBeGreaterThan(5);                       // the sweep found something
    for (const r of new Set(reasons)) {
      if (r === 'no_round') continue;                                 // admin-only, shown raw
      expect(REASON_TH[r], r).toBeTruthy();
    }
    expect(reasonText('???')).toMatch(/ลองใหม่/);
  });
});

describe('roster-parse', () => {
  it('splits the longest prefix first', () => {
    expect(splitPrefix('นางสาวกัญญา')).toEqual(['นางสาว', 'กัญญา']);
    expect(splitPrefix('นายธีร์')).toEqual(['นาย', 'ธีร์']);
  });
  it('reads rows, the group letter, a two-word surname and trailing schedule text', () => {
    const text = [
      '1 999000001-1 นายธีร์ ณ ทดสอบ',
      '13 999000013-1 นางสาวบัว ทดลอง A Surgery III สมรรถนะ (8)',
      '14 999000014-1 นายรัฐ ทดลอง MD 756 107 MD 756 108',
      '15 999000015-1 นางสาวลัก ทดลอง Theory(2) Competency(2)',
    ].join('\n');
    const { rows, problems } = parseRosterText(text);
    expect(problems).toEqual([]);
    expect(rows.map((r) => `${r.group}|${r.prefix}|${r.first_name}|${r.last_name}|${r.gender}`)).toEqual([
      'A|นาย|ธีร์|ณ ทดสอบ|M', 'A|นางสาว|บัว|ทดลอง|F', 'A|นาย|รัฐ|ทดลอง|M', 'A|นางสาว|ลัก|ทดลอง|F',
    ]);
  });
  it('compareNames names the PDF artefacts', () => {
    expect(compareNames({ first_name: 'ก', last_name: 'นาสว่าง' }, { first_name: 'ก', last_name: 'นำสว่าง' })).toBe('sara_am');
    expect(compareNames({ first_name: 'ก', last_name: 'เหลือง' }, { first_name: 'ก', last_name: 'เหลืองพัฒน' })).toBe('cut');
    expect(compareNames({ first_name: 'ก', last_name: 'ข' }, { first_name: 'ก', last_name: 'ค' })).toBe('different');
  });
});

describe('formatMissingGpaCopyText', () => {
  it('formats missing GPA students grouped by group', () => {
    const students = [
      { student_id: '653070001-1', first_name: 'ก', last_name: 'ข', nickname: 'บอม', current_group: 'A', has_gpa: false, signed_in: true },
      { student_id: '653070002-2', first_name: 'ค', last_name: 'ง', nickname: null, current_group: 'A', has_gpa: false, signed_in: false },
      { student_id: '653070003-3', first_name: 'จ', last_name: 'ฉ', nickname: null, current_group: 'B', has_gpa: true, signed_in: true },
      { student_id: '653070004-4', first_name: 'ช', last_name: 'ซ', nickname: null, current_group: 'B', has_gpa: false, signed_in: true },
    ];
    const text = formatMissingGpaCopyText(students, ['A', 'B']);
    expect(text).toContain('3 คน');
    expect(text).toContain('[กลุ่ม A - 2 คน]');
    expect(text).toContain('• 653070001-1 ก ข (บอม)');
    expect(text).toContain('• 653070002-2 ค ง (ยังไม่เคยเข้าเว็บ)');
    expect(text).toContain('[กลุ่ม B - 1 คน]');
    expect(text).toContain('• 653070004-4 ช ซ');
    expect(text).not.toContain('653070003-3');
  });

  it('excludes staying students from callout list and adds a polite footnote', () => {
    const students = [
      { student_id: '653070001-1', first_name: 'ก', last_name: 'ข', nickname: 'บอม', current_group: 'A', has_gpa: false, staying: false },
      { student_id: '653070002-2', first_name: 'ค', last_name: 'ง', nickname: null, current_group: 'A', has_gpa: false, staying: true },
    ];
    const text = formatMissingGpaCopyText(students, ['A']);
    expect(text).toContain('1 คน');
    expect(text).toContain('653070001-1');
    expect(text).not.toContain('653070002-2');
    expect(text).toContain('หมายเหตุ: มีเพื่อนอีก 1 คนที่เลือก "อยู่กลุ่มนี้" แล้ว จึงไม่ประสงค์แลกและไม่จำเป็นต้องกรอก GPA');
  });

  it('handles empty list or all filled', () => {
    expect(formatMissingGpaCopyText([])).toBe('ทุกคนในตารางกรอก GPA เรียบร้อยแล้ว');
  });

  it('handles case where only staying students lack GPA', () => {
    const students = [
      { student_id: '653070001-1', first_name: 'ก', last_name: 'ข', current_group: 'A', has_gpa: false, staying: true },
      { student_id: '653070002-2', first_name: 'ค', last_name: 'ง', current_group: 'A', has_gpa: true, staying: false },
    ];
    expect(formatMissingGpaCopyText(students)).toContain('ทุกคนที่ประสงค์แลกกรอก GPA เรียบร้อยแล้ว');
  });
});

