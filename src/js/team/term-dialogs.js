// ==============================================
// TERM DIALOGS — the two confirmations a SAMO-year action asks, in ONE home.
//
// Two screens ask them: the ปี SAMO admin page (samo-year-admin.js, where the
// handover lives) and ทีม SAMO → ทีมแต่ละปี (team/terms.js, where a year's
// archive is re-published). The wording is the guard — it is what stops a
// re-publish from filing the next team as this year's history — so a second
// copy that drifts is the class-6 "two implementations of one rule" bug.
// Each function only ASKS; the caller does the write and reports the outcome.
// ==============================================

import { askConfirm } from '../confirm-modal.js';
import { publishTerm } from './api.js';

/** Publish (or re-publish) `year`'s archive from the live tree. */
export function askPublishTerm(year, alreadyPublished) {
  return askConfirm({
    title: alreadyPublished ? `เผยแพร่ปี SAMO ${year} ซ้ำ?` : `บันทึกทีมตอนนี้เป็นประวัติของปี SAMO ${year}?`,
    // A re-publish DELETES the year's archive and rebuilds it from the live
    // tree (publish_team_term). During a handover (publish → edit → switch,
    // skills/year-rollover.md) the live tree is already the NEXT team, so a
    // re-publish would file the new team as this year's history. Say so at
    // the click.
    body: alreadyPublished
      ? `รายชื่อและรูปที่แก้ไขไว้ในประวัติปี SAMO ${year} จะถูกแทนที่ด้วยผังตอนนี้ทั้งหมด — `
        + `ถ้ากำลังแก้ผังเป็นทีมของปีถัดไป อย่ากด: ประวัติปี SAMO ${year} จะกลายเป็นทีมใหม่`
      : 'หลังจากนี้หน้าทีม SAMO สาธารณะจะแสดงทีมชุดนี้ไว้ แม้จะแก้ผังเป็นทีมใหม่แล้วก็ตาม '
        + 'แก้ชื่อ/รูปของปีนี้ภายหลังได้ที่ ทีม SAMO → ทีมแต่ละปี',
    yes: alreadyPublished ? 'เผยแพร่ซ้ำ' : 'บันทึกทีมปีนี้',
    danger: !!alreadyPublished,
  });
}

/**
 * Ask, publish, and — if the year's list was built or corrected by hand (0270)
 * — ask AGAIN before replacing it. Resolves to the RPC's result, or null when
 * the person declined either question. Both publish buttons use this, so
 * neither can erase a hand-built year with one click.
 */
export async function publishTermAsking(year, alreadyPublished) {
  if (!await askPublishTerm(year, alreadyPublished)) return null;
  try {
    return await publishTerm(year);
  } catch (err) {
    if (!err?.handEdited) throw err;
    const ok = await askConfirm({
      title: `แทนที่รายชื่อทีมปี SAMO ${year} ที่จัดไว้เอง?`,
      body: `รายชื่อทีมปี SAMO ${year} (${err.handEdited} คน) ถูกเพิ่มหรือแก้ไว้เองที่ ทีมแต่ละปี — `
        + 'ถ้าบันทึกจากผังตอนนี้ รายชื่อนั้นจะถูกแทนที่ทั้งหมด (รูปคงอยู่เฉพาะคนที่ยังอยู่ในผัง) '
        + 'ถ้าต้องการเก็บรายชื่อที่จัดไว้ ให้กดยกเลิก',
      yes: 'แทนที่ด้วยผังตอนนี้',
      danger: true,
    });
    if (!ok) return null;
    return publishTerm(year, { replaceHandEdits: true });
  }
}

/**
 * Make `year` the current SAMO year (start_samo_year → start_team_term).
 * `outgoing` is the term being replaced, or null; `passport` ({ name, season })
 * when the next Passport วาระสโม opens in the same act (0242).
 *
 * Mirrors start_team_term (0224): it snapshots the outgoing year ONLY when
 * that year was never published — an existing archive is kept as is.
 */
export function askStartTerm(year, outgoing, passport = null) {
  const out = outgoing?.year ?? null;
  const willSnapshot = out != null && !outgoing?.published_at;
  const back = out != null && year < out;
  return askConfirm({
    title: back ? `ย้อนกลับไปใช้ปี SAMO ${year}?` : `เริ่มปี SAMO ${year}?`,
    body: (willSnapshot
        ? `ทีมปี SAMO ${out} ยังไม่ได้บันทึกเป็นประวัติ ระบบจะบันทึกผังตอนนี้เป็นทีมของปี SAMO ${out} ให้ก่อน `
          + `— ถ้าแก้ผังเป็นทีมใหม่ไปแล้ว ประวัติของปี SAMO ${out} จะเป็นทีมใหม่ ให้ยกเลิกแล้วทำขั้นที่ 1 ก่อน `
        : (out != null ? `ประวัติทีมปี SAMO ${out} ที่บันทึกไว้แล้วจะคงเดิม `
          : ''))
      + `จากนั้น PR, VitalSound และคำสั่งซื้อ SAMO Shop ที่เข้ามาใหม่จะนับเป็นปี SAMO ${year} `
      + (passport
        ? `และ SAMO Passport เริ่มวาระ ${passport.name} (season ${passport.season}) — ตารางคะแนนสดเริ่มนับใหม่ `
        : 'SAMO Passport ไม่เปลี่ยน ')
      + 'งานที่ส่งเข้ามาแล้วยังอยู่ในปีเดิม และสิทธิ์ของแต่ละคนไม่เปลี่ยน',
    yes: back ? `ย้อนกลับไปปี SAMO ${year}` : `เริ่มปี SAMO ${year}`,
    danger: false,
  });
}
