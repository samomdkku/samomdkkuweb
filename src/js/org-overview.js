// org-overview.js — ภาพรวม, the fourth view on the ทีม SAMO page.
//
// REQUESTED: the ผังรวม canvas "is good but i want to be able to see like this
// without having to scroll, for people to see easily". The other three views
// all answer "show me everything" and pay for it in length or panning — 298
// ตำแหน่ง and 448 people do not fit on a screen at any density a person can
// read. This one answers a smaller question on purpose: WHAT IS SAMO MADE OF,
// AND WHO RUNS EACH PART. That fits.
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
// FITTING THE SCREEN IS CSS's JOB, not this file's (org-overview.css): the stage
// is one viewport tall and each tile is a size container, so a tile shows its
// sub-ฝ่าย list only when it has the room. This module emits the same markup
// at every width.
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
export function overviewModel({ roots, byParent, byNode, subStats }) {
  const card = (node, isRoot) => {
    const { rungs, units } = orderChildren(byParent.get(node.id) || [], isDivision(node.kind));
    const seat = rungs.length ? rungs[0][1][0] : null;
    return {
      node,
      tint: tintColor(node, isRoot),
      seat,
      holders: seat ? (byNode.get(seat.id) || []) : [],
      units,
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

/** "4 ฝ่ายย่อย · 42 คน" — what is inside, in the words a visitor uses. */
export function tileMeta({ units, people }) {
  const bits = [];
  if (units.length) bits.push(`${units.length} ฝ่ายย่อย`);
  bits.push(people ? `${people} คน` : 'ยังไม่มีสมาชิก');
  return bits.join(' · ');
}

function leadHtml(c, hl) {
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
          <span class="orgo-lead-role">${hl(c.seat.name || '')}</span>
        </span>
      </span>`;
}

/** A few sub-ฝ่าย by name and a "+N" for the rest. A FIXED count rather than
 *  as-many-as-fit: CSS clips a wrapping row mid-line and cannot say how much
 *  it hid, which read as a broken tile. The sheet lists them all. */
const UNIT_CHIPS = 2;
function unitsHtml(c, hl) {
  if (!c.units.length) return '';
  const cap = c.seat ? UNIT_CHIPS : UNIT_CHIPS + 1;
  const shown = c.units.length > cap + 1 ? c.units.slice(0, cap) : c.units;
  const rest = c.units.length - shown.length;
  return `<span class="orgo-units${c.seat ? '' : ' is-primary'}">${
    shown.map((u) => `<span class="orgo-unit">${hl(u.name || '')}</span>`).join('')
  }${rest ? `<span class="orgo-unit is-more">+${rest}</span>` : ''}</span>`;
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
  const dim = (c) => (filter && !filter.keepNodes.has(c.node.id) ? ' is-dim' : '');
  const tint = (c) => (c.tint ? ` style="--org-tint:${escHtml(c.tint)}"` : '');

  const apexHtml = `
    <button type="button" class="orgo-apex${dim(apex)}" data-org-open="${escHtml(apex.node.id)}"
      aria-haspopup="dialog"${tint(apex)}>
      ${leadHtml(apex, hl) || `<span class="orgo-tile-name">${hl(apex.node.name || '')}</span>`}
      <span class="orgo-apex-meta">${hl(apex.node.name || '')} · ${metaOf(apex)}</span>
      <i class="bi bi-chevron-right orgo-chev" aria-hidden="true"></i>
    </button>`;

  const tileHtml = (c, i) => `
      <li class="orgo-cell" style="--i:${i}">
        <button type="button" class="orgo-tile${dim(c)}" data-org-open="${escHtml(c.node.id)}"
          aria-haspopup="dialog"${tint(c)}>
          <span class="orgo-tile-name">${hl(c.node.name || '')}</span>
          ${leadHtml(c, hl)}
          ${unitsHtml(c, hl)}
          <span class="orgo-meta">${metaOf(c)}<i class="bi bi-chevron-right orgo-chev" aria-hidden="true"></i></span>
        </button>
      </li>`;

  return `
    <div class="orgo" data-view="overview">
      <p class="orgo-hint">กดที่ฝ่ายเพื่อดูทุกตำแหน่งและทุกคนในฝ่ายนั้น</p>
      ${apexHtml}
      ${tiles.length ? `<span class="orgo-stem" aria-hidden="true"></span>
      <ul class="orgo-grid" aria-label="ฝ่ายทั้งหมด">${tiles.map(tileHtml).join('')}</ul>` : ''}
    </div>`;
}
