// ============================================================
// roster-parse.js — the faculty's rotation PDF → roster rows. THE ONE PARSER:
// tools/rotation-import.mjs calls it, rotation-roster.test.js pins it.
//
// INPUT is the text of `pdftotext -raw <file>.pdf` (poppler). One page per
// group; each student row reads `<no> <รหัส> <prefix><first> <last> …`, and the
// group letter sits alone on the row where the schedule band starts
// (`… <last> A Surgery III …`). A row may carry trailing schedule text.
//
// TWO PDF ARTEFACTS THE IMPORT MUST NOT TRUST (measured on the 2570 file):
//   • `ำ` (sara am) comes out as `า` — the font draws it as two glyphs and the
//     text layer keeps one. ทุก "นำ" reads "นา". The PICTURE is right.
//   • Long surnames are CUT in the file itself ("พงษ์ปิยานุ" for
//     "พงษ์ปิยานุรัตน์") — Excel clipped the cell before printing.
// So the registry (public.people) is the name of record; the PDF spelling is
// kept as `source_name` for evidence, and the import REPORTS every difference
// that is not explained by the first artefact.
// ============================================================

const PREFIXES = ['นางสาว', 'นาย', 'นาง'];
const ROW = /^(\d{1,3}) (\d{9}-\d) (\S+) (.+)$/;
const SCHEDULE_START = /\s(?:[A-F]\s+)?(?:Surgery|Medicine|Pediatrics|Obstetrics|Orthopedics|สมรรถนะ|MD \d|Theory|Sec\.|Competency|Practice)/;

export function genderOfPrefix(prefix) {
  if (prefix === 'นาย') return 'M';
  if (prefix === 'นางสาว' || prefix === 'นาง') return 'F';
  return null;
}

/** Split "นางสาวกัญญาพัชร" → ['นางสาว', 'กัญญาพัชร']. Longest prefix first:
 *  'นาง' is a prefix of 'นางสาว'. */
export function splitPrefix(token) {
  const p = PREFIXES.find((x) => token.startsWith(x));
  return p ? [p, token.slice(p.length)] : [null, token];
}

/** Undo the one known text-layer artefact so a comparison is fair. */
export function foldSaraAm(s) {
  return String(s || '').replace(/ำ/g, 'า').replace(/ํา/g, 'า');
}

/**
 * @param {string} text  pdftotext -raw output (pages split by \f)
 * @returns {{ rows: Array<{group,no,student_id,prefix,first_name,last_name,gender}>, problems: string[] }}
 */
export function parseRosterText(text) {
  const rows = [];
  const problems = [];
  const pages = String(text).split('\f').filter((p) => p.trim());
  pages.forEach((page, pi) => {
    const m = page.match(/\s([A-F])\s+(?:Surgery III|Medicine III|Pediatrics II|Obstetrics|Orthopedics II|สมรรถนะ \(8\))/)
      || page.match(/^\d+ \d{9}-\d \S+ \S+ ([A-F])\s/m);
    const group = m ? m[1] : null;
    if (!group) problems.push(`page ${pi + 1}: no group letter found`);
    for (const line of page.split('\n')) {
      const r = line.match(ROW);
      if (!r) continue;
      const [, no, sid, nameTok, restRaw] = r;
      const [prefix, first] = splitPrefix(nameTok);
      // The surname runs until the schedule text (if any) starts.
      const cut = restRaw.search(SCHEDULE_START);
      const last = (cut === -1 ? restRaw : restRaw.slice(0, cut)).trim();
      const gender = genderOfPrefix(prefix);
      if (!prefix || !gender) problems.push(`page ${pi + 1} row ${no}: unknown prefix in "${nameTok}"`);
      if (!last) problems.push(`page ${pi + 1} row ${no}: no surname`);
      rows.push({ group, no: Number(no), student_id: sid, prefix, first_name: first, last_name: last, gender });
    }
  });
  const seen = new Set();
  for (const r of rows) {
    if (seen.has(r.student_id)) problems.push(`${r.student_id} appears twice`);
    seen.add(r.student_id);
  }
  return { rows, problems };
}

/**
 * How a PDF name compares with the registry's. 'same' · 'sara_am' (only the
 * text-layer artefact differs) · 'cut' (the PDF's surname is a prefix of the
 * registry's — clipped in the file) · 'different' (a person must look).
 */
export function compareNames(pdf, reg) {
  const a = `${pdf.first_name} ${pdf.last_name}`.trim();
  const b = `${reg.first_name || ''} ${reg.last_name || ''}`.trim();
  if (a === b) return 'same';
  if (foldSaraAm(a) === foldSaraAm(b)) return 'sara_am';
  if (foldSaraAm(pdf.first_name) === foldSaraAm(reg.first_name)
      && pdf.last_name && foldSaraAm(reg.last_name || '').startsWith(foldSaraAm(pdf.last_name))) return 'cut';
  return 'different';
}
