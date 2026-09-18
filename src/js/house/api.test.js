// Tests for the self-claim RPC wrappers — claimMySeat, reportNotMyRecord,
// fetchMyHelpStatus, fetchMyStudentRecord.
//
// WHY THIS FILE DID NOT EXIST BEFORE. `api.js` is a thin layer over `dbRest`,
// and every other house test exercises it only indirectly (through my-house.js
// rendering markup, or not at all). The owner asked, in the middle of the
// night the 2026-09-15 handover shipped, "how do I test what a person sees" —
// and the honest answer for the SERVER half is: without a database, the best
// that can be proven from this repo is the CONTRACT between the RPC and the
// code that calls it — which endpoint, which body, and which of "throw" or
// "return {ok:false}" each outcome takes. That contract is exactly what a
// front-end change could silently break without any of the existing markup
// tests noticing (they mock dbRest but never make it resolve to anything).
//
// See docs/HOUSE-YEAR-HANDOVER.md § วิธีทดสอบ for the outcomes this pins,
// and supabase/migrations/0191_the_form_they_already_used_is_the_report.sql
// for the server-side half the fixtures below are copied from.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbRest = vi.fn();
vi.mock('../db.js', () => ({ dbRest: (...args) => dbRest(...args) }));

const {
  claimMySeat, reportNotMyRecord, fetchMyHelpStatus, fetchMyStudentRecord,
} = await import('./api.js');

beforeEach(() => { dbRest.mockReset(); });

describe('claimMySeat — the six outcomes claim_my_student_seat can answer', () => {
  it('calls the RPC with exactly the two facts the server matches on', async () => {
    dbRest.mockResolvedValue({ data: { ok: true, sai: '017' }, error: null });
    await claimMySeat('659999999-9', 'สมชาย');
    expect(dbRest).toHaveBeenCalledWith('/rpc/claim_my_student_seat', {
      method: 'POST', body: { p_student_id: '659999999-9', p_first_name: 'สมชาย' },
    });
  });

  it('FOUND — a match resolves to {ok:true}, no throw', async () => {
    dbRest.mockResolvedValue({ data: { ok: true, sai: '017' }, error: null });
    const res = await claimMySeat('659999999-9', 'สมชาย');
    expect(res).toEqual({ ok: true, sai: '017' });
  });

  // NOT FOUND, WRONG รหัส, and RIGHT รหัส / WRONG ชื่อ are the SAME outcome as
  // far as this wrapper (and the caller) can tell — 0191's whole point is that
  // the server answers all three with one indistinguishable sentence, so a
  // guesser cannot learn which half of their guess was wrong. There is
  // deliberately no test here that tries to tell them apart; that absence is
  // the assertion, and 0191's own SQL proof pins the server side of it
  // (house0191-help-requests.sql §20-22).
  it('NOT FOUND (incl. wrong รหัส / wrong ชื่อ) — a miss resolves to {ok:false, message}, no throw', async () => {
    const message = 'ยังไม่พบรายชื่อที่ตรงกับรหัสนักศึกษาและชื่อนี้ '
      + 'ลองตรวจตัวสะกดอีกครั้ง — ถ้ากรอกถูกแล้วยังไม่พบ '
      + 'ระบบได้แจ้งผู้ดูแลระบบบ้านให้แล้ว ไม่ต้องแจ้งซ้ำที่อื่น';
    dbRest.mockResolvedValue({ data: { ok: false, message }, error: null });
    const res = await claimMySeat('659999999-1', 'ไม่มีใครชื่อนี้');
    expect(res.ok).toBe(false);
    expect(res.message).toBe(message);
  });

  it('ALREADY CLAIMED — the server raises, so this THROWS rather than answering ok:false', async () => {
    // The one case a signed-in student can reach even though the UI never
    // shows them the form for it (they already have a card): a race where the
    // claim RPC is called twice, or a direct call. `claim_my_student_seat`
    // raises before it ever looks at the held list.
    dbRest.mockResolvedValue({
      data: null, error: { message: 'บัญชีนี้มีข้อมูลนักศึกษาอยู่แล้ว' },
    });
    await expect(claimMySeat('659999999-9', 'สมชาย'))
      .rejects.toThrow('บัญชีนี้มีข้อมูลนักศึกษาอยู่แล้ว');
  });

  it('NOT A KKUMAIL ACCOUNT — the server raises with the domain requirement', async () => {
    // Reachable only if the account's email changes between the empty card
    // being painted (which already gates on isKku) and the submit landing —
    // the wrapper still has to surface it rather than eating the error.
    dbRest.mockResolvedValue({
      data: null,
      error: { message: 'ต้องเข้าสู่ระบบด้วยบัญชี @kkumail.com ก่อน จึงจะยืนยันตัวตนได้' },
    });
    await expect(claimMySeat('659999999-9', 'สมชาย'))
      .rejects.toThrow('@kkumail.com');
  });

  it('NOT SIGNED IN — the server raises; the wrapper never assumes a session', async () => {
    dbRest.mockResolvedValue({ data: null, error: { message: 'ต้องเข้าสู่ระบบก่อน' } });
    await expect(claimMySeat('659999999-9', 'สมชาย')).rejects.toThrow('เข้าสู่ระบบ');
  });

  it('a network/transport error (no message) still throws, with a Thai fallback', async () => {
    dbRest.mockResolvedValue({ data: null, error: {} });
    await expect(claimMySeat('659999999-9', 'สมชาย')).rejects.toThrow('ยืนยันตัวตนไม่สำเร็จ');
  });

  it('a malformed success payload (no data at all) still answers ok:false, not undefined', async () => {
    // PostgREST answers 204/null for some misconfigurations; a caller reading
    // `res.ok` on `undefined` would throw INSIDE the UI's own success path.
    dbRest.mockResolvedValue({ data: null, error: null });
    const res = await claimMySeat('659999999-9', 'สมชาย');
    expect(res).toEqual({ ok: false, message: 'ยืนยันตัวตนไม่สำเร็จ' });
  });
});

