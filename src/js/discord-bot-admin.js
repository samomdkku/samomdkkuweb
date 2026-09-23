// ==============================================
// บอท Discord — the role/nickname bot's panel in /admin/ (0208).
//
// Owner, 2026-09-23: a tab to turn the bot on and off "like claude booking
// system", behind a permission set in ทีม SAMO (`discord_bot`). Until now the
// only switch was `systemctl disable` over ssh.
//
// THE PANEL JUDGES THE BOT; IT IS NEVER TOLD. The bot writes discord_bot_status
// after every pass; botHealth() decides from those times whether it is alive,
// against the SERVER's clock (panel.now), so a phone with a wrong clock cannot
// make a dead bot look healthy. "A latest reading with no TTL looks like a
// fact" (0167) — a crashed bot leaves a perfectly good-looking last summary.
//
// Loaded with a dynamic import on first entry (admin-main.js); nothing here is
// in the admin entry bundle.
// ==============================================

import { dbRest } from './db.js';
import { escHtml } from './utils.js';

/** The bot runs a full pass every 15 min; past this with no sign of life it is
 *  reported as possibly down. */
export const STALE_MINUTES = 25;

/** "5 นาที" / "2 ชม." / "3 วัน" — a length of time between two instants. */
export function span(fromIso, nowIso) {
  const ms = Date.parse(nowIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${Math.max(1, m)} นาที`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} ชม.` : `${Math.round(h / 24)} วัน`;
}

/** "5 นาทีที่แล้ว" — a moment. Under a minute: "เมื่อสักครู่". */
export function ago(fromIso, nowIso) {
  const ms = Date.parse(nowIso) - Date.parse(fromIso);
  if (!Number.isFinite(ms)) return '';
  return ms < 60000 ? 'เมื่อสักครู่' : `${span(fromIso, nowIso)}ที่แล้ว`;
}

/**
 * What the panel says about the bot. Pure: { tone, lines } where tone is
 * 'ok' | 'paused' | 'warn' and lines are plain strings (escaped by the painter).
 */
export function botHealth(p) {
  if (!p) return { tone: 'warn', lines: ['อ่านสถานะบอทไม่ได้'] };
  const now = p.now;
  const lines = [];
  const minutes = (iso) => (iso ? (Date.parse(now) - Date.parse(iso)) / 60000 : Infinity);

  if (!p.sync_enabled) {
    const who = p.changed_by_label ? ` โดย ${p.changed_by_label}` : '';
    const when = p.changed_at ? ` · ${ago(p.changed_at, now)}` : '';
    lines.push(`ปิดอยู่${who}${when}`);
    if (p.note) lines.push(`เหตุผล: ${p.note}`);
    // The switch is read by the bot every few seconds; if it has not said
    // "paused" yet it has not seen the command — or is not running at all.
    if (p.state !== 'paused') {
      lines.push(minutes(p.changed_at) < 2 ? 'กำลังส่งคำสั่งปิดให้บอท…'
        : 'บอทยังไม่ยืนยันว่าปิดแล้ว — บอทอาจไม่ได้ทำงาน แจ้งฝ่าย IT');
      return { tone: 'warn', lines };
    }
    if (minutes(p.last_seen_at) > STALE_MINUTES) {
      lines.push(`ไม่ได้รับสัญญาณจากบอทมา ${p.last_seen_at ? span(p.last_seen_at, now) : 'นานแล้ว'} — บอทอาจไม่ได้ทำงาน`);
      return { tone: 'warn', lines };
    }
    return { tone: 'paused', lines };
  }

  if (!p.last_seen_at) return { tone: 'warn', lines: ['ยังไม่เคยได้รับสัญญาณจากบอท — บอทอาจยังไม่ได้เปิดบนเซิร์ฟเวอร์ แจ้งฝ่าย IT'] };
  let tone = 'ok';
  if (minutes(p.last_seen_at) > STALE_MINUTES) {
    tone = 'warn';
    lines.push(`ไม่ได้รับสัญญาณจากบอทมา ${span(p.last_seen_at, now)} — บอทอาจหยุดทำงาน แจ้งฝ่าย IT`);
  } else if (p.state === 'paused') {
    // Switched back on, not yet picked up.
    lines.push(minutes(p.changed_at) < 2 ? 'กำลังส่งคำสั่งเปิดให้บอท…' : 'บอทยังไม่ยืนยันว่าเปิดแล้ว — แจ้งฝ่าย IT');
    tone = 'warn';
  } else {
    lines.push(`ทำงานปกติ · ตรวจล่าสุด ${ago(p.last_pass_at || p.last_seen_at, now)}`);
  }
  if (p.last_summary && tone === 'ok') lines.push(p.last_summary);
  if (p.last_error_at && (!p.last_pass_at || Date.parse(p.last_error_at) > Date.parse(p.last_pass_at))) {
    tone = 'warn';
    lines.push(`ผิดพลาดล่าสุด ${ago(p.last_error_at, now)}: ${p.last_error || ''}`);
  }
  if (p.full_pass_requested_at && (!p.last_pass_at || Date.parse(p.full_pass_requested_at) > Date.parse(p.last_pass_at))) {
    lines.push('ขอให้ตรวจทุกคนแล้ว — รอบอทรับคำสั่ง…');
  }
  if (p.nicknames_enabled && p.nicknames && p.nicknames !== 'apply') {
    lines.push(`การตั้งชื่อถูกปิดไว้ที่เซิร์ฟเวอร์ (${p.nicknames}) — สวิตช์ในหน้านี้เปิดได้เฉพาะเมื่อเซิร์ฟเวอร์อนุญาต`);
  }
  return { tone, lines };
}

// ── the page ────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
let panel = null;
let wired = false;
let timer = null;
let busy = false;

async function rpc(name, body = {}) {
  const { data, error } = await dbRest(`/rpc/${name}`, { method: 'POST', body });
  if (error) throw new Error(error.status === 403 || /42501|ไม่มีสิทธิ์/.test(`${error.code} ${error.message}`)
    ? 'บัญชีนี้ไม่มีสิทธิ์ใช้บอท Discord (ขอสิทธิ์ "บอท Discord" ในทีม SAMO)'
    : (error.message || `HTTP ${error.status}`));
  return data;
}

function say(text, tone = 'muted') {
  const el = $('dbotMsg');
  if (!el) return;
  el.className = `small text-${tone === 'error' ? 'danger' : tone === 'ok' ? 'success' : 'muted'}`;
  el.textContent = text;
}

function paint() {
  const host = $('dbotStatus');
  if (!host) return;
  const h = botHealth(panel);
  const icon = h.tone === 'ok' ? 'bi-check-circle-fill' : h.tone === 'paused' ? 'bi-pause-circle-fill' : 'bi-exclamation-triangle-fill';
  host.className = `dbot-status dbot-card mb-3 is-${h.tone}`;
  host.innerHTML = `<i class="bi ${icon} dbot-status-icon" aria-hidden="true"></i><div>${
    h.lines.map((l, i) => `<div class="${i ? 'dbot-status-sub' : 'dbot-status-main'}">${escHtml(l)}</div>`).join('')}</div>`;
  if (!panel) return;
  // One pass sets every control from the panel — the switches never keep a
  // state the server refused.
  $('dbotSync').checked = !!panel.sync_enabled;
  $('dbotNicks').checked = !!panel.nicknames_enabled;
  $('dbotSilent').checked = !!panel.silent;
  for (const id of ['dbotSync', 'dbotNicks', 'dbotSilent', 'dbotFullPass']) $(id).disabled = busy;
  $('dbotFullPass').disabled = busy || !panel.sync_enabled;
}

async function load() {
  try { panel = await rpc('get_discord_bot_panel'); say(''); }
  catch (e) { panel = null; say(e.message, 'error'); }
  paint();
}

async function set(patch, done) {
  busy = true; paint();
  try { panel = await rpc('set_discord_bot', patch); say(done, 'ok'); }
  catch (e) { say(`บันทึกไม่สำเร็จ: ${e.message}`, 'error'); }
  busy = false; paint();
}

function wire() {
  if (wired) return;
  wired = true;
  $('dbotSync').addEventListener('change', (e) => {
    if (e.target.checked) {
      $('dbotOffBox').hidden = true;
      set({ p_sync_enabled: true }, 'เปิดบอทแล้ว — บอทจะตรวจทุกคนให้ตรงกับเว็บภายในไม่กี่วินาที');
      return;
    }
    // Off asks WHY first; the switch stays on until that is confirmed.
    e.target.checked = true;
    $('dbotOffReason').value = '';
    $('dbotOffConfirm').disabled = true;
    $('dbotOffBox').hidden = false;
    $('dbotOffReason').focus();
  });
  $('dbotOffReason').addEventListener('input', () => {
    $('dbotOffConfirm').disabled = $('dbotOffReason').value.trim().length < 3;
  });
  $('dbotOffCancel').addEventListener('click', () => { $('dbotOffBox').hidden = true; });
  $('dbotOffConfirm').addEventListener('click', async () => {
    const note = $('dbotOffReason').value.trim();
    if (note.length < 3) return;
    $('dbotOffBox').hidden = true;
    await set({ p_sync_enabled: false, p_note: note }, 'ปิดบอทแล้ว — Discord จะไม่เปลี่ยนตามเว็บจนกว่าจะเปิด');
  });
  $('dbotNicks').addEventListener('change', (e) => set({ p_nicknames_enabled: e.target.checked },
    e.target.checked ? 'เปิดการตั้งชื่อแล้ว' : 'ปิดการตั้งชื่อแล้ว — ชื่อที่ตั้งไว้แล้วอยู่เหมือนเดิม'));
  $('dbotSilent').addEventListener('change', (e) => set({ p_silent: e.target.checked },
    e.target.checked ? 'ข้อความจากบอทจะเป็นแบบเงียบ' : 'ข้อความจากบอทจะแจ้งเตือนตามปกติ'));
  $('dbotFullPass').addEventListener('click', async () => {
    busy = true; paint();
    try { panel = await rpc('request_discord_full_pass'); say('สั่งแล้ว — บอทจะตรวจทุกคนภายในไม่กี่วินาที', 'ok'); }
    catch (e) { say(e.message, 'error'); }
    busy = false; paint();
  });
  $('dbotRefresh').addEventListener('click', load);
}

/** Entry from admin-main.js, every time the section is opened. */
export function enterDiscordBot() {
  wire();
  load();
  // Refresh while the pane is on screen, so "กำลังส่งคำสั่ง…" resolves by
  // itself; stops the first time the pane is found hidden.
  clearInterval(timer);
  timer = setInterval(() => {
    const pane = document.querySelector('[data-admin-pane="discordbot"]');
    if (!pane || pane.classList.contains('d-none')) { clearInterval(timer); timer = null; return; }
    if (!busy && !document.hidden) load();   // a background tab skips a tick, it does not stop
  }, 20000);
}
