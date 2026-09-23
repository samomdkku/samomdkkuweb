// The บอท Discord panel's verdict on the bot (0208). The dangerous answer is a
// dead bot shown as healthy — every stale / unconfirmed case is asserted WARN.
import { describe, it, expect } from 'vitest';
import { botHealth, ago, STALE_MINUTES } from './discord-bot-admin.js';

const NOW = '2026-09-23T15:00:00Z';
const min = (m) => new Date(Date.parse(NOW) - m * 60000).toISOString();
const running = { now: NOW, sync_enabled: true, nicknames_enabled: true, state: 'running',
  last_seen_at: min(3), last_pass_at: min(3), last_summary: 'ตรวจทั้งหมด: ได้ role 0', nicknames: 'apply' };

describe('botHealth', () => {
  it('a bot heard from recently is OK and says what it did', () => {
    const h = botHealth(running);
    expect(h.tone).toBe('ok');
    expect(h.lines.join('\n')).toMatch(/ทำงานปกติ · ตรวจล่าสุด 3 นาทีที่แล้ว[\s\S]*ได้ role 0/);
  });
  it(`silent for over ${STALE_MINUTES} min is a WARNING, whatever the last summary said`, () => {
    const h = botHealth({ ...running, last_seen_at: min(STALE_MINUTES + 5), last_pass_at: min(STALE_MINUTES + 5) });
    expect(h.tone).toBe('warn');
    expect(h.lines.join('\n')).toMatch(/อาจหยุดทำงาน/);
    expect(h.lines.join('\n')).not.toMatch(/ทำงานปกติ/);
  });
  it('never heard from is a warning, not a blank', () => {
    expect(botHealth({ ...running, last_seen_at: null, last_pass_at: null }).tone).toBe('warn');
  });
  it('an error newer than the last good pass is shown', () => {
    const h = botHealth({ ...running, last_error_at: min(1), last_error: 'Supabase HTTP 503' });
    expect(h.tone).toBe('warn');
    expect(h.lines.join('\n')).toMatch(/Supabase HTTP 503/);
  });
  it('an error the bot has since recovered from is not', () => {
    expect(botHealth({ ...running, last_error_at: min(30), last_error: 'old' }).tone).toBe('ok');
  });
  it('paused and CONFIRMED by the bot: paused, with who and why', () => {
    const h = botHealth({ ...running, sync_enabled: false, state: 'paused', note: 'จัดทีมใหม่', changed_by_label: 'ใคร', changed_at: min(10), last_seen_at: min(10) });
    expect(h.tone).toBe('paused');
    expect(h.lines.join('\n')).toMatch(/ปิดอยู่ โดย ใคร · 10 นาทีที่แล้ว[\s\S]*เหตุผล: จัดทีมใหม่/);
  });
  it('switched off but the bot never said so: a warning, not "paused"', () => {
    const h = botHealth({ ...running, sync_enabled: false, state: 'running', changed_at: min(10), note: 'x' });
    expect(h.tone).toBe('warn');
    expect(h.lines.join('\n')).toMatch(/ยังไม่ยืนยัน/);
  });
  it('…within the first minutes it is only "sending"', () => {
    expect(botHealth({ ...running, sync_enabled: false, state: 'running', changed_at: min(0.5), note: 'x' }).lines.join('\n')).toMatch(/กำลังส่งคำสั่งปิด/);
  });
  it('paused, but even the pause heartbeat stopped: a warning', () => {
    expect(botHealth({ ...running, sync_enabled: false, state: 'paused', changed_at: min(60), last_seen_at: min(60) }).tone).toBe('warn');
  });
  it('a server that keeps nicknames off says so, instead of a switch that silently does nothing', () => {
    expect(botHealth({ ...running, nicknames: 'plan' }).lines.join('\n')).toMatch(/ปิดไว้ที่เซิร์ฟเวอร์ \(plan\)/);
  });
  it('no panel at all is a warning', () => { expect(botHealth(null).tone).toBe('warn'); });
});

describe('ago', () => {
  it('reads in Thai at each scale', () => {
    expect(ago(min(0.2), NOW)).toBe('เมื่อสักครู่');
    expect(ago(min(5), NOW)).toBe('5 นาทีที่แล้ว');
    expect(ago(min(180), NOW)).toBe('3 ชม.ที่แล้ว');
    expect(botHealth({ now: NOW, sync_enabled: true, last_seen_at: min(95) }).lines[0]).toMatch(/^ไม่ได้รับสัญญาณจากบอทมา 2 ชม\. —/);
    expect(ago(min(60 * 24 * 3), NOW)).toBe('3 วันที่แล้ว');
  });
});
