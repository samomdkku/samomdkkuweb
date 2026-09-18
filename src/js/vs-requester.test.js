// Guard for the second site of the "visible in Discord, invisible on the web"
// bug — found by sweeping every column the forms write against what any view
// reads, after the PR ลิงก์เสริม fix.
//
// SYMPTOM: the VS form asks "ฝ่ายที่ต้องการส่งเรื่องถึง". Non-emergency reports
// route to SE first BY DESIGN, so `target_dept` is 'SE' and the reporter's own
// choice survives only in `requested_dept` — which the Discord embed printed
// with an instruction aimed at SE, and which no web surface read at all. One
// live ticket was CLOSED at SE without ever reaching the ฝ่าย it asked for.
//
// Two things are asserted, and the second is the one that keeps it fixed:
//   1. the three states of the routing rule, including the two that must turn
//      the callout OFF, and
//   2. that vs-staff.js ASKS this module rather than re-reading the columns —
//      the PR bug existed because one rule had two implementations.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { stripComments } from './strip-comments.js';
import {
  vsRequester, vsRequesterLine, renderVsRequesterBlock, renderVsRequestedChip,
  YEAR_QUALIFIER,
} from './vs-requester.js';

const here = dirname(fileURLToPath(import.meta.url));
// Comments stripped with the shared scanner: this file's own prose names the
// columns, and a source guard that reads prose reports the opposite of truth.
const read = (f) => stripComments(readFileSync(join(here, f), 'utf8'));

const DEPT = 'อุปนายกฝ่ายวิชาการ';

describe('vsRequester — the routing state', () => {
  it('PENDING: the reporter named a ฝ่าย and the ticket is still at SE', () => {
    const r = vsRequester({ requested_dept: DEPT, target_dept: 'SE' });
    expect(r.requestedDept).toBe(DEPT);
    expect(r.state).toBe('pending');
  });

  it('MATCHED: the ticket has reached the ฝ่าย that was asked for', () => {
    expect(vsRequester({ requested_dept: DEPT, target_dept: DEPT }).state).toBe('matched');
  });

  it('NONE: "ไม่แน่ใจ" submits SE, which is an answer, not a missing value', () => {
    // The form's default option is value="SE". Reading that as a request to
    // route to SE would light the callout on every single ticket.
    const r = vsRequester({ requested_dept: 'SE', target_dept: 'SE' });
    expect(r.requestedDept).toBeNull();
    expect(r.state).toBe('none');
  });

  it('NONE: an absent or blank column', () => {
    for (const v of [null, undefined, '', '   ']) {
      expect(vsRequester({ requested_dept: v, target_dept: 'SE' }).state).toBe('none');
    }
  });

  it('a transfer to a THIRD ฝ่าย still reads as pending, not matched', () => {
    // Live case: asked for กิจการภายใน, landed at คุณภาพชีวิตฯ. SE may well be
    // right, but the screen must not claim the request was honoured.
    const r = vsRequester({ requested_dept: 'อุปนายกฝ่ายกิจการภายใน', target_dept: 'อุปนายกฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม' });
    expect(r.state).toBe('pending');
  });
});

describe('vsRequester — the reporter', () => {
  it('reads the name and ชั้นปี the form collected', () => {
    expect(vsRequesterLine({ display_name: 'สมชาย', year: '3' }))
      .toBe(`สมชาย · ชั้นปี 3 ${YEAR_QUALIFIER}`);
  });

  it('treats the anonymous defaults as no name', () => {
    // 'Anonymous' is what vs-form.js writes for a blank field; '-' is the
    // year's blank. Neither is a person.
    for (const v of ['Anonymous', 'anonymous', '', '-', '   ']) {
      expect(vsRequester({ display_name: v }).name).toBeNull();
    }
    expect(vsRequester({ year: '-' }).year).toBeNull();
    expect(vsRequesterLine({ display_name: 'Anonymous', year: '-' })).toBeNull();
  });

  it('marks the ชั้นปี as a snapshot, never as a current one', () => {
    // study-year.test.js exempts this file from "every ชั้นปี comes from
    // studyYearLabel()" ONLY because the value is labelled as stated-at-submit.
    // Drop the qualifier and that exemption becomes the bug it exists to stop.
    expect(vsRequesterLine({ display_name: 'ก', year: '3' })).toContain(YEAR_QUALIFIER);
    expect(YEAR_QUALIFIER).toBe('(ตอนที่แจ้ง)');
  });

  it('shows whichever half was given', () => {
    expect(vsRequesterLine({ display_name: 'นก', year: '-' })).toBe('นก');
    expect(vsRequesterLine({ display_name: 'Anonymous', year: '2' }))
      .toBe(`ชั้นปี 2 ${YEAR_QUALIFIER}`);
  });
});

