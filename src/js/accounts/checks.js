// ==============================================
// บัญชีผู้ใช้ — what the account dashboard SAYS about the rows (0211).
//
// Pure: no DOM, no fetch. The page (accounts/admin.js) paints what these
// functions return, and checks.test.js pins them. The rows come from
// account_dashboard(); their short keys are documented on ACCOUNT_KEYS below,
// which is the one place JS names them.
//
// THE CHECKS ARE THE POINT. Each one says what is wrong, why it matters to a
// person, and what fixes it — and each was measured against production before
// it was written (2026-10-12), so none of them fires on the healthy case. Ones
// that are EXPECTED (carried passport profiles) say so instead of alarming:
// "a warning that fires on the healthy case is worse than no warning".
// ==============================================

import { PERM_CATALOG } from '../team-vocab.js';

/** The short keys account_dashboard() returns per account. */
export const ACCOUNT_KEYS = {
  id: 'auth id', e: 'email (auth)', u: 'username', n: 'display name',
  c: 'created', s: 'last sign-in', cf: 'email confirmed', b: 'banned', del: 'soft-deleted',
  pr: 'provider auth recorded at sign-up', pv: 'identity providers', pw: 'has a password (auth)',
  m: 'public.users.method', hp: 'public.users.has_password', nou: 'no public.users row',
  pm: 'permissions[] (set by hand)', mp: 'managed_permissions[] (from ทีม SAMO)',
  emd: 'public.users.email differs from auth', p: 'people row (by kkumail)',
  lc: 'people.user_id points at another account', t: 'ทีม SAMO postings',
  h: 'สาย code', hs: 'in ระบบบ้าน', d: 'Discord linked', pp: 'Passport profile',
};

/** The domain a username-only account is given; never a real mailbox (auth.js). */
export const SYNTHETIC_DOMAIN = 'samomdkku.app';

export const SIGNIN = [
  { key: 'google',   label: 'Google อย่างเดียว' },
  { key: 'both',     label: 'Google + รหัสผ่าน' },
  { key: 'password', label: 'Username + รหัสผ่าน' },
  { key: 'none',     label: 'เข้าไม่ได้ทั้งสองทาง' },
];

export const DOMAINS = [
  { key: 'kkumail',   label: '@kkumail.com' },
  { key: 'kku',       label: '@kku.ac.th' },
  { key: 'gmail',     label: '@gmail.com' },
  { key: 'synthetic', label: 'ไม่มีอีเมล (ใช้ username)' },
  { key: 'other',     label: 'อีเมลอื่น' },
];

export const SYSTEMS = [
  { key: 'house',    label: 'ระบบบ้าน',  icon: 'bi-house-heart' },
  { key: 'passport', label: 'SAMO Passport', icon: 'bi-airplane' },
  { key: 'team',     label: 'ทีม SAMO',  icon: 'bi-people' },
  { key: 'discord',  label: 'Discord',  icon: 'bi-discord' },
  { key: 'grants',   label: 'มีสิทธิ์หลังบ้าน', icon: 'bi-key' },
  { key: 'master',   label: 'Master',   icon: 'bi-shield-lock' },
];

export const RECENCY = [
  { key: 'd1',    label: '24 ชม.',   maxDays: 1 },
  { key: 'd7',    label: '7 วัน',    maxDays: 7 },
  { key: 'd30',   label: '30 วัน',   maxDays: 30 },
  { key: 'd90',   label: '90 วัน',   maxDays: 90 },
  { key: 'older', label: 'นานกว่านั้น', maxDays: Infinity },
  { key: 'never', label: 'ไม่เคยเข้า' },
];

const DAY = 86400000;
export const JOINED = [
  { key: 'd1', label: '24 ชม.', days: 1 },
  { key: 'd7', label: '7 วัน', days: 7 },
  { key: 'd30', label: '30 วัน', days: 30 },
  { key: 'd90', label: '90 วัน', days: 90 },
];
const KNOWN_PERMS = new Set(PERM_CATALOG.map((p) => p.key));
/** `team` is held implicitly by everyone posted in the tree (0110), so it is
 *  not evidence of back-office power by itself. */
const IMPLICIT = new Set(['team']);