describe('reportNotMyRecord — "ไม่ใช่ข้อมูลของฉัน"', () => {
  it('sends the note, or null when blank — never an empty string', async () => {
    dbRest.mockResolvedValue({ data: { ok: true }, error: null });
    await reportNotMyRecord('');
    expect(dbRest).toHaveBeenCalledWith('/rpc/report_not_my_record', {
      method: 'POST', body: { p_note: null },
    });
  });

  it('throws the server message when the caller has no student record to disown', async () => {
    // `report_not_my_record` requires an existing students row (it is "this
    // ISN'T mine", not "I have none") — reachable only off the populated card,
    // but the wrapper still has to propagate the message rather than swallow it.
    dbRest.mockResolvedValue({
      data: null, error: { message: 'บัญชีนี้ยังไม่มีข้อมูลนักศึกษา' },
    });
    await expect(reportNotMyRecord('note')).rejects.toThrow('ยังไม่มีข้อมูลนักศึกษา');
  });
});

describe('fetchMyHelpStatus — the receipt, quiet on failure by design', () => {
  it('returns null when there is nothing open (no help request filed)', async () => {
    dbRest.mockResolvedValue({ data: null, error: null });
    expect(await fetchMyHelpStatus()).toBeNull();
  });

  it('returns the receipt shape when one is open', async () => {
    const receipt = {
      kind: 'no_record', created_at: '2026-09-01T00:00:00Z', attempts: 2, waiting_days: 8,
    };
    dbRest.mockResolvedValue({ data: receipt, error: null });
    expect(await fetchMyHelpStatus()).toEqual(receipt);
  });

  it('NEVER throws — an error is swallowed to null', async () => {
    // Documented at the call site (my-house.js paintHelpReceipt) as
    // "decoration only": a student whose record is genuinely missing must not
    // also be shown a second, unrelated error about the receipt for the first.
    dbRest.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(fetchMyHelpStatus()).resolves.toBeNull();
  });
});

describe('fetchMyStudentRecord — the gate every landing state is decided from', () => {
  it('null data (not in the table yet) is a normal answer, not an error', async () => {
    dbRest.mockResolvedValue({ data: null, error: null });
    expect(await fetchMyStudentRecord()).toBeNull();
  });

  it('propagates a real RPC error rather than mapping it to "not found"', async () => {
    dbRest.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    await expect(fetchMyStudentRecord()).rejects.toThrow('connection reset');
  });
});
