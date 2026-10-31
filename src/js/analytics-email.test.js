// analytics-email.test.js — the อีเมลแจ้งเตือน panel must never show a
// confident number it cannot stand behind.
//
// WHY THIS EXISTS. The owner asked "is 100 a day enough, and have we hit it?"
// Nobody could answer, because notify.js sends the email fire-and-forget
// (`callGAS(...).catch(() => {})`) and records nothing. Migration 0170 answers
// it by DERIVING the count from the notification fan-out — one in-app row per
// staff-seat holder, one email, same call.
//
// That derivation has exactly one failure mode, and it fails in the dangerous
// direction. In notify.js the two halves are gated SEPARATELY:
//
//     if (settings?.notify_uni_in_app !== false) { ...createNotification... }
//     if (settings?.notify_uni_email  !== false && to) { ...callGAS... }
//
// Switch the in-app half off and no rows are written while mail keeps going
// out. The panel would then read ZERO — "we send no email" — while email is
// being sent. A silent zero is worse than no panel, because a reader acts on
// it. So `in_app_enabled` rides along in the payload and the panel must SAY
// the number is untrustworthy.
//
// This is the repo's "a guard that fails green" shape, applied to a readout
// instead of a test: the ritual here is to feed the panel the state that
// breaks its assumption and require it to admit that, rather than render
// cleanly.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, 'src/js/analytics-dashboard.js'), 'utf8');
const CSS = readFileSync(join(ROOT, 'src/css/analytics.css'), 'utf8');
const MIG = readFileSync(
  join(ROOT, 'supabase/migrations/0170_analytics_shows_email_use_against_the_quota.sql'), 'utf8');

/**
 * Run the panel for real rather than grepping for its source.
 *
 * A source grep is satisfied by a COMMENT — this repo has been burned by
 * exactly that (`confirm-modal.test.js` matched a comment, not a control). So
 * the function is extracted and executed against the payload shapes the RPC
 * actually returns, and the assertions are made on rendered OUTPUT.
 */
function extract(name, ...alsoNeeds) {
  const start = SRC.indexOf(`function ${name}(`);
  expect(start, `${name}() is gone — was it renamed or removed?`).toBeGreaterThan(-1);
  const end = SRC.indexOf('\nfunction ', start + 10);
  return SRC.slice(start, end === -1 ? undefined : end)
    + alsoNeeds.map((n) => `\n${extract(n)}`).join('');
}

function renderPanel() {
  // emailPanel calls burstRow, so both must come along. Slicing "everything up
  // to render()" used to work and silently started dragging gasPanel in too
  // when it was added between them — extract by NAME instead.
  const body = extract('emailPanel', 'burstRow');
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const escHtml = (x) => String(x).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const barChart = () => '<!--chart-->';
  return Function('fmt', 'escHtml', 'barChart', `${body}\nreturn emailPanel;`)(
    fmt, escHtml, barChart);
}

/** The action table's source, which is a const rather than a function. */
function gasActionsSource() {
  const start = SRC.indexOf('const GAS_ACTIONS = [');
  expect(start, 'GAS_ACTIONS is gone').toBeGreaterThan(-1);
  const end = SRC.indexOf('];', start) + 2;
  return SRC.slice(start, end);
}

/** The same, for the shared-budget GAS panel. */
function renderGas() {
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const escHtml = (x) => String(x).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const barChart = () => '<!--chart-->';
  const rankBars = () => '<!--rank-->';
  const body = `${gasActionsSource()}\n${extract('gasActionList')}\n${extract('gasPanel')}`;
  return Function('fmt', 'escHtml', 'barChart', 'rankBars',
    `${body}\nreturn gasPanel;`)(fmt, escHtml, barChart, rankBars);
}

/** The action list itself, for the mirror test against prform.gs. */
function gasActions() {
  return Function(`${gasActionsSource()}\nreturn GAS_ACTIONS;`)();
}

const BASE = {
  quota_per_day: 100, staff_holders: 1, recipients: 1,
  enabled: true, in_app_enabled: true,
  sent_total: 93, peak_day: 7,
  sent_by_day: [{ d: '2026-08-24', n: 7 }],
};

