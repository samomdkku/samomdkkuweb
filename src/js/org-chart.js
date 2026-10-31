// org-chart.js — the public ทีม SAMO page.
//
// ONE surface since 2026-10-31 — ภาพรวม: a tile per ฝ่าย, each opening into a
// sheet with everyone in it (org-overview.js, org-sheet.js), searchable.
// The other three views — ผังสายงาน (connector tree), แผนผัง (panels) and ผังรวม
// (d3 canvas) — were removed on the owner's call: "remove other 3 tabs ... only
// left the ภาพรวม". แผนผัง's panel markup (`unitBlock`) survives as the SHEET's
// body, so a ฝ่าย reads the same as it did. History: `git log -- src/js/org-graph.js`.
//
// Data comes from ONE rpc: public.get_public_team_chart(year). That function is
// the only sanctioned publisher of team data (0086 → 0103 → 0104) — a SECURITY
// DEFINER projection whose jsonb keys are an explicit allow-list, over a
// recursive CTE so a non-public ตำแหน่ง hides its entire subtree. Neither
// team_members nor the archive tables have a public SELECT policy (verified:
// anon reads 0 rows from all three), so this page cannot show a field the
// projection does not name.
//
// YEARS: the current ปีการศึกษา renders from the live tree; past years render
// from a frozen archive. Same rpc, same jsonb shape, so nothing below this
// comment knows which it got.
//
// Read-only, anonymous, no writes.
import { dbRest } from './db.js';
import { escHtml } from './utils.js';
import { faceHtml, TREE_SHAPE } from './org-face.js';
import { sortSiblings, subtreeMeta, orderChildren } from './org-rung.js';
import { isDivision } from './node-kind.js';
import { tintColor } from './dept-tint.js';
import {
  overviewModel, overviewHtml, tileMeta, shortUnitName,
} from './org-overview.js';
import { openOrgSheet, onOrgSheetClick, onOrgSheetScroll } from './org-sheet.js';

// One entry per year, so switching back to a year already viewed is instant and
// free. The dataset is ~280 nodes / ~400 people — small enough to just keep.
const charts = new Map();

let years = [];           // [{ year, label, is_current }]
let activeYear = null;
let chart = null;         // { year, is_current, nodes, members }
let byParent = new Map(); // parent_id ('' for root) -> node[]
let byNode = new Map();   // node_id -> member[]
let nodeById = new Map();
let subStats = new Map(); // node_id -> { nodes, people } for the whole subtree
let collapsibleIds = new Set();
let depthById = new Map(); // node_id -> depth in the STORED tree (roots are 0)

// ORDER: every list reads `orderChildren` (org-rung.js) — ตำแหน่ง before ฝ่าย,
// ระดับ ascending — the order the removed views shared.
let loading = false;
let query = '';

// Which ตำแหน่ง are open. Collapsed is the DEFAULT: 279 ตำแหน่ง / 402 people is
// several screens of continuous scroll, and the twelve ฝ่าย with their subtree
// counts read as an index you can actually navigate. Expanding is one tap, and
// "ขยายทั้งหมด" restores the old all-at-once view for anyone who wants it.
// Keyed by node id, reset per ปีการศึกษา (ids differ between the live tree and
// each frozen archive).
let expanded = new Set();

// True only while a ฝ่าย is being rendered into ภาพรวม's sheet, where NOTHING
// collapses: the whole ฝ่าย, everyone, one scroll — the way Contacts lists
// people. Each ฝ่ายย่อย is a section whose header STICKS while you are in it
// (org-overview.css), and a row of ฝ่ายย่อย names at the top jumps to one.
//
// HOW IT GOT HERE — two versions the owner turned down, both kept as lessons:
//   1. ฝ่ายย่อย closed, each with its head in the title: "there should also be a
//      way to see all of it without having to expand many time".
//   2. A segmented control, หัวหน้าฝ่ายย่อย | ทุกคน: "you doing seperate
//      หัวหน้าฝ่าย from ทุกคน is so weird". It was — a head is one of the people,
//      and two modes split one ฝ่าย into two pictures.
// A disclosure in a detail view the reader already chose to open is a tap that
// should not exist; orientation comes from the sticky headers instead.
let sheetRender = false;

