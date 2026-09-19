// ==============================================
// discord-nickname-link.test.js — the one-time nickname match links ONLY what
// is exact and one-to-one, and never overrides a choice a person made.
// ==============================================
import { describe, it, expect } from 'vitest';
import { plan } from '../../tools/discord-nickname-link.mjs';

const people = [
  { id: 'p1', nickname: 'เบสท์', student_id: '653070175-4' },
  { id: 'p2', nickname: 'เอิร์น', student_id: '663070139-0' },
  { id: 'p3', nickname: 'นิว', student_id: '663070147-1' },
  { id: 'p4', nickname: 'นิว', student_id: '673070147-1' },   // same ชื่อเล่น AND digits
  { id: 'p5', nickname: 'โอม', student_id: '663070120-1' },
  { id: 'p6', nickname: 'ปอน', student_id: '663070067-9' },
];
const m = (id, display, bot = false) => ({ id, display, bot });
const base = { people, linkedPeople: new Set(), linkedAccounts: new Set(), orphaned: new Set() };
const ids = (xs) => xs.map((x) => `${x.member.id}>${x.person.id}`);

describe('what it links', () => {
  it('an exact ชื่อเล่น + last-4 match to ONE person, and ignores ชั้นปี', () => {
    const r = plan({ ...base, members: [m('D1', 'เบสท์_#5_175-4'), m('D5', 'โอม_#1_120-1')] });
    expect(ids(r.link)).toEqual(['D1>p1', 'D5>p5']);
  });

  it('never a bot, never a nickname outside the shape', () => {
    const r = plan({ ...base, members: [m('B', 'เบสท์_#5_175-4', true), m('D9', 'ChocChip')] });
    expect(r.link).toEqual([]);
    expect(r.unparsed.map((x) => x.id)).toEqual(['D9']);
  });

  it('two people with the same ชื่อเล่น and digits → nobody', () => {
    const r = plan({ ...base, members: [m('D3', 'นิว_#3_147-1')] });
    expect(r.link).toEqual([]);
    expect(r.none).toHaveLength(1);
  });

  it('two accounts matching one person → neither', () => {
    const r = plan({ ...base, members: [m('D1', 'เบสท์_#5_175-4'), m('D1b', 'เบสท์_#4_175-4')] });
    expect(r.link).toEqual([]);
    expect(r.skipped.map((s) => s.why)).toEqual(['two accounts match this person', 'two accounts match this person']);
  });
});

describe('a near match waits for a human', () => {
  it('different ชื่อเล่น, one person with those digits → NEAR, not linked', () => {
    const r = plan({ ...base, members: [m('D2', 'Erin_#3_139-0')] });
    expect(r.link).toEqual([]);
    expect(r.near.map((n) => `${n.member.id}>${n.person.id}`)).toEqual(['D2>p2']);
  });

  it('…and is linked once that Discord id is confirmed', () => {
    const r = plan({ ...base, confirm: ['D2'], members: [m('D2', 'Erin_#3_139-0')] });
    expect(ids(r.link)).toEqual(['D2>p2']);
    expect(r.link[0].how).toBe('confirmed');
  });
});

describe('it never overrides what a person did', () => {
  const members = [m('D1', 'เบสท์_#5_175-4')];
  it('an already-linked person is left alone', () => {
    const r = plan({ ...base, members, linkedPeople: new Set(['p1']) });
    expect(r.link).toEqual([]);
  });
  it('an already-linked account is left alone', () => {
    const r = plan({ ...base, members, linkedAccounts: new Set(['D1']) });
    expect(r.link).toEqual([]);
  });
  it('an account somebody UNLINKED is not linked back', () => {
    const r = plan({ ...base, members, orphaned: new Set(['D1']) });
    expect(r.link).toEqual([]);
    expect(r.skipped[0].why).toMatch(/UNLINKED/);
  });
  it('control: the same member with none of those links IS linked', () => {
    expect(ids(plan({ ...base, members }).link)).toEqual(['D1>p1']);
  });
});