describe('the อีเมลแจ้งเตือน panel', () => {
  const panel = renderPanel();

  it('renders the healthy case with no warning at all', () => {
    const html = panel(BASE);
    expect(html).toContain('7');
    expect(html).toContain('100');
    // A warning on the healthy case is worse than no warning — this repo has
    // paid for that too (the boot watchdog that fired on a slow-but-fine load).
    expect(html, 'the panel cries wolf at 7% of the quota').not.toContain('an-email-note--warn');
  });

  it('says the number is untrustworthy when in-app notifications are off', () => {
    const html = panel({ ...BASE, in_app_enabled: false, sent_total: 0, peak_day: 0 });
    expect(html, 'a silent zero: the panel showed no warning while mail was still sending')
      .toContain('an-email-note--warn');
    expect(html).toMatch(/เชื่อถือไม่ได้/);
  });

  it('warns when NOBODY holds the staff seat — mail still sends, rows do not', () => {
    // The second cause of a silent zero, and the one the first version missed.
    // notifyUniStaff() sends on `notify_uni_email !== false && to`, where `to`
    // comes from SETTINGS. The in-app rows this count is derived from come
    // from the seat. Empty seat, no rows, mail still going out.
    const html = panel({ ...BASE, staff_holders: 0, sent_total: 0, peak_day: 0 });
    expect(html, 'zero seat holders reads as "we send no email" while sending')
      .toContain('an-email-note--warn');
  });

  it('distinguishes "switched off" from "cannot be trusted"', () => {
    const off = panel({ ...BASE, enabled: false });
    expect(off).toContain('an-email-note');
    // Email genuinely off is not an alarm — nothing is being missed.
    expect(off, 'a deliberately disabled feature must not read as a fault')
      .not.toContain('an-email-note--warn');
  });

  it('warns when the busiest day approaches the ceiling', () => {
    expect(panel({ ...BASE, peak_day: 85 })).toContain('an-email-note--warn');
    expect(panel({ ...BASE, peak_day: 49 })).not.toContain('an-email-note--warn');
  });

  it('counts RECIPIENTS, not messages — two addresses cost two per send', () => {
    // The Apps Script quota is per recipient. 40 sends x 3 addresses = 120,
    // over the ceiling, even though 40 messages looks comfortable.
    const html = panel({ ...BASE, recipients: 3, peak_day: 40 });
    expect(html, 'multi-recipient cost is not counted against the quota')
      .toContain('an-email-note--warn');
    expect(html).toContain('120');
  });

  // ── the OTHER ceilings (0171) ─────────────────────────────────────────
  //
  // A comfortable daily total says nothing about sending many at once. Apps
  // Script caps simultaneous executions at 30/user and one message at 50
  // recipients — and the email path, unlike Discord's, is NOT serialised.
  it('shows burst against the concurrency ceiling', () => {
    const html = panel({ ...BASE, peak_per_minute: 2, peak_per_hour: 5,
      min_gap_seconds: 7.7, simultaneous_limit: 30 });
    expect(html).toContain('2');
    expect(html).toContain('30');
    expect(html).toContain('7.7');
    // 2 of 30 is not an alarm.
    expect(html, 'the panel cries wolf at 2 sends a minute').not.toContain('an-email-note--warn');
  });

  it('warns when sends start bunching toward the concurrency limit', () => {
    expect(panel({ ...BASE, peak_per_minute: 20, simultaneous_limit: 30 }))
      .toContain('an-email-note--warn');
    expect(panel({ ...BASE, peak_per_minute: 4, simultaneous_limit: 30 }))
      .not.toContain('an-email-note--warn');
  });

  it('warns when one message would exceed the per-message recipient cap', () => {
    // A hard cap, not a rate limit: one address over and the send fails
    // outright, with nothing in the app to say so.
    const html = panel({ ...BASE, recipients: 51, recipients_per_message_limit: 50 });
    expect(html).toContain('an-email-note--warn');
    expect(html).toContain('51');
  });

  it('a payload without the burst fields still renders (0170 shape)', () => {
    // The RPC and the bundle deploy separately; the panel must not assume the
    // newer migration is live.
    const { peak_per_minute, peak_per_hour, min_gap_seconds, ...old } = {
      ...BASE, peak_per_minute: 1, peak_per_hour: 1, min_gap_seconds: 1 };
    expect(() => panel(old)).not.toThrow();
    expect(panel(old), 'an empty burst row was drawn from a payload that has none')
      .not.toContain('an-email-legend--sub');
  });

  it('survives a payload the RPC could not build', () => {
    expect(panel(null)).toBe('');
    expect(() => panel({})).not.toThrow();
  });

  it('every class the panel emits has a live CSS rule', () => {
    // A dead selector looks exactly like a feature nobody built, and CSS fails
    // silently. Assert the PROPERTY — that what is rendered can be styled —
    // rather than re-listing what the stylesheet happens to contain.
    const html = [panel(BASE), panel({ ...BASE, in_app_enabled: false })].join('');
    const classes = new Set();
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (c.startsWith('an-email')) classes.add(c);
    }
    expect(classes.size, 'the panel emits no an-email-* class — did it get restyled?')
      .toBeGreaterThan(2);
    for (const c of classes) {
      expect(CSS, `.${c} is rendered but has no rule in analytics.css`).toContain(`.${c}`);
    }
  });

  it('the migration ships the flag the panel depends on', () => {
    // The panel cannot warn about a field the RPC never sends.
    expect(MIG).toContain("'in_app_enabled'");
    expect(MIG).toContain("'recipients'");
    expect(MIG).toContain("'peak_day'");
    // And it must not reintroduce the shadowed variable that made the first
    // version deploy clean and fail on the first call.
    expect(MIG, 'the by_day CTE aliases `d` again — that name shadows the plpgsql range variable')
      .not.toMatch(/select day::date as d\b/);
  });
});

