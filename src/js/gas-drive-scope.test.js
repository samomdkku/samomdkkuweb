// ============================================================
// gas-drive-scope.test.js — runs the REAL appscript/prform.gs against a fake
// Drive and asserts what each public handler is allowed to reach.
//
// prform.gs is deployed "Execute as: Me + Anyone": every handler runs with the
// SAMO account's whole Drive, for any caller on the internet. A source-text
// test can see a check's SHAPE, not whether it holds (mistakes class 7: "a
// source guard is a review, not a test"), so these load the file into a VM
// context with a stub DriveApp and call the handlers.
//
// What they pin (2026-10-14 review of the year-rollover handlers):
//   - fileLivesUnderTop_ — the gate for every PR/Shop/Team/Projects delete,
//     move and read — accepted ANY folder NAMED "PR"/"Projects" anywhere in
//     the Drive. It must be a real top folder: under the app root, or a legacy
//     one at My Drive root.
//   - uploadPRFile / uploadArchiveFile take EXACTLY `PR/<year>` /
//     `Archives/<year>`; movePRFileToYear and the Projects year segment only a
//     year 2500–2700.
//   - an archive file is set PRIVATE.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../appscript/prform.gs', import.meta.url), 'utf8');

let seq = 0;
function iter(list) { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }

class FakeFile {
  constructor(name, parent) {
    this.id = `file${++seq}xxxxxxxxxxxxxxxxxxxxxx`; this.name = name; this.parents = [parent];
    this.sharing = null; parent.files.push(this);
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; }
  getParents() { return iter(this.parents); }
  moveTo(folder) {
    for (const p of this.parents) p.files = p.files.filter((f) => f !== this);
    this.parents = [folder]; folder.files.push(this);
  }
  setSharing(access, perm) { this.sharing = `${access}/${perm}`; }
}

class FakeFolder {
  constructor(name, parent = null) {
    this.id = `fold${++seq}`; this.name = name; this.parent = parent;
    this.folders = []; this.files = []; this.sharing = null;
    if (parent) parent.folders.push(this);
  }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; }
  getParents() { return iter(this.parent ? [this.parent] : []); }
  getFolders() { return iter([...this.folders]); }
  getFoldersByName(n) { return iter(this.folders.filter((f) => f.name === n)); }
  createFolder(n) { return new FakeFolder(n, this); }
  createFile(blob) { return new FakeFile(blob.name, this); }
  moveTo(dest) { this.parent.folders = this.parent.folders.filter((f) => f !== this); this.parent = dest; dest.folders.push(this); }
  setSharing(access, perm) { this.sharing = `${access}/${perm}`; }
  setTrashed(v) { this.trashed = v; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  getFiles() { return iter([...this.files]); }
  child(path) {
    return path.split('/').reduce((f, n) => f && f.folders.find((c) => c.name === n), this);
  }
}

