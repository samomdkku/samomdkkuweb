// Guards for postGAS — the GAS call on every path where a person is waiting.
//
// The bug it exists to prevent: Google intermittently answers /exec with an
// HTML page instead of running the script, and every upload call site did
// `await res.json()` on it, so a student submitting a PDF got
// `SyntaxError: Unexpected token '<'`. Measured 2026-09-10 at 2-of-3 calls
// while the Drive sweep ran (HANDOFF §13a).
//
// The last test is the one that keeps this fixed: it asserts the PROPERTY —
// that no module reaches the GAS endpoint with a raw fetch — rather than a list
// of the call sites that existed on the day it was written. A list-vs-list
// guard proves only that the lists agree (.claude/rules/mistakes.md class 7).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { postGAS, GAS_BUSY_MESSAGE, GAS_UNREACHABLE_MESSAGE } from './gas-post.js';

const fetchMock = vi.fn();
const URL_ = 'https://script.google.com/macros/s/x/exec';

/** Google's "ขออภัย ไม่สามารถเปิดไฟล์ได้ในเวลานี้" page, in the shape fetch sees. */
const htmlPage = () => ({
  ok: true, status: 200,
  text: async () => '<!DOCTYPE html><html><head><title>Error</title></head><body>ขออภัย</body></html>',
});
const jsonResp = (obj, status = 200) => ({
  ok: status < 400, status, text: async () => JSON.stringify(obj),
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('postGAS — the reply Google actually sends', () => {
  it('returns the parsed JSON on a normal reply', async () => {
    fetchMock.mockResolvedValue(jsonResp({ success: true, fileUrl: 'https://drive/x' }));
    await expect(postGAS(URL_, { action: 'uploadPRFile' }))
      .resolves.toEqual({ success: true, fileUrl: 'https://drive/x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('RETRIES an HTML page and succeeds on the second attempt', async () => {
    fetchMock
      .mockResolvedValueOnce(htmlPage())
      .mockResolvedValueOnce(jsonResp({ success: true, fileUrl: 'https://drive/y' }));
    const out = await postGAS(URL_, { action: 'uploadPRFile' }, { retryDelayMs: 0 });
    expect(out.fileUrl).toBe('https://drive/y');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws Thai a student can act on — never a JSON SyntaxError', async () => {
    fetchMock.mockResolvedValue(htmlPage());
    await expect(postGAS(URL_, { action: 'uploadPRFile' }, { retryDelayMs: 0 }))
      .rejects.toThrow(GAS_BUSY_MESSAGE);
    // The whole point: the message must say the file was NOT saved, or the
    // student assumes it went through and never retries.
    expect(GAS_BUSY_MESSAGE).toContain('ยังไม่ถูกบันทึก');
    expect(GAS_BUSY_MESSAGE).not.toMatch(/JSON|SyntaxError|<|undefined/);
  });

  it('does NOT retry a timeout — it may already have written the file', async () => {
    // The design decision, asserted: an HTML page means the script never ran,
    // so retrying is safe. A timeout is AMBIGUOUS — the upload may have landed
    // and only the answer been lost — and a second attempt would put the same
    // file in Drive twice, which is the orphan mess 0181 cost six days.
    fetchMock.mockRejectedValue(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    await expect(postGAS(URL_, { action: 'uploadProjectFile' }, { retryDelayMs: 0 }))
      .rejects.toThrow(GAS_UNREACHABLE_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(GAS_UNREACHABLE_MESSAGE).toContain('ไม่ทราบว่าไฟล์ถูกบันทึกหรือไม่');
  });

  it('passes a JSON success:false straight through', async () => {
    // uploadTeamPhoto reads "Unknown action" out of one of these to drive its
    // fallback to uploadPRFile. Retrying or swallowing it breaks a live path.
    fetchMock.mockResolvedValue(jsonResp({ success: false, message: 'Unknown action' }));
    const out = await postGAS(URL_, { action: 'uploadTeamFile' }, { retryDelayMs: 0 });
    expect(out).toEqual({ success: false, message: 'Unknown action' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a non-2xx HTML body the same way — status is not the signal', async () => {
    fetchMock.mockResolvedValue({ ...htmlPage(), ok: false, status: 500 });
    await expect(postGAS(URL_, { action: 'uploadPRFile' }, { retryDelayMs: 0 }))
      .rejects.toThrow(GAS_BUSY_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('no module reaches GAS with a raw fetch', () => {
  // Walk src/js rather than naming files: the point is that a NEW call site
  // cannot reappear, and a hardcoded list cannot see one.
  function jsFiles(dir, out = []) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) jsFiles(full, out);
      else if (name.endsWith('.js') && !name.endsWith('.test.js')) out.push(full);
    }
    return out;
  }

  const files = jsFiles('src/js');

  it('has a control — the sweep really is reading files', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith('gas-post.js'))).toBe(true);
  });

  it('finds no fetch(GAS_API_URL) outside the helper and the queue', () => {
    const offenders = files.filter((f) => {
      // gas-post.js IS the helper; discord-queue.js has its own fire-and-forget
      // caller with different semantics (returns null, never throws).
      if (f.endsWith('gas-post.js') || f.endsWith('discord-queue.js')) return false;
      return /fetch\(\s*(GAS_API_URL|targetUrl)\b/.test(readFileSync(f, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });
});
