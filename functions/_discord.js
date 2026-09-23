// ==============================================
// _discord.js — pure Discord payload builders + webhook router + poster
//
// Imported by the `functions/notify.js` Cloudflare Pages Function. The
// leading underscore keeps Pages from routing this file as an endpoint.
// Everything here is framework-free and unit-testable (see
// functions/notify.test.js) — no `env`, no Request/Response, just data in
// → Discord payload / delivery result out.
//
// This replaces the Discord half of the two GAS deployments (prform.gs
// `sendDiscordNotification`/`sendProjectDiscord`, vssound.gs
// `sendDiscordNotification`/`sendConsultDiscord`). The embed shapes are
// ported verbatim so the messages land identical to the GAS era.
//
// Webhook URLs come from Pages env vars (never hardcoded — see
// .claude/rules/security.md):
//   DISCORD_PR_WEBHOOK        — PR-team channel
//   DISCORD_PROJECTS_WEBHOOK  — หนังสือโครงการ / VP-Admin channel
//   DISCORD_VS_WEBHOOKS       — JSON map { "<dept>": "<webhook url>", ... }
//                               incl. "SE" (the default/routing fallback)
// ==============================================

const DISCORD_BLUE = 3447003;
const VS_DEFAULT_DEPT = 'SE';

/** Strip the Quill HTML the VS form stores down to Discord-ready text. */
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<p>/g, '')
    .replace(/<\/p>/g, '\n')
    .replace(/<br>/g, '\n')
    .replace(/<[^>]*>?/gm, '')
    .trim();
}

const isTruthyFlag = (v) => v === true || v === 'true';

/**
 * Should this notification arrive WITHOUT pinging anyone?
 *
 * ⚠️ ONE HOME. Until 2026-08-28 each builder decided this for itself, and only
 * three of seven did: PR, VS and VS-consult honoured the flag while
 * projects, claude-booking, claude-alert and claude-monitor silently dropped
 * it. A caller passing `silentNotify` therefore got a ping anyway, depending on
 * which action they used — reported by the owner as "on samodocument not
 * silent" after a test run interrupted people.
 *
 * ALL THREE spellings are accepted because all three are already in the wire
 * format the app sends: the PR form sends `silentNotify`, the public VS form
 * `vsSilentNotify`, and the VS STAFF modal `isSilent` (vs-staff.js). The 08-28
 * centralisation above collected the two spellings it could see from
 * `wantsSilence`'s own callers and missed the third, which lives in the
 * FRONTEND — so `notifyVSConsult` accepted "แจ้งเตือนแบบ Silent (ไม่ดัง)" from
 * the staff modal and pinged the ฝ่าย anyway from 2026-08-28 until this fix.
 * `silenceKeys()` below is exported so a test can assert the set against the
 * senders instead of against this list (which is where the bug hid).
 * Discord's flag is SUPPRESS_NOTIFICATIONS (1 << 12) — the message still
 * appears, it just does not notify.
 */
export const SUPPRESS_NOTIFICATIONS = 4096;
export const SILENCE_KEYS = ['silentNotify', 'vsSilentNotify', 'isSilent'];
export function wantsSilence(data = {}) {
  return SILENCE_KEYS.some((k) => isTruthyFlag(data[k]));
}

// ---- payload builders (one per GAS action) ----

export function buildPrPayload(data = {}) {
  const isRush = data.deadlineMode === 'Rush PR Review';

  let links = '';
  if (Array.isArray(data.uploadedUrls) && data.uploadedUrls.length > 0) {
    data.uploadedUrls.forEach((url, i) => { links += `[📸 ภาพที่ ${i + 1}](${url})\n`; });
  }
  if (data.largeFileLink) links += `[🔗 ลิงก์ G-Drive เพิ่มเติม](${data.largeFileLink})`;
  if (!links) links = '-';

  const fields = [
    { name: 'Ticket ID', value: String(data.ticketId || '-'), inline: true },
    { name: 'ประเภทงาน', value: data.jobType || '-', inline: true },
    { name: 'กำหนดการ', value: isRush ? '⚡ ด่วน' : '📅 ปกติ', inline: true },
    { name: 'ติดต่อ', value: data.contact || '-', inline: true },
    { name: 'ไฟล์แนบ', value: links, inline: false },
  ];

  const otherPlat = Array.isArray(data.otherPlatform) ? data.otherPlatform : [];
  if (otherPlat.length > 0) {
    fields.push({ name: 'Other Platform', value: otherPlat.join(', '), inline: false });
    if (data.otherPlatformReason) {
      fields.push({ name: 'เหตุผลที่ต้องการ PR', value: data.otherPlatformReason, inline: false });
    }
  }

  const payload = {
    content: `🚨 ส่งงาน PR ใหม่ จาก **${data.department}**!`,
    embeds: [{ title: data.content, color: isRush ? 16711680 : DISCORD_BLUE, fields }],
  };
  return payload;
}

