// ==============================================
// WHY a student's claim found nothing — computed from what they typed, for the
// admin's คนที่ยืนยันตัวตนไม่ผ่าน list and (the safe half) the claim form itself.
//
// REPORTED (owner, 2026-10-13): five requests, every one "ไม่มีใครใกล้เคียงใน
// รายการค้าง", and no way to tell what to do with any of them. Measured: all
// five รหัส pass KKU's check digit, three are MD47/MD48 — outside ระบบบ้าน,
// which covers the รุ่น now studying (owner, 2026-09-19: MD47/MD48 are not
// added) — and two are MD54 with no line in the faculty's file at all.
// Each of those has exactly one next step, and this names it.
//
// PURE. No DOM, no network. `now` is a parameter so the range is testable.
// ==============================================
import { normalizeStudentId, studentIdChecksumOk } from '../team/fields.js';
import { cohortFromStudentId, studyYear, cohortLabel } from '../study-year.js';

/** ระบบบ้าน holds the รุ่น that are studying: ชั้นปี 1–6 this academic year. */
export function houseCoversCohort(cohortYear, now = new Date()) {
  const y = studyYear({ cohort_year: cohortYear }, now);
  return y !== null && y >= 1 && y <= 6;
}

/** The รุ่น the house system covers this year, as labels: ['MD49', … 'MD54']. */
export function coveredCohortLabels(now = new Date()) {
  const out = [];
  for (let c = 2540; c <= 2580; c += 1) {
    if (houseCoversCohort(c, now)) out.push(cohortLabel({ cohort_year: c }));
  }
  return out;
}

const rangeText = (now) => {
  const l = coveredCohortLabels(now);
  return l.length ? `${l[0]}–${l[l.length - 1]}` : '';
};

/**
 * Before a claim is SENT: what the student can be told from the number alone.
 * Safe to say because it depends on nothing the database holds — no answer
 * here tells anyone whether a รหัส or a person exists (house0188 §30).
 * @returns {string|null} a sentence for the student, or null to go ahead.
 */
export function claimPrecheck(sid, now = new Date()) {
  const n = normalizeStudentId(sid);
  if (!n.ok) return 'รหัสนักศึกษาต้องเป็นตัวเลข 10 หลัก เช่น 659999999-9';
  if (studentIdChecksumOk(n.value) === false) {
    return 'รหัสนักศึกษานี้น่าจะพิมพ์ผิด — ตัวเลขหลักสุดท้ายไม่ตรงกับเลขข้างหน้า ลองตรวจอีกครั้ง';
  }
  const c = cohortFromStudentId(n.value);
  if (c && !houseCoversCohort(c, now)) {
    return `รหัสนี้เป็นรุ่น ${cohortLabel({ cohort_year: c })} — ระบบบ้านมีเฉพาะรุ่นที่กำลังเรียนอยู่ (${rangeText(now)})`;
  }
  return null;
}

/**
 * For the ADMIN: why this request found nothing, and what closes it.
 * @param {object} req   a row of list_house_help_requests
 * @param {object} d     { students, held } as the pane loaded them
 * @returns {{code:string, text:string, close:string|null}} `close` is a reason
 *   to prefill when the request can be closed with nothing else to do.
 */
export function diagnoseHelpRequest(req, d = {}, now = new Date()) {
  if (req?.kind === 'not_me') {
    return { code: 'not_me', text: 'บอกว่าการ์ดที่ระบบแสดงไม่ใช่ของเขา — ตรวจว่าแถวนั้นผูกอีเมลผิดคนหรือไม่', close: null };
  }
  if ((req?.candidates || []).length) {
    return { code: 'near_miss', text: 'มีแถวค้างที่ใกล้เคียง — ถ้าใช่คนเดียวกัน กรอกอีเมลนี้ในแถวนั้น', close: null };
  }
  const n = normalizeStudentId(req?.typed_student_id);
  if (!n.ok) {
    return { code: 'typo', text: 'รหัสที่กรอกไม่ครบ 10 หลัก — เจ้าตัวน่าจะพิมพ์ผิด', close: null };
  }
  if (studentIdChecksumOk(n.value) === false) {
    return { code: 'typo', text: 'เลขตรวจท้ายรหัสไม่ตรง — เจ้าตัวน่าจะพิมพ์ผิด ระบบจะเก็บครั้งต่อไปที่เขาลองใหม่', close: null };
  }
  const c = cohortFromStudentId(n.value);
  const md = c ? cohortLabel({ cohort_year: c }) : '';
  if (c && !houseCoversCohort(c, now)) {
    return {
      code: 'outside',
      text: `รหัสถูกต้อง แต่เป็นรุ่น ${md} — ระบบบ้านมีเฉพาะ ${rangeText(now)} ไม่มีอะไรให้เพิ่ม`,
      close: `รุ่น ${md} ไม่อยู่ในระบบบ้าน (มีเฉพาะ ${rangeText(now)})`,
    };
  }
  const key = (v) => String(v || '').replace(/\D/g, '');
  const owner = (d.students || []).find((s) => key(s.student_id) === key(n.value));
  if (owner) {
    return {
      code: 'taken',
      text: `รหัสนี้เป็นของนักศึกษาที่อยู่ในระบบแล้ว (${[owner.first_name_th, owner.last_name_th].filter(Boolean).join(' ')}) ด้วยอีเมลอื่น — ตรวจว่าใครพิมพ์ผิด`,
      close: null,
    };
  }
  return {
    code: 'absent',
    text: `รหัสถูกต้อง รุ่น ${md} แต่ไม่มีในไฟล์จากคณะเลย (อาจเป็นสาขาอื่นหรือย้ายเข้า) — ต้องขอสายรหัสจากฝ่ายข้อมูล`,
    close: null,
  };
}