export function domainOf(email) {
  const d = String(email || '').toLowerCase().split('@')[1] || '';
  if (d === 'kkumail.com') return 'kkumail';
  if (d === 'kku.ac.th') return 'kku';
  if (d === 'gmail.com' || d === 'googlemail.com') return 'gmail';
  if (d === SYNTHETIC_DOMAIN || !d) return 'synthetic';
  return 'other';
}

export function signinOf(a) {
  const google = Array.isArray(a.pv) && a.pv.includes('google');
  if (google && a.pw) return 'both';
  if (google) return 'google';
  if (a.pw) return 'password';
  return 'none';
}

/** The method auth itself recorded — what public.users.method must say. */
export function realMethod(a) {
  return a.pr === 'google' ? 'google' : 'password';
}

export function grantsOf(a) {
  return [...new Set([...(a.pm || []), ...(a.mp || [])])];
}

export function systemsOf(a) {
  const g = grantsOf(a);
  return {
    house: !!a.hs,
    passport: !!a.pp,
    team: Array.isArray(a.t) && a.t.length > 0,
    discord: !!a.d,
    grants: g.some((k) => !IMPLICIT.has(k)),
    master: g.includes('master'),
  };
}

export function recencyOf(a, nowMs) {
  if (!a.s) return 'never';
  const days = (nowMs - Date.parse(a.s)) / DAY;
  return RECENCY.find((r) => r.maxDays != null && days <= r.maxDays).key;
}

