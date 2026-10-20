// ==============================================
// ปี — the ONE admin page for every year the portal keeps (/admin/#years).
//
// There are four, and they are different facts (owner, 2026-10-20: "ปีการศึกษา
// isn't the same as ปีsamo you should make a unified ui ux to handle it"):
//
//   ปี SAMO      team_terms (0104/0219). The team in office. PR, VitalSound,
//                หนังสือโครงการ and SAMO Shop stamp new rows with it
//                (0220/0221/0223/0230); PR and หนังสือโครงการ pick their Drive
//                folder by it; the public ทีม SAMO page names its team by it.
//                Moved by an admin on handover day.
//   Passport     passport.samo_years/samo_seasons — the leaderboard window.
//   วาระสโม      Opened IN THE SAME ACT as a new ปี SAMO (owner: "Move it in the
//                same click") — start_samo_year, 0242, one transaction.
//   ปีการศึกษา   house_settings.academic_year (0141). Every ชั้นปี and who reads
//                "จบแล้ว". Moved by an admin when the faculty promotes — NOT on
//                the team's handover day, so it keeps its own button.
//   ปีงบ         the calendar (1 ต.ค., projects/fiscal-year.js). Shown, never set.
//
// Before this page the ปี SAMO switch was an outline button inside ทีม SAMO →
// ปีการศึกษา (a tab named after a DIFFERENT year), ปีการศึกษา was a line at the
// bottom of ระบบบ้าน, and Passport's lived behind three browser prompts. Each
// control now has exactly one home — here; ทีม SAMO keeps the archive work
// (names, photos, re-publish), ระบบบ้าน shows the year it computes with.
//
// Gates mirror the RPCs, not guesses: ปี SAMO = start_team_term's own test
// (vp_admin/dev or team_edit); ปีการศึกษา = set_academic_year's (vp_admin/dev
// or house); Passport = passport_admin_context().all_departments, ASKED of the
// database. The page opens for either of the first two (SIDE_FEATURE.years).
// ==============================================

import { escHtml } from './utils.js';
import { userCanAccess } from './auth.js';
import {
  fetchTerms, fetchTermStatus, publishTerm, startSamoYear,
  fetchPassportTerm, fetchPassportOrgWide,
} from './team/api.js';
import { askPublishTerm, askStartTerm } from './team/term-dialogs.js';
import { fetchAcademicYearStatus, saveAcademicYear, primeAcademicYear } from './house/api.js';
import { askConfirm } from './confirm-modal.js';
import { dbRest } from './db.js';
import { studyYear } from './study-year.js';
import { currentFiscalYearBE } from './projects/fiscal-year.js';
import { SAMO_YEAR_CHANGED } from './samo-year.js';
import { handoverState, startTargetError, nextPassportName, passportAlreadyOn } from './samo-year-handover.js';

// ── state ───────────────────────────────────────────────────────────────────

let host = null;
let terms = [];
let staleByYear = new Map();
let academic = null;        // academic_year_status(): { academic_year, clock_year, behind }
let atSix = null;           // people at ชั้นปี 6 now (they read "จบแล้ว" after a move); null = unknown
let passport = null;        // { term, season } — the open วาระ, or null when unreadable
let ppOrgWide = false;
let can = { samo: false, house: false };
let loadError = '';
let busy = false;
let target = null;          // step 3's year as typed
let ppOn = true;            // step 3's "move Passport too" choice
let ppName = null;          // as typed; null = the suggestion
let ppSeason = 'Q1';

const $ = (id) => document.getElementById(id);
const yr = (n) => (n == null ? '—' : String(n));   // a year is never "2,569"

const thDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getFullYear() < 1900) return '';
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
};

// ── rendering ───────────────────────────────────────────────────────────────

