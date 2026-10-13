// จองโควตา Claude, migration 0159 — the five things that would go wrong
// SILENTLY if a later edit undid them.
//
// The bug 0159 fixed was invisible for a day: with 08:00–13:00 booked at 100%,
// the board happily accepted a booking at 06:00, whose 5-hour window swallows
// the first one. It was invisible because the guard was ARITHMETICALLY BUSY —
// it computed sessions, it raised on straddles, it capped percentages — and
// every one of those answers was about the wrong set of rows. Nothing here
// re-tests the arithmetic; tools/claude0159-window-share.sql does that live,
// in both directions, and was falsified against the old guard. These are the
// STRUCTURAL properties that a live proof cannot see.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { stripComments } from '../strip-comments.js';
import { buildClaudeBookingPayload } from '../../../functions/_discord.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const INDEX_JS = read('./index.js');
const HTML     = read('../../html/tab-claude.html');
const CSS      = read('../../css/claude.css');
const M0159    = read('../../../supabase/migrations/'
  + '0159_claude_a_window_is_shared_by_whoever_it_covers.sql');
const M0162    = read('../../../supabase/migrations/'
  + '0162_claude_usage_runs_when_it_was_actually_used.sql');

const CODE = stripComments(INDEX_JS);

// ── §A. The cap comes from the SERVER, always ──────────────────────────────
// The modal used to project board.sessions locally to guess how much a range
// could claim. 0159 made the rule a chain over windows with a MEASURED window
// in it; re-deriving that in the browser is the drift class this repo pays for
// most, and the failure mode is a form that offers a number the database will
// refuse.
describe('the booking form asks the database how much a range may claim', () => {
  it('calls claude_booking_limits', () => {
    expect(CODE).toContain('/rpc/claude_booking_limits');
  });

  it('the slider ceiling comes from that answer and nowhere else', () => {
    // `cap` is what slider.max is set from. It must be derived from `limits`,
    // never from board.sessions.
    expect(CODE).toMatch(/const cap =[\s\S]{0,120}limits\.max_pct/);
    expect(CODE).toMatch(/slider\.max = String\(Math\.max\(5, cap\)\)/);
  });

  it('the local session projection is gone, not merely unused', () => {
    // probeSession() was the second implementation. If it comes back under any
    // name, these are the shapes it will wear.
    expect(CODE).not.toContain('probeSession');
    expect(CODE).not.toMatch(/pool - pr\.used/);
    expect(CODE).not.toMatch(/board\.sessions\.find\([\s\S]{0,200}used_pct/);
  });

  it('a late reply cannot cap the slider for a range somebody has changed', () => {
    // The two mechanisms that make that impossible, both required: a sequence
    // number so a late reply is discarded, and a KEY so an answer is only used
    // for the range it describes. Either one alone leaves the hole open.
    expect(CODE).toContain('limitsSeq');
    expect(CODE).toMatch(/if \(seq !== limitsSeq\) return/);
    expect(CODE).toContain('limitsKey === key');
  });

  it('dragging the percentage slider does not re-ask the server', () => {
    // max_pct does not depend on the pct being asked for. A request per pixel
    // would be a hundred RPCs per booking.
    const fetchFn = CODE.slice(CODE.indexOf('async function fetchLimits'));
    expect(fetchFn.slice(0, fetchFn.indexOf('\n}\n'))).not.toContain('claudePct');
  });
});

// ── §B. The straddle rule really is gone, from BOTH sides ──────────────────
// Dropping it in SQL and leaving the client-side wall in place would keep the
// legal pair (50% at 06:00 + 50% at 08:00) undrawable in one of the two orders
// — the exact asymmetry 0159 exists to remove — while every live proof stayed
// green, because a proof writes rows and never touches the form.
describe('a block may cross a 5-hour boundary, in SQL and in the form alike', () => {
  it('the guard no longer raises the straddle error', () => {
    expect(M0159).toContain('claude_window_loads(new.id');
    expect(M0159).not.toContain('คร่อมขอบเซสชัน');
  });

  it('limitsFor() no longer treats a session edge as a wall', () => {
    const fn = CODE.slice(CODE.indexOf('function limitsFor'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(body).not.toContain('board.sessions');
    // The three walls that ARE still real must all still be there.
    expect(body).toContain('board.bookings');
    expect(body).toContain('weekEnd()');
    expect(body).toContain('sessionMs()');
  });
});

// ── §C. Every write announces itself ───────────────────────────────────────
// A cancel is the notification that matters most — it is the one that hands
// quota BACK — and it was the one that did not exist.
describe('booking, editing and cancelling all notify', () => {
  it('index.js fires all three modes', () => {
    expect(CODE).toMatch(/notifyBooking\(wasEdit \? 'edit' : 'new'/);
    expect(CODE).toMatch(/notifyBooking\('cancel'/);
  });

  it('the cancel notice is built from a row captured BEFORE the delete', () => {
    // Afterwards the row is off the board and the notice would have no name in
    // it — a notification that says "ไม่ทราบชื่อ" is worse than none.
    const fn = CODE.slice(CODE.indexOf('async function removeBooking'));
    const body = fn.slice(0, fn.indexOf("\n  notifyBooking('cancel'"));
    expect(body).toMatch(/const gone = \{ \.\.\.editing \}/);
    expect(body.indexOf('const gone')).toBeLessThan(body.indexOf('method: \'DELETE\''));
  });

  it('the payload builder gives each mode its own verb, title and colour', () => {
    const base = { who: 'ก', pct: 30, purpose: 'x', weekUsed: 100, weekPool: 700 };
    const made = buildClaudeBookingPayload({ ...base, mode: 'new' });
    const edited = buildClaudeBookingPayload({ ...base, mode: 'edit' });
    const gone = buildClaudeBookingPayload({ ...base, mode: 'cancel' });

    const titles = [made, edited, gone].map((p) => p.embeds[0].title);
    expect(new Set(titles).size).toBe(3);
    const colors = [made, edited, gone].map((p) => p.embeds[0].color);
    expect(new Set(colors).size).toBe(3);
    expect(gone.content).toContain('ยกเลิก');
    expect(gone.embeds[0].title).toContain('ว่างแล้ว');
  });

  it('an unknown or missing mode reads as a new booking', () => {
    // Every caller written before `mode` existed meant "new". A payload builder
    // that renders `undefined` for them would be a silent regression in the one
    // notification that already worked.
    const p = buildClaudeBookingPayload({ who: 'ก' });
    expect(p.content).toContain('จองโควตา Claude');
    expect(JSON.stringify(p)).not.toContain('undefined');
  });

  it('a cancelled block reports no "left in this session"', () => {
    // The session it belonged to may not exist any more, and a dash there reads
    // as a reading.
    const gone = buildClaudeBookingPayload({ who: 'ก', mode: 'cancel', pct: 30 });
    const names = gone.embeds[0].fields.map((f) => f.name);
    expect(names.join('|')).not.toContain('เหลือในรอบ');
    expect(names.join('|')).toContain('โควตาที่คืนกลับมา');
  });

  it('the start-on-time reminder rides along when somebody is waiting', () => {
    const p = buildClaudeBookingPayload({ who: 'ก', mode: 'new', nextUp: 'ข 21:00' });
    const txt = JSON.stringify(p);
    expect(txt).toContain('ข 21:00');
    expect(txt).toContain('ตรงเวลา');
    // …and stays away when nobody is. A warning that fires every time is a
    // warning people stop reading.
    expect(JSON.stringify(buildClaudeBookingPayload({ who: 'ก', mode: 'new' })))
      .not.toContain('มีคนใช้ต่อ');
  });
});

// ── §D. The page says the three things, in the asked-for order ─────────────
describe('the week card names ใช้ไปแล้ว / จองไว้ / ว่าง, above the free-now hero', () => {
  it('has all three figures', () => {
    ['claudeWeekUsed', 'claudeWeekBooked', 'claudeWeekFree']
      .forEach((id) => expect(HTML).toContain(`id="${id}"`));
    expect(CODE).toContain('จองไว้');
    expect(CODE).toContain('ว่าง');
  });

  it('the shared-pool card comes BEFORE "ใช้ได้เลยตอนนี้"', () => {
    // Asked for in those terms: leading with "you may use this much without
    // booking" advertises the behaviour the board exists to reduce. This is a
    // DOM-order property, so it is invisible in every other kind of test and
    // would be undone by any restructure of the pane.
    expect(HTML.indexOf('id="claudeWeekBar"'))
      .toBeLessThan(HTML.indexOf('id="claudeNow"'));
  });

  it('the three figures are stated ONCE, not repeated in the legend', () => {
    // They used to appear twice — as figures and again as legend rows — so
    // neither copy was clearly the one attached to the bar. The legend is now
    // the one thing the figures cannot say: whose the middle number is.
    expect(CODE).toContain('claude-legend-k');
    expect(CODE).toContain('จองไว้โดย');
    expect(CODE).not.toMatch(/claude-swatch is-track/);
    expect(CODE).not.toContain('ใช้ไปแล้วจริง ·');
  });

  it('each figure carries its segment colour, in the bar\'s order', () => {
    // The association between a number and a stripe cannot live in an in-bar
    // label — a segment is 2% wide as often as it is 50%.
    ['is-used', 'is-booked', 'is-free'].forEach((cls) => {
      expect(CSS).toMatch(new RegExp(`\\.claude-week-fig-block\\.${cls}\\s*\\{[^}]*color:`));
    });
    expect(CSS).toMatch(/\.claude-week-fig-block::before[\s\S]{0,160}background: currentColor/);
  });

  it('a week with no measurement shows no number rather than a zero', () => {
    // A zero draws an empty bar and reads as "nothing used yet", which is
    // indistinguishable from a real reading (0156).
    expect(CODE).toMatch(/haveMeasured \? Math\.round\(usedReal\) : '—'/);
  });
});

// ── §E. The two view layers stay out of each other's way ───────────────────
describe('the measured overlay has its own lane', () => {
  it('is off by default and remembered per device', () => {
    expect(CODE).toContain("lsGet(LS_HIST) === '1'");
    expect(HTML).toContain('id="claudeHistToggle"');
    expect(HTML).toContain('aria-pressed="false"');
  });

  it('narrows the blocks instead of drawing over them', () => {
    // The capacity rail cost this feature a report by being drawn over the
    // bookings ("the rails it got overlap with the booking making it look
    // weird"). The answer there was a reserved lane; this asserts the same
    // answer here, and that it costs nothing when the overlay is off.
    expect(CSS).toMatch(/\.claude-cal-shell\.is-hist \.claude-bk[\s\S]{0,120}right:/);
    expect(CSS).toMatch(/\.claude-hist \{[\s\S]{0,200}right: 0/);
  });

  it('a gap in the samples is neither bridged nor drawn as idle', () => {
    // The reporter goes down. Joining across a two-hour hole draws a reading
    // nobody took; leaving it blank says nobody was using it, which is worse.
    //
    // ⚠️ THIS ASSERTION MOVED IN 0162 AND THAT IS THE GUARD WORKING. It used to
    // read `MAX_GAP_MS` out of index.js, and went red the moment the derivation
    // moved into claude_usage_runs() — correctly: the hazard still exists, its
    // OWNER changed. Re-pointed rather than deleted, because deleting it is how
    // a rule loses its last enforcement while looking tidied up.
    expect(M0162).toMatch(/v_gap_limit\s+constant\s+interval/);
    expect(M0162).toMatch(/r\.sampled_at - v_prev_at > v_gap_limit/);
    // …and the gap becomes its own STATE, not an absence.
    expect(M0162).toContain("kind := 'unknown'");
    // The client must render that state distinctly, or the honesty is lost on
    // the way to the screen.
    expect(CODE).toContain("r.kind === 'unknown'");
    expect(CSS).toMatch(/\.claude-hist\.is-unknown/);
  });
});

// ── §H. An open window cannot be claimed (0160) ────────────────────────────
describe('a 5-hour window that has already opened is not bookable', () => {
  const M0160 = read('../../../supabase/migrations/'
    + '0160_claude_an_open_window_cannot_be_claimed.sql');

  it('the guard refuses ANY percentage, not just one over the remainder', () => {
    // Clamping to the remainder was the 0159 behaviour and it was wrong: the
    // remainder is not a quantity anybody can promise, because the person
    // already in the window may spend it at any moment. Reported as "i'm
    // currently working 82% … someone could just book 16.40-20.00 kick me out".
    expect(M0160).toContain('claude_open_window()');
    expect(M0160).toMatch(/if new\.pct > coalesce\(v_prev, 0\) then/);
  });

  it('an edit may still SHRINK or cancel a claim already inside it', () => {
    // The test is on the CLAIM, not on the row — otherwise somebody who booked
    // before the window opened could not give their block back.
    expect(M0160).toMatch(/select coalesce\(b\.pct, 0\) into v_prev/);
  });

  it('the rule is checked BEFORE the capacity rule', () => {
    // Order is the message a person gets. An arithmetic complaint about a
    // window they were never allowed to book is not an explanation.
    expect(M0160.indexOf('claude_open_window()'))
      .toBeLessThan(M0160.indexOf('claude_window_loads(new.id'));
  });

  it('the form leads with it, and does not report it as "0% left"', () => {
    // "เหลือ 0%" sends somebody to change the percentage, and no percentage
    // works.
    expect(CODE).toContain('limits.open_window');
    expect(CODE).toContain('ช่วงนี้จองไม่ได้ — รอบนี้เริ่มไปแล้ว');
    expect(CODE).toContain('โดยไม่ต้องจอง (ใช้ร่วมกัน)');
  });

  it('claude_open_window is not reachable by a signed-in account', () => {
    expect(M0160).toContain(
      'revoke all on function public.claude_open_window() from authenticated');
  });
});

// ── §I. The unit is stated before the rules that use it ────────────────────
describe('the ข้อตกลง says what a percentage IS', () => {
  it('gives the session/weekly conversion and the pool', () => {
    // Every number on the page is SESSION percent and the week is 700 of them.
    // Without this "จองไว้ 50%" and "สัปดาห์เหลือ 350%" read as two scales.
    expect(HTML).toContain('claude-terms-math');
    expect(HTML).toMatch(/7%[\s\S]{0,80}1%[\s\S]{0,120}รายสัปดาห์/);
    expect(HTML).toContain('700%');
    expect(HTML).toContain('7 รอบเต็ม');
  });
});

// ── §F. The ข้อตกลง is seen, and can be re-seen ────────────────────────────
describe('the rules open by themselves, and again when they change', () => {
  it('opens on first visit', () => {
    expect(CODE).toMatch(/if \(!termsSeen\(\)\) openTerms\(\)/);
  });

  it('acceptance is recorded under the SAME key it is checked against', () => {
    // Recording under one key and testing another is a modal that either never
    // appears or never goes away, and both look like the feature working to
    // whoever wrote it.
    expect(CODE).toMatch(/lsGet\(LS_TERMS\) === TERMS_VERSION/);
    expect(CODE).toMatch(/lsSet\(LS_TERMS, TERMS_VERSION\)/);
  });

  it('the date jump opens the picker on a DESKTOP too', () => {
    // A transparent <input type="date"> over a label opens the platform picker
    // on a phone, where tapping the FIELD opens it. On a desktop the field only
    // takes focus and the calendar belongs to an indicator icon that opacity:0
    // makes unclickable. showPicker() is the API for "open it now"; the click is
    // the user gesture it requires, and it must be guarded because it throws
    // where unsupported or already open.
    expect(CODE).toMatch(/claudeJump'\)\.addEventListener\('click'/);
    expect(CODE).toMatch(/showPicker\(\)/);
    expect(CODE).toMatch(/try \{ ev\.currentTarget\.showPicker\(\); \} catch/);
  });

  it('jumps to NOON so a date lands in the week that day belongs to', () => {
    // The quota week starts at 16:00, so a date at 00:00 falls in the PREVIOUS
    // week on eight days out of every fifty-six.
    expect(CODE).toMatch(/new Date\(y, \(m \|\| 1\) - 1, d \|\| 1, 12, 0, 0, 0\)/);
  });

  it('is reachable again from the toolbar and from the help line', () => {
    expect(HTML).toContain('id="claudeTermsOpen"');
    expect(CODE).toContain('claudeTermsInline');
  });

  it('reads the weekly reset from the data instead of repeating it', () => {
    // A rule sheet that says Wednesday while claude_settings says Sunday is
    // worse than no rule sheet.
    expect(CODE).toMatch(/claudeTermsReset[\s\S]{0,160}weekEnd\(\)/);
  });

  it('spells the day out — THAI_DOW is an abbreviation for a column header', () => {
    // Rendered, it read "ทุกวันพ". The two arrays are interchangeable to a
    // type-checker and to a reviewer, and only one of them is a word.
    expect(CODE).toMatch(/ทุกวัน\$\{THAI_DOW_FULL\[/);
    expect(CODE).not.toMatch(/ทุกวัน\$\{THAI_DOW\[/);
  });
});

// ── §G. The cancel is called a cancel ──────────────────────────────────────
describe('giving a slot back is ยกเลิก, not ลบ', () => {
  it('the button says ยกเลิกการจอง', () => {
    expect(HTML).toContain('ยกเลิกการจอง');
    expect(HTML).not.toContain('ลบการจอง');
  });

  it('the confirmation says it too, and says what it frees', () => {
    // askDelete() hardcodes ลบ in both its title and its button, so using it
    // here would put the old word back through the back door.
    expect(CODE).not.toContain('askDelete');
    expect(CODE).toMatch(/title: 'ยกเลิกการจองนี้\?'/);
    // …and the CONFIRMING button must not begin with the same word as the
    // dismissing one. askConfirm's "no" is a hardcoded, shared ยกเลิก, so
    // labelling the "yes" ยกเลิกการจอง put two buttons starting with ยกเลิก
    // beside each other — one meaning "back out", one meaning "do it". That was
    // only visible in the rendered dialog.
    const yes = CODE.match(/yes: '([^']+)'/)?.[1] || '';
    expect(yes).not.toMatch(/^ยกเลิก/);
    expect(yes).toContain('คืนช่วงเวลา');
  });
});

// ── the capacity rail encodes magnitude twice (0164) ───────────────────────
describe('the rail says HOW MUCH, not just "some"', () => {
  it('carries no width encoding — the owner asked for colour alone', () => {
    // "i don't need this ยิ่งแถบกว้าง ยิ่งเหลือมาก, i just want the color full".
    // A proportional fill was built and pulled; asserted so it is not
    // reintroduced as an "improvement", and so the key does not promise it.
    // The property named exactly `--f` — not any token that starts with it
    // (the dark-mode theme's --fg-mix is not a width; 2026-10-13).
    expect(CSS).not.toMatch(/--f(?![\w-])/);
    expect('.x{--f: 40%}').toMatch(/--f(?![\w-])/);   // control: it still catches the real thing
    expect(CODE).not.toContain("setProperty('--f'");
    expect(CODE).not.toContain('ยิ่งแถบกว้าง');
  });

  it('and colour steps FOUR ways, so 98% and 25% are not one bucket', () => {
    // Matched as a RULE WITH A BACKGROUND, not as a literal string: the first
    // version asserted `.claude-free.is-low {` and failed on the two spaces
    // used to align the four declarations. A guard that breaks on whitespace
    // is testing the formatter.
    for (const c of ['is-full', 'is-part', 'is-low', 'is-none']) {
      expect(CSS).toMatch(new RegExp(`\\.claude-free\\.${c}\\s*\\{[^}]*background`));
    }
    expect(CODE).toMatch(/free >= pool \* 0\.9 \? ' is-full'/);
    expect(CODE).toMatch(/free >= pool \* 0\.4 \? ' is-part'/);
  });

  it('"none" is not forced to full width — that inverted the encoding', () => {
    // A zero drawn as the longest bar on the calendar reads as "maximum".
    expect(CSS).not.toMatch(/\.claude-free\.is-none[^}]*width:/);
  });

  it('the band never clips its own label', () => {
    // `.claude-free-tag` sits at left: calc(100% + 3px) — OUTSIDE the band, on
    // purpose, because "100%" does not fit in a 10px lane. Any overflow
    // clipping on the band therefore deletes every number on the rail, which is
    // exactly what happened when the fill was given a rounded corner.
    const band = CSS.slice(CSS.indexOf('.claude-free {'),
      CSS.indexOf('.claude-free {') + 700);
    expect(band).not.toMatch(/overflow:\s*hidden/);
    expect(CSS).toMatch(/\.claude-free-tag[\s\S]{0,160}left:\s*calc\(100% \+/);
  });

  it('the track belongs to the BAND, so a day with no reading has none', () => {
    // A column-wide track drew an empty gauge down the past, which states
    // "nothing available" where the truth is "no data".
    expect(CSS).not.toMatch(/\.claude-daycol::before\s*\{[^}]*--claude-rail-w/);
  });
});
