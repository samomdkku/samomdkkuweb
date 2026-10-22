// ==============================================
// FOLLOW-UP — what ฝ่ายข้อมูล (or an admin) found out about a held row (0217).
//
// ONE HOME for the four answers on the JS side: the admin pane, the สาย grid,
// the ข้อมูลไม่ครบ audit, the handover sheet and the import-back tool all read
// this. The database's half is the check constraint in
// supabase/migrations/0217_what_the_data_team_found_out.sql, and
// follow-up.test.js reads that file and fails if the two disagree.
//
// They split by whether the seat is still OWED:
//   open   — unreachable, maybe_left: a real student, still claimable. "คาดว่า"
//            is a guess, and closing on a guess is how a student loses a seat
//            they could still take.
//   closes — left, no_person: nothing is owed. The สาย reads as ANSWERED, not
//            as a hole, everywhere a hole is reported.
// ==============================================

export const FOLLOW_UP = {
  unreachable: { label: 'ติดต่อไม่ได้', closes: false, icon: 'telephone-x' },
  maybe_left: { label: 'คาดว่าลาออกแล้ว', closes: false, icon: 'question-circle' },
  left: { label: 'ลาออก', closes: true, icon: 'box-arrow-right' },
  no_person: { label: 'ไม่มีคนนี้จริง (เลขนี้ไม่มีตัวตน)', closes: true, icon: 'slash-circle' },
};

/** Statuses that close the row, and so EXPLAIN an empty สาย. */
export const CLOSING = new Set(Object.keys(FOLLOW_UP).filter((k) => FOLLOW_UP[k].closes));

export const followUpLabel = (k) => FOLLOW_UP[k]?.label || '';

/** An OPEN held row the ฝ่าย already answered (ติดต่อไม่ได้ / คาดว่าลาออก):
 *  nothing left to ask, but the seat stays theirs if they turn up. */
export const isAnsweredOpen = (h) => !h?.resolved_at && FOLLOW_UP[h?.follow_up]?.closes === false;
/** A closed held row whose answer explains why its สาย has nobody on it. */
export const isAnsweredEmpty = (h) => !!h?.resolved_at && CLOSING.has(h.follow_up);

/**
 * A remark as the ฝ่าย typed it → a status, or null.
 * ⛔ ORDER IS LOAD-BEARING: "คาดว่าลาออก" CONTAINS "ลาออก", so the guess must be
 * tested first or every "probably left" closes a seat as "left".
 */
export function followUpFromText(text) {
  const t = String(text ?? '').replace(/\s+/g, '');
  if (!t) return null;
  if (/คาดว่า.*ลาออก|น่าจะ.*ลาออก/.test(t)) return 'maybe_left';
  if (/ติดต่อไม่ได้|ติดต่อไม่ติด/.test(t)) return 'unreachable';
  if (/ไม่มีตัวตน|ไม่มีคนนี้|ไม่มีคนในสาย|ไม่มีคนสายนี้/.test(t)) return 'no_person';
  if (/ลาออก/.test(t)) return 'left';
  return null;
}