export function buildVsPayload(data = {}) {
  // No silence handling here: resolveTarget() owns it (see wantsSilence). A
  // dead `const silent = …` used to sit on this line and on buildVsConsultPayload's,
  // left over from the per-builder era — and reading `data.isSilent` in the
  // consult builder made that spelling look handled when nothing consumed it.
  const emergency = isTruthyFlag(data.isEmergency);

  let content = '🚨 **แจ้งปัญหาใหม่ระบบ Vital Sound**';
  let color = 15548997;
  if (emergency) {
    content = '‼️ **แจ้งปัญหาฉุกเฉิน (ส่งตรงถึงอุปนายก)!!**';
    color = 16711680;
  }

  let problem = htmlToText(data.vsProblem);
  if (!problem) problem = '*(ไม่มีข้อความ: มีการแนบรูปภาพหรือสื่อ)*';

  let note = '';
  if (!emergency && data.requestedDept && data.requestedDept !== VS_DEFAULT_DEPT) {
    note = `\n\n📌 **ผู้แจ้งปัญหาระบุว่าต้องการส่งถึง: ${data.requestedDept}**\n*(SE กรุณาพิจารณาและโอนย้ายหากเหมาะสม)*`;
  }

  const displayDept = data.department || VS_DEFAULT_DEPT;
  const payload = {
    content,
    embeds: [{
      title: `Ticket: ${data.ticketId} [${displayDept}]`,
      description: (problem + note).substring(0, 2048),
      color,
    }],
  };
  return payload;
}

export function buildVsConsultPayload(data = {}) {
  const content = `💬 **${data.role}** มีการอัปเดตใน Ticket **${data.ticketId}**`;
  let desc = `**ฝ่ายที่ดูแล:** ${data.displayDept || '-'}\n**สถานะ:** ${data.displayStatus || '-'}\n\n`;
  desc += data.remark ? `**ข้อความ:**\n${data.remark}` : '*(ไม่มีข้อความแนบ)*';

  const payload = {
    content,
    embeds: [{ title: `อัปเดต Ticket: ${data.ticketId}`, description: desc.substring(0, 2048), color: DISCORD_BLUE }],
  };
  return payload;
}

export function buildProjectPayload(data = {}) {
  // projects/notify.js already builds the embed and sends title/
  // description/color/fields (or a full `payload`). Mirror the GAS
  // sendProjectDiscord normalisation.
  if (data.payload && typeof data.payload === 'object') return data.payload;
  const fields = Array.isArray(data.fields) ? data.fields : [];
  return {
    content: String(data.content || ''),
    embeds: [{
      title: String(data.title || 'อัปเดตหนังสือโครงการ'),
      description: String(data.description || ''),
      color: typeof data.color === 'number' ? data.color : DISCORD_BLUE,
      fields,
    }],
  };
}

/** Parse the VS dept→webhook JSON map from env (tolerant of bad JSON). */
export function parseVsWebhooks(env = {}) {
  try { return JSON.parse(env.DISCORD_VS_WEBHOOKS || '{}'); }
  catch { return {}; }
}

/**
 * Resolve an action+payload to a concrete { url, payload }. Returns
 * { error } for an unknown action, { url: undefined } when the action is
 * known but no webhook is configured (caller surfaces that distinctly).
 */
/**
 * จองโควตา Claude — a booking was made, MOVED, or GIVEN BACK.
 *
 * Reports a claim on the shared Claude Pro subscription: who, which ฝ่าย and
 * ตำแหน่ง, the block, the session percent it consumes, and what is left in both
 * pools. The "เหลือ" numbers are the point — a notice that does not say what
 * remains makes everyone open the board to find out. The identity is already a
 * projection (get_claude_board names its columns); nothing on this path can
 * reach an email or a รหัสนักศึกษา.
 *
 * All three are announced, and the reason is the same one that makes the board
 * worth having: each of them changes what everybody else can have. A cancel is
 * the most valuable of the three — it hands quota back, and nobody discovers
 * that by staring at a page they closed an hour ago — so it gets its own colour
 * and its own verb rather than being a quieter version of a booking.
 *
 * `mode` is 'new' | 'edit' | 'cancel'. An unknown or missing mode reads as
 * 'new', which is what every caller before this field existed meant.
 */
