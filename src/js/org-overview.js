// org-overview.js — ภาพรวม, the fourth view on the ทีม SAMO page.
//
// REQUESTED: the ผังรวม canvas "is good but i want to be able to see like this
// without having to scroll, for people to see easily". The other three views
// all answer "show me everything" and pay for it in length or panning — 298
// ตำแหน่ง and 448 people do not fit on a screen at any density a person can
// read. This one answers a smaller question on purpose: WHAT IS SAMO MADE OF,
// AND WHO RUNS EACH PART. On a big screen that is one screen; a laptop or
// phone scrolls a little, because two owner choices outrank fitting: every
// ฝ่ายย่อย head is shown, and the layout is one aligned grid that stays put
// when the data changes (org-overview.css, `.orgo-grid`).
//
//   • the apex     the first root ฝ่าย (สำนักนายกฯ), drawn as its head seat —
//                  นายกสโมสร — because that is who the organisation reports to.
//   • one tile per remaining root ฝ่าย, each carrying its head's face, its
//                  sub-ฝ่าย by name and its head-count.
//
// Everything below a tile is one tap away, in a sheet (org-sheet.js) that
// renders the ฝ่าย with แผนผัง's own markup. Overview, then detail: the page
// never has to scroll and nothing is unreachable.
//
// "FIRST ROOT IS THE APEX" is the same fact every other view relies on —
// `position` 0 is the head (org-rung.js `chartParentage`). No list of Thai
// names decides it, so renaming สำนักนายกฯ changes nothing here.
//
// EVERY ฝ่ายย่อย SHOWS ITS HEAD, by one rule. REQUESTED by the หัวหน้าฝ่าย IT:
// the overview showed only อุปนายก, so the heads of the ฝ่ายย่อย — who carry
// most of the actual work — were invisible until a tap. The ask came with its
// own constraint: "if i standout too much that it doesnt makesense i might get
// sideeye". So nobody is singled out. Each tile lists its ฝ่ายย่อย, and EVERY
// row carries that ฝ่ายย่อย's head — the same size, the same weight, one step
// below the อุปนายก above them (a small face and a ชื่อเล่น, against a portrait
// and a full name). Rank stays in the layout, exactly as on แผนผัง; the rule is
// what makes it fair. `headOf` is that rule's ONE home — the tile's อุปนายก,
// every ฝ่ายย่อย row and the sheet's collapsed rows all ask it.
//
// LAYOUT IS CSS's JOB, not this file's (org-overview.css): one aligned grid on
// every device, in the ฝ่าย order, so a ฝ่าย added later lands at the end and
// nothing else moves. A script-placed masonry was tried and removed — the
// `.orgo-grid` note says why. This module emits the same markup at every width.
import { escHtml } from './utils.js';
import { faceHtml, TREE_SHAPE } from './org-face.js';
import { orderChildren } from './org-rung.js';
import { isDivision } from './node-kind.js';
import { tintColor } from './dept-tint.js';

/**
 * What the overview draws, from the indexes org-chart.js already holds.
 *
 * Pure — no DOM — so org-overview.test.js can hand it a fixture.
 *
 * The HEAD of a ฝ่าย is the first seat of its top ระดับ: the same seat
 * `chartParentage` hangs the sub-ฝ่าย off, so the face on a tile is the person
 * the canvas draws the lines from. A ฝ่าย with no seats at all (ฝ่าย รพ.
 * ร่วมผลิต is three hospitals and no head) has no face — the tile shows its
 * sub-ฝ่าย instead, rather than inventing a leader.
 *
 * ONE ROOT is the organisation itself: it becomes the apex and its sub-ฝ่าย the
 * tiles, so an archive year stored under a single top box still reads as a map
 * rather than as one tile.
 */
export function headOf(node, byParent, byNode) {
  const { rungs, units } = orderChildren(byParent.get(node.id) || [], isDivision(node.kind));
  const seat = rungs.length ? rungs[0][1][0] : null;
  return { seat, holders: seat ? (byNode.get(seat.id) || []) : [], units };
}

