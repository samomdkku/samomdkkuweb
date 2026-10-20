// ==============================================
// EDITING AN ARCHIVED ANNOUNCEMENT MUST NOT REPUBLISH IT.
//
// 0232 added เก็บเข้าคลัง (archive) / เผยแพร่อีกครั้ง (restore) for
// announcements, but publishAnnouncement()'s save path built its PATCH body
// with a hardcoded `status: 'approved'` — written before archiving existed,
// when every row WAS 'approved' by construction. Once an archived post could
// be reopened in the editor (the manage card's pencil, or a `#creator/{id}`
// deep link — both resolve archived rows via `loadAnnouncements('all')`),
// saving even an unrelated text fix silently flipped it back onto the public
// site. `nextAnnouncementStatus` is the pure decision `publishAnnouncement`
// now defers to; see docs/mistakes/app-state.md.
// ==============================================
import { describe, it, expect } from 'vitest';
import { nextAnnouncementStatus } from './announcements.js';

describe('nextAnnouncementStatus', () => {
  it('a brand-new post is always approved — there is no "create archived" control', () => {
    expect(nextAnnouncementStatus(null, false)).toBe('approved');
    expect(nextAnnouncementStatus({ status: 'archived' }, false)).toBe('approved');
  });

  it('editing an archived post keeps it archived', () => {
    expect(nextAnnouncementStatus({ status: 'archived' }, true)).toBe('archived');
  });

  it('editing an approved post keeps it approved', () => {
    expect(nextAnnouncementStatus({ status: 'approved' }, true)).toBe('approved');
  });

  it('editing with no prior row on hand (cache miss) falls back to approved, never archived by accident', () => {
    expect(nextAnnouncementStatus(null, true)).toBe('approved');
  });
});
