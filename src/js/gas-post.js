// ==============================================
// GAS-POST — the GAS call for paths where A PERSON IS WAITING.
//
// WHY THIS EXISTS. Google intermittently answers `/exec` with an HTML page
// ("ขออภัย ไม่สามารถเปิดไฟล์ได้ในเวลานี้") instead of running the script at all.
// Measured 2026-09-10 while the Drive sweep was running flat out: 2 of 3 probe
// calls got the HTML page, and it tracks request RATE, not client identity
// (docs/state/HANDOFF.md §13a). Every upload call site did `await res.json()`
// on that, so the student who had just picked a file got
// `SyntaxError: Unexpected token '<'` — a browser error about JSON, thrown at
// somebody who was submitting a PDF. That is the same class of loss as 0181,
// from the other end: real work, destroyed by a failure nobody translated.
//
// ⛔ WHAT IT RETRIES, AND WHAT IT DELIBERATELY DOES NOT. A blanket "retry once"
// is WRONG for an upload and this is the whole design decision:
//
//   · A NON-JSON (HTML) reply means Google refused to run the script — it never
//     reached `uploadPRFile`, so no Drive file was created. Retrying is safe,
//     and it is the case that actually happens. THIS WE RETRY.
//   · A TIMEOUT or a dropped connection is AMBIGUOUS: the script may have run
//     and created the file, with only the answer lost. Retrying there can write
//     the SAME file to Drive twice, and a duplicate nothing references is
//     exactly the orphan mess 0181 cost six days. THIS WE DO NOT RETRY — we
//     report it and let a person decide.
//   · A well-formed JSON reply carrying `success:false` is an ANSWER, not a
//     failure of transport. It passes through untouched: `uploadTeamPhoto`
//     reads `"Unknown action"` out of one to drive its fallback, so retrying or
//     swallowing it would break a working path.
//
// The thrown message is Thai a student can act on, and it says whether the file
// was saved — "ยังไม่ถูกบันทึก" is the part that tells them to try again rather
// than assume it went through.
// ==============================================

/** The page Google serves instead of running the script. */
export const GAS_BUSY_MESSAGE =
  'ตอนนี้ Google ไม่ว่าง ระบบจึงอัปโหลดไม่สำเร็จ ไฟล์ยังไม่ถูกบันทึก กรุณารอสักครู่แล้วลองใหม่อีกครั้ง';

/** Ambiguous outcome: it may or may not have been written, so say exactly that. */
export const GAS_UNREACHABLE_MESSAGE =
  'เชื่อมต่อ Google ไม่สำเร็จ ระบบไม่ทราบว่าไฟล์ถูกบันทึกหรือไม่ กรุณาตรวจสอบก่อนอัปโหลดซ้ำ';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST a GAS action and return its parsed JSON.
 *
 * Throws (never returns null) — the caller is a UI path with a person in front
 * of it, and a silent null is how a failed upload renders as a success.
 *
 * @param {string} url        the GAS /exec URL
 * @param {object} body       the full JSON body, including `action`
 * @param {object} [opts]
 * @param {number} [opts.tries=2]         attempts, but ONLY for a non-JSON reply
 * @param {number} [opts.timeoutMs=120000] uploads carry base64 bytes; be generous
 * @param {number} [opts.retryDelayMs=1500] the HTML page is rate pressure, so wait
 */
export async function postGAS(url, body, {
  tries = 2, timeoutMs = 120000, retryDelayMs = 1500,
} = {}) {
  let lastText = '';

  for (let attempt = 1; attempt <= tries; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // Timeout or network. AMBIGUOUS — see the header. Do not retry.
      console.warn(`[gas] ${body?.action} unreachable:`, e?.message || e);
      throw new Error(GAS_UNREACHABLE_MESSAGE);
    }

    lastText = await res.text().catch(() => '');

    let parsed = null;
    try { parsed = lastText ? JSON.parse(lastText) : null; } catch { /* HTML page */ }

    // A real answer, success or not — hand it back verbatim.
    if (parsed && typeof parsed === 'object') return parsed;

    // Non-JSON: Google did not run the script. Safe to try again.
    console.warn(
      `[gas] ${body?.action} non-JSON reply (HTTP ${res.status}), attempt ${attempt}/${tries}:`,
      (lastText || '').slice(0, 200),
    );
    if (attempt < tries) await sleep(retryDelayMs);
  }

  throw new Error(GAS_BUSY_MESSAGE);
}