/** What starting a ปี SAMO changes. Each line is a CONSEQUENCE a person will
 *  see, and each is true of the code today — verify before adding one:
 *  PR → pr_tickets trigger (0220) + PR/<year> upload folder (pr-form.js) +
 *  isPastYearTicket's lock on FINISHED work only (pr-year.js); VitalSound →
 *  vs_tickets trigger (0221), no lock (vs-year.js); หนังสือโครงการ → projects
 *  trigger + drive_layout 'year' (0223, projects/api.js); Shop → shop_orders
 *  trigger + shop_order_totals() scoped to the current year (0230); ทีม SAMO →
 *  get_public_team_chart labels the live tree with the current year (0153);
 *  Passport → start_samo_year opens a new วาระ + season (0242), which is what
 *  resets the live leaderboard (passport admin-page.js startNewYear). */
const EFFECTS = [
  { icon: 'bi-megaphone', name: 'PR Management',
    line: 'คำขอใหม่นับเป็นปีใหม่ ไฟล์แนบเก็บในโฟลเดอร์ของปีใหม่ — งานที่เสร็จแล้วของปีก่อนต้องกดยืนยันก่อนแก้' },
  { icon: 'bi-clipboard2-pulse', name: 'VitalSound',
    line: 'เรื่องที่แจ้งใหม่นับเป็นปีใหม่ หน้าเจ้าหน้าที่เปิดที่ปีใหม่ เรื่องเดิมยังแก้ได้ตามปกติ' },
  { icon: 'bi-folder2', name: 'หนังสือโครงการ',
    line: 'โครงการใหม่นับเป็นปีใหม่ และเก็บไฟล์ในโฟลเดอร์ Drive ของปีใหม่' },
  { icon: 'bi-shop', name: 'SAMO Shop',
    line: 'คำสั่งซื้อใหม่นับเป็นปีใหม่ ยอดสรุปในข้อความ Discord ของร้านเริ่มนับใหม่' },
  { icon: 'bi-diagram-3', name: 'หน้าทีม SAMO',
    line: 'ผังปัจจุบันแสดงเป็นทีมของปีใหม่ ทีมปีเดิมยังดูได้จากประวัติ' },
  { icon: 'bi-patch-check', name: 'SAMO Passport', passport: true,
    line: 'เริ่มวาระสโมใหม่ ตารางคะแนนสดเริ่มนับใหม่ ระยะทางและอันดับของวาระก่อนยังเก็บไว้' },
];

function overviewHtml(st) {
  const c = st.current;
  const pp = passport?.term;
  const ppMatch = pp && c && passportAlreadyOn(pp, c.year);
  const ay = academic?.academic_year ?? null;
  return `
    <section class="sy-hero" aria-labelledby="syHeroYear">
      <div class="sy-hero-main">
        <div class="sy-hero-kicker">ปี SAMO ปัจจุบัน</div>
        <div class="sy-hero-year" id="syHeroYear">${c ? escHtml(yr(c.year)) : 'ยังไม่ได้ตั้ง'}</div>
        <p class="sy-hero-lead">${c
          ? 'ทีมที่ดำรงตำแหน่งอยู่ — งานใหม่ทุกชิ้นใน PR, VitalSound, หนังสือโครงการ และ SAMO Shop นับเป็นปีนี้'
          : 'ยังไม่มีปีที่เป็นปีปัจจุบัน งานใหม่จะยังไม่ถูกนับเข้าปีใด — เริ่มปีที่ขั้นที่ 3 ด้านล่าง'}</p>
        ${c ? `<div class="sy-hero-meta">
          ${thDate(c.started_at) ? `<span><i class="bi bi-flag"></i> เริ่ม ${escHtml(thDate(c.started_at))}</span>` : ''}
          <span class="${st.published ? 'is-ok' : 'is-todo'}">
            <i class="bi ${st.published ? 'bi-check-circle-fill' : 'bi-circle'}"></i>
            ${st.published ? `บันทึกทีมปีนี้แล้ว · ${escHtml(thDate(c.published_at))}` : 'ยังไม่ได้บันทึกทีมปีนี้เป็นประวัติ'}
          </span></div>` : ''}
      </div>
      <ul class="sy-tiles" aria-label="ปีอื่นในระบบ">
        <li class="sy-tile${pp && c && !ppMatch ? ' is-warn' : ''}">
          <span class="sy-tile-k"><i class="bi bi-patch-check"></i> วาระสโม · Passport</span>
          <span class="sy-tile-v">${pp ? escHtml(pp.name) : '—'}</span>
          <span class="sy-tile-s">${!passport ? 'อ่านไม่ได้'
            : !pp ? 'ไม่มีวาระที่เปิดอยู่'
            : ppMatch ? `ตรงกับปี SAMO ${escHtml(yr(c.year))}${passport.season ? ` · season ${escHtml(passport.season.name)}` : ''}`
            : `ยังไม่ได้ผูกกับปี SAMO${passport.season ? ` · season ${escHtml(passport.season.name)}` : ''} — จะเปลี่ยนพร้อมปีใหม่`}</span>
        </li>
        <li class="sy-tile${academic?.behind ? ' is-warn' : ''}">
          <span class="sy-tile-k"><i class="bi bi-mortarboard"></i> ปีการศึกษา · ชั้นปี</span>
          <span class="sy-tile-v">${escHtml(yr(ay))}</span>
          <span class="sy-tile-s">${academic?.behind ? 'ถึงกำหนดเลื่อนแล้ว' : 'คนละค่ากับปี SAMO · เลื่อนแยก'}
            · <a href="#syAcademic" class="sy-link">จัดการ</a></span>
        </li>
        <li class="sy-tile">
          <span class="sy-tile-k"><i class="bi bi-calendar3"></i> ปีงบประมาณ</span>
          <span class="sy-tile-v">${escHtml(yr(currentFiscalYearBE()))}</span>
          <span class="sy-tile-s">เปลี่ยนเองทุก 1 ต.ค. · ใช้ในหนังสือโครงการ</span>
        </li>
      </ul>
    </section>`;
}