/** Monday 00:00 (local) of the week holding `ms`. */
export function weekStart(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

// ── the checks ─────────────────────────────────────────────────────────────
// sev: 'bug'      — something is broken for that person or in our data; fix it
//      'review'   — legal, but a human should look
//      'info'     — worth knowing, nothing is wrong
//      'expected' — looks odd, is by design; says why so nobody re-investigates
export const SEVERITY = {
  bug:      { label: 'ผิดพลาด',   icon: 'bi-x-octagon-fill', order: 0 },
  review:   { label: 'ควรตรวจ',   icon: 'bi-exclamation-triangle-fill', order: 1 },
  info:     { label: 'ข้อมูล',     icon: 'bi-info-circle-fill', order: 2 },
  expected: { label: 'ปกติ',      icon: 'bi-check-circle-fill', order: 3 },
};

/** Per-account checks. `test(a, ctx)` → true when the account has the issue. */
export const ACCOUNT_CHECKS = [
  { id: 'no_profile', sev: 'bug', title: 'มีบัญชีเข้าสู่ระบบ แต่ไม่มีข้อมูลผู้ใช้',
    why: 'สมัครสำเร็จแต่ระบบไม่ได้สร้างข้อมูลผู้ใช้ให้ — เข้าได้แต่ใช้งานแทบไม่ได้',
    fix: 'ตรวจทริกเกอร์ on_auth_user_created (handle_new_auth_user)',
    test: (a) => !!a.nou },
  { id: 'locked_out', sev: 'bug', title: 'ไม่มีทางเข้าสู่ระบบ',
    why: 'ไม่ได้ผูก Google และไม่มีรหัสผ่าน — เจ้าของบัญชีเข้าไม่ได้เลย',
    fix: 'ตั้งรหัสผ่านให้ใหม่ หรือลบบัญชีถ้าไม่มีใครใช้',
    test: (a) => signinOf(a) === 'none' },
  // `review`, not `bug`: claude-reporter is exactly this shape on purpose — a
  // service account that signs in by email from a program, never the form.
  { id: 'no_username', sev: 'review', title: 'เข้าทางหน้าเว็บไม่ได้ (ไม่มีอีเมลจริงและไม่มี username)',
    why: 'หน้าเข้าสู่ระบบรับแค่ username หรือ Google — บัญชีนี้ไม่มีทั้งสองอย่าง บัญชีระบบที่โปรแกรมใช้ (เช่น claude-reporter) เป็นแบบนี้โดยตั้งใจ',
    fix: 'ถ้าเป็นบัญชีของคน ตั้ง username ให้',
    test: (a) => domainOf(a.e) === 'synthetic' && !a.u && signinOf(a) === 'password' },
  { id: 'method_drift', sev: 'bug', title: 'ระบบจำวิธีเข้าสู่ระบบผิด',
    why: 'ช่อง method ไม่ตรงกับที่ระบบยืนยันตัวตนบันทึกไว้ — สลับบัญชีแล้วจะพาไปหน้ารหัสผ่านแทน Google (แก้แล้วใน 0211; ถ้าขึ้นอีกแปลว่ากลับมาเสีย)',
    fix: 'ดู handle_new_auth_user และ supabase/migrations/0211',
    test: (a) => !a.nou && !!a.m && a.m !== realMethod(a) },
  { id: 'password_drift', sev: 'bug', title: 'สถานะ “มีรหัสผ่าน” ไม่ตรงกับความจริง',
    why: 'หน้าบัญชีจะขอ/ซ่อนการตั้งรหัสผ่านผิด เพราะสำเนาใน public.users ไม่ตรงกับ auth',
    fix: 'ดูทริกเกอร์ handle_auth_user_password_sync',
    test: (a) => !a.nou && a.hp != null && !!a.hp !== !!a.pw },
  { id: 'email_drift', sev: 'bug', title: 'อีเมลสองที่ไม่ตรงกัน',
    why: 'อีเมลใน public.users ไม่ตรงกับอีเมลที่ใช้เข้าสู่ระบบ — การจับคู่ตามอีเมลจะผิดคน',
    fix: 'ดูทริกเกอร์ handle_auth_user_email_change',
    test: (a) => !!a.emd },
  { id: 'link_conflict', sev: 'bug', title: 'ทะเบียนชี้ไปบัญชีอื่น',
    why: 'แถวในทะเบียนคน (people) ที่มีอีเมลนี้ ถูกผูกไว้กับอีกบัญชีหนึ่ง',
    fix: 'ตรวจใน ระบบบ้าน → ข้อมูลไม่ครบ',
    test: (a) => !!a.lc },
  { id: 'passport_email_drift', sev: 'review', title: 'อีเมลใน Passport ไม่ตรงกับบัญชี',
    why: 'โปรไฟล์ Passport ของบัญชีนี้เก็บอีเมลอื่นไว้ — ใบประกาศ/รายงานจะแสดงอีเมลเก่า',
    fix: 'แก้อีเมลในโปรไฟล์ Passport ให้ตรงกับบัญชี',
    test: (a) => !!a.pp?.emd },
  { id: 'moved_old_left', sev: 'review', title: 'ย้ายไปบัญชีใหม่แล้ว แต่บัญชีเก่ายังอยู่',
    why: 'เคยย้าย Passport จากบัญชีนี้ไปบัญชี kkumail แล้ว — คนเดียวมีสองบัญชี',
    fix: 'ถ้าเจ้าของยืนยันว่าไม่ใช้แล้ว ลบบัญชีเก่าได้',
    test: (a, ctx) => ctx.movedFrom.has(String(a.e || '').toLowerCase()) },
  { id: 'manual_grant', sev: 'review', title: 'มีสิทธิ์ที่ไม่ได้มาจากทีม SAMO',
    why: 'สิทธิ์ถูกใส่ตรง ๆ ในฐานข้อมูล ไม่ผ่านผังทีม — เอาออกจากทีมแล้วสิทธิ์ก็ยังอยู่',
    fix: 'ถ้าเป็นบัญชีระบบ (เช่น samomdkkudev, claude-reporter) ถือว่าตั้งใจ; ถ้าไม่ใช่ ให้ย้ายไปให้สิทธิ์ผ่านทีม SAMO',
    test: (a) => Array.isArray(a.pm) && a.pm.length > 0 },
  { id: 'outsider_grant', sev: 'review', title: 'อีเมลนอก KKU มีสิทธิ์หลังบ้าน',
    why: 'คนที่มีสิทธิ์ควรใช้ kkumail/kku.ac.th — บัญชี gmail ส่งต่อหรือหลุดได้ง่ายกว่า',
    fix: 'ให้เจ้าของเข้าด้วย kkumail แล้วย้ายสิทธิ์ไปบัญชีนั้น',
    test: (a) => ['gmail', 'other'].includes(domainOf(a.e)) && systemsOf(a).grants },
  { id: 'unknown_perm', sev: 'review', title: 'มีสิทธิ์ที่ระบบไม่รู้จัก',
    why: 'คีย์สิทธิ์นี้ไม่มีในรายการสิทธิ์ของเว็บแล้ว — อาจเป็นของเก่าที่ค้างอยู่',
    fix: 'ลบคีย์ที่ไม่ใช้ออกจากทีม SAMO',
    test: (a) => grantsOf(a).some((k) => !KNOWN_PERMS.has(k)) },
  { id: 'same_name', sev: 'review', title: 'ชื่อซ้ำกับบัญชีอื่น',
    why: 'อาจเป็นคนเดียวกันสมัครสองครั้ง — หรือแค่ชื่อเหมือนกัน ห้ามรวมบัญชีจากชื่ออย่างเดียว',
    fix: 'เทียบอีเมลและรหัสนักศึกษาก่อนทำอะไร',
    test: (a, ctx) => { const k = nameKey(a.n); return !!k && ctx.nameCount.get(k) > 1; } },
  { id: 'never_signed_in', sev: 'info', title: 'สร้างแล้วแต่ไม่เคยเข้าสู่ระบบ',
    why: 'บัญชีที่ถูกสร้างให้ (เช่น นำเข้าทีละมาก) แต่ยังไม่มีใครใช้',
    fix: 'ไม่ต้องทำอะไร เว้นแต่จะเก็บกวาด',
    test: (a) => !a.s },
  { id: 'kkumail_not_registry', sev: 'info', title: 'kkumail ที่ไม่อยู่ในทะเบียนคน',
    why: 'มีบัญชี kkumail แต่ไม่พบในทะเบียนนักศึกษา/ทีม — เช่น คณะอื่น รุ่นที่ยังไม่นำเข้า หรือพิมพ์ kkumail ในทะเบียนผิด',
    fix: 'ถ้าเป็นนักศึกษาแพทย์ ตรวจ kkumail ในระบบบ้าน',
    test: (a) => domainOf(a.e) === 'kkumail' && !a.p },
  { id: 'banned', sev: 'info', title: 'ถูกระงับการเข้าสู่ระบบ',
    why: 'บัญชีถูกแบนในระบบยืนยันตัวตน', fix: '—',
    test: (a) => !!a.b },
  { id: 'unconfirmed', sev: 'info', title: 'ยังไม่ยืนยันอีเมล',
    why: 'อีเมลจริงที่ยังไม่ได้ยืนยัน', fix: '—',
    test: (a) => !a.cf && domainOf(a.e) !== 'synthetic' },
];

export function nameKey(n) {
  return String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function context(d) {
  const nameCount = new Map();
  for (const a of d.accounts || []) {
    const k = nameKey(a.n);
    if (k) nameCount.set(k, (nameCount.get(k) || 0) + 1);
  }
  const movedFrom = new Set((d.migrations || [])
    .filter((m) => m.from_exists && m.to_exists)
    .map((m) => String(m.from || '').toLowerCase()));
  return { nameCount, movedFrom };
}

/**
 * Every check with its hits. Account checks carry `ids`; the two set-level
 * checks carry `rows` (things with no account to point at).
 */
export function runChecks(d) {
  const ctx = context(d);
  const accounts = d.accounts || [];
  const out = ACCOUNT_CHECKS.map(({ test, ...c }) => ({
    ...c, ids: accounts.filter((a) => test(a, ctx)).map((a) => a.id),
  }));
  const orphans = d.passport_orphans || [];
  out.push({
    id: 'passport_orphans', sev: 'expected', title: 'โปรไฟล์ Passport ที่ยังไม่มีบัญชี',
    why: 'ยกมาจาก Passport เดิมก่อนรวมระบบ จะผูกกับบัญชีเองอัตโนมัติเมื่อเจ้าของเข้าสู่ระบบด้วยอีเมลเดียวกัน (กิโลเมตรไม่หาย) — เป็นเรื่องปกติ อย่าลบ',
    fix: 'ไม่ต้องทำอะไร (docs/INVARIANTS.md → Passport totals)',
    rows: orphans, count: orphans.length,
  });
  const lost = (d.migrations || []).filter((m) => !m.to_exists);
  out.push({
    id: 'migration_target_missing', sev: 'info', title: 'ย้าย Passport ไปบัญชีที่ยังไม่เคยสมัคร',
    why: 'บันทึกการย้ายชี้ไปที่ kkumail ที่ยังไม่มีบัญชี — แต้มจะตามไปเมื่อเจ้าของสมัครด้วย kkumail นั้น',
    fix: 'แจ้งเจ้าของให้เข้าสู่ระบบด้วย kkumail',
    rows: lost, count: lost.length,
  });
  for (const c of out) if (c.ids) c.count = c.ids.length;
  return out.sort((x, y) => SEVERITY[x.sev].order - SEVERITY[y.sev].order || y.count - x.count);
}

/** id → [check ids] for the table's "ปัญหา" column and the detail view. */
export function issuesById(checks) {
  const m = new Map();
  for (const c of checks) {
    if (!c.ids || c.sev === 'expected') continue;
    for (const id of c.ids) {
      if (!m.has(id)) m.set(id, []);
      m.get(id).push(c);
    }
  }
  return m;
}

// ── the overview ───────────────────────────────────────────────────────────
export function summarize(d) {
  const nowMs = Date.parse(d.now) || Date.now();
  const accounts = d.accounts || [];
  const count = (list) => Object.fromEntries(list.map((x) => [x.key, 0]));
  const signin = count(SIGNIN);
  const domain = count(DOMAINS);
  const systems = count(SYSTEMS);
  const recency = count(RECENCY);
  const weeks = new Map();
  let active1 = 0, active7 = 0, active30 = 0, new30 = 0;
  for (const a of accounts) {
    signin[signinOf(a)] += 1;
    domain[domainOf(a.e)] += 1;
    const sys = systemsOf(a);
    for (const k of Object.keys(systems)) if (sys[k]) systems[k] += 1;
    const r = recencyOf(a, nowMs);
    recency[r] += 1;
    if (r === 'd1') active1 += 1;
    if (r === 'd1' || r === 'd7') active7 += 1;
    if (r === 'd1' || r === 'd7' || r === 'd30') active30 += 1;
    const c = Date.parse(a.c);
    if (Number.isFinite(c)) {
      if (nowMs - c <= 30 * DAY) new30 += 1;
      const w = weekStart(c);
      weeks.set(w, (weeks.get(w) || 0) + 1);
    }
  }
  // Every week from the first sign-up to now, empty ones included — a gap is
  // information, and a chart that skips it lies about the slope.
  const signups = [];
  if (weeks.size) {
    const first = Math.min(...weeks.keys());
    for (let w = first; w <= weekStart(nowMs); w = weekStart(w + 8 * DAY)) {
      signups.push({ w, n: weeks.get(w) || 0 });
    }
  }
  return { total: accounts.length, nowMs, signin, domain, systems, recency, signups,
           active1, active7, active30, new30 };
}

/** The latest sign-ups and sign-ins, newest first — the "live" feed. */
export function activity(d, limit = 12) {
  const ev = [];
  for (const a of d.accounts || []) {
    if (a.c) ev.push({ kind: 'signup', at: a.c, a });
    // A first sign-in is the sign-up itself; only show it once.
    if (a.s && Math.abs(Date.parse(a.s) - Date.parse(a.c)) > 60000) ev.push({ kind: 'signin', at: a.s, a });
  }
  return ev.sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, limit);
}

// ── the table ──────────────────────────────────────────────────────────────
/** Lower-cased text a search box matches against. */
export function haystack(a) {
  return [a.n, a.e, a.u, a.p?.n, a.p?.nk, a.p?.sid, a.p?.mj, ...(a.t || [])]
    .filter(Boolean).join(' ').toLowerCase();
}

/** The name a row is sorted and shown by: the registry's, else the account's. */
export function displayName(a) {
  return a.p?.n || a.n || a.u || String(a.e || '').split('@')[0] || '';
}

/** The รุ่น year of the row's registry person, or null. Its LABEL ("MD54") is
 *  study-year.js's cohortLabel, handed in through ctx — one implementation. */
const cohortOf = (a) => (a.p?.co ? Number(a.p.co) : null);

/**
 * THE FILTERS — one entry per dropdown above the list. Adding a filter is one
 * entry here; the page renders the dropdown, the chip and the reset from it.
 *   options(ctx) → [{ value, label }]   ctx = { accounts, checks, cohortLabel }
 *   test(a, value, ctx) → boolean
 * A value starting with '!' on `system` means "NOT in that system".
 */
export const FILTERS = [
  { key: 'signin', label: 'เข้าด้วย',
    options: () => SIGNIN.map((s) => ({ value: s.key, label: s.label })),
    test: (a, v) => signinOf(a) === v },
  { key: 'domain', label: 'อีเมล',
    options: () => DOMAINS.map((d) => ({ value: d.key, label: d.label })),
    test: (a, v) => domainOf(a.e) === v },
  { key: 'system', label: 'ระบบ',
    options: () => SYSTEMS.flatMap((s) => [
      { value: s.key, label: `อยู่ใน ${s.label}` },
      { value: `!${s.key}`, label: `ไม่อยู่ใน ${s.label}` },
    ]),
    test: (a, v) => (v.startsWith('!') ? !systemsOf(a)[v.slice(1)] : !!systemsOf(a)[v]) },
  { key: 'recency', label: 'เข้าล่าสุด',
    options: () => RECENCY.map((r) => ({ value: r.key, label: r.key === 'never' ? r.label : `ภายใน ${r.label}` })),
    test: (a, v, ctx) => recencyOf(a, ctx.nowMs) === v },
  // Cumulative on purpose (unlike เข้าล่าสุด's buckets): "สมัครใหม่ 30 วัน" on
  // the tile counts EVERY account made in the last 30 days, and this filter is
  // what that tile opens — the list must hold exactly the number it showed.
  { key: 'joined', label: 'สมัครภายใน',
    options: () => JOINED.map((j) => ({ value: j.key, label: j.label })),
    test: (a, v, ctx) => {
      const days = JOINED.find((j) => j.key === v)?.days;
      return days != null && (ctx.nowMs - Date.parse(a.c)) / DAY <= days;
    } },
  { key: 'cohort', label: 'รุ่น',
    options: (ctx) => {
      const years = [...new Set((ctx.accounts || []).map(cohortOf).filter(Boolean))].sort((x, y) => x - y);
      return [...years.map((y) => ({ value: String(y), label: ctx.cohortLabel?.(y) || String(y) })),
        { value: 'none', label: 'ไม่อยู่ในทะเบียน' }];
    },
    test: (a, v) => (v === 'none' ? !cohortOf(a) : String(cohortOf(a)) === v) },
  { key: 'grant', label: 'สิทธิ์',
    options: () => [
      { value: 'master', label: 'มี Master' },
      { value: 'any', label: 'มีสิทธิ์หลังบ้าน' },
      { value: 'manual', label: 'สิทธิ์ที่ไม่ได้มาจากทีม SAMO' },
      { value: 'none', label: 'ไม่มีสิทธิ์หลังบ้าน' },
    ],
    test: (a, v) => {
      const s = systemsOf(a);
      if (v === 'master') return s.master;
      if (v === 'any') return s.grants;
      if (v === 'manual') return Array.isArray(a.pm) && a.pm.length > 0;
      return !s.grants;
    } },
  { key: 'check', label: 'ปัญหา',
    options: (ctx) => [
      { value: '*', label: 'มีปัญหาอย่างน้อยหนึ่งข้อ' },
      ...(ctx.checks || []).filter((c) => c.ids && c.count > 0)
        .map((c) => ({ value: c.id, label: `${c.title} (${c.count})` })),
    ],
    test: (a, v, ctx) => (v === '*'
      ? (ctx.checks || []).some((c) => c.ids && c.sev !== 'expected' && c.ids.includes(a.id))
      : !!ctx.hit?.has(a.id)) },
];

/**
 * filters: { q, <FILTERS key>: value } — every one optional, combined with AND.
 */
export function filterAccounts(accounts, f, checks, nowMs) {
  const q = String(f.q || '').trim().toLowerCase();
  const hit = f.check && f.check !== '*' ? new Set(checks.find((c) => c.id === f.check)?.ids || []) : null;
  const ctx = { checks, nowMs, hit };
  const active = FILTERS.filter((d) => f[d.key]);
  return accounts.filter((a) => {
    for (const d of active) if (!d.test(a, f[d.key], ctx)) return false;
    if (q && !haystack(a).includes(q)) return false;
    return true;
  });
}

const issueWeight = (issues) => (a) => {
  const mine = issues.get(a.id) || [];
  return mine.filter((c) => c.sev === 'bug').length * 1e6
    + mine.filter((c) => c.sev === 'review').length * 1e3 + mine.length;
};
const rank = (list) => (k) => { const i = list.findIndex((x) => x.key === k); return i < 0 ? list.length : i; };

/**
 * THE SORT ORDERS. `key(a, issues)` returns a number or a string; `missing`
 * says where a row with NO value goes (a never-signed-in account has no
 * "last sign-in") — 'last' keeps blanks at the bottom whichever way it runs.
 * Ties fall back to the name, then the id, so the order is stable.
 */
export const SORTS = {
  signin_desc:  { label: 'เข้าล่าสุด: ใหม่ → เก่า', key: (a) => (a.s ? Date.parse(a.s) : null), desc: true },
  signin_asc:   { label: 'เข้าล่าสุด: เก่า → ใหม่ (ไม่เคยเข้าอยู่ท้าย)', key: (a) => (a.s ? Date.parse(a.s) : null), desc: false },
  created_desc: { label: 'สมัคร: ใหม่ → เก่า', key: (a) => Date.parse(a.c) || null, desc: true },
  created_asc:  { label: 'สมัคร: เก่า → ใหม่', key: (a) => Date.parse(a.c) || null, desc: false },
  name_asc:     { label: 'ชื่อ: ก → ฮ, A → Z', key: (a) => displayName(a).toLowerCase() || null, desc: false },
  name_desc:    { label: 'ชื่อ: ฮ → ก, Z → A', key: (a) => displayName(a).toLowerCase() || null, desc: true },
  method:       { label: 'วิธีเข้าสู่ระบบ (Google → รหัสผ่าน)', key: (a) => rank(SIGNIN)(signinOf(a)), desc: false },
  domain:       { label: 'อีเมล (kkumail → อื่น ๆ)', key: (a) => rank(DOMAINS)(domainOf(a.e)), desc: false },
  cohort_asc:   { label: 'รุ่น: เก่า → ใหม่', key: (a) => cohortOf(a), desc: false },
  cohort_desc:  { label: 'รุ่น: ใหม่ → เก่า', key: (a) => cohortOf(a), desc: true },
  km_desc:      { label: 'Passport: กม. มาก → น้อย', key: (a) => (a.pp ? Number(a.pp.km) || 0 : null), desc: true },
  systems_desc: { label: 'อยู่หลายระบบก่อน', key: (a) => Object.entries(systemsOf(a)).filter(([k, v]) => v && k !== 'master').length, desc: true },
  grants_desc:  { label: 'สิทธิ์มากก่อน (Master ก่อน)', key: (a) => (systemsOf(a).master ? 1000 : 0) + grantsOf(a).length, desc: true },
  issues:       { label: 'ปัญหามากสุด', key: null, desc: true },
};
export const DEFAULT_SORT = 'signin_desc';

/** Column header → the two sorts a click toggles between. */
export const HEADER_SORTS = {
  name: ['name_asc', 'name_desc'],
  method: ['method', 'method'],
  created: ['created_desc', 'created_asc'],
  signin: ['signin_desc', 'signin_asc'],
  issues: ['issues', 'issues'],
};

export function sortAccounts(list, sortKey, issues) {
  const s = SORTS[sortKey] || SORTS[DEFAULT_SORT];
  const key = s.key || issueWeight(issues);
  const dir = s.desc ? -1 : 1;
  const cmp = (x, y) => (typeof x === 'string' ? x.localeCompare(y, 'th') : x - y);
  const keyed = list.map((a) => ({ a, k: key(a), n: displayName(a).toLowerCase() }));
  keyed.sort((x, y) => {
    const xm = x.k == null || Number.isNaN(x.k), ym = y.k == null || Number.isNaN(y.k);
    if (xm !== ym) return xm ? 1 : -1;            // a blank goes LAST, either direction
    if (!xm) { const c = cmp(x.k, y.k); if (c) return c * dir; }
    return x.n.localeCompare(y.n, 'th') || String(x.a.id).localeCompare(String(y.a.id));
  });
  return keyed.map((x) => x.a);
}
