// ถาวร-only people (0272): an อาจารย์ or เจ้าหน้าที่ has no รหัสนักศึกษา, so the
// card must not ask them for student fields or flag those as missing.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./db.js', () => ({ dbRest: vi.fn() }));
const { renderMySeat, ownIssues, isStaffSeat } = await import('./my-seat.js');
const { isEmailAddress } = await import('./team/identity.js');
const { isLikelyEmail } = await import('./team/io.js');

const posting = (over = {}) => ({
  node_id: 'n1', node: 'อาจารย์', path: [], member_id: 'm1', standing: true,
  first_name_th: 'สมชาย', last_name_th: 'ใจดี', full_name: 'สมชาย ใจดี',
  kkumail: 'somchai@kku.ac.th', photo_url: 'x', ...over,
});
const seat = (postings) => ({ name: 'สมชาย ใจดี', postings, permissions: [] });

describe('isStaffSeat', () => {
  it('is true only when EVERY posting is ถาวร and there is no รหัส', () => {
    expect(isStaffSeat(seat([posting()]))).toBe(true);
    expect(isStaffSeat(seat([posting(), posting({ standing: false })]))).toBe(false);
    expect(isStaffSeat(seat([posting({ student_id: '653000000-1' })]))).toBe(false);
    expect(isStaffSeat(seat([posting({ standing: undefined })]))).toBe(false);
  });
});

describe('the staff card', () => {
  it('does not report รหัส / ชั้นปี / สาขา / ชื่อเล่น / รูป as missing', () => {
    expect(ownIssues(seat([posting({ photo_url: '' })]))).toEqual([]);
    const missing = ownIssues(seat([posting()])).find((i) => i.kind === 'missing');
    expect(missing).toBeUndefined();
  });
  it('still reports them for a student posting', () => {
    const missing = ownIssues(seat([posting({ standing: false })])).find((i) => i.kind === 'missing');
    expect(missing?.detail).toContain('รหัสนักศึกษา');
  });
  it('calls the address what it is, and keeps hidden student boxes in the form', () => {
    const el = { hidden: false, innerHTML: '' };
    renderMySeat(el, seat([posting()]));
    expect(el.innerHTML).toContain('อีเมลที่ใช้เข้าระบบ');
    expect(el.innerHTML).not.toContain('<dt>รหัสนักศึกษา</dt>');
    // Present but hidden, so a save writes the stored value back, not ''.
    expect(el.innerHTML).toMatch(/<label class="myseat-field"\s+hidden>\s*<span>รหัสนักศึกษา<\/span>/);
  });
});

describe('the email rule (one home: identity.js)', () => {
  const good = ['a@kkumail.com', 'x.y@gmail.com', 'a@kku.ac.th', 'A@HOTMAIL.COM'];
  const bad = ['a@kku,ail.com', '-', 'a@b', 'a b@c.com', 'a@c.', 'nope', ''];
  it.each(good)('accepts %s', (v) => { expect(isEmailAddress(v)).toBe(true); expect(isLikelyEmail(v)).toBe(true); });
  it.each(bad)('refuses %j', (v) => { expect(isEmailAddress(v)).toBe(false); expect(isLikelyEmail(v)).toBe(false); });
});
