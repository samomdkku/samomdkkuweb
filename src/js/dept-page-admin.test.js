// ============================================================
// dept-page-admin.test.js — the re-entry trap on the หน้าฝ่าย editor.
//
// THE BUG. admin-main.js calls initDeptPageAdmin(authGetUser()) on EVERY
// entry into the section — including clicking the already-open sidebar item
// again, or coming back from another admin tab after a glance. Before this
// fix, the picker was reset to the FIRST ฝ่าย in the list and refresh(root)
// re-fetched + repainted #dpaRows unconditionally, every single time — so a
// staff account that manages several ฝ่าย (the blanket `dept_pages`/`master`
// grant) had its dept selection silently snapped back, and anything typed but
// not yet saved in the form was discarded with no warning. Every other admin
// workspace in this app (team/index.js, house/index.js) uses a "load once,
// re-entry is a no-op" flag for exactly this reason.
//
// No jsdom in this repo's test setup (see my-house.test.js), so this pins the
// behaviour with a minimal hand-built DOM stand-in, not a real browser.
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./db.js', () => ({ dbRest: vi.fn(async () => ({ data: [], error: null })) }));

const { dbRest } = await import('./db.js');
const { initDeptPageAdmin, editableDepts } = await import('./dept-page-admin.js');
const { DEPT_OPTIONS } = await import('../data/depts.js');

/** A bare element stand-in — only the members this module actually touches. */
function el() {
  return {
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
  };
}

describe('หน้าฝ่าย editor — re-entry by the same account', () => {
  const user = { id: 'staff-1', role: 'dev' }; // blanket grant: editableDepts() returns every ฝ่าย

  let root;
  let children;

  beforeEach(() => {
    dbRest.mockClear();
    children = {
      '#dpaDept': el(),
      '#dpaOnly': el(),
      '#dpaBody': el(),
      '#dpaRows': el(),
      '#dpaPreview': el(),
      '#dpaStatus': el(),
    };
    root = {
      dataset: {},
      querySelector: (sel) => children[sel] || null,
      querySelectorAll: () => [],
      addEventListener() {},
    };
    globalThis.document = { querySelector: () => root };
    globalThis.window = globalThis.window || { addEventListener() {} };
  });

  afterEach(() => {
    delete globalThis.document;
  });

  it('precondition: a blanket-grant account can manage more than one ฝ่าย', () => {
    expect(editableDepts(user).length).toBeGreaterThan(1);
  });

  it('does not re-fetch dept_content on a same-account re-entry', async () => {
    await initDeptPageAdmin(user);
    const callsAfterFirstEntry = dbRest.mock.calls.length;
    expect(callsAfterFirstEntry).toBeGreaterThan(0);

    // The user picks the SECOND ฝ่าย before navigating away — a real pick
    // fires `change`, which is what moves the editor's state.
    children['#dpaDept'].value = DEPT_OPTIONS[1].value;
    for (const fn of children['#dpaDept'].listeners.change || []) fn();
    const callsAfterPick = dbRest.mock.calls.length;

    // Re-entry: sidebar click on the already-open section, or coming back
    // from another admin tab. Same account, same page instance.
    await initDeptPageAdmin(user);

    // Nothing loaded again, so nothing could have overwritten the picker's
    // value or the unsaved rows underneath it — though the LIST was rebuilt.
    expect(dbRest.mock.calls.length).toBe(callsAfterPick);
    expect(children['#dpaDept'].value).toBe(DEPT_OPTIONS[1].value);
  });

  it('does reinitialize for a genuinely different account', async () => {
    await initDeptPageAdmin(user);
    const callsAfterFirstEntry = dbRest.mock.calls.length;
    await initDeptPageAdmin({ id: 'staff-2', role: 'dev' });
    expect(dbRest.mock.calls.length).toBeGreaterThan(callsAfterFirstEntry);
  });

  it('attaches its handlers ONCE, even when a different account enters', async () => {
    // A second account falling through to the wiring attached every handler
    // again — one Save click then ran save() twice (code review, 2026-10-13).
    await initDeptPageAdmin(user);
    await initDeptPageAdmin({ id: 'staff-2', role: 'dev' });
    await initDeptPageAdmin(user);
    expect((children['#dpaDept'].listeners.change || []).length).toBe(1);
  });
});