describe('renderVsRequesterBlock', () => {
  it('names the requested ฝ่าย when the ticket has not reached it', () => {
    const html = renderVsRequesterBlock({ requested_dept: DEPT, target_dept: 'SE' });
    expect(html).toContain(DEPT);
    expect(html).toContain('is-pending');
  });

  it('renders in EVERY state — silence is what the bug looked like', () => {
    // A block that draws nothing for "did not say" is indistinguishable from
    // the months this column had no reader.
    for (const t of [{}, { requested_dept: 'SE', target_dept: 'SE' },
      { requested_dept: DEPT, target_dept: DEPT }]) {
      expect(renderVsRequesterBlock(t).trim().length).toBeGreaterThan(0);
    }
  });

  it('withdraws the action callout once the ticket arrives', () => {
    const html = renderVsRequesterBlock({ requested_dept: DEPT, target_dept: DEPT });
    expect(html).toContain('is-matched');
    expect(html).not.toContain('is-pending');
    expect(html).not.toContain('pickRequestedVsDept');
  });

  it('says so when the reporter stayed anonymous', () => {
    expect(renderVsRequesterBlock({})).toContain('ผู้แจ้งไม่ระบุตัวตน');
  });

  it('escapes a ฝ่าย and a name that came from a form', () => {
    const html = renderVsRequesterBlock({
      requested_dept: '<img src=x onerror=alert(1)>',
      display_name: '"><script>alert(1)</script>',
      target_dept: 'SE',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<script>');
  });
});

describe('renderVsRequestedChip', () => {
  it('appears only on the actionable state', () => {
    expect(renderVsRequestedChip({ requested_dept: DEPT, target_dept: 'SE' })).toContain('ขอ:');
    expect(renderVsRequestedChip({ requested_dept: DEPT, target_dept: DEPT })).toBe('');
    expect(renderVsRequestedChip({ requested_dept: 'SE', target_dept: 'SE' })).toBe('');
    expect(renderVsRequestedChip({})).toBe('');
  });

  it('uses the board abbreviation in the chip and the full name in the title', () => {
    const html = renderVsRequestedChip({ requested_dept: DEPT, target_dept: 'SE' },
      { short: () => 'วิชาการ' });
    expect(html).toContain('ขอ: วิชาการ');
    expect(html).toContain(`title="ผู้แจ้งขอให้ส่งถึง ${DEPT}"`);
  });
});

describe('one reading of the reporter columns', () => {
  it('the module under test owns the column names', () => {
    // Control: an empty sweep below would otherwise pass by finding nothing.
    expect(read('vs-requester.js')).toContain('requested_dept');
  });

  it('vs-staff.js asks vs-requester.js instead of reading the columns itself', () => {
    const src = read('vs-staff.js');
    expect(src).toContain("from './vs-requester.js'");
    expect(src).not.toContain('requested_dept');
    expect(src).not.toContain('display_name');
  });

  it('the transfer select is never pre-set to the requested ฝ่าย on open', () => {
    // submitStaffAction derives `deptChanged` from this select, so a value
    // parked there on open would make an ordinary save silently transfer the
    // ticket — the opposite of routing through SE.
    const src = read('vs-staff.js');
    const preset = src.match(/getElementById\('staffActionTransfer'\)\.value\s*=\s*([^;]+);/g) || [];
    expect(preset).toEqual(["getElementById('staffActionTransfer').value = dept;"]);
  });
});