/** A fresh Drive + a fresh copy of prform.gs bound to it. */
function load() {
  const root = new FakeFolder('My Drive');
  const app = new FakeFolder('IT Database', root);
  const byId = new Map();
  const ctx = {
    DriveApp: {
      getRootFolder: () => root,
      getFileById: (id) => {
        const f = byId.get(id);
        if (!f) throw new Error('not found');
        return f;
      },
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' },
      Permission: { VIEW: 'VIEW', NONE: 'NONE' },
    },
    Utilities: {
      base64Decode: (s) => Buffer.from(s, 'base64'),
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
    },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Logger: { log: () => {} },
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const track = (f) => { byId.set(f.id, f); return f; };
  const call = (fn, data) => JSON.parse(ctx[fn](data).text);
  return { ctx, root, app, track, call };
}

const DATA_URL = `data:text/plain;base64,${Buffer.from('x').toString('base64')}`;

describe('fileLivesUnderTop_ — a top folder must BE a top folder', () => {
  let d;
  beforeEach(() => { d = load(); });

  it('a file in IT Database/PR (and in a year folder under it) is inside PR', () => {
    const pr = new FakeFolder('PR', d.app);
    expect(d.ctx.fileLivesUnderTop_(new FakeFile('a.png', pr), 'PR')).toBe(true);
    expect(d.ctx.fileLivesUnderTop_(new FakeFile('b.png', new FakeFolder('2569', pr)), 'PR')).toBe(true);
  });

  it('a legacy top folder at My Drive root still counts (warnIfSplit_ territory)', () => {
    const legacy = new FakeFolder('PR', d.root);
    expect(d.ctx.fileLivesUnderTop_(new FakeFile('c.png', legacy), 'PR')).toBe(true);
  });

  it('a folder merely NAMED PR inside Shop/ does not count', () => {
    const nested = new FakeFolder('PR', new FakeFolder('x', new FakeFolder('Shop', d.app)));
    expect(d.ctx.fileLivesUnderTop_(new FakeFile('d.png', nested), 'PR')).toBe(false);
  });

  it('a personal folder named Projects elsewhere in My Drive does not count', () => {
    const personal = new FakeFolder('Projects', new FakeFolder('Work', d.root));
    expect(d.ctx.fileLivesUnderTop_(new FakeFile('secret.pdf', personal), 'Projects')).toBe(false);
  });
});

describe('movePRFileToYear — reaches only files under the real PR folder', () => {
  let d;
  beforeEach(() => { d = load(); });

  it('moves a flat PR file into PR/<year>, same id', () => {
    const pr = new FakeFolder('PR', d.app);
    const f = d.track(new FakeFile('a.png', pr));
    const r = d.call('handleMovePRFileToYear', { fileUrl: f.getUrl(), year: '2569' });
    expect(r.success).toBe(true);
    expect(f.parents[0].name).toBe('2569');
    expect(f.parents[0].parent).toBe(pr);
  });

  it('refuses a file in a look-alike PR folder, and leaves it where it was', () => {
    const fake = new FakeFolder('PR', new FakeFolder('Work', d.root));
    const f = d.track(new FakeFile('private.pdf', fake));
    const r = d.call('handleMovePRFileToYear', { fileUrl: f.getUrl(), year: '2569' });
    expect(r.success).toBe(false);
    expect(f.parents[0]).toBe(fake);
  });

  it('refuses a year outside 2500–2700 before touching Drive', () => {
    const f = d.track(new FakeFile('a.png', new FakeFolder('PR', d.app)));
    for (const year of ['9999', '0001', '2569/../x', '']) {
      expect(d.call('handleMovePRFileToYear', { fileUrl: f.getUrl(), year }).success, year).toBe(false);
    }
  });
});

describe('uploadPRFile / uploadArchiveFile — exactly <top>/<year>', () => {
  let d;
  beforeEach(() => { d = load(); });

  it('uploadPRFile: PR/<year> lands there; no folderPath stays flat', () => {
    expect(d.call('handleUploadPRFile', { folderPath: 'PR/2569', fileData: DATA_URL, mimeType: 'image/png', fileName: 'a.png' }).success).toBe(true);
    expect(d.app.child('PR/2569').files).toHaveLength(1);
    expect(d.call('handleUploadPRFile', { fileData: DATA_URL, mimeType: 'image/png', fileName: 'b.png' }).success).toBe(true);
    expect(d.app.child('PR').files).toHaveLength(1);
  });

  it('uploadPRFile refuses any other shape, and creates no folder for it', () => {
    for (const folderPath of ['PR/2569/deep', 'PR/x', 'PR/9999', 'Shop/2569', 'PR/../Projects']) {
      expect(d.call('handleUploadPRFile', { folderPath, fileData: DATA_URL, mimeType: 'image/png', fileName: 'a' }).success, folderPath).toBe(false);
    }
    expect(d.app.child('PR/2569/deep')).toBeUndefined();
    expect(d.app.child('PR/x')).toBeUndefined();
  });

  it('uploadArchiveFile: Archives/<year>, json or csv only, and the file is PRIVATE', () => {
    const ok = d.call('handleUploadArchiveFile', { folderPath: 'Archives/2569', fileData: DATA_URL, mimeType: 'text/csv', fileName: 'pr_tickets_2569.csv' });
    expect(ok.success).toBe(true);
    const file = d.app.child('Archives/2569').files[0];
    expect(file.sharing).toBe('PRIVATE/NONE');
    for (const [folderPath, mimeType] of [['Archives/2569/x', 'text/csv'], ['Archives/2569', 'image/png'], ['Archives/12', 'text/csv'], ['PR/2569', 'text/csv']]) {
      expect(d.call('handleUploadArchiveFile', { folderPath, fileData: DATA_URL, mimeType, fileName: 'a' }).success, `${folderPath} ${mimeType}`).toBe(false);
    }
  });
});

describe('a YEAR folder is a container, like the Projects root — never trashed, never shared', () => {
  let d; let year; let a; let b;
  beforeEach(() => {
    d = load();
    const projects = new FakeFolder('Projects', d.app);
    year = new FakeFolder('2569', projects);
    a = new FakeFolder('โครงการก_PRJ-AAAA', year);
    b = new FakeFolder('โครงการข_PRJ-BBBB', year);
  });

  it('deleteProjectFolder refuses Projects/2569 and trashes nothing', () => {
    for (const folderPath of ['Projects/2569', 'Projects/2569/']) {
      expect(d.call('handleDeleteProjectFolder', { folderPath }).success, folderPath).toBe(false);
    }
    expect([year.trashed, a.trashed, b.trashed]).toEqual([undefined, undefined, undefined]);
  });

  it('…while one project under it is still deleted, and only that one', () => {
    expect(d.call('handleDeleteProjectFolder', { folderPath: 'Projects/2569/โครงการก_PRJ-AAAA' }).success).toBe(true);
    expect([a.trashed, b.trashed, year.trashed]).toEqual([true, undefined, undefined]);
  });

  it('getProjectFolderInfo refuses to share Projects/2569, and shares a project folder', () => {
    expect(d.call('handleGetProjectFolderInfo', { folderPath: 'Projects/2569', share: true }).success).toBe(false);
    expect(year.sharing).toBe(null);
    expect(d.call('handleGetProjectFolderInfo', { folderPath: 'Projects/2569/โครงการก_PRJ-AAAA', share: true }).success).toBe(true);
    expect(a.sharing).toBe('ANYONE_WITH_LINK/VIEW');
  });
});

describe('cost: the top-folder lookup happens once per request, not per file', () => {
  it('fifty ancestry checks cost the same root lookups as one', () => {
    const count = (n) => {
      const d = load();
      const projects = new FakeFolder('Projects', d.app);
      let calls = 0;
      const real = d.ctx.DriveApp.getRootFolder;
      d.ctx.DriveApp.getRootFolder = () => { calls++; return real(); };
      for (let i = 0; i < n; i++) d.ctx.fileLivesUnderTop_(new FakeFile(`f${i}`, projects), 'Projects');
      return calls;
    };
    expect(count(1)).toBeGreaterThan(0);
    expect(count(50)).toBe(count(1));
  });
});

describe('the Projects year segment', () => {
  it('a year 2500–2700 is matched by exact name; a bare 4-digit non-year is walked as before', () => {
    const d = load();
    const folder = d.ctx.walkProjectsPathByCode_('Projects/2569/โครงการ_PRJ-AB12');
    expect(folder.name).toBe('โครงการ_PRJ-AB12');
    expect(folder.parent.name).toBe('2569');
    expect(d.ctx.isSamoYearSegment_('2569')).toBe(true);
    expect(d.ctx.isSamoYearSegment_('9999')).toBe(false);
  });
});