// ── The other half: a test email must not look like a real one ──────────
//
// A preview and the dev database send through the SAME Apps Script deployment
// as production, so a test notification lands in a real inbox indistinguishable
// from a real one. The screen has the env ribbon; email had nothing. An
// unmarked test message asking someone to sign a document is worse than a
// missing one, because they may act on it.
describe('email subjects say when the mail is not from production', () => {
  it('leaves production subjects untouched', async () => {
    const { markSubject } = await import('./projects/notify.js');
    expect(markSubject('[MDKKU SAMO] โครงการ ก — sent', 'production', 'samo.md.kku.ac.th'))
      .toBe('[MDKKU SAMO] โครงการ ก — sent');
  });

  it('marks a preview host even when the variable was forgotten', async () => {
    const { markSubject } = await import('./projects/notify.js');
    // The polarity the ribbon settled: an ABSENT var marks nothing on its own,
    // but the host still gives it away. That is the case a rebuilt box hits.
    expect(markSubject('x', undefined, 'abc123.samomdkkuweb.pages.dev')).toBe('[PREVIEW] x');
    expect(markSubject('x', undefined, 'samo.md.kku.ac.th')).toBe('x');
  });

  it('uses an explicit env name when there is one', async () => {
    const { markSubject } = await import('./projects/notify.js');
    expect(markSubject('x', 'dev', 'localhost')).toBe('[DEV] x');
  });

  it('does not re-implement the environment check', () => {
    // Two implementations of one rule drift. The ribbon's polarity was argued
    // out once and must not be re-derived here, where getting it wrong fails
    // SILENTLY instead of visibly.
    const src = readFileSync(join(ROOT, 'src/js/projects/notify.js'), 'utf8');
    expect(src, 'notify.js should call ribbonLabel, not test the host itself')
      .toContain('ribbonLabel');
    expect(src, 'notify.js grew its own pages.dev check — use ribbonLabel')
      .not.toMatch(/pages\\\\?\.dev/);
  });
});

