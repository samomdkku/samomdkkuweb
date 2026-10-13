// ============================================================
// projects-view-restale.test.js — the public ฝ่ายโครงการ mirror never
// refreshed after its first load.
//
// THE BUG. bootIfNeeded() set its own `initialised` flag on the FIRST call
// and returned immediately on every later one — including every later
// shown.bs.tab on the same page. mountCustomerProjects() (projects/index.js)
// already has the correct re-show behaviour built in (its OWN
// customerInitialised flag re-fetches via reloadProjects() instead of
// re-running first-mount setup) — but with no caller ever reaching that
// branch a second time, it was dead code. Concretely: a visitor opens the
// public หนังสือโครงการ tab, an admin tags/untags a project's ฝ่ายสโม or
// flips its visibility, the visitor switches tabs and back — they keep
// seeing the pre-change state for the rest of the session, with no
// realtime subscription to ever correct it.
//
// No jsdom in this repo's test setup (see my-house.test.js /
// dept-page-admin.test.js), so this pins the behaviour with a minimal
// hand-built DOM stand-in and a captured shown.bs.tab listener, not a real
// browser.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./projects/index.js', () => ({ mountCustomerProjects: vi.fn(async () => {}) }));

const { mountCustomerProjects } = await import('./projects/index.js');

describe('the public projects-view tab refreshes on every re-show, not just the first', () => {
  let listeners;
  let grid;

  beforeEach(() => {
    mountCustomerProjects.mockClear();
    listeners = {};
    grid = { childElementCount: 0, innerHTML: '' };
    globalThis.document = {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      getElementById: (id) => (id === 'projectsGrid' ? grid : null),
    };
    globalThis.window = globalThis.window || {};
  });

  afterEach(() => {
    delete globalThis.document;
  });

  it('calls mountCustomerProjects again on a second shown.bs.tab, not just the first', async () => {
    const { initProjectsView } = await import('./projects-view.js');
    initProjectsView();
    const onShown = listeners['shown.bs.tab'];
    expect(onShown).toBeTypeOf('function');

    await onShown({ target: { id: 'pills-projects-view-tab' } });
    expect(mountCustomerProjects).toHaveBeenCalledTimes(1);

    // Re-entry: the visitor switched away and back. Before the fix this was
    // swallowed by projects-view.js's own `initialised` guard and
    // mountCustomerProjects() — hence its internal refresh-from-cache
    // branch — was never called a second time.
    await onShown({ target: { id: 'pills-projects-view-tab' } });
    expect(mountCustomerProjects).toHaveBeenCalledTimes(2);

    await onShown({ target: { id: 'pills-projects-view-tab' } });
    expect(mountCustomerProjects).toHaveBeenCalledTimes(3);
  });

  it('ignores a shown.bs.tab for a different tab', async () => {
    const { initProjectsView } = await import('./projects-view.js');
    initProjectsView();
    const onShown = listeners['shown.bs.tab'];
    await onShown({ target: { id: 'pills-shop-tab' } });
    expect(mountCustomerProjects).not.toHaveBeenCalled();
  });
});
