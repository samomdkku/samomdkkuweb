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
//   • EVERY ฝ่ายย่อย head is on the tile. The owner turned down "three, then
//     และอีก N ฝ่ายย่อย": "people would be น้อยใจ". So the assertion is the
//     PROPERTY — each sub-ฝ่าย with a holder has a chip — not a count.
//
// TO CHECK THIS GUARD ACTUALLY GUARDS: in overviewModel, replace
// `rungs[0][1][0]` with `(byParent.get(node.id) || [])[0]` and watch the
// ระดับ assertion fail. Then put it back.
// ==============================================
import { describe, it, expect } from 'vitest';
import {
  overviewModel, overviewHtml, tileMeta, shortUnitName, callName, rowOrder, columnOrder,
} from './org-overview.js';
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

const NODES_SUBS = (n) => Array.from({ length: n }, (_, i) => [
  div(`sub${i}`, 'big', i, `ฝ่ายย่อย${i}`),
  seat(`sub${i}h`, `sub${i}`, 0),
]).flat();

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

describe('every ฝ่ายย่อย head is on the tile — nobody behind a "+N"', () => {
  it('nine ฝ่ายย่อย, nine rows, and no และอีก', () => {
    const nodes = [div('office', null, 0), seat('p', 'office', 0),
      div('big', null, 1), seat('bighead', 'big', 0), ...NODES_SUBS(9)];
    const members = [person('p', 'P'), person('bighead', 'H'),
      ...Array.from({ length: 9 }, (_, i) => ({ ...person(`sub${i}h`, `คน${i}`), nickname: `nick${i}` }))];
    const html = overviewHtml(overviewModel(fixture(nodes, members)),
      { filter: null, hitsOf: () => 0, hl: (t) => t });
    for (let i = 0; i < 9; i++) expect(html).toContain(`>nick${i}<`);
    expect(html).not.toMatch(/และอีก|\+\d/);
  });

  it('the digital tile names PR, ComArt and IT heads alike', () => {
    const model = overviewModel(fixture(NODES, MEMBERS));
    expect(model.tiles[0].subs.map((x) => x.holders[0]?.name)).toEqual(['dev1']);
  });
});

describe('shortUnitName / callName', () => {
  it('drops the leading ฝ่าย and a trailing translation, never to nothing', () => {
    expect(shortUnitName('ฝ่าย IT (Information Technology)')).toBe('IT');
    expect(shortUnitName('ฝ่ายวิชาการ')).toBe('วิชาการ');
    expect(shortUnitName('รพ. ขอนแก่น')).toBe('รพ. ขอนแก่น');
    expect(shortUnitName('ฝ่าย')).toBe('ฝ่าย');
  });
  it('a person is called by ชื่อเล่น, else their first name', () => {
    expect(callName({ name: 'ภูริพัฒณ์ มหาพรหมรักษ์', nickname: 'เอิง' })).toBe('เอิง');
    expect(callName({ name: 'ภูริพัฒณ์ มหาพรหมรักษ์', nickname: '' })).toBe('ภูริพัฒณ์');
  });
});

describe('the tile says what a tap does — no hint sentence needed', () => {
  it('every tile ENDS with the disclosure: the count and a chevron — the verb for screen readers only', () => {
    const html = overviewHtml(overviewModel(fixture(NODES, MEMBERS)),
      { filter: null, hitsOf: () => 0, hl: (t) => t });
    const tiles = html.split('class="orgo-cell"').slice(1);
    expect(tiles.length).toBe(2);
    for (const t of tiles) {
      expect(t).toMatch(/class="orgo-cta">(<span class="orgo-sr">ดูทุกคน <\/span>\d+ คน|ยังไม่มีสมาชิก)<i class="bi bi-chevron-right/);
    }
    expect(html).not.toContain('orgo-hint');
  });
});

describe('placing the tiles', () => {
  const tallest = (h, a, k) => {
    const t = Array(k).fill(0);
    h.forEach((x, i) => { t[a[i]] += x; });
    return Math.max(...t);
  };

  it('ROWS: the first row reads left to right, then each tile takes the shortest column', () => {
    expect(rowOrder([100, 100, 100, 50, 100], 3)).toEqual([0, 1, 2, 0, 1]);
  });

  it('COLUMNS: contiguous runs in order, and the tallest column as short as it can be', () => {
    const h = [223, 200, 223, 200, 200, 200, 223, 200, 200, 339, 143, 118];
    const a = columnOrder(h, 5);
    // contiguous and in order: never steps back to an earlier column
    for (let i = 1; i < a.length; i++) expect(a[i] - a[i - 1]).toBeGreaterThanOrEqual(0);
    // optimal: brute force over every contiguous 5-way split agrees
    let best = Infinity;
    const n = h.length;
    const rec = (start, cols, worst) => {
      if (cols === 1) { best = Math.min(best, Math.max(worst, h.slice(start).reduce((x, y) => x + y, 0))); return; }
      let run = 0;
      for (let end = start + 1; end <= n - cols + 1; end++) {
        run += h[end - 1];
        rec(end, cols - 1, Math.max(worst, run));
      }
    };
    rec(0, 5, 0);
    expect(tallest(h, a, 5)).toBe(best);
  });

  it('fewer tiles than columns: each gets its own, nothing out of range', () => {
    expect(columnOrder([10, 20], 5)).toEqual([0, 1]);
    expect(rowOrder([10, 20], 5)).toEqual([0, 1]);
  });
});
