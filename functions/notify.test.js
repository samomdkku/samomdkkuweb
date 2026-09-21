// Tests for the Cloudflare Pages Function Discord proxy: pure payload
// builders + webhook routing + retry delivery + the onRequestPost handler.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  htmlToText, buildPrPayload, buildVsPayload, buildVsConsultPayload,
  buildProjectPayload, buildClaudeMonitorPayload, parseVsWebhooks, resolveTarget,
  postToDiscord, logNotifyOutcome, wantsSilence, SILENCE_KEYS,
} from './_discord.js';
import { onRequestPost } from './notify.js';
import { readFileSync, readdirSync } from 'node:fs';
import { stripComments } from '../src/js/strip-comments.js';

const noSleep = () => Promise.resolve();
const resp = (status, body = '', headers = {}) => ({
  status,
  headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

const ENV = {
  DISCORD_PR_WEBHOOK: 'https://discord/pr',
  DISCORD_PROJECTS_WEBHOOK: 'https://discord/projects',
  // Absent until 0167, which made every "routes to the Claude webhook"
  // assertion compare undefined with undefined and pass.
  DISCORD_CLAUDE_WEBHOOK: 'https://discord/claude',
  DISCORD_VS_WEBHOOKS: JSON.stringify({
    SE: 'https://discord/vs/se',
    'อุปนายกฝ่ายวิชาการ': 'https://discord/vs/academic',
  }),
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('htmlToText', () => {
  it('flattens Quill HTML to Discord text', () => {
    expect(htmlToText('<p>line one</p><p>line two</p>')).toBe('line one\nline two');
    expect(htmlToText('a<br>b')).toBe('a\nb');
    expect(htmlToText('<b>bold</b> <i>x</i>')).toBe('bold x');
    expect(htmlToText('')).toBe('');
    expect(htmlToText(null)).toBe('');
  });
});

describe('buildPrPayload', () => {
  it('builds fields, image links, and normal (blue) color', () => {
    const p = buildPrPayload({
      ticketId: 'PR-1', content: 'Poster', department: 'media', jobType: 'โปสเตอร์',
      contact: '@x', uploadedUrls: ['u1', 'u2'], deadlineMode: 'Normal',
    });
    expect(p.content).toContain('media');
    expect(p.embeds[0].title).toBe('Poster');
    expect(p.embeds[0].color).toBe(3447003);
    const fileField = p.embeds[0].fields.find((f) => f.name === 'ไฟล์แนบ');
    expect(fileField.value).toContain('ภาพที่ 1');
    expect(fileField.value).toContain('ภาพที่ 2');
    expect(p.flags).toBeUndefined();
  });

  it('rush → red, other-platform fields appended', () => {
    const p = buildPrPayload({
      ticketId: 'PR-2', content: 'X', department: 'd', deadlineMode: 'Rush PR Review',
      silentNotify: true, otherPlatform: ['IG', 'FB'], otherPlatformReason: 'reach',
    });
    expect(p.embeds[0].color).toBe(16711680);
    // flags are set in resolveTarget now — see the every-action test at the end.
    expect(p.embeds[0].fields.some((f) => f.name === 'Other Platform' && f.value === 'IG, FB')).toBe(true);
    expect(p.embeds[0].fields.some((f) => f.name === 'เหตุผลที่ต้องการ PR')).toBe(true);
  });
});

describe('buildVsPayload', () => {
  it('normal ticket: no @here mention, red embed, dept in title', () => {
    const p = buildVsPayload({ ticketId: 'VS-1', vsProblem: '<p>broken</p>', department: 'SE' });
    expect(p.content).not.toContain('@here');
    expect(p.embeds[0].title).toBe('Ticket: VS-1 [SE]');
    expect(p.embeds[0].description).toBe('broken');
    expect(p.embeds[0].color).toBe(15548997);
  });

  it('emergency → brighter red + emergency copy', () => {
    const p = buildVsPayload({ ticketId: 'VS-2', vsProblem: 'x', department: 'SE', isEmergency: true });
    expect(p.content).toContain('ฉุกเฉิน');
    expect(p.embeds[0].color).toBe(16711680);
  });

  it('silent → no @here mention', () => {
    const p = buildVsPayload({ ticketId: 'VS-3', vsProblem: 'x', department: 'SE', vsSilentNotify: true });
    expect(p.content).not.toContain('@here');
    // flags are set in resolveTarget now — see the every-action test at the end.
  });

  it('non-SE requestedDept adds a routing note; empty problem gets a placeholder', () => {
    const p = buildVsPayload({ ticketId: 'VS-4', vsProblem: '', department: 'SE', requestedDept: 'อุปนายกฝ่ายวิชาการ' });
    expect(p.embeds[0].description).toContain('ไม่มีข้อความ');
    expect(p.embeds[0].description).toContain('อุปนายกฝ่ายวิชาการ');
  });
});

describe('buildVsConsultPayload', () => {
  it('includes role, dept, status, remark', () => {
    const p = buildVsConsultPayload({
      ticketId: 'VS-9', role: 'SE', displayDept: 'วิชาการ', displayStatus: 'กำลังดำเนินการ', remark: 'โอนให้ฝ่าย',
    });
    expect(p.content).toContain('SE');
    expect(p.embeds[0].title).toBe('อัปเดต Ticket: VS-9');
    expect(p.embeds[0].description).toContain('วิชาการ');
    expect(p.embeds[0].description).toContain('โอนให้ฝ่าย');
    expect(p.embeds[0].color).toBe(3447003);
  });
});

describe('buildProjectPayload', () => {
  it('wraps title/description/color/fields into an embed', () => {
    const p = buildProjectPayload({ title: 'หนังสือ', description: 'd', color: 123, fields: [{ name: 'a', value: 'b' }] });
    expect(p.embeds[0]).toMatchObject({ title: 'หนังสือ', description: 'd', color: 123 });
    expect(p.embeds[0].fields).toHaveLength(1);
  });
  it('passes a pre-built payload through unchanged', () => {
    const raw = { content: 'c', embeds: [{ title: 't' }] };
    expect(buildProjectPayload({ payload: raw })).toBe(raw);
  });
});

describe('parseVsWebhooks / resolveTarget', () => {
  it('tolerates malformed JSON (returns {})', () => {
    expect(parseVsWebhooks({ DISCORD_VS_WEBHOOKS: '{bad' })).toEqual({});
    expect(parseVsWebhooks({})).toEqual({});
  });

  it('routes each action to the right webhook', () => {
    expect(resolveTarget('notifyPROnly', { ticketId: 'P' }, ENV).url).toBe('https://discord/pr');
    expect(resolveTarget('notifyProjectDiscord', { title: 't' }, ENV).url).toBe('https://discord/projects');
    expect(resolveTarget('notifyVSOnly', { department: 'อุปนายกฝ่ายวิชาการ' }, ENV).url).toBe('https://discord/vs/academic');
    expect(resolveTarget('notifyVSConsult', { notifyTo: 'SE' }, ENV).url).toBe('https://discord/vs/se');
  });

  it('VS falls back to SE webhook when dept is unmapped', () => {
    expect(resolveTarget('notifyVSOnly', { department: 'ไม่มีฝ่ายนี้' }, ENV).url).toBe('https://discord/vs/se');
  });

  it('unknown action → { error }', () => {
    expect(resolveTarget('bogus', {}, ENV).error).toMatch(/unknown action/);
  });
});

describe('postToDiscord', () => {
  it('returns ok on a 2xx first shot (one attempt)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(204));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r).toEqual({ ok: true, status: 204, attempts: 1 });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('retries a 429 then succeeds, honouring Retry-After', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(resp(429, 'rate limited', { 'Retry-After': '0.5' }))
      .mockResolvedValueOnce(resp(204));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r).toMatchObject({ ok: true, status: 204, retried: true, attempts: 2, firstStatus: 429 });
  });

  it('does NOT retry a 400 (non-transient) — bails after one attempt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(400, 'bad payload'));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('bails immediately on a Cloudflare 1015 body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(resp(429, 'error code: 1015'));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();  // no retry after 1015
  });

  it('does not crash when an error response body cannot be read', async () => {
    // resp.text rejects — must NOT be misclassified as a transport throw.
    const badBody = { status: 400, headers: { get: () => null }, text: async () => { throw new Error('stream'); } };
    const fetchImpl = vi.fn().mockResolvedValue(badBody);
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);          // a real 400, not threw:true
    expect(fetchImpl).toHaveBeenCalledOnce();  // 400 is non-transient → no retry
  });

  it('treats a transport throw as transient and exhausts attempts', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const r = await postToDiscord('u', {}, { fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(3);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('onRequestPost (handler)', () => {
  function req(bodyObj) {
    return { text: async () => JSON.stringify(bodyObj) };
  }
  async function readJson(response) {
    return JSON.parse(await response.text());
  }

  it('400 on an unparseable body', async () => {
    const res = await onRequestPost({ request: { text: async () => 'not json' }, env: ENV });
    expect(res.status).toBe(400);
    expect((await readJson(res)).success).toBe(false);
  });

  it('delivers a PR notify to the PR webhook and returns success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(204));
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequestPost({
      request: req({ action: 'notifyPROnly', ticketId: 'PR-1', content: 'x', department: 'media' }),
      env: ENV,
    });
    const body = await readJson(res);
    expect(body.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://discord/pr');
    vi.unstubAllGlobals();
  });

  it('routes a VS submit to the dept webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(204));
    vi.stubGlobal('fetch', fetchMock);
    await onRequestPost({
      request: req({ action: 'notifyVSOnly', ticketId: 'VS-1', vsProblem: '<p>x</p>', department: 'อุปนายกฝ่ายวิชาการ' }),
      env: ENV,
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://discord/vs/academic');
    vi.unstubAllGlobals();
  });

  it('success:false when no webhook is configured for the action', async () => {
    const res = await onRequestPost({
      request: req({ action: 'notifyPROnly', content: 'x' }),
      env: {},  // no DISCORD_PR_WEBHOOK
    });
    const body = await readJson(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/no webhook/);
  });

  it('success:false (with status) when Discord rejects the delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(404, 'unknown webhook'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequestPost({
      request: req({ action: 'notifyProjectDiscord', title: 't' }),
      env: ENV,
    });
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.status).toBe(404);
    vi.unstubAllGlobals();
  });
});

describe('logNotifyOutcome (durable notify_log)', () => {
  const SB_ENV = { SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_ANON_KEY: 'anon-key' };

  it('skips (no fetch) when Supabase env is absent', async () => {
    const fetchMock = vi.fn();
    const out = await logNotifyOutcome({}, { action: 'notifyPROnly', ok: true }, { fetchImpl: fetchMock });
    expect(out.logged).toBe(false);
    expect(out.skipped).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs a row to the notify_log endpoint with the anon key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(201));
    const out = await logNotifyOutcome(
      SB_ENV,
      { system: 'pr', action: 'notifyPROnly', ticketId: 'PR-1', dept: 'media',
        ok: false, status: 429, firstStatus: 429, attempts: 3, retried: true, error: 'rate limited' },
      { fetchImpl: fetchMock },
    );
    expect(out.logged).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://ref.supabase.co/rest/v1/notify_log');
    expect(opts.method).toBe('POST');
    expect(opts.headers.apikey).toBe('anon-key');
    expect(opts.headers.Authorization).toBe('Bearer anon-key');
    const body = JSON.parse(opts.body);
    expect(body.ticket_id).toBe('PR-1');
    expect(body.ok).toBe(false);
    expect(body.discord_status).toBe(429);
    expect(body.attempts).toBe(3);
    expect(body.retried).toBe(true);
  });

  it('truncates a long error snippet to 500 chars', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(201));
    await logNotifyOutcome(SB_ENV, { ok: false, error: 'x'.repeat(2000) }, { fetchImpl: fetchMock });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.error.length).toBe(500);
  });

  it('never throws when the insert rejects (returns threw:true)', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const out = await logNotifyOutcome(SB_ENV, { ok: true }, { fetchImpl: fetchMock });
    expect(out.logged).toBe(false);
    expect(out.threw).toBe(true);
  });

  it('reports a non-2xx insert (e.g. RLS denied) without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(403, 'RLS denied'));
    const out = await logNotifyOutcome(SB_ENV, { ok: true }, { fetchImpl: fetchMock });
    expect(out.logged).toBe(false);
    expect(out.status).toBe(403);
  });
});