const CLAUDE_MODES = {
  new:    { verb: 'จองโควตา Claude',      title: 'จองโควตา Claude แล้ว',  color: 1071394 },
  edit:   { verb: 'แก้ไขการจอง Claude',   title: 'แก้ไขการจองแล้ว',        color: 15832320 },
  cancel: { verb: 'ยกเลิกการจอง Claude',  title: 'ยกเลิกการจองแล้ว — ช่วงเวลานี้ว่างแล้ว', color: 11815192 },
};

export function buildClaudeBookingPayload(data = {}) {
  const m = CLAUDE_MODES[data.mode] || CLAUDE_MODES.new;
  const cancelled = data.mode === 'cancel';

  const fields = [
    { name: 'ฝ่าย', value: data.dept || '-', inline: true },
    { name: 'ตำแหน่ง', value: data.roles || '-', inline: true },
    { name: 'ช่วงเวลา', value: `${data.when || '-'} (${data.duration || '-'})`, inline: false },
    {
      name: cancelled ? 'โควตาที่คืนกลับมา' : 'ใช้โควตาเซสชัน',
      value: `${data.pct ?? '-'}%`,
      inline: true,
    },
  ];
  // A cancelled block has no "how much is left in its session" — the session it
  // belonged to may not exist any more. A dash there would look like a reading.
  if (!cancelled) {
    fields.push({ name: 'เหลือในรอบ 5 ชม. นี้', value: `${data.sessionLeft ?? '-'}%`, inline: true });
  }
  fields.push({ name: 'จองไปทำอะไร', value: data.purpose || '-', inline: false });

  // WHO IS WAITING. The board says it in the form; Discord is where people
  // actually are, so it says it here too — a late start moves the next person's
  // 5-hour reset by exactly as long as the lateness.
  if (!cancelled && data.nextUp) {
    fields.push({
      name: 'มีคนใช้ต่อ',
      value: `${data.nextUp} · กรุณาเริ่มใช้งานให้ตรงเวลา `
        + 'เนื่องจากรอบ 5 ชม. เริ่มนับจากข้อความแรกที่ส่ง',
      inline: false,
    });
  }

  fields.push({
    name: 'โควตาสัปดาห์',
    value: `${data.weekUsed ?? '-'} / ${data.weekPool ?? '-'}%`
      + ` · เหลือ ${(data.weekPool ?? 0) - (data.weekUsed ?? 0)}%`,
    inline: false,
  });

  return {
    content: `${m.verb} — **${data.who || 'ไม่ทราบชื่อ'}**`,
    embeds: [{ title: m.title, color: m.color, fields }],
  };
}

/**
 * The Claude usage reporter needs help (migration 0154).
 *
 * A monitor that fails silently is worse than no monitor: the board would keep
 * showing the last sample, quietly ageing, and the first sign of trouble would
 * be someone noticing the number looked wrong days later. The reporter's one
 * real failure mode is the OAuth refresh token expiring — which only happens if
 * the timer has been dead for ~12 days — and the fix is a human running
 * `claude login` on the VM, so it has to reach a human.
 */
export function buildClaudeAlertPayload(data = {}) {
  return {
    content: `**ตัวรายงานการใช้งาน Claude มีปัญหา** — ${data.reason || 'ไม่ทราบสาเหตุ'}`,
    embeds: [{
      title: 'ต้องเข้าสู่ระบบใหม่บนเซิร์ฟเวอร์',
      color: 11815192,
      fields: [
        { name: 'อาการ', value: String(data.detail || '-').slice(0, 1000), inline: false },
        {
          name: 'วิธีแก้',
          value: 'ssh เข้าเครื่องเซิร์ฟเวอร์ แล้วรัน `claude login` '
            + 'ด้วยบัญชี Claude ของสโม จากนั้นตัวรายงานจะต่ออายุตัวเองได้อีกครั้ง',
          inline: false,
        },
        {
          // Added after this embed repeated itself four times a day for three
          // days about a lapsed subscription nobody could renew that week. The
          // fix above is right when the TOKEN expired; it is useless when the
          // ACCOUNT did, and the person reading needs to be told there is a
          // second thing they can do.
          name: 'ถ้ายังไม่ได้ต่ออายุ Claude',
          value: 'ไปที่ จองโควตา Claude แล้วกดปุ่มสถานะด้านบนกระดานเพื่อ '
            + '**หยุดติดตามชั่วคราว** พร้อมระบุเหตุผล — การแจ้งเตือนนี้จะหยุด '
            + 'และทุกคนยังจองได้ตามปกติ',
          inline: false,
        },
      ],
    }],
  };
}