// ── what opens by default, and why it is a DEPTH ────────────────────────────
//
// Every ฝ่าย open at once is 448 people in one scroll — measured at 16,872px on
// a desktop and 32,776px on a phone, which is forty screens. Every ฝ่าย closed
// is fifteen names and no reason to tap any of them.
//
// So the ROOT ฝ่าย open and nothing below them does. What that shows is exactly
// the shape of the organisation: each ฝ่าย, the ตำแหน่ง it holds directly with
// the faces of the people in them, and its sub-ฝ่าย as named cards carrying
// their own head-counts. The membership lists are one tap in, and
// "ขยายทั้งหมด" still opens the lot.
const OPEN_TO_DEPTH = 0;

// A sub-ฝ่าย that CONTAINS ฝ่าย, or that is simply large, takes a whole line of
// the band instead of a 16rem tile. Both thresholds are about the same failure:
// a 16rem column is one portrait wide, so anything with real content inside it
// stacks one item per line and becomes a tower beside its neighbours. Measured
// against the live tree — ฝ่ายจัดการโครงการ is 2 ตำแหน่ง and 13 คน, so the
// node count alone would have missed it.
const WIDE_SUB_NODES = 5;
const WIDE_SUB_PEOPLE = 6;

// Above this a ตำแหน่ง is a MEMBERSHIP LIST and wants the whole line to wrap its
// faces into; at or below it the card is capped, because a seat holding one
// person stretched across a 1,000px row is the same emptiness in a narrower
// costume. The threshold is 3 because 214 of 296 ตำแหน่ง hold that many or
// fewer — the cap is the common case, not the exception.
const SEAT_LEAN_MAX = 3;

const $ = (id) => document.getElementById(id);

function index() {
  byParent = new Map();
  byNode = new Map();
  nodeById = new Map();
  for (const n of chart.nodes || []) {
    const k = n.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
    nodeById.set(n.id, n);
  }
  // ตำแหน่ง before ฝ่าย, in EVERY view — an ordering, not a restructure.
  for (const bucket of byParent.values()) sortSiblings(bucket);

  for (const m of chart.members || []) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }

  ({ subStats, collapsibleIds, depthById } = indexStats(byParent));

  // The default disclosure state belongs to the DATASET, not to a paint — a
  // render() triggered by a search or a view switch must not silently reopen
  // every ฝ่าย the reader closed.
  expanded = new Set([...collapsibleIds].filter((id) => (depthById.get(id) ?? 0) <= OPEN_TO_DEPTH));
}

/** Subtree totals, so a collapsed ฝ่าย still says how much is inside it — a
 *  disclosure with nothing but a name gives no reason to open it. Walked once
 *  per year rather than per paint; `seen` guards against a cycle turning a
 *  render into an infinite loop (the projection is a tree, but this is the only
 *  walk whose cost is unbounded if that ever stops being true). */
function indexStats(parents) {
  const subs = new Map();
  const collapsible = new Set();
  const depths = new Map();
  const seen = new Set();
  const walk = (id, depth) => {
    if (seen.has(id)) return { nodes: 0, people: 0 };
    seen.add(id);
    depths.set(id, depth);
    const kids = parents.get(id) || [];
    const own = (byNode.get(id) || []).length;
    let people = own;
    let nodes = 0;
    for (const c of kids) {
      const s = walk(c.id, depth + 1);
      people += s.people;
      nodes += s.nodes + 1;
    }
    const stat = { nodes, people };
    subs.set(id, stat);
    // ONLY a ฝ่าย collapses. A ตำแหน่ง in แผนผัง is a card the width of its own
    // name with its holders' faces under it — hiding that behind a chevron
    // would cost a tap to reveal something already smaller than the control.
    if ((kids.length || own) && isDivision(nodeById.get(id)?.kind)) collapsible.add(id);
    return stat;
  };
  for (const r of parents.get('') || []) walk(r.id, 0);
  return { subStats: subs, collapsibleIds: collapsible, depthById: depths };
}

// The face element lives in org-face.js — see the note there on why it is
// shared rather than copied into the graph renderer.

// THE คณะกรรมการ GRID IS GONE, and deliberately.
//
// It rendered นายกฯ and the อุปนายก a second time, above the tree, at roughly
// twice the size of everyone else. The owner's call: "don't leave the อุปนายก up
// there, make them also be in the horizontal chart as everyone, don't make them
// too bigger than anyone."
//
// That is the same principle as the equal-sized cards below it. The chart states
// rank by POSITION — นายกฯ is the box at the top of the tree — so a second,
// larger rendering of the same people was both a duplicate and a competing
// ranking system. `is_board` still exists on the node (the admin sets it, the
// archive keeps it, my-seat.js draws a small award icon with it); this page just
// no longer builds a separate grid from it.