function step(n, state, title, body) {
  return `
    <li class="sy-step is-${state}">
      <span class="sy-step-dot" aria-hidden="true">${state === 'done' ? '<i class="bi bi-check-lg"></i>' : n}</span>
      <div class="sy-step-main">
        <h3 class="sy-step-title">${title}${state === 'done' ? '<span class="visually-hidden"> (เสร็จแล้ว)</span>' : ''}</h3>
        ${body}
      </div>
    </li>`;
}

function passportBlockHtml(t) {
  const pp = passport?.term;
  if (!passport) {
    return '<div class="sy-pp is-off"><i class="bi bi-exclamation-circle"></i> อ่านวาระสโมของ Passport ไม่ได้ — ปีใหม่จะเริ่มโดยไม่เปลี่ยน Passport</div>';
  }
  if (t != null && passportAlreadyOn(pp, t)) {
    return `<div class="sy-pp is-off"><i class="bi bi-check-circle"></i> Passport เปิดวาระของปี SAMO ${escHtml(yr(t))} ไว้แล้ว (${escHtml(pp.name)}) — ไม่เปิดซ้ำ</div>`;
  }
  if (!ppOrgWide) {
    return `<div class="sy-pp is-off"><i class="bi bi-lock"></i> Passport จะ<strong>ไม่</strong>เปลี่ยน — การเริ่มวาระสโมต้องมีสิทธิ์ SAMO Passport ทุกฝ่าย
      ${pp ? `(ตอนนี้คือ ${escHtml(pp.name)})` : ''}</div>`;
  }
  const name = ppName ?? nextPassportName(pp?.name, t ?? 0);
  return `
    <fieldset class="sy-pp">
      <label class="sy-pp-toggle">
        <input type="checkbox" class="form-check-input" id="syPpOn" ${ppOn ? 'checked' : ''} />
        <span>เริ่มวาระสโมของ <strong>SAMO Passport</strong> ใหม่พร้อมกัน
          <span class="sy-pp-sub">${pp ? `ปิด ${escHtml(pp.name)}${passport.season ? ` · season ${escHtml(passport.season.name)}` : ''} แล้วเปิดวาระใหม่ ตารางคะแนนสดเริ่มนับใหม่` : 'เปิดวาระแรก'}</span></span>
      </label>
      <div class="sy-pp-fields${ppOn ? '' : ' d-none'}" id="syPpFields">
        <label class="sy-field"><span>ชื่อวาระ</span>
          <input type="text" class="form-control form-control-sm" id="syPpName" maxlength="80" value="${escHtml(name)}" /></label>
        <label class="sy-field sy-field--short"><span>season แรก</span>
          <input type="text" class="form-control form-control-sm" id="syPpSeason" maxlength="80" value="${escHtml(ppSeason)}" /></label>
      </div>
    </fieldset>`;
}