/**
 * จองโควตา Claude — an admin switched the usage MEASUREMENT off, or back on.
 *
 * Not an incident, and it must not look like one. buildClaudeAlertPayload above
 * is the "something is broken, a human must fix it" embed; this is a decision
 * somebody made on purpose, and rendering it in the alert's clothes is how the
 * channel learns to ignore both. The reason a person typed is the headline
 * field, because it is the only thing that answers what everyone reading will
 * actually wonder — is the board broken, or did we mean this?
 *
 * BOOKING IS UNAFFECTED, and the message says so out loud. The board's job is
 * coordinating one shared login; that job never depended on the measurement,
 * and a notice that only says "measurement is off" leaves people guessing
 * whether they may still reserve their evening.
 *
 * `mode` is 'monitor-off' | 'monitor-on'. Unknown reads as 'monitor-off' — the
 * quieter, more cautious of the two, and the one whose copy makes sense even if
 * the state it describes turns out to be the other.
 */
const CLAUDE_MONITOR_MODES = {
  'monitor-off': {
    verb: 'หยุดติดตามการใช้งานจริงของ Claude ชั่วคราว',
    title: 'ตัวเลข “ใช้จริง” จะหยุดอัปเดตจนกว่าจะเปิดใหม่',
    color: 15832320,          // amber — a deliberate pause, not the alert red
  },
  'monitor-on': {
    verb: 'กลับมาติดตามการใช้งานจริงของ Claude แล้ว',
    title: 'ตัวเลข “ใช้จริง” จะอัปเดตทุก 15 นาทีตามปกติ',
    color: 1071394,           // the same green a new booking uses
  },
};

export function buildClaudeMonitorPayload(data = {}) {
  const off = data.mode !== 'monitor-on';
  const m = CLAUDE_MONITOR_MODES[off ? 'monitor-off' : 'monitor-on'];

  const fields = [];
  if (off) {
    fields.push({ name: 'เหตุผล', value: String(data.note || '-').slice(0, 1000), inline: false });
  } else if (data.note) {
    // On resume, the note is what it HAD been off for. Saying it closes the
    // loop for anyone who saw the pause and never heard the end of it.
    fields.push({
      name: 'ที่หยุดไปเพราะ',
      value: String(data.note).slice(0, 1000),
      inline: false,
    });
  }

  fields.push({ name: off ? 'หยุดโดย' : 'เปิดโดย', value: data.who || 'ไม่ทราบชื่อ', inline: true });
  if (data.since) fields.push({ name: 'หยุดไปนาน', value: data.since, inline: true });

  fields.push({
    name: 'จองได้ตามปกติไหม',
    value: off
      ? 'ได้ตามปกติ — การจองไม่เกี่ยวกับการติดตาม เพียงแต่กระดานจะไม่รู้ว่าใช้ไปจริงเท่าไร'
      : 'ได้ตามปกติ',
    inline: false,
  });

  if (off) {
    // The cost of a long pause, said once, where the person who will pay it
    // reads it. Twelve days is the refresh token's life; a paused reporter does
    // not rotate it on purpose (tools/claude-usage-report.mjs).
    fields.push({
      name: 'ถ้าหยุดนานเกิน 12 วัน',
      value: 'ต้อง ssh เข้าเซิร์ฟเวอร์แล้วรัน `claude login` อีกครั้งตอนเปิดกลับมา '
        + 'เพราะสิทธิ์เข้าถึงจะหมดอายุระหว่างที่หยุด',
      inline: false,
    });
  }

  return {
    content: `${m.verb} — **${data.who || 'ไม่ทราบชื่อ'}**`,
    embeds: [{ title: m.title, color: m.color, fields }],
  };
}

// ---- SAMO Shop: a new order ----
//
// ⛔ NOT BUILT FROM WHAT THE BROWSER SAYS. Every other action here formats the
// fields the client posted, so anyone can post a PR that never existed. For an
// ORDER that would mean anyone announcing a paid order to the shop team. So the
// client sends only { orderId, accessToken }, and loadShopOrderForNotify()
// reads the row with the BUYER's own session: RLS (shop_orders_read) answers
// only for the buyer or a shop admin, so a stranger's id reads nothing. The
// builder below takes that DB row, never `data`.

const SHOP_NOTIFY_MAX_AGE_MS = 30 * 60 * 1000;

