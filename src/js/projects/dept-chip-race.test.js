// ==============================================
// dept-chip-race.test.js — two ฝ่ายสโม chips clicked before either lands.
//
// THE BUG. onToggleProjectDept() reads `cache.projects` to compute the WHOLE
// samo_depts array, then writes the whole array back — there is no per-tag
// column, so two different chips clicked close together both read the SAME
// pre-toggle array and each writes their own version of it. `btn.disabled`
// only stops a second click on the SAME button; it does nothing for two
// DIFFERENT chips on the same โครงการ. Whichever request's response lands
// last wins, and the other person's tag is silently dropped — never shown as
// an error, because neither request failed.
// ==============================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./api.js', () => ({
  getProject: vi.fn(),
  getDocument: vi.fn(),
  deleteProject: vi.fn(),
  updateProject: vi.fn(),
  appendDocTimeline: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
  listFiles: vi.fn(async () => []),
  createFile: vi.fn(),
  deleteFile: vi.fn(),
  listMyDocViews: vi.fn(async () => []),
  upsertMyDocView: vi.fn(),
  bulkUpsertMyDocViews: vi.fn(),
  appendSignTimeline: vi.fn(),
  updateSignRequest: vi.fn(),
  deleteSignRequest: vi.fn(),
  getMyProjectPrefs: vi.fn(async () => null),
  saveMyProjectDefaultFY: vi.fn(),
  setProjectSamoDept: vi.fn(),
}));

const { setProjectSamoDept } = await import('./api.js');
const { renderInbox, mountInbox, onToggleProjectDept } = await import('./inbox.js');

beforeEach(() => {
  // render() bails out the instant its two root elements are missing, so a
  // document that returns null for everything makes renderInbox() a safe,
  // DOM-free way to set the module's `cache` (this repo's test setup has no
  // jsdom — see my-house.test.js for the same constraint elsewhere).
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  setProjectSamoDept.mockReset();
});

afterEach(() => {
  delete globalThis.document;
});

// The server, as 0216's set_project_samo_dept behaves: it applies ONE add or
// remove to the tags as they are on the server NOW (row lock), never to the
// caller's copy.
function fakeServer(initial) {
  const server = { tags: [...initial] };
  setProjectSamoDept.mockImplementation(async (projectId, dept, on) => {
    const set = new Set(server.tags);
    if (on) set.add(dept); else set.delete(dept);
    server.tags = [...set].sort();
    return { id: projectId, samo_depts: server.tags };
  });
  return server;
}

describe('onToggleProjectDept — one change per click, applied by the database', () => {
  it('two chips clicked before the first round trip lands: both tags survive', async () => {
    const server = fakeServer([]);
    mountInbox({ onChanged: async () => renderInbox({ projects: [{ id: 'P1', samo_depts: server.tags }] }) });
    renderInbox({ projects: [{ id: 'P1', samo_depts: [] }], role: 'vp_admin', docTypes: [], settings: {} });

    const a = { dataset: { projectsToggleDept: 'P1', dept: 'office' }, disabled: false };
    const b = { dataset: { projectsToggleDept: 'P1', dept: 'academic' }, disabled: false };
    await Promise.all([onToggleProjectDept(a), onToggleProjectDept(b)]);

    expect(server.tags).toEqual(['academic', 'office']);
    expect(setProjectSamoDept.mock.calls.map((c) => c.slice(1))).toEqual([['office', true], ['academic', true]]);
  });

  it('ANOTHER PERSON tagged the same โครงการ after this tab loaded: their tag is not erased', async () => {
    // This tab loaded the โครงการ untagged; meanwhile someone else added `rt`.
    const server = fakeServer(['rt']);
    mountInbox({ onChanged: async () => {} });               // even with no reload in between
    renderInbox({ projects: [{ id: 'P1', samo_depts: [] }], role: 'vp_admin', docTypes: [], settings: {} });

    await onToggleProjectDept({ dataset: { projectsToggleDept: 'P1', dept: 'office' }, disabled: false });

    expect(server.tags).toEqual(['office', 'rt']);           // whole-array writes left ['office']
  });

  it('clicking an active chip removes that ฝ่าย only', async () => {
    const server = fakeServer(['office', 'rt']);
    mountInbox({ onChanged: async () => {} });
    renderInbox({ projects: [{ id: 'P1', samo_depts: ['office'] }], role: 'vp_admin', docTypes: [], settings: {} });

    await onToggleProjectDept({ dataset: { projectsToggleDept: 'P1', dept: 'office' }, disabled: false });

    expect(setProjectSamoDept).toHaveBeenCalledWith('P1', 'office', false);
    expect(server.tags).toEqual(['rt']);
  });
});