function samoHtml(st) {
  const c = st.current;
  const cy = c ? Number(c.year) : null;
  const t = target ?? st.next;
  const err = t != null ? startTargetError(t, cy) : 'ใส่ปี SAMO ใหม่';
  const ro = !can.samo;
  const dis = (extra = false) => (ro || busy || extra ? 'disabled' : '');
  // The SAME test doStart() applies — the list must not promise a Passport
  // move the click will not make.
  const ppWill = ppOrgWide && ppOn && !!passport && !passportAlreadyOn(passport.term, t);

  const s1 = !c ? 'later' : (st.published ? 'done' : 'now');
  const s1Body = !c
    ? '<p class="sy-step-text">ต้องมีปีปัจจุบันก่อน</p>'
    : st.published
      ? `<p class="sy-step-text">หน้าทีม SAMO แสดงทีมปี SAMO ${escHtml(yr(cy))} ไว้ระหว่างที่แก้ผังเป็นทีมใหม่${st.editing
          ? ' — <strong>ผังเปลี่ยนไปแล้วหลังบันทึก ไม่ต้องบันทึกซ้ำ</strong>' : ''}</p>`
      : `<p class="sy-step-text">เก็บทีมชุดนี้ไว้ก่อนเริ่มแก้ผัง หน้าทีม SAMO จะยังแสดงทีมนี้ระหว่างเปลี่ยน</p>
         <button type="button" class="btn sy-btn sy-btn-soft" data-sy-publish="${cy}" ${dis()}>
           <i class="bi bi-camera"></i> บันทึกทีมปี SAMO ${escHtml(yr(cy))}
         </button>`;

  const s2Body = `
    <p class="sy-step-text">เพิ่มคนของทีมใหม่ในผังก่อน แล้วค่อยเอาคนของทีมเดิมออกในวันส่งต่อ
      — <strong>สิทธิ์ของแต่ละคนเปลี่ยนตามผังทันที</strong> คนที่ถูกเอาออกจะใช้ระบบที่เคยใช้ไม่ได้อีก</p>
    <button type="button" class="btn btn-outline-secondary sy-btn" data-sy-go="team-tree">
      <i class="bi bi-people"></i> ไปที่ ทีม SAMO → จัดการทีม
    </button>
    ${st.editing ? '<div class="sy-step-note"><i class="bi bi-pencil"></i> เริ่มแก้ผังแล้ว</div>' : ''}`;

  const s3Body = `
    <p class="sy-step-text">ทำในวันที่ทีมใหม่รับตำแหน่ง${!st.published && c
      ? `<span class="sy-warn"><i class="bi bi-exclamation-triangle"></i> ยังไม่ได้ทำขั้นที่ 1 — ถ้าเริ่มตอนนี้ ผังตอนนี้จะถูกบันทึกเป็นทีมปี SAMO ${escHtml(yr(cy))}</span>` : ''}</p>
    <div class="sy-start">
      <label class="sy-field sy-field--year"><span>ปี SAMO ใหม่</span>
        <input type="number" inputmode="numeric" class="form-control" id="syTarget"
          value="${t ?? ''}" min="2500" max="2700" aria-describedby="syTargetErr" ${dis()} /></label>
      ${passportBlockHtml(t)}
      <button type="button" class="btn sy-btn sy-btn-go" id="syStart" ${dis(!!err)}>
        <i class="bi bi-arrow-right-circle"></i> <span id="syStartLabel">เริ่มปี SAMO ${escHtml(yr(t))}</span>
      </button>
      <div class="sy-start-err" id="syTargetErr" role="status">${escHtml(c ? err : '')}</div>
    </div>`;

  const others = st.others.length ? `
    <details class="sy-more">
      <summary class="sy-more-sum">ปีอื่น ๆ <span class="sy-more-hint">ย้อนกลับ หรือแก้ประวัติทีม</span></summary>
      <ul class="sy-years">
        ${st.others.map((o) => {
          const y = Number(o.year);
          const span = [thDate(o.started_at), thDate(o.ended_at)].filter(Boolean).join(' – ');
          return `
            <li class="sy-year">
              <span class="sy-year-num">${escHtml(yr(y))}</span>
              <span class="sy-year-meta">${o.published_at ? `บันทึกทีมแล้ว · ${escHtml(thDate(o.published_at))}` : 'ยังไม่มีประวัติทีม'}${span ? ` · ใช้งาน ${escHtml(span)}` : ''}</span>
              <button type="button" class="btn btn-sm btn-outline-secondary" data-sy-switch="${y}" ${dis()}>
                ${cy != null && y < cy ? 'ย้อนกลับไปปีนี้' : 'ตั้งเป็นปีปัจจุบัน'}
              </button>
            </li>`;
        }).join('')}
      </ul>
      <p class="sy-more-foot">ย้อนกลับไม่เปลี่ยนวาระของ Passport · แก้ชื่อ รูป หรือลบปี ที่
        <button type="button" class="sy-link" data-sy-go="team-years">ทีม SAMO → ทีมแต่ละปี</button></p>
    </details>` : '';

  return `
    <section class="sy-card" aria-labelledby="sySamoH">
      <header class="sy-card-head">
        <h2 class="sy-h" id="sySamoH">ส่งต่อให้ทีมใหม่</h2>
        <p class="sy-sub">ทำตามลำดับ — เริ่มขั้นที่ 1 เมื่อจะเริ่มเตรียมผังของทีมใหม่ ไม่ต้องรีบทำตั้งแต่ต้นปี</p>
        ${ro ? '<p class="sy-ro"><i class="bi bi-eye"></i> ดูได้อย่างเดียว — การเปลี่ยนปี SAMO ต้องมีสิทธิ์แก้ไขทีม SAMO</p>' : ''}
      </header>
      <ol class="sy-steps">
        ${step(1, s1, c ? `บันทึกทีมปี SAMO ${escHtml(yr(cy))} เป็นประวัติ` : 'บันทึกทีมเป็นประวัติ', s1Body)}
        ${step(2, st.published ? 'now' : 'later', 'แก้ผังเป็นทีมใหม่', s2Body)}
        ${step(3, c ? 'later' : 'now', 'เริ่มปีใหม่', s3Body)}
      </ol>
      <div class="sy-effects-wrap">
        <h3 class="sy-h3">เมื่อเริ่มปีใหม่ อะไรเปลี่ยน</h3>
        <ul class="sy-effects">
          ${EFFECTS.map((e) => `
            <li class="sy-effect${e.passport && !ppWill ? ' is-muted' : ''}">
              <span class="sy-effect-icon"><i class="bi ${e.icon}"></i></span>
              <span class="sy-effect-body">
                <span class="sy-effect-name">${escHtml(e.name)}</span>
                <span class="sy-effect-line">${escHtml(e.line)}${e.passport && !ppWill ? ' (ครั้งนี้ไม่เปลี่ยน)' : ''}</span>
              </span>
            </li>`).join('')}
        </ul>
        <div class="sy-same">
          <span class="sy-same-title"><i class="bi bi-shield-check"></i> ไม่เปลี่ยน</span>
          งานที่ส่งเข้ามาแล้วยังอยู่ในปีเดิม · สิทธิ์ใช้งานเป็นไปตามผังใน ทีม SAMO · ชั้นปีของนักศึกษา (ใช้ปีการศึกษาด้านล่าง)
        </div>
      </div>
      ${others}
    </section>`;
}