export function overviewModel({ roots, byParent, byNode, subStats }) {
  const card = (node, isRoot) => {
    const { seat, holders, units } = headOf(node, byParent, byNode);
    return {
      node,
      tint: tintColor(node, isRoot),
      seat,
      holders,
      units,
      // Each ฝ่ายย่อย with ITS head — the same question asked one level down.
      subs: units.map((u) => ({ node: u, ...headOf(u, byParent, byNode) })),
      people: subStats.get(node.id)?.people || 0,
    };
  };
  if (!roots.length) return { apex: null, tiles: [] };
  if (roots.length === 1) {
    const apex = card(roots[0], true);
    return { apex, tiles: apex.units.map((u) => card(u, false)) };
  }
  const [first, ...rest] = roots;
  return { apex: card(first, true), tiles: rest.map((n) => card(n, true)) };
}

/**
 * A ฝ่ายย่อย's name as a row has room for it: "ฝ่าย IT (Information
 * Technology)" → "IT". The leading ฝ่าย says nothing inside a list headed
 * ฝ่ายย่อย, and the parenthesis is a translation. Display only — the sheet and
 * every other view show the stored name.
 */
export function shortUnitName(name) {
  const bare = String(name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const cut = bare.replace(/^ฝ่าย\s*/, '');
  return cut || bare;
}

/** What a row calls a person: the ชื่อเล่น everyone uses, else the first name. */
export function callName(m) {
  if (!m) return '';
  return (m.nickname || '').trim() || String(m.name || '').trim().split(/\s+/)[0] || '';
}

/** "4 ฝ่ายย่อย · 42 คน" — what is inside, in the words a visitor uses. */
export function tileMeta({ units, people }) {
  const bits = [];
  if (units.length) bits.push(`${units.length} ฝ่ายย่อย`);
  bits.push(people ? `${people} คน` : 'ยังไม่มีสมาชิก');
  return bits.join(' · ');
}

function leadHtml(c, hl, extra = '') {
  const m = c.holders[0];
  if (!c.seat) return '';
  const more = c.holders.length > 1 ? ` <span class="orgo-lead-more">+${c.holders.length - 1}</span>` : '';
  const who = m
    ? `${hl(m.name || '')}${m.nickname ? ` <span class="orgo-lead-nick">${hl(m.nickname)}</span>` : ''}${more}`
    : '<span class="orgo-lead-nick">ยังไม่มีสมาชิก</span>';
  return `
      <span class="orgo-lead">
        <span class="org-face orgo-face">${m ? faceHtml(m, TREE_SHAPE) : '<span class="org-face-initials" aria-hidden="true">—</span>'}</span>
        <span class="orgo-lead-text">
          <span class="orgo-lead-name">${who}</span>
          <span class="orgo-lead-role">${hl(c.seat.name || '')}</span>${extra}
        </span>
      </span>`;
}

/**
 * Every ฝ่ายย่อย, one row each — its name and the ชื่อเล่น of its head — ALL
 * of them.
 *
 * ALL, and that is the owner's rule, not a layout default: an earlier version
 * showed three and "และอีก N ฝ่ายย่อย", and the answer was "people would be
 * น้อยใจ". A list that names some heads and counts the rest ranks them, by
 * nothing but the order an admin happened to type. So every row is here, and
 * the TILE is as tall as its rows (the grid is a masonry of columns;
 * org-overview.css says why that fits and a row-aligned grid did not).
 *
 * WHEN THE TEXT IS LONG, the ฝ่ายย่อย's name gives way and the PERSON's does
 * not: the name is shortened (`shortUnitName`) and then ellipsised, the ชื่อเล่น
 * never shrinks. Cutting "แพรหวาน" to "แพรห…" cut a person; cutting
 * "กิจกรรมมหาวิทยาลัยและจิตอาสา" cuts a label whose full form is one tap away
 * in the sheet. A ฝ่ายย่อย with nobody in its head seat still gets its row.
 */
/**
 * More ฝ่ายย่อย than this and the tile is WIDE: two grid columns, its rows in
 * two columns inside — the iOS widget sizes, small and medium in one grid. In an
 * aligned grid a row is as tall as its tallest tile, and ฝ่ายเวชนิทัศน์'s nine
 * rows left ~200px of nothing in each of four neighbours (measured, 1440 wide).
 * Wide, nine rows are five, level with a four-row tile. A rule about CONTENT,
 * not about which ฝ่าย, so it holds when the next ฝ่าย grows.
 */
export const WIDE_SUBS = 5;

function subFace(m) {
  return m
    ? `<span class="org-face orgo-sub-face">${faceHtml(m, TREE_SHAPE)}</span>`
    : '<span class="orgo-sub-face is-empty" aria-hidden="true"></span>';
}
function subsHtml(c, hl) {
  if (!c.subs.length) return '';
  return `<span class="orgo-subs">${c.subs.map((s) => {
    const m = s.holders[0];
    return `<span class="orgo-sub">${subFace(m)}<span class="orgo-sub-name">${
      hl(shortUnitName(s.node.name))}</span>${
      m ? `<span class="orgo-sub-who">${hl(callName(m))}</span>` : ''}</span>`;
  }).join('')}</span>`;
}

/**
 * @param model   overviewModel()'s result
 * @param filter  the page's search, or null. A tile with no hit DIMS rather than
 *                disappearing: the point of this view is the whole shape, and
 *                a map that drops eleven of its twelve regions is not a map.
 * @param hitsOf  node → how many people under it matched the search
 * @param hl      the page's highlighter, (text) → safe HTML
 */
export function overviewHtml(model, { filter, hitsOf, hl }) {
  const { apex, tiles } = model;
  if (!apex) return '';
  const metaOf = (c) => {
    if (!filter) return escHtml(tileMeta(c));
    const n = hitsOf(c.node);
    return n ? `<span class="orgo-hit">พบ ${n} คน</span>` : 'ไม่พบ';
  };
  // THE TILE SAYS WHAT A TAP DOES. Owner: "a good design should make user know
  // กดที่ฝ่ายเพื่อดูทุกตำแหน่งและทุกคนในฝ่ายนั้น not just by the text". There was a
  // sentence above the map saying so, and the tiles' only tap cue — a chevron
  // in the count line — was hidden on most screens to save height. Now every
  // tile ENDS with a disclosure — "40 คน ›", right-aligned — the one line never
  // dropped. The sentence is gone; the tiles say it.
  //
  // NO VERB on screen. The first version read "ดูทุกคน · 40 คน ›"; asked "does
  // it need to say ดูทุกคน", no: a trailing value + chevron is the platform's
  // own "tap to go in" (iOS Settings: "Storage 12 GB ›"), and one verb printed
  // twelve times is noise after the first. The verb stays for a SCREEN READER,
  // which gets no chevron to read.
  const ctaOf = (c) => {
    if (filter) {
      const n = hitsOf(c.node);
      return n ? `<span class="orgo-hit">พบ ${n} คน</span>` : 'ไม่พบ';
    }
    return c.people
      ? `<span class="orgo-sr">ดูทุกคน </span>${c.people} คน`
      : 'ยังไม่มีสมาชิก';
  };
  const dim = (c) => (filter && !filter.keepNodes.has(c.node.id) ? ' is-dim' : '');
  const tint = (c) => (c.tint ? ` style="--org-tint:${escHtml(c.tint)}"` : '');

  const apexHtml = `
    <button type="button" class="orgo-apex${dim(apex)}" data-org-open="${escHtml(apex.node.id)}"
      aria-haspopup="dialog"${tint(apex)}>
      ${leadHtml(apex, hl, `<span class="orgo-apex-meta">${hl(apex.node.name || '')} · ${metaOf(apex)}</span>`)
        || `<span class="orgo-tile-name">${hl(apex.node.name || '')}</span>`}
      <i class="bi bi-chevron-right orgo-chev" aria-hidden="true"></i>
    </button>`;

  const tileHtml = (c, i) => `
      <li class="orgo-cell${c.subs.length > WIDE_SUBS ? ' is-wide' : ''}" style="--i:${i}">
        <button type="button" class="orgo-tile${dim(c)}" data-org-open="${escHtml(c.node.id)}"
          aria-haspopup="dialog"${tint(c)}>
          <span class="orgo-tile-name">${hl(c.node.name || '')}</span>
          ${leadHtml(c, hl)}
          ${subsHtml(c, hl)}
          <span class="orgo-cta">${ctaOf(c)}<i class="bi bi-chevron-right orgo-chev" aria-hidden="true"></i></span>
        </button>
      </li>`;

  return `
    <div class="orgo" data-view="overview">
      ${apexHtml}
      ${tiles.length ? `<span class="orgo-stem" aria-hidden="true"></span>
      <ul class="orgo-grid" aria-label="ฝ่ายทั้งหมด">${tiles.map(tileHtml).join('')}</ul>` : ''}
    </div>`;
}