// ── Only production may email the people configured in admin ────────────
//
// samo-dev is a full copy of production, so uni_staff_email arrives holding a
// real @kku.ac.th staff address, and dev + previews send through the SAME Apps
// Script deployment as production. Repointing the dev ROW fixed it once — but
// a stored value is not a guard: the next dev:refresh restores it, or somebody
// edits it in the dev admin UI, and a test flow mails a real person a document
// request that does not exist. Silently, both times.
//
// So the rule lives at the transport. These tests pin BOTH directions, because
// a guard that only proves "dev is blocked" cannot tell a working rule from a
// notification system that has stopped sending at all.
describe('only production emails the configured recipients', () => {
  const PROD_HOST = 'samo.md.kku.ac.th';

  it('production sends to exactly who admin configured', async () => {
    const { resolveRecipients } = await import('./projects/notify.js');
    expect(resolveRecipients('woratho@kku.ac.th', 'production', PROD_HOST))
      .toBe('woratho@kku.ac.th');
    // Several recipients must all survive — this is the ALLOW direction, and
    // silently dropping one would look exactly like the guard working.
    expect(resolveRecipients('a@kku.ac.th, b@kku.ac.th', 'production', PROD_HOST))
      .toBe('a@kku.ac.th,b@kku.ac.th');
  });

  it('a preview can only ever reach the test inbox', async () => {
    const { resolveRecipients, DEV_TEST_INBOX } = await import('./projects/notify.js');
    // Even though the dev database holds a REAL address, as it does after a
    // refresh from production.
    expect(resolveRecipients('woratho@kku.ac.th', undefined, 'abc.samomdkkuweb.pages.dev'))
      .toBe(DEV_TEST_INBOX);
    expect(resolveRecipients('woratho@kku.ac.th', 'dev', 'localhost')).toBe(DEV_TEST_INBOX);
    expect(resolveRecipients('a@kku.ac.th,b@kku.ac.th', 'preview', 'localhost'))
      .toBe(DEV_TEST_INBOX);
  });

  it('"email off" stays off in every environment', async () => {
    const { resolveRecipients } = await import('./projects/notify.js');
    // An empty setting must not become a send to the test inbox.
    for (const env of [['production', PROD_HOST], ['dev', 'localhost'], [undefined, 'x.pages.dev']]) {
      expect(resolveRecipients('', ...env), `empty setting leaked a send in ${env[0]}`).toBe('');
      expect(resolveRecipients(null, ...env)).toBe('');
      expect(resolveRecipients('not-an-address', ...env)).toBe('');
    }
  });

  it('EVERY send path resolves through the guard, not just the first one', () => {
    // The first version of this test asserted one SPELLING —
    // `normalizeRecipients(settings` — and passed while two other paths were
    // wide open: notifyProf (a real อาจารย์) and the admin "send test" button
    // (whatever is typed, no save needed). Assert the PROPERTY instead: every
    // file that hands an address to the mail action must obtain it from
    // resolveRecipients. A list built from the code the bug came from will
    // always agree with that code.
    const files = ['src/js/projects/notify.js', 'src/js/projects/manage.js'];
    for (const f of files) {
      const src = readFileSync(join(ROOT, f), 'utf8');
      const sends = (src.match(/'notifyProjectEmail'/g) || []).length;
      if (!sends) continue;
      const guarded = (src.match(/resolveRecipients\(/g) || []).length
        - (f.endsWith('notify.js') ? 1 : 0);   // minus its own definition
      expect(guarded, `${f} has ${sends} mail send(s) but ${guarded} guarded recipient(s)`)
        .toBeGreaterThanOrEqual(sends);
    }
  });
});

// ── Apps Script is a SHARED budget across every component ───────────────
//
// The owner's correction, and the important one: "there're many components
// like photo upload etc samoweb samopassport ระบบจองห้องสโม also use the same
// gas". Apps Script quotas are per GOOGLE ACCOUNT, not per script, so a quiet
// email month says nothing about whether uploads are near the ceiling.
describe('the shared Apps Script panel', () => {
  const gas = renderGas();
  const G = {
    simultaneous_limit: 30, is_floor: true, total: 254,
    peak_per_day: 13, peak_per_hour: 7, peak_per_minute: 2,
    peak_per_minute_ever: 25, busiest_minute_at: '2026-05-22 11:07',
    by_source: [{ label: 'อัปโหลด PR', n: 124 }], by_day: [{ d: '2026-08-01', n: 3 }],
  };

  it('warns on the ALL-TIME peak, not only the selected range', () => {
    // Synthetic numbers, on purpose: real traffic has never exceeded 2/minute
    // (the "25" this was first written against turned out to be a bulk import,
    // see 0173). What is being tested is that a spike OUTSIDE the selected
    // range still raises the warning — a range-only view would show today's
    // quiet 2/minute and say nothing about the day it nearly hit the ceiling.
    const html = gas(G);
    expect(html).toContain('25');
    expect(html).toContain('2026-05-22 11:07');
    expect(html, 'a spike outside the range is not surfaced').toContain('an-email-note--warn');
  });

  it('stays quiet when nothing has ever come close', () => {
    expect(gas({ ...G, peak_per_minute_ever: 3, busiest_minute_at: null }))
      .not.toContain('an-email-note--warn');
  });

  it('admits the count is a floor', () => {
    // Deletes, reads, photo overwrites and FAILED calls leave no row. Implying
    // a complete count is how a dashboard becomes confidently wrong.
    expect(gas(G)).toMatch(/ไม่ถูกนับ/);
  });

  it('survives a payload from before the migration', () => {
    expect(gas(null)).toBe('');
    expect(() => gas({})).not.toThrow();
  });

  it('the migration ships every field the panel reads', () => {
    const mig = readFileSync(join(ROOT,
      'supabase/migrations/0172_analytics_shows_all_apps_script_traffic.sql'), 'utf8');
    for (const k of ['peak_per_minute_ever', 'busiest_minute_at', 'is_floor',
                     'simultaneous_limit', 'by_source', 'peak_per_day']) {
      expect(mig, `0172 does not ship ${k}, which the panel reads`).toContain(`'${k}'`);
    }
    // Passport shares the account, so it must be in the union or the panel
    // under-reports the shared budget it exists to show.
    expect(mig, 'passport traffic is not counted — it shares the same Google account')
      .toContain('passport.');
  });
});

// ── The action list must match the Apps Script it describes ─────────────
describe('the Apps Script action list', () => {
  it('lists every action prform.gs actually handles, and no phantom ones', () => {
    // Two hand-maintained copies of one list is a bug class this repo has paid
    // for repeatedly. Assert against the SOURCE OF TRUTH — the handler itself —
    // rather than against a list copied from it.
    const gs = readFileSync(join(ROOT, 'appscript/prform.gs'), 'utf8');
    const inGas = new Set(
      [...gs.matchAll(/action === '([a-zA-Z]+)'/g)].map((m) => m[1]));
    const listed = new Set(gasActions().map((a) => a.name));

    const missing = [...inGas].filter((a) => !listed.has(a));
    const phantom = [...listed].filter((a) => !inGas.has(a));
    expect(missing, 'prform.gs handles actions the dashboard does not list — they use the same quota')
      .toEqual([]);
    expect(phantom, 'the dashboard lists actions prform.gs does not handle')
      .toEqual([]);
  });

  it('every action says whether the dashboard can see it', () => {
    for (const a of gasActions()) {
      expect(typeof a.counted, `${a.name} does not say if it is counted`).toBe('boolean');
      expect(a.label && a.label.length > 2, `${a.name} has no readable label`).toBe(true);
    }
    // Both kinds must exist, or the column is decorative. The whole point is
    // that the total is a FLOOR — a list where everything is "counted" would
    // say the opposite of what is true.
    const counted = gasActions().filter((a) => a.counted).length;
    expect(counted).toBeGreaterThan(0);
    expect(counted).toBeLessThan(gasActions().length);
  });

  it('the panel renders the list, not just holds it', () => {
    const html = renderGas()({ simultaneous_limit: 30, peak_per_minute_ever: 2, total: 1 });
    expect(html).toContain('uploadPRFile');
    expect(html).toContain('getProjectFileData');
    expect(html).toMatch(/มองไม่เห็น/);
  });
});

/**
 * WHAT DRIVING THE PAGE FOUND THAT NOTHING ABOVE COULD.
 *
 * Every test above this line passed while both of these were broken, because
 * they are LAYOUT faults and this file renders to a string. The panels had 29
 * unit tests, their classes were confirmed in the served bundle — and nobody
 * had opened `/admin#analytics`. At 390px:
 *
 *   1. `มองไม่เห็น` wrapped to two lines in 8 of the 12 action rows, so a
 *      two-word STATUS read as a broken cell.
 *   2. `.an-rank-label` was `nowrap` + `text-overflow: ellipsis` in a 96px
 *      column, so "ไฟล์หนังสือโครงการ" rendered "ไฟล์หนังสือโคร…" and
 *      "SAMO Passport" rendered "SAMO Pass…". The full text was in `title`
 *      — AND A PHONE HAS NO HOVER. Disclosure on one input path only is this
 *      repo's most repeated bug shape; here it hid the very thing the panel
 *      exists to say, which system is spending the shared quota.
 *
 * These assert the PROPERTY each fix produces, not the declaration text I
 * happened to write, so a future restyle that keeps the property passes.
 */
describe('the quota panels stay readable on a phone', () => {
  /** The declaration block of the first rule whose selector list matches. */
  const ruleFor = (selector) => {
    const re = new RegExp(`(^|})[^{}]*\\${selector}\\b[^{}]*{([^}]*)}`, 'm');
    const m = CSS.match(re);
    expect(m, `${selector} has no rule in analytics.css`).not.toBe(null);
    return m[2].replace(/\s+/g, ' ');
  };

  it('the นับได้ / มองไม่เห็น status never wraps', () => {
    // It is a status, not prose. The table around it already scrolls
    // (.an-gas-actions is overflow-x:auto), so nowrap costs nothing.
    const html = renderGas()({ simultaneous_limit: 30, peak_per_minute_ever: 2, total: 1 });
    for (const cls of ['an-gas-yes', 'an-gas-no']) {
      expect(html, `${cls} is not rendered — did the status column change?`).toContain(cls);
      expect(ruleFor(`.${cls}`), `.${cls} may wrap; "มองไม่เห็น" broke across two lines at 390px`)
        .toMatch(/white-space:\s*nowrap/);
    }
  });

  it('a ranked label is never disclosed by hover alone', () => {
    // `title` is not a fallback on a touch device. Whatever the label is, it
    // must be readable from the page itself.
    const label = ruleFor('.an-rank-label');
    expect(label, '.an-rank-label is nowrap again — long Thai labels will ellipsize with no way to read them')
      .not.toMatch(/white-space:\s*nowrap/);
    expect(label, '.an-rank-label must allow the text to wrap or clamp, not be cut off')
      .toMatch(/line-clamp|overflow-wrap|white-space:\s*normal/);
  });

  it('every class the shared-quota panel emits has a live CSS rule', () => {
    // The an-email-* guard above never covered this panel, which is why a
    // stylesheet gap here would have been silent. Same property, second panel.
    const rank = extract('rankBars');
    const realRank = Function('fmt', 'escHtml', `${rank}\nreturn rankBars;`)(
      (n) => String(n ?? ''), (x) => String(x));
    const html = renderGas()({
      simultaneous_limit: 30, peak_per_minute_ever: 2, total: 85, peak_per_day: 10,
      by_source: [{ label: 'ไฟล์หนังสือโครงการ', n: 44 }],
    }) + realRank([{ label: 'ไฟล์หนังสือโครงการ', n: 44 }], '#000');

    const classes = new Set();
    for (const m of html.matchAll(/class="([^"]+)"/g)) {
      for (const c of m[1].split(/\s+/)) if (/^an-(gas|rank)/.test(c)) classes.add(c);
    }
    expect(classes.size, 'the panel emits no an-gas-*/an-rank-* class — did it get restyled?')
      .toBeGreaterThan(3);
    for (const c of classes) {
      expect(CSS, `.${c} is rendered but has no rule in analytics.css`).toContain(`.${c}`);
    }
  });
});
