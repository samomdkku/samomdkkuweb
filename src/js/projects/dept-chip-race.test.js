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
  setProjectSamoDepts: vi.fn(),
}));

const { setProjectSamoDepts } = await import('./api.js');
const { renderInbox, mountInbox, onToggleProjectDept } = await import('./inbox.js');

beforeEach(() => {
  // render() bails out the instant its two root elements are missing, so a
  // document that returns null for everything makes renderInbox() a safe,
  // DOM-free way to set the module's `cache` (this repo's test setup has no
  // jsdom — see my-house.test.js for the same constraint elsewhere).
  globalThis.document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  setProjectSamoDepts.mockReset();
});

afterEach(() => {
  delete globalThis.document;
});

describe('onToggleProjectDept — two chips, one โครงการ', () => {
  it('both tags survive even when the second chip is clicked before the first round trip lands', async () => {
    let serverDepts = [];
    // Stands in for the real RPC + reloadProjects(): records whatever the
    // call wrote, and onChanged() (below) reflects it back into cache so the
    // NEXT queued toggle reads the updated array, not the original one.
    setProjectSamoDepts.mockImplementation(async (projectId, depts) => {
      serverDepts = depts;
      return {};
    });
    mountInbox({
      onChanged: async () => {
        renderInbox({ projects: [{ id: 'P1', samo_depts: serverDepts }] });
      },
    });
    renderInbox({ projects: [{ id: 'P1', samo_depts: [] }], role: 'vp_admin', docTypes: [], settings: {} });

    const chipSE = { dataset: { projectsToggleDept: 'P1', dept: 'SE' }, disabled: false };
    const chipNS = { dataset: { projectsToggleDept: 'P1', dept: 'นายกสโม' }, disabled: false };

    // Fired back-to-back, synchronously — before either's setProjectSamoDepts
    // call has resolved. A user double-clicking two chips in quick succession.
    const p1 = onToggleProjectDept(chipSE);
    const p2 = onToggleProjectDept(chipNS);
    await Promise.all([p1, p2]);

    expect([...serverDepts].sort()).toEqual(['SE', 'นายกสโม'].sort());
    expect(setProjectSamoDepts).toHaveBeenCalledTimes(2);
  });
});