describe('onRequestPost + notify_log wiring', () => {
  function req(bodyObj) { return { text: async () => JSON.stringify(bodyObj) }; }
  async function readJson(response) { return JSON.parse(await response.text()); }

  it('writes a notify_log row after delivery when SUPABASE env is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(204));
    vi.stubGlobal('fetch', fetchMock);
    const res = await onRequestPost({
      request: req({ action: 'notifyPROnly', ticketId: 'PR-9', content: 'x', department: 'media' }),
      env: { ...ENV, SUPABASE_URL: 'https://ref.supabase.co', SUPABASE_ANON_KEY: 'anon-key' },
    });
    expect((await readJson(res)).success).toBe(true);
    // 1st fetch = Discord webhook, 2nd = notify_log insert.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://discord/pr');
    expect(fetchMock.mock.calls[1][0]).toBe('https://ref.supabase.co/rest/v1/notify_log');
    vi.unstubAllGlobals();
  });

  it('does NOT attempt a log write when SUPABASE env is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(resp(204));
    vi.stubGlobal('fetch', fetchMock);
    await onRequestPost({
      request: req({ action: 'notifyPROnly', ticketId: 'PR-10', content: 'x', department: 'media' }),
      env: ENV, // no SUPABASE_*
    });
    // Only the Discord POST — no notify_log insert.
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

// ============================================================
// NOTHING THIS APP POSTS MAY PING ANYBODY
//
// `@here` was removed from the two VitalSound builders by hand, and that fix
// left the rule living in string literals inside three functions with no test
// on two of the branches — the emergency ticket and the consult update both
// went unasserted. Rewriting the same assertion once per builder would repeat
// the mistake in test form: the next builder added is the next one nobody
// checks.
//
// So this asserts the PROPERTY instead, and it asserts it in the two places the
// property can be broken:
//   • at the WIRE, where allowed_mentions decides what actually notifies —
//     which also covers a mention that arrives inside interpolated user text
//     rather than from a builder's own string;
//   • over EVERY action resolveTarget knows, enumerated FROM ITS SOURCE, so an
//     action added tomorrow is covered without anybody remembering to.
// ============================================================
describe('no notification this app sends may ping the channel', () => {
  const SOURCE = stripComments(
    readFileSync(new URL('./_discord.js', import.meta.url), 'utf8'),
  );

  /** Every `case '…':` inside resolveTarget, read out of the stripped source.
   *  Comments are stripped first because this file's prose NAMES these actions
   *  — an instrument that cannot tell a case label from a paragraph about one
   *  is the failure mode `strip-comments.js` exists for. */
  const ACTIONS = [...SOURCE.slice(SOURCE.indexOf('export function resolveTarget'))
    .matchAll(/case\s+'([A-Za-z]+)'/g)].map((m) => m[1]);

  it('the instrument found the actions (a sweep over nothing proves nothing)', () => {
    // The control. If resolveTarget is ever restructured away from a switch,
    // this fails loudly and tells the next reader to re-derive the list, rather
    // than sweeping an empty array and reporting green.
    expect(ACTIONS.length).toBeGreaterThanOrEqual(6);
    expect(ACTIONS).toContain('notifyVSOnly');
    expect(ACTIONS).toContain('notifyClaudeMonitor');
  });

  /** A payload for every action, each carrying user-supplied text in the field
   *  that reaches `content` — because that is where a mention could ride in
   *  from data rather than from a literal. */
  const DATA = {
    department: 'SE',
    notifyTo: 'SE',
    ticketId: 'VS-1',
    vsProblem: 'x',
    content: 'x',
    role: 'SE',
    who: 'x',
    reason: 'x',
    mode: 'monitor-off',
    note: 'x',
    // notifyShopOrder resolves only once notify.js has LOADED the order from
    // the database; this is that loaded state, with the buyer's name (DB text a
    // buyer controls) in the field that reaches `content`.
    __shop: { order: { id: 'SH1', buyer_name: 'x', total: 1, items: [] } },
  };

  it.each(['@here', '@everyone'])('no builder writes %s into content', (mention) => {
    for (const action of ACTIONS) {
      const { payload } = resolveTarget(action, DATA, ENV);
      expect(`${action}: ${payload?.content || ''}`).not.toContain(mention);
    }
  });

  it('a mention pasted into user text is defused at the wire, not in a builder', async () => {
    // The half a per-builder assertion cannot reach: nothing here wrote a
    // mention, a person typed one into a ticket title.
    const { payload } = resolveTarget('notifyVSConsult',
      { ...DATA, role: '@everyone please look' }, ENV);
    expect(payload.content).toContain('@everyone');   // the text is preserved…

    const calls = [];
    await postToDiscord('https://discord/vs', payload, {
      fetchImpl: async (_u, opts) => { calls.push(JSON.parse(opts.body)); return resp(204); },
      sleep: noSleep,
    });
    // …and it still cannot notify anybody.
    expect(calls[0].allowed_mentions).toEqual({ parse: [] });
  });

  it('every action is sent with mentions suppressed', async () => {
    for (const action of ACTIONS) {
      const { payload } = resolveTarget(action, DATA, ENV);
      const calls = [];
      await postToDiscord('https://discord/x', payload, {
        fetchImpl: async (_u, opts) => { calls.push(JSON.parse(opts.body)); return resp(204); },
        sleep: noSleep,
      });
      expect(calls[0].allowed_mentions, action).toEqual({ parse: [] });
    }
  });

  it('a builder that deliberately wants a ping is still able to ask for one', async () => {
    // The opposite direction. A blanket suppression nothing can override is a
    // policy, not a default, and would have to be undone rather than configured
    // the first time a real ping is wanted.
    const calls = [];
    await postToDiscord('https://discord/x',
      { content: 'x', allowed_mentions: { parse: ['everyone'] } },
      {
        fetchImpl: async (_u, opts) => { calls.push(JSON.parse(opts.body)); return resp(204); },
        sleep: noSleep,
      });
    expect(calls[0].allowed_mentions).toEqual({ parse: ['everyone'] });
  });
});

// ============================================================
// The measurement on/off notice (migration 0167)
// ============================================================
describe('buildClaudeMonitorPayload', () => {
  it('off: the reason is the headline field, and booking is addressed', () => {
    const p = buildClaudeMonitorPayload({
      mode: 'monitor-off', who: 'พู่กัน', note: 'ยังไม่ได้ต่ออายุ Claude',
    });
    const f = p.embeds[0].fields;
    expect(p.content).toContain('พู่กัน');
    expect(f[0].name).toBe('เหตุผล');
    expect(f[0].value).toBe('ยังไม่ได้ต่ออายุ Claude');
    // The question everyone reading will actually have.
    expect(f.some((x) => x.name === 'จองได้ตามปกติไหม' && x.value.includes('ได้ตามปกติ')))
      .toBe(true);
    // The cost of a long pause is stated where the person who pays it reads it.
    expect(f.some((x) => x.value.includes('claude login'))).toBe(true);
  });

  it('off does NOT wear the alert embed\'s clothes', () => {
    // A deliberate pause rendered as an incident is how a channel learns to
    // ignore both. Different colour, and none of the alert's "ต้องเข้าสู่ระบบ
    // ใหม่บนเซิร์ฟเวอร์" framing.
    const p = buildClaudeMonitorPayload({ mode: 'monitor-off', who: 'x', note: 'y' });
    expect(p.embeds[0].color).not.toBe(11815192);
    expect(p.embeds[0].title).not.toContain('ต้องเข้าสู่ระบบใหม่');
  });

  it('on: reports how long it was off, and what it had been off for', () => {
    const p = buildClaudeMonitorPayload({
      mode: 'monitor-on', who: 'พู่กัน', note: 'รอต่ออายุ', since: '3 วัน',
    });
    const f = p.embeds[0].fields;
    expect(p.content).toContain('กลับมาติดตาม');
    expect(f.some((x) => x.name === 'ที่หยุดไปเพราะ' && x.value === 'รอต่ออายุ')).toBe(true);
    expect(f.some((x) => x.name === 'หยุดไปนาน' && x.value === '3 วัน')).toBe(true);
    expect(f.some((x) => x.name === 'เปิดโดย')).toBe(true);
  });

  it('an unknown mode reads as OFF, never as a resume', () => {
    // Fail toward the quieter statement: announcing "measurement is back" when
    // it is not is the one direction that makes a stale number look trusted.
    const p = buildClaudeMonitorPayload({ who: 'x', note: 'y' });
    expect(p.content).toContain('หยุดติดตาม');
  });

  it('routes to the Claude webhook — the same one bookings use', () => {
    // Asserted against a LITERAL, not against `ENV.DISCORD_CLAUDE_WEBHOOK`:
    // that key was missing from ENV when this test was first written, so the
    // check was `undefined === undefined` and would have passed for an action
    // that routed nowhere at all.
    const monitor = resolveTarget('notifyClaudeMonitor',
      { mode: 'monitor-off', who: 'x', note: 'y' }, ENV);
    const booking = resolveTarget('notifyClaudeBooking', { mode: 'new' }, ENV);
    expect(monitor.url).toBe('https://discord/claude');
    expect(monitor.url).toBe(booking.url);
  });
});

// ============================================================
// Every action must honour "do not ping" — the PROPERTY, not a list.
//
// Until 2026-08-28 each builder decided this for itself and only three of seven
// did. `silentNotify` was accepted by the API and silently DROPPED for
// projects and all three claude actions, so a test run pinged people in
// #notify-samodocument. Reported by the owner: "on samodocument not silent".
//
// The action list is read out of the SOURCE, so a `case` added later cannot
// escape this test by nobody remembering to extend a list here.
// ============================================================
describe('silence is honoured by every action, not only the ones that remembered', () => {
  const WEBHOOK = 'https://discord.com/api/webhooks/1/x';
  const env = {
    DISCORD_PR_WEBHOOK: WEBHOOK,
    DISCORD_PROJECTS_WEBHOOK: WEBHOOK,
    DISCORD_CLAUDE_WEBHOOK: WEBHOOK,
    DISCORD_VS_WEBHOOKS: JSON.stringify({ SE: WEBHOOK }),
    DISCORD_SHOP_WEBHOOK: WEBHOOK,
  };
  const src = readFileSync(new URL('./_discord.js', import.meta.url), 'utf8');
  // The loaded-from-DB state notifyShopOrder needs (see notify.js).
  const SHOP = { order: { id: 'SH1', total: 1, items: [] } };
  const ACTIONS = [...stripComments(src).matchAll(/case '(notify\w+)':/g)].map((m) => m[1]);

  it('found every action in the source', () => {
    expect(ACTIONS.length, 'no actions parsed — did the switch change shape?').toBeGreaterThanOrEqual(7);
  });

  for (const action of ACTIONS) {
    it(`${action} suppresses the ping when asked`, () => {
      const data = { department: 'SE', notifyTo: 'SE', ticketId: 'T', silentNotify: true, __shop: SHOP };
      const { payload, error } = resolveTarget(action, data, env);
      expect(error, `${action} did not resolve`).toBeFalsy();
      expect(payload && payload.flags, `${action} DROPPED the silence flag`).toBe(4096);
    });

    it(`${action} pings normally when not asked`, () => {
      const { payload } = resolveTarget(action, { department: 'SE', notifyTo: 'SE', ticketId: 'T', __shop: SHOP }, env);
      expect(payload && payload.flags, `${action} silenced a message nobody asked to silence`).toBeUndefined();
    });
  }
});

// ============================================================
// …and it must honour the spelling the SENDERS actually use.
//
// The block above reads the ACTION list out of the source — the property, not
// a list — but it hardcoded ONE spelling, `silentNotify`, taken from
// wantsSilence's own definition. That is the list the code came from, so a
// caller using a different key passed the guard invisibly: the VS staff modal
// sends `isSilent`, wantsSilence knew only `silentNotify`/`vsSilentNotify`,
// and "แจ้งเตือนแบบ Silent (ไม่ดัง)" pinged the ฝ่าย from 2026-08-28 until
// 2026-09-04. Nothing was red.
//
// So derive the spellings from the FRONTEND senders instead. This is the
// differential test for a rule with two homes in two build targets: the
// checkbox is read in src/js, the flag is applied in functions/. Neither half
// can see the other, and only this crosses.
//
// One direction only, deliberately: every key a sender passes must be honoured.
// The reverse (a key in SILENCE_KEYS nobody sends) is NOT asserted — a spelling
// stays accepted so an already-loaded browser tab running the old bundle keeps
// working after a rename.
// ============================================================
describe('every silence spelling a frontend sender uses is honoured', () => {
  const SRC = new URL('../src/js/', import.meta.url);

  /** Every .js under src/js that is not a test. */
  function walk(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) out.push(...walk(u));
      else if (e.name.endsWith('.js') && !e.name.includes('.test.')) out.push(u);
    }
    return out;
  }

  /** Text of every `sendNotify(...)` argument list, by balanced parens. */
  function sendNotifyCalls(src) {
    const calls = [];
    const re = /\bsendNotify\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      let depth = 1;
      let i = re.lastIndex;
      for (; i < src.length && depth > 0; i += 1) {
        if (src[i] === '(') depth += 1;
        else if (src[i] === ')') depth -= 1;
      }
      calls.push(src.slice(re.lastIndex, i - 1));
    }
    return calls;
  }

  const sent = new Set();
  for (const f of walk(SRC)) {
    // Comments are stripped first: notify.js's own usage BLOCK names the
    // actions in prose, and a doc comment describing a flag is not a sender.
    for (const call of sendNotifyCalls(stripComments(readFileSync(f, 'utf8')))) {
      // Object-literal keys, shorthand (`isSilent,`) or explicit (`isSilent:`).
      for (const k of call.matchAll(/(?:^|[{,\s])(\w*[sS]ilent\w*)\s*[,:}]/g)) sent.add(k[1]);
    }
  }

  it('found the senders (a zero-key sweep would pass every assertion below)', () => {
    // Control: if the walk or the paren scan breaks, this is what says so
    // rather than an empty loop reading as green.
    expect([...sent].sort(), 'no silence flag found in any sendNotify call').toEqual(
      ['isSilent', 'silentNotify', 'vsSilentNotify'],
    );
  });

  const WEBHOOK = 'https://discord.com/api/webhooks/1/x';
  const env = {
    DISCORD_PR_WEBHOOK: WEBHOOK,
    DISCORD_PROJECTS_WEBHOOK: WEBHOOK,
    DISCORD_CLAUDE_WEBHOOK: WEBHOOK,
    DISCORD_VS_WEBHOOKS: JSON.stringify({ SE: WEBHOOK }),
  };

  it('wantsSilence accepts every spelling the app sends', () => {
    for (const key of sent) {
      expect(SILENCE_KEYS, `nothing honours "${key}", which a sendNotify call passes`)
        .toContain(key);
      expect(wantsSilence({ [key]: true }), `wantsSilence dropped "${key}"`).toBe(true);
    }
  });

  it('notifyVSConsult suppresses the ping for the staff modal\'s own flag', () => {
    // The exact wire shape vs-staff.js sends. This is the case that was broken.
    const { payload } = resolveTarget('notifyVSConsult',
      { notifyTo: 'SE', ticketId: 'T', role: 'x', isSilent: true }, env);
    expect(payload && payload.flags).toBe(4096);
  });
});