// ── the year picker ─────────────────────────────────────────────────────────

function renderYears() {
  const host = $('orgYears');
  if (!host) return;
  if (years.length < 2) { host.innerHTML = ''; host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = years.map((y) => `
    <button type="button" class="org-year${y.year === activeYear ? ' is-active' : ''}"
      data-year="${y.year}"${y.year === activeYear ? ' aria-current="true"' : ''}>${
        escHtml(y.label || String(y.year))
      }</button>`).join('');
}

// ── filtering ───────────────────────────────────────────────────────────────
// A match on a person keeps that person and every ANCESTOR ตำแหน่ง, so the result
// still reads as a structure rather than a flat list of hits. A match on a
// ตำแหน่ง name keeps that ตำแหน่ง and everything beneath it, because "show me
// ฝ่ายวิชาการ" should mean the whole branch.

function computeFilter(qRaw) {
  const q = qRaw.trim().toLowerCase();
  if (!q) return null;
  const keepNodes = new Set();
  const keepMembers = new Set();
  // From byParent — the STORED parentage, which is what the panels draw.
  const parentOf = new Map();
  for (const [k, kids] of byParent) for (const n of kids) parentOf.set(n.id, k);
  const markUp = (id) => {
    let cur = id;
    while (cur && !keepNodes.has(cur)) { keepNodes.add(cur); cur = parentOf.get(cur); }
  };
  const markDown = (id) => {
    keepNodes.add(id);
    (byParent.get(id) || []).forEach((c) => markDown(c.id));
  };

  for (const n of chart.nodes || []) {
    if ((n.name || '').toLowerCase().includes(q)) { markUp(n.id); markDown(n.id); }
  }
  for (const m of chart.members || []) {
    const hay = `${m.name || ''} ${m.nickname || ''}`.toLowerCase();
    if (hay.includes(q)) { keepMembers.add(m); markUp(m.node_id); }
  }
  // Inside a ตำแหน่ง whose NAME matched, show all of its people — otherwise
  // searching a ฝ่าย returns a branch with empty rooms.
  for (const n of chart.nodes || []) {
    if ((n.name || '').toLowerCase().includes(q)) {
      (byNode.get(n.id) || []).forEach((m) => keepMembers.add(m));
      const walk = (id) => (byParent.get(id) || []).forEach((c) => {
        (byNode.get(c.id) || []).forEach((m) => keepMembers.add(m));
        walk(c.id);
      });
      walk(n.id);
    }
  }
  return { keepNodes, keepMembers, q: qRaw.trim() };
}

function highlight(text, q) {
  const safe = escHtml(text);
  if (!q) return safe;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return safe;
  return `${escHtml(text.slice(0, i))}<mark>${escHtml(text.slice(i, i + q.length))}</mark>${escHtml(text.slice(i + q.length))}`;
}

// ── rendering แผนผัง ────────────────────────────────────────────────────────
//
// TWO ELEMENTS, and the difference between them is the whole layout.
//
//   ฝ่าย (a UNIT)     a PANEL — a titled, collapsible container.
//   ตำแหน่ง (a SEAT)   a CARD  — a title and the faces of whoever holds it.
//
// A panel lays its contents out in two bands: one row per ระดับ of its own
// seats, then a grid of its sub-ฝ่าย. That is the ordering `orderChildren`
// returns — the one ordering every org list reads.
//
// ── why every card is the SAME SIZE ─────────────────────────────────────────
//
// REPORTED: "the head of like each ฝ่าย got drowned inside many people in their
// own ฝ่าย" — and then, on how to fix it: "i thought like from top to bottom,
// the layout importancy already hierarchy based on importance" and "i thought
// like making everyone card big equally".
//
// A first attempt gave หัวหน้า a BIGGER card, detected from a list of Thai name
// prefixes (หัวหน้า…, อุปนายก…, ประธาน…). That was the wrong instrument, for the
// reason the owner gave: the tree ALREADY ranks people. Every ฝ่าย orders its
// children by `position`, and position 0 is the head — so a prefix list would
// have been a SECOND source of truth for a fact the structure already carries,
// and it would drift the first time somebody renamed a ตำแหน่ง or invented a
// title the list had never heard of.
//
// So: one card, one size, for everyone. What makes the head stand out is where
// they SIT — first seat, on the first ระดับ row of their own ฝ่าย panel. Rank
// belongs to the layout; the card is just a person.

function personCard(m, filter) {
  const name = m.name || '';
  const nick = m.nickname || '';
  return `
    <li class="orgc-person">
      <span class="org-face">${faceHtml(m, TREE_SHAPE)}</span>
      <span class="orgc-person-text">
        <span class="orgc-person-name">${highlight(name, filter?.q)}</span>
        ${nick ? `<span class="orgc-person-nick">${highlight(nick, filter?.q)}</span>` : ''}
      </span>
    </li>`;
}

/** The people this paint may show for a node — everyone, or just the search
 *  hits. One helper because three call sites need both the COUNT and the
 *  markup, and filtering twice is how the two disagree. */
function visiblePeople(node, filter) {
  const people = byNode.get(node.id) || [];
  return filter ? people.filter((m) => filter.keepMembers.has(m)) : people;
}

function peopleHtml(people, filter) {
  if (!people.length) return '';
  return `<ul class="orgc-people">${people.map((m) => personCard(m, filter)).join('')}</ul>`;
}

/** The line under a ฝ่าย's name: what is inside it. Wording lives in
 *  org-rung.js's `subtreeMeta`, shared with the graph renderer. */
function unitMeta(node) {
  const s = subStats.get(node.id) || { nodes: 0, people: 0 };
  return subtreeMeta({
    isDiv: true, nodes: s.nodes, people: s.people, own: (byNode.get(node.id) || []).length,
  });
}

/**
 * The line under a ตำแหน่ง's name — and it says LESS than a ฝ่าย's on purpose.
 *
 * `subtreeMeta` will happily render "9 คน" for a seat, which is what the old
 * outline needed: the holders were behind a disclosure. Here the faces are
 * directly beneath the name, so that number is a caption counting what the
 * reader is already looking at. What is NOT visible is a subtree hanging off
 * the seat, and an empty seat — 21 of them exist, and on a page that doubles as
 * recruitment a vacancy is real information rather than a card that failed to
 * load.
 */
function seatMeta(node) {
  const s = subStats.get(node.id) || { nodes: 0, people: 0 };
  const own = (byNode.get(node.id) || []).length;
  if (!s.nodes && !own) return 'ยังไม่มีสมาชิก';
  if (!s.nodes) return '';
  return subtreeMeta({ isDiv: false, nodes: s.nodes, people: s.people, own });
}

/**
 * A node's children, in the ONE order both views agree on.
 *
 * `orderChildren` groups by ระดับ only when the parent is a ฝ่าย — the same
 * test `chartParentage` makes, and for the same reason: seats under a ตำแหน่ง
 * are that ตำแหน่ง's own sub-seats, not rungs of a ฝ่าย, so ranking them
 * against each other would invent a hierarchy nobody stored.
 */
function childrenHtml(node, depth, filter) {
  const { rungs, units } = orderChildren(byParent.get(node.id) || [], isDivision(node.kind));

  // FLAT, and that is the density decision. Wrapping each ระดับ in a row of its
  // own forces a line break after it, so a ฝ่าย whose top rung is one อุปนายก
  // spends a whole row on one card and leaves the rest of the line empty — the
  // exact "leftover space" this rewrite is about. Emitted as siblings, every
  // tile flows into one wrapping band and the rung survives as a `data-rung`
  // attribute the stylesheet weights by: ระดับ 1 reads as the heads, deeper
  // rungs read quieter, and the ORDER is what states the rank.
  // `i === 0` decides the leading rung, NOT `tier === 1`. Measured on the live
  // tree: ฝ่ายพัฒนาทรัพยากรบุคคล's หัวหน้า is ระดับ 2 and ฝ่ายวิเคราะห์ข้อมูล's
  // is ระดับ 3 — the numbers are what an admin typed, and nothing makes them
  // start at 1. Styling the heads off the literal number left those ฝ่าย with no
  // head marked at all, which reads as a ฝ่าย that has no head.
  const seats = rungs.map(([tier, list], i) => list
    .map((n) => seatBlock(n, depth + 1, filter, tier, i === 0)).join('')).join('');

  const subs = units.map((n) => unitBlock(n, depth + 1, filter)).join('');
  return { seats, subs };
}

function seatBlock(node, depth, filter, tier = 1, lead = true) {
  if (filter && !filter.keepNodes.has(node.id)) return '';
  const people = visiblePeople(node, filter);
  const kid = childrenHtml(node, depth, filter);
  const sub = kid.seats + kid.subs;
  // A branch that filtered down to nothing at all is noise — drop it.
  if (filter && !people.length && !sub) return '';

  const meta = filter ? '' : seatMeta(node);
  const hTag = `h${Math.min(depth + 3, 6)}`;
  return `
    <article class="orgc-seat${lead ? ' is-lead' : ''}${sub ? ' has-sub' : ''}${
  people.length > SEAT_LEAN_MAX ? ' has-many' : ''}"
      data-depth="${depth}" data-rung="${tier}">
      <${hTag} class="orgc-seat-name">${highlight(node.name || '', filter?.q)}</${hTag}>
      ${meta ? `<p class="orgc-seat-meta">${escHtml(meta)}</p>` : ''}
      ${peopleHtml(people, filter)}
      ${sub ? `<div class="orgc-seat-sub">${sub}</div>` : ''}
    </article>`;
}

function unitBlock(node, depth, filter) {
  if (filter && !filter.keepNodes.has(node.id)) return '';
  const people = visiblePeople(node, filter);
  const kid = childrenHtml(node, depth, filter);
  const inner = peopleHtml(people, filter) + kid.seats + kid.subs;
  if (filter && !inner) return '';

  // A CSS COLOUR, not a palette key. Set inline so an admin-chosen colour and a
  // name-derived one arrive by the same route — a `data-tint` attribute could
  // only ever express the ten the stylesheet had a rule for.
  const tint = tintColor(node, depth === 0);
  const meta = filter ? '' : unitMeta(node);
  const stat = subStats.get(node.id) || { nodes: 0, people: 0 };

  // A search result is always fully open — a disclosure the user has to expand
  // to find what they just searched for is the same as no result.
  const collapsible = !filter && !sheetRender && !!inner && collapsibleIds.has(node.id);
  const open = !collapsible || expanded.has(node.id);
  const bodyId = `org-n-${node.id}`;
  const hTag = `h${Math.min(depth + 3, 6)}`;

  const headInner = `
        <span class="orgc-unit-name">${highlight(node.name || '', filter?.q)}</span>
        ${meta ? `<span class="orgc-unit-meta">${escHtml(meta)}</span>` : ''}
        ${collapsible ? '<i class="bi bi-chevron-down orgc-unit-chev" aria-hidden="true"></i>' : ''}`;

  // ARIA accordion pattern: the heading WRAPS the button, so the panel still
  // reads as a hierarchy to a screen reader and the control is the whole row.
  const head = collapsible
    ? `<button type="button" class="orgc-unit-btn" aria-expanded="${open}" aria-controls="${escHtml(bodyId)}">${headInner}</button>`
    : `<span class="orgc-unit-btn is-static">${headInner}</span>`;

  // NOTE the stylesheet only honours this while the panel is OPEN — a collapsed
  // ฝ่าย is one title row, and giving that a whole line is the emptiness this
  // rewrite exists to remove. Expressed with `:has()` rather than a second class
  // so `toggleNode`, which only flips `hidden`, cannot leave the two disagreeing.
  const wide = depth > 0 && (!!kid.subs
    || stat.nodes >= WIDE_SUB_NODES || stat.people >= WIDE_SUB_PEOPLE);

  return `
    <section class="orgc-unit${collapsible ? ' is-collapsible' : ''}${wide ? ' is-wide' : ''}"
      data-depth="${depth}"${tint ? ` style="--org-tint:${tint}"` : ''}>
      <${hTag} class="orgc-unit-title">${head}</${hTag}>
      ${inner ? `<div class="orgc-unit-body" id="${escHtml(bodyId)}"${open ? '' : ' hidden'}>${inner}</div>` : ''}
    </section>`;
}

function render() {
  const body = $('orgBody');
  if (!body || !chart) return;
  renderYears();

  const filter = computeFilter(query);
  const roots = byParent.get('') || [];

  const cnt = $('orgCount');
  if (cnt) {
    cnt.textContent = filter
      ? `พบ ${filter.keepMembers.size} คน`
      : `${(chart.nodes || []).length} ตำแหน่ง · ${(chart.members || []).length} คน`;
  }

  const panels = overviewPanels(roots, filter);
  if (!panels) {
    body.innerHTML = `<p class="org-status">${
      filter ? `ไม่พบ “${escHtml(filter.q)}” ในโครงสร้างองค์กร` : 'ยังไม่มีข้อมูลโครงสร้างองค์กร'
    }</p>`;
    return;
  }

  // One view, so no switcher: the heading alone names what is below it.
  body.innerHTML = `
    <div class="org-tree-head">
      <h2 class="org-tree-heading">โครงสร้างทั้งหมด</h2>
    </div>
    ${panels}`;
}

// ── rendering ภาพรวม ─────────────────────────────────────────────────────────
//
// The tiles are org-overview.js's; what lives here is what needs this file's
// indexes — the search hit counts and the sheet's body, which is แผนผัง's own
// `unitBlock`, so a ฝ่าย reads the same in the sheet as on the page.

function overviewModelNow(roots) {
  return overviewModel({ roots, byParent, byNode, subStats });
}

/** People under `node` (itself included) that the search kept. */
function hitsOf(node, filter) {
  let n = (byNode.get(node.id) || []).filter((m) => filter.keepMembers.has(m)).length;
  for (const c of byParent.get(node.id) || []) n += hitsOf(c, filter);
  return n;
}

function overviewPanels(roots, filter) {
  // A search that matched nothing anywhere is the page's empty state, not a
  // map with every tile dimmed.
  if (filter && !filter.keepNodes.size) return '';
  return overviewHtml(overviewModelNow(roots), {
    filter,
    hitsOf: (node) => hitsOf(node, filter),
    hl: (text) => highlight(text, filter?.q),
  });
}

/** Tapped a tile: the ฝ่าย, whole, in a sheet. While searching, the sheet shows
 *  the same filtered branch the page would — what you searched for is what you
 *  open into. */
function openOverviewSheet(btn) {
  const node = nodeById.get(btn.dataset.orgOpen);
  if (!node) return;
  const filter = computeFilter(query);
  sheetRender = true;
  let html;
  try {
    html = unitBlock(node, 0, filter);
  } finally {
    sheetRender = false;
  }
  const card = overviewModelNow([node]).apex;
  // The jump row: one chip per ฝ่ายย่อย, in the order the sections are drawn.
  // Navigation, not a filter — every section stays on the page. Not while
  // searching: the result is already short, and a chip could name a section
  // the search dropped.
  const jump = !filter && card.units.length > 1 ? `
    <nav class="orgs-jump" aria-label="ไปยังฝ่ายย่อย">${card.units.map((u) => `
      <button type="button" class="orgs-jump-chip" data-sheet-jump="${escHtml(u.id)}">${
  escHtml(shortUnitName(u.name))}</button>`).join('')}
    </nav>` : '';
  openOrgSheet({
    title: node.name || '',
    meta: filter ? `พบ ${hitsOf(node, filter)} คน` : tileMeta(card),
    tint: tintColor(node, !node.parent_id),
    html: `${jump}<div class="orgc-tree">${html || '<p class="org-status">ไม่มีข้อมูลในฝ่ายนี้</p>'}</div>`,
    from: btn,
  });
  initJumpRow();
}

// ── the jump row FOLLOWS the reader ─────────────────────────────────────────
//
// ASKED: "will the user understand the jump row that its clickable, feedback
// for user". As first shipped, no: light pills read as TAGS, the row never
// changed as you scrolled, and tapping one of the last sections looked like it
// did nothing — they cannot reach the top, so the list stopped with the target
// 476px down (measured) and nothing said "you are here".
//
// What makes a strip of chips read as navigation is that it MOVES WITH YOU —
// the category bars people already know (App Store, YouTube) all do it:
//   • the section you are in is the SELECTED chip, filled green — the same
//     "selected" the ภาพรวม button above wears;
//   • a tap selects on the press and glides there. Arrival is confirmed by
//     WHERE the header lands: every section that can reach the top pins in
//     the same place, which needs no further signal. Only a section that
//     CANNOT reach the top (the last few — the list ends first) gets a soft
//     glow, because only then does the eye not know where to look. Asked
//     "does flashing good?": the first version flashed on every jump at 30%
//     — feedback where none was needed, and a blink rather than a glow;
//   • the row slides to keep the selected chip in view, and fades at an edge
//     that has more chips past it.

const smoothOk = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
// While a tap's glide is in flight the scroll position passes through other
// sections; reacting to it would flick the selection through them.
let jumpLock = 0;

function sectionOf(id) {
  return document.getElementById(`org-n-${id}`)?.closest('.orgc-unit') || null;
}

function setJumpActive(row, id) {
  let active = null;
  for (const c of row.querySelectorAll('[data-sheet-jump]')) {
    const on = c.dataset.sheetJump === id;
    c.classList.toggle('is-on', on);
    if (on) { c.setAttribute('aria-current', 'location'); active = c; } else c.removeAttribute('aria-current');
  }
  if (!active) return;
  const l = active.offsetLeft;
  const r = l + active.offsetWidth;
  if (l < row.scrollLeft || r > row.scrollLeft + row.clientWidth) {
    row.scrollTo({ left: l - (row.clientWidth - active.offsetWidth) / 2, behavior: smoothOk() ? 'smooth' : 'auto' });
  }
}

function updateJumpEdges(row) {
  row.classList.toggle('more-left', row.scrollLeft > 2);
  row.classList.toggle('more-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 2);
}

/** Which section the reader is in: the last one whose top has passed under the
 *  pinned headers. At the very bottom, the last section — it is being read even
 *  though it never reached the top. */
function spyJump(body) {
  const row = body.querySelector('.orgs-jump');
  if (!row || performance.now() < jumpLock) return;
  const chips = [...row.querySelectorAll('[data-sheet-jump]')];
  if (!chips.length) return;
  const line = body.getBoundingClientRect().top + row.offsetHeight + 8;
  let id = chips[0].dataset.sheetJump;
  for (const c of chips) {
    const sec = sectionOf(c.dataset.sheetJump);
    if (sec && sec.getBoundingClientRect().top <= line) id = c.dataset.sheetJump;
  }
  if (body.scrollTop > 0 && body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
    id = chips[chips.length - 1].dataset.sheetJump;
  }
  setJumpActive(row, id);
}

/** The glow, ONLY when the section stopped short of where headers pin. */
function arriveGlow(section, body) {
  const title = section.querySelector(':scope > .orgc-unit-title');
  if (!title || !smoothOk()) return;
  const row = body.querySelector('.orgs-jump');
  const pinAt = body.getBoundingClientRect().top + (row ? row.offsetHeight : 0);
  if (Math.abs(section.getBoundingClientRect().top - pinAt) < 6) return;
  title.classList.remove('is-arrived');
  void title.offsetWidth;   // restart the animation if it is still running
  title.classList.add('is-arrived');
  setTimeout(() => title.classList.remove('is-arrived'), 1000);
}

/** A jump chip: select it NOW, glide to its section; glow it only if it could
 *  not reach the top. */
function onSheetClick(e) {
  const chip = e.target.closest('[data-sheet-jump]');
  if (!chip) return;
  const section = sectionOf(chip.dataset.sheetJump);
  const body = chip.closest('.orgs-body');
  if (!section || !body) return;
  setJumpActive(chip.parentElement, chip.dataset.sheetJump);
  jumpLock = performance.now() + 1200;
  let arrived = false;
  const arrive = () => {
    if (arrived) return;
    arrived = true;
    jumpLock = 0;
    arriveGlow(section, body);
  };
  // `scrollend` where the browser has it; the timer covers the rest, and the
  // case where the section is already in place and nothing scrolls at all.
  body.addEventListener('scrollend', arrive, { once: true });
  setTimeout(arrive, smoothOk() ? 700 : 0);
  section.scrollIntoView({ block: 'start', behavior: smoothOk() ? 'smooth' : 'auto' });
}

/** After the sheet opens: first chip selected, edge fades set, and the row
 *  keeps its fades honest as it is swiped. */
function initJumpRow() {
  const body = document.querySelector('.orgs-body');
  const row = body?.querySelector('.orgs-jump');
  if (!row) return;
  spyJump(body);
  updateJumpEdges(row);
  row.addEventListener('scroll', () => updateJumpEdges(row), { passive: true });
}

// ── loading ─────────────────────────────────────────────────────────────────

/** NOTE dbRest resolves to { data, error } rather than to the payload; reading
 *  it as the payload makes `chart.nodes` undefined and renders a convincing
 *  "ยังไม่มีข้อมูล" empty state instead of an error. */
async function fetchChart(year) {
  if (charts.has(year)) return charts.get(year);
  const { data, error } = await dbRest('/rpc/get_public_team_chart', {
    method: 'POST',
    body: { p_year: year },
  });
  if (error) throw new Error(error.message || `HTTP ${error.status}`);
  const safe = (data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.nodes))
    ? data
    : { nodes: [], members: [] };
  charts.set(year, safe);
  return safe;
}

function showError() {
  const body = $('orgBody');
  if (body) {
    body.innerHTML = '<p class="org-status is-error">โหลดโครงสร้างองค์กรไม่สำเร็จ ลองรีเฟรชหน้าอีกครั้ง</p>';
  }
}

// Tapping two years quickly starts two fetches. Without a token the SLOWER one
// wins whenever it resolves last, so the highlighted year and the rendered chart
// disagree — and it is not reproducible on a fast connection, which is the worst
// kind of bug to be handed. Only the newest request is allowed to paint.
let showToken = 0;

async function showYear(year) {
  const body = $('orgBody');
  const mine = ++showToken;
  if (!charts.has(year) && body) {
    body.innerHTML = '<p class="org-status">กำลังโหลด…</p>';
  }
  try {
    const next = await fetchChart(year);
    if (mine !== showToken) return;   // a newer click already took over
    chart = next;
    activeYear = year ?? chart.year ?? null;
    // NOTE `expanded` is reset by index(), not here — node ids are per-tree (the
    // live tree and each frozen archive are different rows), so a stale set
    // would silently open nothing, and the DEFAULT open state is a fact about
    // the dataset. A `new Set()` on this line survived the rewrite for a while
    // and read like the policy while index() overwrote it two lines later.
    index();
    render();
  } catch (err) {
    console.warn('org chart load failed:', err);
    if (mine === showToken) showError();
  }
}

/** Load once. Safe to call on every tab activation — the guard makes repeats free. */
export async function enterOrgChart() {
  if (chart || loading) { render(); return; }
  loading = true;
  try {
    // Anonymous is fine — dbRest falls back to the anon key when there is no
    // session, and both rpcs are granted to anon.
    //
    // The year list is OPTIONAL: if it fails we still want the chart, because
    // get_public_team_chart(null) resolves the current term server-side. Failing
    // the whole page over a missing picker would be a worse outcome than a page
    // with no picker.
    let current = null;
    try {
      const { data } = await dbRest('/rpc/get_public_team_years', { method: 'POST', body: {} });
      years = Array.isArray(data) ? data : [];
      current = years.find((y) => y.is_current) || years[years.length - 1] || null;
    } catch (err) {
      console.warn('org chart: year list failed, falling back to current term:', err);
      years = [];
    }
    await showYear(current ? current.year : null);
  } catch (err) {
    // showYear handles its own failures; this catches anything above it. Without
    // it the page sits on "กำลังโหลด…" forever and the only trace is an
    // unhandled rejection — the pre-0104 code had this catch and it was lost in
    // the rewrite.
    console.warn('org chart init failed:', err);
    showError();
  } finally {
    loading = false;
  }
}

export function initOrgChart() {
  const search = $('orgSearch');
  const clear = $('orgSearchClear');
  let t = null;
  search?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      query = search.value.trim();
      clear?.classList.toggle('d-none', !query);
      if (chart) render();
    }, 120);
  });
  clear?.addEventListener('click', () => {
    search.value = ''; query = '';
    clear.classList.add('d-none');
    if (chart) render();
    search.focus();
  });

  // ภาพรวม's sheet: the jump row — tapped, and following the scroll.
  onOrgSheetClick(onSheetClick);
  let spyFrame = 0;
  onOrgSheetScroll((body) => {
    if (spyFrame) return;
    spyFrame = requestAnimationFrame(() => { spyFrame = 0; spyJump(body); });
  });

  // Delegated: every station is re-rendered on each paint, and #orgBody itself
  // is the one element that survives.
  $('orgBody')?.addEventListener('click', (e) => {
    const ob = e.target.closest('[data-org-open]');
    if (ob) { openOverviewSheet(ob); return; }
  });

  // Delegated: the year buttons are re-rendered on every paint.
  $('orgYears')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-year]');
    if (!btn) return;
    const y = Number(btn.dataset.year);
    if (!Number.isFinite(y) || y === activeYear) return;
    // Switching year while a search is active would show a filtered view of a
    // year the user has not seen yet — confusing. Clear it.
    if (query) {
      query = '';
      if (search) search.value = '';
      clear?.classList.add('d-none');
    }
    showYear(y);
  });
}