function academicHtml() {
  const y = academic?.academic_year ?? null;
  const ro = !can.house;
  const behind = Number(academic?.behind || 0);
  return `
    <section class="sy-card" id="syAcademic" aria-labelledby="syAcadH">
      <header class="sy-card-head">
        <h2 class="sy-h" id="syAcadH">ปีการศึกษา <span class="sy-h-sub">ใช้คำนวณชั้นปี</span></h2>
        <p class="sy-sub">คนละค่ากับปี SAMO — เลื่อนเมื่อคณะขึ้นปีการศึกษาใหม่ ซึ่งอาจไม่ใช่วันเดียวกับวันส่งต่อทีม</p>
        ${ro ? '<p class="sy-ro"><i class="bi bi-eye"></i> ดูได้อย่างเดียว — การเลื่อนปีการศึกษาต้องมีสิทธิ์ระบบบ้าน</p>' : ''}
      </header>
      <div class="sy-acad">
        <div class="sy-acad-now">
          <span class="sy-acad-v">${escHtml(yr(y))}</span>
          ${behind ? `<span class="sy-badge is-warn"><i class="bi bi-alarm"></i> ถึงกำหนดเลื่อนแล้ว — ปฏิทินอยู่ที่ ${escHtml(yr(academic.clock_year))}</span>` : ''}
        </div>
        <ul class="sy-acad-what">
          <li>ชั้นปีของนักศึกษาทุกคนเลื่อนขึ้นพร้อมกัน — คนที่เคยเลือกชั้นปีเอง (ลาพัก/เรียนซ้ำ) เลื่อนตามส่วนต่างที่บันทึกไว้</li>
          <li>${atSix == null ? 'คนที่อยู่ปี 6 จะกลายเป็น “จบแล้ว” และหายจากรายชื่อเริ่มต้นในระบบบ้าน'
            : atSix ? `<strong>${atSix.toLocaleString('th-TH')} คน</strong>ที่อยู่ปี 6 ตอนนี้จะกลายเป็น “จบแล้ว” และหายจากรายชื่อเริ่มต้นในระบบบ้าน`
            : 'ตอนนี้ไม่มีใครอยู่ปี 6'}</li>
          <li>ชื่อใน Discord (ชื่อเล่น_#ชั้นปี) เปลี่ยนตามเมื่อบอทซิงก์รอบถัดไป ถ้าเปิดบอทอยู่</li>
        </ul>
        ${y ? `<div class="sy-acad-actions">
          <button type="button" class="btn sy-btn sy-btn-soft" data-sy-acad="${y + 1}" ${ro || busy ? 'disabled' : ''}>
            <i class="bi bi-arrow-up-circle"></i> เลื่อนเป็น ${escHtml(yr(y + 1))}</button>
          <button type="button" class="btn btn-link btn-sm sy-btn-quiet" data-sy-acad="${y - 1}" ${ro || busy ? 'disabled' : ''}>
            ย้อนเป็น ${escHtml(yr(y - 1))}</button>
        </div>` : ''}
      </div>
    </section>`;
}

