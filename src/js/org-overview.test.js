// ==============================================
// ภาพรวม — what the one-screen view CLAIMS about the organisation.
//
// The view draws three facts per ฝ่าย: who heads it, what it contains, and how
// many people are in it. Each is DERIVED, and each has a wrong answer that
// would render perfectly:
//
//   • the head must be the first seat of the TOP ระดับ — not the first child
//     (a sub-ฝ่าย can sort first in stored order) and not ระดับ 1 literally
//     (several live ฝ่าย start at 2 or 3; see org-chart.js childrenHtml).
//   • a ฝ่าย with NO seat has no head. Promoting someone from a sub-ฝ่าย would
//     put a stranger's face on a hospital group.
//   • the apex is the first ROOT, by position — the same "position 0 is the
//     head" rule the other three views use, so no Thai name list decides it.
//
// TO CHECK THIS GUARD ACTUALLY GUARDS: in overviewModel, replace
// `rungs[0][1][0]` with `(byParent.get(node.id) || [])[0]` and watch the
// ระดับ assertion fail. Then put it back.
// ==============================================
import { describe, it, expect } from 'vitest';
import { overviewModel, overviewHtml, tileMeta } from './org-overview.js';
import { sortSiblings } from './org-rung.js';

function fixture(nodes, members) {
  const byParent = new Map();
  for (const n of nodes) {
    const k = n.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  for (const b of byParent.values()) { b.sort((a, c) => a.position - c.position); sortSiblings(b); }
  const byNode = new Map();
  for (const m of members) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }
  const subStats = new Map();
  const walk = (id) => {
    let people = (byNode.get(id) || []).length;
    for (const c of byParent.get(id) || []) people += walk(c.id);
    subStats.set(id, { people });
    return people;
  };
  for (const r of byParent.get('') || []) walk(r.id);
  return { roots: byParent.get('') || [], byParent, byNode, subStats };
}

const div = (id, parent, position, name = id) => ({ id, parent_id: parent, position, kind: 'division', name, tier: null });
const seat = (id, parent, position, tier = null, name = id) => ({ id, parent_id: parent, position, kind: 'role', name, tier });
const person = (node_id, name) => ({ node_id, name, nickname: '', photo_url: '' });

const NODES = [
  div('office', null, 0, 'สำนักนายกฯ'),
  seat('president', 'office', 0, null, 'นายกสโมสรนักศึกษาฯ'),
  div('digital', null, 1, 'ฝ่ายดิจิทัล'),
  // stored FIRST, but a sub-ฝ่าย — the head is still the seat
  div('it', 'digital', 0, 'ฝ่าย IT'),
  // the top ระดับ here is 2, not 1 — and its seat is stored AFTER a ระดับ 3
  // one, so "first seat by position" and "head" give different answers
  seat('deputy', 'digital', 1, 3, 'เลขาฯ'),
  seat('vp', 'digital', 2, 2, 'อุปนายกฝ่ายดิจิทัล'),
  seat('dev', 'it', 0, null, 'Developer'),
  div('hosp', null, 2, 'ฝ่าย รพ. ร่วมผลิต'),
  div('kk', 'hosp', 0, 'รพ. ขอนแก่น'),
  seat('kkhead', 'kk', 0, null, 'หัวหน้า'),
];
const MEMBERS = [
  person('president', 'นายก'),
  person('vp', 'อุปนายก'),
  person('deputy', 'เลขา'),
  person('dev', 'dev1'),
  person('dev', 'dev2'),
  person('kkhead', 'หมอ'),
];

describe('overviewModel', () => {
  const model = overviewModel(fixture(NODES, MEMBERS));

  it('the apex is the first root, drawn as its head seat', () => {
    expect(model.apex.node.id).toBe('office');
    expect(model.apex.seat.id).toBe('president');
    expect(model.tiles.map((t) => t.node.id)).toEqual(['digital', 'hosp']);
  });

  it('a ฝ่าย is headed by the first seat of its TOP ระดับ, whatever number that is', () => {
    const digital = model.tiles[0];
    expect(digital.seat.id).toBe('vp');
    expect(digital.holders.map((m) => m.name)).toEqual(['อุปนายก']);
    expect(digital.units.map((u) => u.id)).toEqual(['it']);
    expect(digital.people).toBe(4);
  });

  it('a ฝ่าย with no seat of its own has no head — nobody is promoted from below', () => {
    const hosp = model.tiles[1];
    expect(hosp.seat).toBeNull();
    expect(hosp.holders).toEqual([]);
    expect(hosp.units.map((u) => u.id)).toEqual(['kk']);
  });

  it('a single root is the organisation: its sub-ฝ่าย become the tiles', () => {
    const one = overviewModel(fixture(
      [div('org', null, 0), seat('head', 'org', 0), div('a', 'org', 1), div('b', 'org', 2)],
      [person('head', 'x')],
    ));
    expect(one.apex.node.id).toBe('org');
    expect(one.tiles.map((t) => t.node.id)).toEqual(['a', 'b']);
  });

  it('no data, no apex', () => {
    expect(overviewModel(fixture([], [])).apex).toBeNull();
  });
});

describe('tileMeta', () => {
  it('says what is inside in the words a visitor uses', () => {
    expect(tileMeta({ units: [1, 2, 3], people: 40 })).toBe('3 ฝ่ายย่อย · 40 คน');
    expect(tileMeta({ units: [], people: 3 })).toBe('3 คน');
    expect(tileMeta({ units: [], people: 0 })).toBe('ยังไม่มีสมาชิก');
  });
});

describe('overviewHtml', () => {
  const data = fixture(NODES, MEMBERS);
  const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  it('every ฝ่าย is a button that names the node it opens', () => {
    const html = overviewHtml(overviewModel(data), { filter: null, hitsOf: () => 0, hl: esc });
    for (const id of ['office', 'digital', 'hosp']) expect(html).toContain(`data-org-open="${id}"`);
  });

  it('a search DIMS the tiles it missed rather than dropping them', () => {
    const filter = { keepNodes: new Set(['digital', 'vp']), keepMembers: new Set(), q: 'x' };
    const html = overviewHtml(overviewModel(data), { filter, hitsOf: (n) => (n.id === 'digital' ? 1 : 0), hl: esc });
    expect(html).toContain('data-org-open="hosp"');
    expect(html).toMatch(/orgo-tile is-dim" data-org-open="hosp"/);
    expect(html).not.toMatch(/orgo-tile is-dim" data-org-open="digital"/);
    expect(html).toContain('พบ 1 คน');
  });
});
