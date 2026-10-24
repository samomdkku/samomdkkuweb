// model.test.js — the page's reading of rotation_board().
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildModel, buildFeed, parseGpa, reasonText, REASON_TH } from './model.js';
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

describe('parseGpa', () => {
  it.each([['3.5', 3.5], ['3,25', 3.25], [' 4 ', 4], ['', null]])('%s', (raw, v) => {
    expect(parseGpa(raw)).toEqual({ value: v, error: null });
  });
  it.each(['4.5', '3.555', 'abc', '-1'])('refuses %s', (raw) => {
    expect(parseGpa(raw).error).toBeTruthy();
  });
});

describe('reasons', () => {
  it('every reason an RPC in 0250 can return has Thai', () => {
    const sql = readFileSync('supabase/migrations/0250_rotation_swap.sql', 'utf8');
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