// ---- SAMO Shop: new-order notification ----
// The one action NOT built from what the client posts: the order is read from
// the database with the buyer's own session, so these tests assert what goes
// OUT — to Supabase (the token) and to Discord (the DB's numbers, never the
// client's) — against a stubbed fetch.
describe('notifyShopOrder', () => {
  const SHOP_ENV = { ...ENV, DISCORD_SHOP_WEBHOOK: 'https://discord/shop', SUPABASE_URL: 'https://db', SUPABASE_ANON_KEY: 'anon', PUBLIC_ORIGIN: 'https://samo.md.kku.ac.th' };
  const row = (over = {}) => ({
    id: 'SH1234', buyer_name: 'ผู้ซื้อ', buyer_label: 'someone@kkumail.com', status: 'review',
    subtotal: 580, fee: 0, total: 580, placed_at: new Date().toISOString(),
    is_preorder: false, slip_url: 'https://x/slip', slips: [{ url: 'https://x/slip' }],
    buyer_note: 'ขอรับวันศุกร์', buyer_email: 'leak@kkumail.com', buyer_phone: '0812345678',
    items: [{ product_id: 'p1', size: 'XL', color: 'black', qty: 2, unit_price: 290, is_preorder: false }], ...over,
  });
  const jsonResp = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
  function stub(orderRows) {
    const calls = [];
    const f = vi.fn(async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/rest/v1/shop_orders')) return jsonResp(orderRows);
      if (String(url).includes('/rest/v1/shop_products')) return jsonResp([{ id: 'p1', name: 'เสื้อ SAMO',
        image_url: 'https://drive.google.com/file/d/IMG123/view', colors: [{ id: 'black', label: 'ดำ' }],
        pickup_location_id: 7, promptpay_qr_id: 3 }]);
      if (String(url).includes('/rest/v1/shop_pickup_locations')) return jsonResp([{ id: 7, label: 'ห้องสโม ชั้น 1' }]);
      if (String(url).includes('/rest/v1/shop_promptpay_qrs')) return jsonResp([{ id: 3, label: 'บัญชีฝ่ายสวัสดิการ' }]);
      if (String(url).includes('/rest/v1/notify_log')) return jsonResp([]);
      return resp(204);
    });
    vi.stubGlobal('fetch', f);
    return calls;
  }
  const post = (body) => onRequestPost({ request: { text: async () => JSON.stringify(body) }, env: SHOP_ENV, waitUntil: () => {} });
  let n = 0;
  const freshId = () => `SH${9000 + (n++)}`;

  it('builds the message from the DATABASE row, not from the client', async () => {
    const id = freshId();
    const calls = stub([row({ id })]);
    const res = await post({ action: 'notifyShopOrder', orderId: id, accessToken: 'TOKEN', total: 1, __shop: { order: { id: 'FAKE', total: 0 } } });
    expect(JSON.parse(await res.text()).success).toBe(true);
    const read = calls.find((c) => c.url.includes('/rest/v1/shop_orders'));
    expect(read.init.headers.Authorization).toBe('Bearer TOKEN');
    const discord = calls.filter((c) => c.url === 'https://discord/shop');
    expect(discord).toHaveLength(1);
    const body = discord[0].init.body;
    expect(body).toContain(`คำสั่งซื้อใหม่ **${id}** จาก **ผู้ซื้อ**`);
    expect(body).toContain('฿580');
    expect(body).toContain('เสื้อ SAMO');
    expect(body).toContain('ไซส์ XL · ดำ');
    expect(body).toContain('× 2 · ฿290/ชิ้น = **฿580**');
    expect(body).toContain('ผู้ซื้อ');
    expect(body).toContain('ห้องสโม ชั้น 1');
    expect(body).toContain('บัญชีฝ่ายสวัสดิการ');
    expect(body).toContain('ขอรับวันศุกร์');
    expect(body).toContain('https://lh3.googleusercontent.com/d/IMG123=w400');
    expect(JSON.parse(body).embeds[0].color).toBe(0x105922);
    // Never copied into a channel that keeps it for ever — the order page has them.
    for (const secret of ['leak@kkumail.com', '0812345678', 'someone@kkumail.com']) expect(body).not.toContain(secret);
    expect(body).not.toContain('FAKE');
    expect(body).not.toContain('TOKEN');
    expect(body).toContain(`/admin/?scan=${id}`);
  });

  it('no slip yet → amber, and it says so', async () => {
    const id = freshId();
    const calls = stub([row({ id, slip_url: null, slips: [] })]);
    await post({ action: 'notifyShopOrder', orderId: id, accessToken: 'T' });
    const body = JSON.parse(calls.find((c) => c.url === 'https://discord/shop').init.body);
    expect(body.embeds[0].color).toBe(0xE0A100);
    expect(JSON.stringify(body)).toContain('ยังไม่ได้ส่ง');
  });

  it('announces an order ONCE', async () => {
    const id = freshId();
    const calls = stub([row({ id })]);
    await post({ action: 'notifyShopOrder', orderId: id, accessToken: 'T' });
    const again = await post({ action: 'notifyShopOrder', orderId: id, accessToken: 'T' });
    expect(JSON.parse(await again.text()).duplicate).toBe(true);
    expect(calls.filter((c) => c.url === 'https://discord/shop')).toHaveLength(1);
  });

  it("a stranger's order id reads nothing (RLS) → nothing is posted", async () => {
    const calls = stub([]);
    const res = await post({ action: 'notifyShopOrder', orderId: freshId(), accessToken: 'T' });
    expect(JSON.parse(await res.text()).success).toBe(false);
    expect(calls.some((c) => c.url.startsWith('https://discord'))).toBe(false);
  });

  it('an old order is not news', async () => {
    const id = freshId();
    const calls = stub([row({ id, placed_at: new Date(Date.now() - 2 * 3600e3).toISOString() })]);
    const res = await post({ action: 'notifyShopOrder', orderId: id, accessToken: 'T' });
    expect(JSON.parse(await res.text()).message).toBe('order is not new');
    expect(calls.some((c) => c.url.startsWith('https://discord'))).toBe(false);
  });

  it('no token or a malformed id is refused before any read', async () => {
    const calls = stub([row()]);
    expect(JSON.parse(await (await post({ action: 'notifyShopOrder', orderId: freshId() })).text()).success).toBe(false);
    expect(JSON.parse(await (await post({ action: 'notifyShopOrder', orderId: "x'; drop", accessToken: 'T' })).text()).success).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