/** Read the order — and what it takes to describe it (product names,
 *  pictures and colour labels; pickup places; payment accounts) — as the
 *  caller. Returns `{ order, products, pickups, qrs }`, or `{ error }` for
 *  every way it is not something to announce. Everything past the order row
 *  is a nicety: a failed lookup leaves the message plainer, never unsent. */
export async function loadShopOrderForNotify(env = {}, data = {}, { fetchImpl = fetch, now = Date.now() } = {}) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;
  const id = String(data.orderId || '');
  const token = String(data.accessToken || '');
  if (!base || !key) return { error: 'shop notify needs SUPABASE_URL + SUPABASE_ANON_KEY' };
  if (!/^[A-Z0-9]{2,12}$/.test(id)) return { error: 'bad orderId' };
  if (!token) return { error: 'accessToken required' };
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const sel = 'id,buyer_name,buyer_label,status,subtotal,fee,total,placed_at,is_preorder,'
    + 'slip_url,slips,buyer_note,pickup_location,'
    + 'items:shop_order_items(product_id,size,color,qty,unit_price,is_preorder)';
  let rows;
  try {
    const r = await fetchImpl(`${base}/rest/v1/shop_orders?id=eq.${encodeURIComponent(id)}&select=${sel}`, { headers });
    if (!r.ok) return { error: `order read HTTP ${r.status}` };
    rows = await r.json();
  } catch (e) { return { error: `order read failed: ${e}` }; }
  const order = Array.isArray(rows) && rows[0];
  if (!order) return { error: 'order not found for this session' };
  const age = now - Date.parse(order.placed_at);
  if (!(age >= 0 && age <= SHOP_NOTIFY_MAX_AGE_MS)) return { error: 'order is not new' };

  const get = async (path) => {
    try {
      const r = await fetchImpl(`${base}/rest/v1/${path}`, { headers });
      return r.ok ? await r.json() : [];
    } catch { return []; }
  };
  const inList = (xs) => `in.(${xs.map((x) => encodeURIComponent(String(x))).join(',')})`;
  const ids = [...new Set((order.items || []).map((it) => it.product_id).filter(Boolean))];
  const products = ids.length ? Object.fromEntries((await get(
    `shop_products?id=${inList(ids)}&select=id,name,code,image_url,colors,pickup_location_id,promptpay_qr_id`,
  )).map((p) => [p.id, p])) : {};
  const pickupIds = [...new Set(Object.values(products).map((p) => p.pickup_location_id).filter((x) => x != null))];
  const qrIds = [...new Set(Object.values(products).map((p) => p.promptpay_qr_id).filter((x) => x != null))];
  const pickups = pickupIds.length ? Object.fromEntries((await get(
    `shop_pickup_locations?id=${inList(pickupIds)}&select=id,label`)).map((l) => [l.id, l.label])) : {};
  const qrs = qrIds.length ? Object.fromEntries((await get(
    `shop_promptpay_qrs?id=${inList(qrIds)}&select=id,label,promptpay_name`))
    .map((q) => [q.id, q.label || q.promptpay_name])) : {};
  return { order, products, pickups, qrs };
}

/** The shop's running totals for the message (0206), or null. READ WITH THE
 *  SERVICE KEY, which bypasses every RLS policy — so its whole use here is ONE
 *  RPC that returns three numbers and no row (notify.test.js pins it). Called
 *  only after loadShopOrderForNotify() has proved, with the buyer's session,
 *  that a real new order exists: an anonymous POST never reaches this. A
 *  failure leaves the message without the overview, never unsent. */