function render() {
  if (!host) return;
  if (loadError) {
    host.innerHTML = `<div class="sy"><div class="sy-card sy-error"><i class="bi bi-exclamation-octagon"></i> ${escHtml(loadError)}
      <button type="button" class="btn btn-sm btn-outline-secondary ms-2" data-sy-retry>ลองอีกครั้ง</button></div></div>`;
    return;
  }
  const st = handoverState(terms, staleByYear);
  host.innerHTML = `
    <div class="sy">
      ${overviewHtml(st)}
      <div class="sy-status" id="syStatus" role="status" aria-live="polite"></div>
      ${samoHtml(st)}
      ${academicHtml()}
    </div>`;
}

function status(msg, kind = '') {
  const el = $('syStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.className = `sy-status${kind ? ` is-${kind}` : ''}`;
}

// ── loading ─────────────────────────────────────────────────────────────────

/** People at ชั้นปี 6 under the CURRENT ปีการศึกษา — who a move turns
 *  "จบแล้ว". The same studyYear() arithmetic ระบบบ้าน counts with, over the
 *  three columns it needs; never a second formula. */
async function countAtSix() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await dbRest('/students?select=cohort_year,student_id,year_offset',
      { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    if (error && error.status === 416) break;
    if (error) return null;
    out.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return out.filter((s) => studyYear(s) === 6).length;
}

async function load() {
  try {
    terms = await fetchTerms();
    loadError = '';
  } catch (e) {
    loadError = e?.message || 'โหลดปี SAMO ไม่สำเร็จ';
    render();
    return;
  }
  // Everything below is best-effort: each costs one hint, never the page.
  const [st, ac, pp, org, six] = await Promise.allSettled([
    fetchTermStatus(),
    fetchAcademicYearStatus(),
    fetchPassportTerm(),
    can.samo ? fetchPassportOrgWide() : Promise.resolve(false),
    can.house ? countAtSix() : Promise.resolve(null),
  ]);
  staleByYear = st.status === 'fulfilled'
    ? new Map((st.value.terms || []).map((t) => [Number(t.year), !!t.stale])) : new Map();
  academic = ac.status === 'fulfilled' ? ac.value : null;
  passport = pp.status === 'fulfilled' ? pp.value : null;
  ppOrgWide = org.status === 'fulfilled' && !!org.value;
  atSix = six.status === 'fulfilled' ? six.value : null;
  render();
}

// ── actions ─────────────────────────────────────────────────────────────────

/** One write at a time; every button repaints disabled while it runs. The
 *  outcome is said AFTER the reload, so the message sits over the new state. */
async function run(fn) {
  if (busy) return;
  busy = true;
  render();
  let msg = ''; let kind = '';
  try {
    [msg, kind] = await fn();
  } catch (e) {
    msg = e?.message || 'ทำรายการไม่สำเร็จ'; kind = 'error';
  } finally {
    busy = false;
  }
  await load();
  status(msg, kind);
}

async function doPublish(year) {
  if (!await askPublishTerm(year, false)) return;
  await run(async () => {
    const res = await publishTerm(year);
    return [`บันทึกทีมปี SAMO ${year} แล้ว — ${res?.nodes ?? 0} ตำแหน่ง · ${res?.members ?? 0} คน`, 'ok'];
  });
}

/** `withPassport` only from step 3 (forward). A switch from ปีอื่น ๆ never
 *  opens a วาระ — start_samo_year refuses one going back anyway. */
async function doStart(year, { withPassport = false } = {}) {
  const st = handoverState(terms, staleByYear);
  if (st.current && Number(st.current.year) === year) return;
  let pp = null;
  if (withPassport && ppOrgWide && ppOn && passport && !passportAlreadyOn(passport.term, year)) {
    const name = ($('syPpName')?.value || '').trim();
    const season = ($('syPpSeason')?.value || '').trim();
    if (!name || !season) return void status('ใส่ชื่อวาระและ season แรกของ Passport ให้ครบ หรือเอาเครื่องหมายออก', 'error');
    pp = { name, season };
  }
  if (!await askStartTerm(year, st.current, pp)) return;
  await run(async () => {
    const res = await startSamoYear(year, pp);
    target = null; ppName = null;
    window.dispatchEvent(new CustomEvent(SAMO_YEAR_CHANGED, { detail: { year } }));
    const bits = [`ตอนนี้เป็นปี SAMO ${year} แล้ว`];
    if (res?.archived_outgoing) bits.push(`บันทึกทีมปี SAMO ${res.previous_year} เป็นประวัติให้แล้ว`);
    if (res?.passport?.moved) bits.push(`Passport เริ่ม ${res.passport.name} · season ${res.passport.season}`);
    return [bits.join(' — '), 'ok'];
  });
}

async function doAcademic(year) {
  const cur = Number(academic?.academic_year || 0);
  const up = year > cur;
  if (!await askConfirm({
    title: up ? `เลื่อนปีการศึกษาเป็น ${year}?` : `ย้อนปีการศึกษาเป็น ${year}?`,
    body: up
      ? 'ชั้นปีของนักศึกษาทุกคนจะเลื่อนขึ้น 1 ปีพร้อมกัน '
        + (atSix ? `${atSix.toLocaleString('th-TH')} คนที่อยู่ปี 6 จะกลายเป็น “จบแล้ว” ` : '')
        + 'ถ้ากดผิด ย้อนกลับเป็นปีเดิมได้'
      : 'ชั้นปีของทุกคนจะถอยลง 1 ปีพร้อมกัน — ใช้เมื่อเลื่อนผิด',
    yes: up ? 'เลื่อนปีการศึกษา' : 'ย้อนปีการศึกษา',
    danger: false,
  })) return;
  await run(async () => {
    await saveAcademicYear(year);
    await primeAcademicYear();   // every ชั้นปี on this page instance follows
    return [`ปีการศึกษาเป็น ${year} แล้ว`, 'ok'];
  });
}

/** Repaint only what the step-3 inputs drive — a full render() would replace
 *  the input and drop the caret mid-typing. */
function onTargetInput(el) {
  target = el.value === '' ? null : Number(el.value);
  const st = handoverState(terms, staleByYear);
  const err = target == null ? 'ใส่ปี SAMO ใหม่' : startTargetError(target, st.current?.year ?? null);
  const btn = $('syStart');
  if (btn) btn.disabled = !!err || busy || !can.samo;
  const lab = $('syStartLabel');
  if (lab) lab.textContent = `เริ่มปี SAMO ${yr(target)}`;
  const out = $('syTargetErr');
  if (out) out.textContent = err;
  // The suggested Passport name follows the year until someone types their own.
  const nm = $('syPpName');
  if (nm && ppName == null && target != null) nm.value = nextPassportName(passport?.term?.name, target);
}

function go(where) {
  if (where === 'team-tree') return window.openTeamMode?.('team');
  if (where === 'team-years') return window.openTeamMode?.('years');
  return undefined;
}

// ── wiring ──────────────────────────────────────────────────────────────────

function wire() {
  host.addEventListener('click', (e) => {
    const t = e.target;
    const pub = t.closest?.('[data-sy-publish]');
    if (pub) return void doPublish(Number(pub.dataset.syPublish));
    const sw = t.closest?.('[data-sy-switch]');
    if (sw) return void doStart(Number(sw.dataset.sySwitch));
    const ac = t.closest?.('[data-sy-acad]');
    if (ac) return void doAcademic(Number(ac.dataset.syAcad));
    if (t.closest?.('#syStart')) {
      const y = Number($('syTarget')?.value);
      const err = startTargetError(y, handoverState(terms, staleByYear).current?.year ?? null);
      if (err) return void status(err, 'error');
      return void doStart(y, { withPassport: true });
    }
    const g = t.closest?.('[data-sy-go]');
    if (g) return void go(g.dataset.syGo);
    const a = t.closest?.('a[href="#syAcademic"]');
    if (a) { e.preventDefault(); $('syAcademic')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return undefined; }
    if (t.closest?.('[data-sy-retry]')) return void load();
    return undefined;
  });
  host.addEventListener('input', (e) => {
    const id = e.target.id;
    if (id === 'syTarget') onTargetInput(e.target);
    else if (id === 'syPpName') ppName = e.target.value;
    else if (id === 'syPpSeason') ppSeason = e.target.value;
  });
  host.addEventListener('change', (e) => {
    if (e.target.id !== 'syPpOn') return;
    ppOn = e.target.checked;
    $('syPpFields')?.classList.toggle('d-none', !ppOn);
    // The Passport line in "what changes" follows the choice.
    render();
  });
  host.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'syTarget') { e.preventDefault(); $('syStart')?.click(); }
  });
}

/** The gates, from the same tests the RPCs make (header). The SIDEBAR's
 *  gate is SIDE_FEATURE.years = ['team_edit', 'house'] in admin-main.js — the
 *  same union for every account, since userCanAccess already grants vp_admin
 *  team_edit and dev everything. */
export function yearPageAccess(user) {
  const byRole = ['vp_admin', 'dev'].includes(user?.role);
  return {
    samo: byRole || userCanAccess('team_edit', user),
    house: byRole || userCanAccess('house', user),
  };
}

/** Called on every entry to /admin/#years. Wiring is idempotent; the data is
 *  always re-read, because a year may have moved from another tab or device. */
export async function enterSamoYear(user) {
  const el = document.getElementById('samoYearHost');
  if (!el) return;
  can = yearPageAccess(user);
  if (host !== el) {
    host = el;
    wire();
    host.innerHTML = '<div class="sy"><div class="sy-loading">กำลังโหลด…</div></div>';
  }
  await load();
}
