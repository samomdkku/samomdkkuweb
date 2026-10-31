// drive-year.test.js — where a โครงการ's Drive folder is (0269).
//
// The path is rebuilt from the row on every upload/rename/QR/delete, and Apps
// Script CREATES any folder the path names. So the year segment must come from
// where the folder IS (drive_year_be), never from the ปีงบ label, which a
// person can change — building from the label splits a โครงการ's files across
// two folders the first time someone moves its ปีงบ.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectDriveYear, buildProjectFolderPath, buildDocFolderPath } from './data.js';
import { stripComments } from '../strip-comments.js';

describe('projectDriveYear — the recorded folder wins over every label', () => {
  it('drive_year_be is the answer, even when the ปีงบ label says otherwise', () => {
    const p = { drive_year_be: 2569, fiscal_year_be: 2570, created_at: '2026-10-20T00:00:00Z', drive_layout: 'year', samo_year_be: 2569 };
    expect(projectDriveYear(p)).toBe(2569);
    expect(buildProjectFolderPath('PRJ-AB12', 'ค่าย', projectDriveYear(p))).toBe('Projects/2569/ค่าย_PRJ-AB12');
  });

  it('a flat project (before 0223, never moved) builds a flat path', () => {
    const p = { drive_year_be: null, drive_layout: 'flat', samo_year_be: 2569 };
    expect(projectDriveYear(p)).toBeNull();
    expect(buildDocFolderPath('PRJ-AB12', 'ค่าย', 'DOC-ABCDE', 'หนังสือ', projectDriveYear(p)))
      .toBe('Projects/ค่าย_PRJ-AB12/หนังสือ_DOC-ABCDE');
  });

  it('a row the pre-0269 bundle created (year layout, no drive_year_be) falls back to samo_year_be, where 0223 put it', () => {
    expect(projectDriveYear({ drive_layout: 'year', samo_year_be: 2569, drive_year_be: null })).toBe(2569);
  });

  it('a moved flat project uses its recorded year even though drive_layout still says flat', () => {
    expect(projectDriveYear({ drive_layout: 'flat', samo_year_be: 2569, drive_year_be: 2570 })).toBe(2570);
  });
});

describe('every path builder call asks projectDriveYear, never a year column directly', () => {
  for (const f of ['send.js', 'qr.js', 'inbox.js']) {
    it(f, () => {
      const src = stripComments(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'));
      const calls = src.match(/build(Project|Doc)FolderPath\([^;]*\)/g) || [];
      expect(calls.length, `${f} builds no folder path?`).toBeGreaterThan(0);
      for (const c of calls) {
        expect(c, `${f}: ${c}`).toMatch(/projectDriveYear\(/);
        expect(c).not.toMatch(/samo_year_be|fiscal_year_be|drive_year_be|projectFiscalYear/);
      }
    });
  }
});

describe('createProject files a new โครงการ under the current ปีงบ', () => {
  it('sends drive_year_be from currentFiscalYearBE(), the fiscal-year module, not a local copy', () => {
    const src = stripComments(readFileSync(new URL('./api.js', import.meta.url), 'utf8'));
    expect(src).toMatch(/drive_year_be:\s*currentFiscalYearBE\(\)/);
    expect(src).toMatch(/import \{ currentFiscalYearBE \} from '\.\/fiscal-year\.js'/);
  });
});