export async function loadShopTotals(env = {}, { fetchImpl = fetch } = {}) {
  const base = env.SUPABASE_URL;
  const sk = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !sk) return null;
  try {
    const r = await fetchImpl(`${base.replace(/\/+$/, '')}/rest/v1/rpc/shop_order_totals`, {
      method: 'POST',
      headers: { apikey: sk, Authorization: `Bearer ${sk}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!r.ok) return null;
    const t = await r.json();
    return t && typeof t === 'object' && 'orders' in t ? t : null;
  } catch { return null; }
}

const SHOP_COLOR_PAID = 0x105922;    // slip attached — brand green
const SHOP_COLOR_WAITING = 0xE0A100; // no slip yet — amber: someone must follow up
const baht = (n) => `฿${(Number(n) || 0).toLocaleString('en-US')}`;
/** Same rule as src/js/uploads.js convertDriveUrl: Discord needs a URL that
 *  IS an image, and a Drive share link is a web page. */
function shopImageUrl(url) {
  if (!url) return null;
  if (url.includes('googleusercontent.com/')) return url;
  const m = url.match(/\/file\/d\/([^/?#]+)/) || url.match(/[?&]id=([^&]+)/);
  if (m) return `https://lh3.googleusercontent.com/d/${m[1]}=w400`;
  return /^https:\/\//.test(url) ? url : null;
}
/** A person's name for the channel. `buyer_label` falls back to the account's
 *  EMAIL for a password account with no name — never print an address into a
 *  channel that keeps it for ever (the order page has the contact). */
const notAnEmail = (s) => (s && !String(s).includes('@') ? String(s).trim() : '');

/**
 * The shop team's view of a new order — built ONLY from the database row
 * loadShopOrderForNotify() read (see the header above).
 *
 * WHAT IS DELIBERATELY LEFT OUT: the buyer's phone and email, and the slip
 * image. A Discord channel keeps every message for as long as it exists and is
 * read by whoever is in it; a payment slip carries a bank account and a full
 * legal name. Both are one tap away — the title links to the order in /admin/.
 */
export function buildShopOrderPayload(loaded = {}, origin = '') {
  const order = loaded.order || {};
  const products = loaded.products || {};
  const pickups = loaded.pickups || {};
  const qrs = loaded.qrs || {};
  const items = Array.isArray(order.items) ? order.items : [];

  const lines = items.map((it) => {
    const p = products[it.product_id] || {};
    const color = (Array.isArray(p.colors) ? p.colors : [])
      .find((c) => (c.id || c.label) === it.color || c.label === it.color);
    const variant = [
      it.size && it.size !== 'F' ? `ไซส์ ${it.size}` : '',
      color?.label || (it.color && it.color !== 'default' ? it.color : ''),
      it.is_preorder ? 'Preorder' : '',
    ].filter(Boolean).join(' · ');
    const qty = Number(it.qty) || 0;
    return `**${p.name || it.product_id || 'สินค้า'}**${variant ? ` — ${variant}` : ''}\n`
      + `× ${qty} · ${baht(it.unit_price)}/ชิ้น = **${baht((Number(it.unit_price) || 0) * qty)}**`;
  });
  const count = items.reduce((n, it) => n + (Number(it.qty) || 0), 0);
  const slips = Array.isArray(order.slips) && order.slips.length ? order.slips.length : (order.slip_url ? 1 : 0);

  const who = notAnEmail(order.buyer_name) || notAnEmail(order.buyer_label) || 'ลูกค้า';
  const account = notAnEmail(order.buyer_label);
  const fields = [
    { name: 'ผู้สั่ง', value: account && account !== who ? `${who}\nบัญชี: ${account}` : who, inline: true },
    { name: 'ยอดที่ต้องโอน', value: `**${baht(order.total)}**\n${count} ชิ้น`
        + (Number(order.fee) ? ` · ค่าส่ง ${baht(order.fee)}` : ''), inline: true },
    { name: 'สลิป', value: slips ? `ส่งแล้ว${slips > 1 ? ` ${slips} ใบ` : ''} — รอตรวจ` : 'ยังไม่ได้ส่ง', inline: true },
  ];
  const pickupLabels = [...new Set(items.map((it) => pickups[products[it.product_id]?.pickup_location_id]).filter(Boolean))];
  if (order.pickup_location) pickupLabels.unshift(order.pickup_location);
  if (pickupLabels.length) fields.push({ name: 'รับสินค้าที่', value: [...new Set(pickupLabels)].join('\n').substring(0, 1024), inline: true });
  const qrLabels = [...new Set(items.map((it) => qrs[products[it.product_id]?.promptpay_qr_id]).filter(Boolean))];
  if (qrLabels.length) fields.push({ name: 'บัญชีรับเงิน', value: qrLabels.join('\n').substring(0, 1024), inline: true });
  if (order.is_preorder) fields.push({ name: 'ประเภท', value: 'มีสินค้า Preorder', inline: true });
  // Whole-shop totals (0206) — the dashboard's two cards, where the team is.
  const t = loaded.totals;
  if (t) {
    fields.push({ name: 'ภาพรวมร้าน', value: [
      `รอตรวจสลิป **${Number(t.awaiting_review) || 0}** รายการ`,
      `คำสั่งซื้อทั้งหมด **${Number(t.orders) || 0}** รายการ รวม ${baht(t.orders_total)} (ไม่นับที่ยกเลิก)`,
      `รายรับที่ตรวจสลิปแล้ว **${baht(t.revenue)}**`,
    ].join('\n') });
  }
  if (order.buyer_note && String(order.buyer_note).trim()) {
    fields.push({ name: 'หมายเหตุจากผู้สั่ง', value: String(order.buyer_note).trim().substring(0, 1024) });
  }

  const embed = {
    author: { name: 'SAMO Shop · คำสั่งซื้อใหม่' },
    title: `${order.id} — ${baht(order.total)}`,
    description: (lines.join('\n\n') || '—').substring(0, 4000),
    color: slips ? SHOP_COLOR_PAID : SHOP_COLOR_WAITING,
    fields,
    footer: { text: slips ? 'กดหัวข้อเพื่อเปิดคำสั่งซื้อและตรวจสลิป' : 'ยังไม่มีสลิป — กดหัวข้อเพื่อเปิดคำสั่งซื้อ' },
  };
  if (order.placed_at) embed.timestamp = new Date(order.placed_at).toISOString();
  const thumb = items.map((it) => shopImageUrl(products[it.product_id]?.image_url)).find(Boolean);
  if (thumb) embed.thumbnail = { url: thumb };
  if (origin) embed.url = `${origin.replace(/\/$/, '')}/admin/?scan=${encodeURIComponent(order.id)}`;
  return { content: `คำสั่งซื้อใหม่ **${order.id}** จาก **${who}**`, embeds: [embed] };
}

export function resolveTarget(action, data = {}, env = {}) {
  const t = resolveTargetInner(action, data, env);
  // Applied HERE so no builder can forget it, and so an action added later
  // inherits it for free. See wantsSilence().
  if (t && t.payload && wantsSilence(data)) t.payload.flags = SUPPRESS_NOTIFICATIONS;
  return t;
}

function resolveTargetInner(action, data = {}, env = {}) {
  switch (action) {
    case 'notifyPROnly':
      return { url: env.DISCORD_PR_WEBHOOK, payload: buildPrPayload(data) };
    case 'notifyShopOrder':
      // `data.__shop` is set by notify.js from the DATABASE (see above); a
      // client cannot supply it because notify.js overwrites it first.
      if (!data.__shop?.order) return { error: 'shop order not loaded' };
      return { url: env.DISCORD_SHOP_WEBHOOK,
        payload: buildShopOrderPayload(data.__shop, env.PUBLIC_ORIGIN) };
    case 'notifyClaudeBooking':
      return { url: env.DISCORD_CLAUDE_WEBHOOK, payload: buildClaudeBookingPayload(data) };
    case 'notifyClaudeAlert':
      return { url: env.DISCORD_CLAUDE_WEBHOOK, payload: buildClaudeAlertPayload(data) };
    case 'notifyClaudeMonitor':
      return { url: env.DISCORD_CLAUDE_WEBHOOK, payload: buildClaudeMonitorPayload(data) };
    case 'notifyProjectDiscord':
      return { url: env.DISCORD_PROJECTS_WEBHOOK, payload: buildProjectPayload(data) };
    case 'notifyVSOnly': {
      const map = parseVsWebhooks(env);
      return { url: map[data.department] || map[VS_DEFAULT_DEPT], payload: buildVsPayload(data) };
    }
    case 'notifyVSConsult': {
      const map = parseVsWebhooks(env);
      return { url: map[data.notifyTo], payload: buildVsConsultPayload(data) };
    }
    default:
      return { error: `unknown action: ${action}` };
  }
}

// ---- delivery with retry (ported from GAS sendProjectDiscord) ----

const MAX_ATTEMPTS = 3;
const FALLBACK_SLEEPS_MS = [1200, 2500, 4000];
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * NOTHING THIS APP POSTS MAY PING ANYBODY.
 *
 * `@here` was removed from the two VitalSound builders by hand in August 2026,
 * and doing it that way left the rule living in four string literals across
 * three functions — one per branch, with no branch obliged to know about the
 * others. The emergency branch and the consult branch had no test at all.
 *
 * Worse, a builder is not the only way a mention gets into `content`. VS pastes
 * `data.role` in, Claude bookings paste a person's display name in, and a name
 * or a title that happens to contain "@everyone" would ping the server from a
 * builder that never wrote a mention anywhere.
 *
 * `allowed_mentions: { parse: [] }` is Discord's own answer: the text is still
 * whatever it was, and NOTHING in it resolves to a notification. Applied here,
 * at the one place every payload passes through, it is a property of the
 * transport rather than a promise each builder has to keep. A builder may still
 * set its own `allowed_mentions` if a deliberate ping is ever wanted — this only
 * supplies the default.
 */
function withoutMentions(payload) {
  if (payload && typeof payload === 'object' && payload.allowed_mentions === undefined) {
    return { ...payload, allowed_mentions: { parse: [] } };
  }
  return payload;
}

async function postOnce(url, payload, fetchImpl) {
  try {
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(withoutMentions(payload)),
    });
    const code = resp.status;
    if (code >= 200 && code < 300) return { ok: true, status: code };
    const raHeader = resp.headers?.get?.('Retry-After') || resp.headers?.get?.('retry-after') || '0';
    const ra = parseFloat(raHeader);
    const body = (typeof resp.text === 'function' ? await resp.text().catch(() => '') : '').slice(0, 500);
    return { ok: false, status: code, body, retryAfter: isFinite(ra) ? ra : 0 };
  } catch (e) {
    return { ok: false, threw: true, status: 0, body: String(e), retryAfter: 0 };
  }
}

/**
 * Deliver a payload to a Discord webhook with up to 3 attempts. Retries
 * only the transient modes (429 / transport throw), honours Retry-After
 * (clamped), and bails immediately on a Cloudflare-1015 body. fetch +
 * sleep are injectable so tests run instantly and offline.
 */
export async function postToDiscord(url, payload, { fetchImpl = fetch, sleep = defaultSleep } = {}) {
  let firstStatus = null;
  let last = null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const result = await postOnce(url, payload, fetchImpl);
    if (result.ok) {
      return i === 0
        ? { ok: true, status: result.status, attempts: 1 }
        : { ok: true, status: result.status, retried: true, attempts: i + 1, firstStatus };
    }
    if (i === 0) firstStatus = result.status;
    last = result;

    const transient = result.status === 429 || result.threw;
    if (!transient) break;                 // 400/401/404 won't recover — bail
    if (i === MAX_ATTEMPTS - 1) break;      // last attempt, no point sleeping

    let sleepMs = FALLBACK_SLEEPS_MS[i] || 4000;
    if (result.status === 429 && result.retryAfter > 0) {
      sleepMs = Math.min(Math.max(Math.floor(result.retryAfter * 1000), 400), 9000);
    }
    // Cloudflare per-IP 1015 cooldown is minutes — retrying in-window is
    // futile. (Far less likely from Cloudflare's own egress than from
    // GAS's shared IP, but cheap to guard.)
    if (result.body && result.body.indexOf('1015') !== -1) break;
    await sleep(sleepMs);
  }
  return {
    ok: false,
    status: last ? last.status : 0,
    body: last ? last.body : '',
    retried: true,
    attempts: MAX_ATTEMPTS,
    firstStatus,
  };
}

