// A ฝ่าย page with nothing on it must SAY so — a bare header is
// indistinguishable from a page that failed to load (2026-10-13: six ฝ่าย were
// added with no tools and no content yet).
import { describe, it, expect } from 'vitest';
import { emptyDeptNote } from './departments.js';
import { DEPT_KEYS } from '../data/depts.js';
import { toolsForDept } from '../data/tools.js';

describe('emptyDeptNote', () => {
  it('speaks only when there is neither a tool nor any content', () => {
    expect(emptyDeptNote(0, '')).toContain('ยังไม่ได้ลงข้อมูล');
    expect(emptyDeptNote(1, '')).toBe('');
    expect(emptyDeptNote(0, '<div>x</div>')).toBe('');
  });

  it('control: some real ฝ่าย has no tool today, so the empty case is live, not hypothetical', () => {
    expect(DEPT_KEYS.some((k) => toolsForDept(k).length === 0)).toBe(true);
  });
});
