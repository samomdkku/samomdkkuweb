// ==============================================
// drive-year-folder.test.js — the Drive folder path a โครงการ's files
// live under never changes shape for a project that already has one
// (0223, docs/YEAR-ROLLOVER.md § หนังสือโครงการ).
//
// THE HAZARD THIS GUARDS. buildProjectFolderPath/buildDocFolderPath are
// RECOMPUTED FROM SCRATCH on every rename, delete and QR-folder-info call
// (inbox.js, qr.js) — there is no "ask GAS where this project's folder
// already is". If the year segment were added unconditionally, every one
// of the 42 projects that existed before migration 0223 would start being
// looked up at a folder (`Projects/<year>/<slug>_<id>`) that was never
// created, instead of the real one holding their files
// (`Projects/<slug>_<id>`). `projectDriveYear()` is the one gate that
// decides which shape applies, and this file pins both directions.
// ==============================================
import { describe, it, expect } from 'vitest';
import {
  buildProjectFolderPath,
  buildDocFolderPath,
  projectDriveYear,
} from './data.js';

describe('projectDriveYear', () => {
  it('is null for a flat-layout project, even if samo_year_be is set', () => {
    expect(projectDriveYear({ drive_layout: 'flat', samo_year_be: 2569 })).toBeNull();
  });

  it('is the project\'s own samo_year_be for a year-layout project', () => {
    expect(projectDriveYear({ drive_layout: 'year', samo_year_be: 2569 })).toBe(2569);
  });

  it('is null for a year-layout project with no samo_year_be yet (should not happen, but must not throw)', () => {
    expect(projectDriveYear({ drive_layout: 'year', samo_year_be: null })).toBeNull();
  });

  it('is null when drive_layout is missing entirely (a row loaded before 0223\'s column existed)', () => {
    expect(projectDriveYear({})).toBeNull();
    expect(projectDriveYear(null)).toBeNull();
  });
});

describe('buildProjectFolderPath / buildDocFolderPath — year segment', () => {
  it('omits the year segment when no year is passed — the ORIGINAL, pre-0223 shape', () => {
    expect(buildProjectFolderPath('PRJ-1', 'ปฐมนิเทศ')).toBe('Projects/ปฐมนิเทศ_PRJ-1');
    expect(buildDocFolderPath('PRJ-1', 'ปฐมนิเทศ', 'DOC-1', 'หนังสือขออนุมัติ'))
      .toBe('Projects/ปฐมนิเทศ_PRJ-1/หนังสือขออนุมัติ_DOC-1');
  });

  it('prefixes Projects/<year>/ when a year is passed', () => {
    expect(buildProjectFolderPath('PRJ-1', 'ปฐมนิเทศ', 2570)).toBe('Projects/2570/ปฐมนิเทศ_PRJ-1');
    expect(buildDocFolderPath('PRJ-1', 'ปฐมนิเทศ', 'DOC-1', 'หนังสือขออนุมัติ', 2570))
      .toBe('Projects/2570/ปฐมนิเทศ_PRJ-1/หนังสือขออนุมัติ_DOC-1');
  });

  it('a flat project\'s rename/delete/QR path matches what projectDriveYear would gate — no year, same as before 0223', () => {
    const flatProject = { id: 'PRJ-OLD', name: 'โครงการเก่า', drive_layout: 'flat', samo_year_be: 2569 };
    const path = buildProjectFolderPath(flatProject.id, flatProject.name, projectDriveYear(flatProject));
    expect(path).toBe('Projects/โครงการเก่า_PRJ-OLD');
  });

  it('a new project\'s path carries its year — the shape new uploads use', () => {
    const newProject = { id: 'PRJ-NEW', name: 'โครงการใหม่', drive_layout: 'year', samo_year_be: 2570 };
    const path = buildProjectFolderPath(newProject.id, newProject.name, projectDriveYear(newProject));
    expect(path).toBe('Projects/2570/โครงการใหม่_PRJ-NEW');
  });
});