// ---- durable outcome logging (best-effort → Supabase notify_log) ----

/**
 * Append one delivery outcome to `public.notify_log` (migration 0055) so
 * dropped notifications are diagnosable after the fact — the Function's
 * console logs are NOT retained (live tail only), so without this a drop
 * leaves no trace anywhere.
 *
 * BEST-EFFORT by contract: this must never throw and never affect notify
 * delivery. It returns `{ logged: boolean, skipped?, status? }` purely so
 * the unit tests can assert behaviour.
 *
 * Gated on env: if SUPABASE_URL / SUPABASE_ANON_KEY are unset it no-ops
 * (skipped:true), so the Function keeps working on deploys that haven't
 * added the env vars yet. The anon key is the same public-but-RLS-gated
 * key the frontend bundles; the notify_log insert policy is append-only.
 */
export async function logNotifyOutcome(env = {}, record = {}, { fetchImpl = fetch } = {}) {
  const base = env.SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY;
  if (!base || !key) return { logged: false, skipped: 'no-supabase-env' };

  const row = {
    system: record.system ?? null,
    action: record.action ?? null,
    ticket_id: record.ticketId ?? null,
    dept: record.dept ?? null,
    ok: !!record.ok,
    discord_status: record.status ?? null,
    first_status: record.firstStatus ?? null,
    attempts: record.attempts ?? null,
    retried: !!record.retried,
    // keep the failure snippet short — the column is for triage, not storage
    error: record.error ? String(record.error).slice(0, 500) : null,
  };

  try {
    const res = await fetchImpl(`${base.replace(/\/+$/, '')}/rest/v1/notify_log`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    const code = res.status;
    if (!(code >= 200 && code < 300)) {
      const body = (typeof res.text === 'function' ? await res.text().catch(() => '') : '').slice(0, 200);
      console.warn(`[notify-log] insert failed HTTP ${code}: ${body}`);
      return { logged: false, status: code };
    }
    return { logged: true, status: code };
  } catch (e) {
    // Swallow — logging must never break the notify path.
    console.warn('[notify-log] insert threw:', e?.message || e);
    return { logged: false, threw: true };
  }
}
