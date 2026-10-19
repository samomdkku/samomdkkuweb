// The บอท Discord panel's verdict on the bot (0208). The dangerous answer is a
// dead bot shown as healthy — every stale / unconfirmed case is asserted WARN.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

// THE BUG (HANDOFF §18f — "CONFIRMED บอท Discord tab"). enterDiscordBot()'s
// 20 s background poll called load(), which on success called say('')
// UNCONDITIONALLY — wiping a `set()` save error off #dbotMsg the instant the
// next poll landed, often before anyone had read it. No jsdom here (this
// repo's test setup has none), so this is pinned structurally: by function
// body, not line number (see docs/mistakes/frontend-ui.md, "NEVER SLICE
// SOURCE BY LINE NUMBER" — same technique as admin-order-modal.test.js).
const SRC = readFileSync(new URL('./discord-bot-admin.js', import.meta.url), 'utf8');
const CODE = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');
function functionBody(src, name) {
  const m = new RegExp(`(?:async )?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`).exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  let depth = 1;
  let i = m.index + m[0].length;
  const start = i;
  for (; i < src.length && depth > 0; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') depth -= 1;
  }
  return src.slice(start, i - 1);
}

describe('the 20s background poll does not clear an unrelated message', () => {
  it('load() only clears #dbotMsg when NOT called silently', () => {
    const body = functionBody(CODE, 'load');
    expect(body).toMatch(/silent/);
    // The success branch must gate say('') behind the silent flag — not call
    // it unconditionally, which is the exact shape of the original bug.
    expect(body).not.toMatch(/rpc\('get_discord_bot_panel'\);\s*say\(''\);/);
  });
  it('the background poll passes silent — not a plain load()', () => {
    const timerBody = functionBody(CODE, 'enterDiscordBot');
    expect(timerBody).toMatch(/load\(\s*\{\s*silent:\s*true\s*\}\s*\)/);
  });
  it('an explicit reload ("โหลดใหม่") is NOT silent — the user asked, so it may clear the message', () => {
    expect(CODE).toMatch(/dbotRefresh'\)\.addEventListener\('click',\s*load\)/);
  });
});

describe('the status card paints only when its content actually changed', () => {
  it('paint() tracks the last rendered text/class before writing #dbotStatus again', () => {
    expect(functionBody(CODE, 'paint')).toMatch(/last(S|_s)tatus/i);
  });
});
