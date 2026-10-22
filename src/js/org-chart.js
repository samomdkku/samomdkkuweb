// org-chart.js — the public ทีม SAMO page.
//
// FOUR surfaces over one dataset — every ตำแหน่ง and person, searchable:
//   • ภาพรวม   — AT A GLANCE. A tile per ฝ่าย, opens into a sheet (org-overview.js).
//   • ผังสายงาน — the connector tree (this file).
//   • แผนผัง   — the PAGE. ฝ่าย panels that reflow at any width (this file).
//   • ผังรวม   — the CANVAS. One d3 chart over the whole org (org-graph.js).
// The full note on which is which, and why the other two were removed, is at
// the `VIEWS` constant below.
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
import {
  mountOrgGraph, destroyOrgGraph, setGraphRung, fitGraphs, zoomGraphs,
  toggleGraphFullscreen, anyGraphFullscreen, exitGraphFullscreen,
} from './org-graph.js';
import {
  RUNG, chartParentage, sortSiblings, subtreeMeta, orderChildren,
} from './org-rung.js';
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

// ── TWO PARENTAGES, ONE ORDERING ────────────────────────────────────────────
//
// แผนผัง draws CONTAINMENT: what is inside ฝ่าย IT. It reads the tree as stored
// and expresses ระดับ as ROWS inside the ฝ่าย panel.
//
// ผังรวม draws REPORTING: a ฝ่าย's sub-ฝ่าย hang off its head seat, and ระดับ 2
// hangs off ระดับ 1 (`chartParentage`). That is what a top-down canvas needs.
//
// The reporting parentage was applied to BOTH at one point, on the theory that
// one structure cannot drift. It can't — but nesting costs DEPTH, and on a page
// depth is vertical: measured on the live tree, แผนผัง went from 25,847px to
// 52,163px and max depth from 5 to 9, a staircase down the middle of an empty
// page.
//
// So the geometries differ and the ORDER does not. Both read `orderChildren` —
// ตำแหน่ง before ฝ่าย, ระดับ ascending — and `org-rung.test.js` holds the
// differential that says the seat sequence is the same one either way. That is
// the answer to "แผนผัง doesn't show order like the ผังรวม".
let byParentChart = new Map();
let subStatsChart = new Map();
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

// TWO surfaces over one dataset, answering two different questions:
//
//   • แผนผัง  — THE PAGE. Every ฝ่าย is a panel; inside it, its ตำแหน่ง are laid
//               out as one ROW PER ระดับ and its sub-ฝ่าย pack into a grid that
//               reflows from four columns to one. No canvas, no panning, no
//               horizontal scrollbar — this is the surface you read on a phone.
//   • ผังรวม  — THE CANVAS. ONE d3 chart over the whole organisation, hung off a
//               synthetic องค์กร root, with real connector lines and pan/zoom
//               (org-graph.js). Wide by construction; the แสดงถึง rung is what
//               makes it navigable.
//
// รายการ AND ผังองค์กร WERE REMOVED, on the owner's call: "remove รายการ and
// ผังองค์กร, left only แผนผัง and ผังรวม". Neither was a third picture. รายการ
// shared แผนผัง's markup and differed only in CSS; ผังองค์กร shared ผังรวม's
// renderer and differed only in how the rows were grouped. Four buttons offered
// two pictures twice, and the pair that went is the pair whose survivor already
// does the job better at every width.
//
// The saved preference is MIGRATED rather than dropped: a reader whose last
// choice was รายการ lands on แผนผัง, and ผังองค์กร lands on ผังรวม. Silently
// resetting them to the default would be the same bug as forgetting the
// preference existed.
//
// THREE VIEWS SINCE 2026-08-25, and the third is a RESTORE.
//
// The rework above removed the connector chart — white boxes, elbow lines, one
// section per ฝ่าย, read top to bottom from SAMO's own recruitment poster — and
// replaced it with the panel view. The owner's answer: *"you've implemented
// this design which i also like, so i would like to KEEP this and RESTORE the
// previous and improve it."* Both ship. Neither is a fallback for the other:
//
//   ผังสายงาน  the connector tree. Shows the LINES — who reports through whom,
//              as a picture you could print.
//   แผนผัง     the panel view. Shows the CONTENT — every ฝ่าย's seats and faces,
//              at a third the height.
//   ผังรวม     d3 on a pan/zoom canvas. The whole organisation at once.
//
// ⚠️ THE KEY MAPPING, WRITTEN DOWN BEFORE ANYTHING ELSE. `'chart'` means the
// PANEL view and keeps meaning it. The restored connector tree gets a NEW key,
// `'lines'`. It historically owned `'chart'`, and giving it back would silently
// move every reader whose saved preference is `'chart'` — currently the panel
// view — onto a different picture. A new key costs nothing and moves nobody.
//
// FOUR SINCE 2026-10-22: ภาพรวม (`'overview'`, org-overview.js) — every ฝ่าย as
// a tile listing each ฝ่ายย่อย with its head, one screen on a computer (a phone
// scrolls ~1.5 screens), each tile opening a sheet. Asked for beside the other three, not instead of one, so it is a new
// key and the default does not move.
const VIEWS = ['overview', 'lines', 'chart', 'all'];
// `Object.create(null)`, and it is the same fix af36088 made to the four
// vocabulary maps in team/index.js one day earlier: the key here comes from
// localStorage, which a reader can set to anything, and the read below is
// `MAP[key] || key`. On a plain object literal `RETIRED_VIEWS['constructor']`
// returns an inherited FUNCTION rather than undefined. `VIEWS.includes()` would
// still reject it — so this is the benign end of that bug — but a map read by
// `[untrusted]` should never have a prototype at all.
const RETIRED_VIEWS = Object.assign(Object.create(null), { list: 'chart', graph: 'all' });
const GRAPH_VIEWS = ['all'];
let view = 'chart';
try {
  const saved = localStorage.getItem('samo.org.view');
  const mapped = RETIRED_VIEWS[saved] || saved;
  if (VIEWS.includes(mapped)) view = mapped;
} catch { /* private mode */ }

// ผังรวม's "แสดงถึง" rung. A KIND, not a depth — the `RUNG` note in org-rung.js
// has the measurements and why a number could not express it. It opens at
// ฝ่ายหลัก, the only rung of the whole-organisation picture that fits without
// panning. Still a per-view map (of one) so the control code below does not have
// to change shape if a second canvas view ever comes back.
const graphRung = { all: RUNG.top };

/** Which rungs the canvas view OFFERS. The labels say what you will SEE, not
 *  how deep it goes. */
const VIEW_RUNGS = {
  all: [[RUNG.top, 'ฝ่ายหลัก'], [RUNG.fai, 'ฝ่ายย่อย'], [RUNG.role, 'ตำแหน่ง'],
    [RUNG.full, 'ทั้งหมด']],
};

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
  // The canvas views' reporting structure, built from the stored one.
  byParentChart = chartParentage(byParent, nodeById);

  for (const m of chart.members || []) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }

  // Twice, because the two parentages give different answers and both are
  // shown: a head seat's "ใต้สังกัด …" on the canvas has to count the sub-ฝ่าย
  // hanging off it, while the same seat in แผนผัง must not claim them.
  ({ subStats, collapsibleIds, depthById } = indexStats(byParent));
  ({ subStats: subStatsChart } = indexStats(byParentChart));

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
  // From byParent — the STORED parentage, which is what แผนผัง draws. ผังรวม
  // re-parents, so it widens this result itself rather than making แผนผัง keep
  // an ancestor only the canvas needs (`chartFilter`).
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
// returns, which is the SAME ordering ผังรวม draws — see the note there on why
// one rule in two geometries beats one geometry that fits neither.
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

// ── rendering ผังสายงาน (the connector tree) ────────────────────────────────
//
// RESTORED from `befd30e`, where it was deleted whole, and then changed in
// exactly three ways. Everything else — the geometry, the elbow technique, the
// per-ฝ่าย sectioning — is the code that shipped for months, because the owner
// asked for THIS picture back and a reimplementation would not be it.
//
// THE THREE CONSTRAINTS THAT MAKE IT FIT 400 PEOPLE, each measured before the
// deletion and still true. Do not relax one without re-measuring:
//   1. ONE SECTION PER ฝ่าย. As a single tree the twelve ฝ่าย sit side by side
//      and the width is their SUM — 44,386px, about thirty screens. Per-ฝ่าย it
//      is the widest single ฝ่าย instead.
//   2. BRANCH SIDEWAYS ONCE. Below depth 1 it switches to a vertical spine.
//      Branching at every level let the LEAF row set the width.
//   3. THE SPREADING ROW MUST BE BOUNDED TO WRAP. `.org-tree` is
//      `width: max-content`, so a container that always grows never reaches its
//      wrap point — `flex-wrap` alone did nothing here.
//
// WHAT CHANGED, and why each was the actual complaint:
//
//   a. IT HONOURS ระดับ. The old one read `byParent` in stored order, so the
//      rungs an admin configures in ทีม SAMO were ignored — *"it doesn't care
//      about ระดับ that i config in the admin teamsamo"*, which was half the
//      original bug report. It now routes through `orderChildren()`, the same
//      call แผนผัง and ผังรวม make. ONE ordering, three pictures.
//      ⚠️ ORDER, NOT GEOMETRY. It keeps the CONTAINMENT parentage it always
//      drew. Handing it `chartParentage` is what made this view a 52,000px
//      staircase in August 2026, and that has now been paid for twice.
//
//   b. IT OPENS COLLAPSED, like แผนผัง. The old one did
//      `expanded = new Set(collapsibleIds)` on entry — every ฝ่าย open, always —
//      and measured 24,101px at 1440 and 55,273px at 390. It now shares the
//      one `expanded` set the whole page uses (`OPEN_TO_DEPTH = 0`), which was
//      the single change that bought แผนผัง most of its win. ขยายทั้งหมด still
//      opens everything, so nothing is unreachable.
//      This also dissolves the "many leftover space" complaint at its
//      STRUCTURAL cause rather than by tuning gaps: a connector row is
//      `align-items: flex-start`, so a one-person ตำแหน่ง beside a forty-person
//      ฝ่าย left a dead column as tall as the tall one. Collapsed, there is no
//      tall one.
//
//   c. IT REUSES THE SHARED PERSON CARD, meta wording and tint. The old view had
//      its own `memberCard()` and `stationMeta()`; two portrait renderers is
//      how `TREE_SHAPE` and the CSS width drift apart, which
//      `org-chart-metrics.test.js` exists to catch. Only the BOX and the LINES
//      are this view's own.

/**
 * One node of the connector tree: a box, its people, and the row of its
 * children hanging beneath on elbows.
 *
 * MARKUP SHAPE, and why the box is its own element: the connector technique
 * needs a node's BOX to be a layout SIBLING of the row of its children —
 * `li > .box + ul` — with the elbows hung off both. So `.org-box` holds the
 * station and `.org-node-body` (which is what collapses) becomes
 * `display: contents`, so it stops being a box of its own while `hidden`
 * keeps working. `[hidden]`'s `display: none` wins over `display: contents`,
 * and since 2026-08-20 that `!important` is OURS in base.css rather than
 * borrowed from Bootstrap's CDN reboot.
 */
function lineBlock(node, depth, filter) {
  if (filter && !filter.keepNodes.has(node.id)) return '';
  const people = visiblePeople(node, filter);

  // The SAME call แผนผัง makes. `orderChildren` groups by ระดับ only when the
  // parent is a ฝ่าย, so seats under a ตำแหน่ง keep their stored order rather
  // than being ranked against each other — see childrenHtml().
  const { rungs, units } = orderChildren(byParent.get(node.id) || [], isDivision(node.kind));
  const kids = [...rungs.flatMap(([, list]) => list), ...units];
  const childHtml = kids.map((c) => lineBlock(c, depth + 1, filter)).join('');

  // A branch that filtered down to nothing at all is noise — drop it.
  if (filter && !people.length && !childHtml) return '';

  // A CSS COLOUR, not a palette key. Set inline so an admin-chosen colour and a
  // name-derived one arrive by the same route.
  const tint = tintColor(node, depth === 0);
  // A ฝ่าย with a dozen sub-ฝ่าย went twelve columns wide, because depth 1 is
  // the one level that spreads. Past a handful the row WRAPS into a grid: a
  // single connector bar stops being meaningful across wrapped lines, so
  // `is-grid` drops it and each child keeps its own drop tick instead.
  const branchHtml = childHtml
    ? `<ul class="org-branch${kids.length > 4 ? ' is-grid' : ''}">${childHtml}</ul>`
    : '';
  const inner = `${peopleHtml(people, filter)}${branchHtml}`;

  // A search result is always fully open — a disclosure the reader has to
  // expand to find what they just searched for is the same as no result.
  const collapsible = !filter && !!inner && collapsibleIds.has(node.id);
  const open = !collapsible || expanded.has(node.id);
  // The two views are never in the DOM at once, so one id per node is safe and
  // the disclosure state carries across a switch — which is the behaviour you
  // want: closing ฝ่าย IT in one picture and finding it open in the other would
  // read as the page forgetting.
  const bodyId = `org-n-${node.id}`;
  const meta = filter ? '' : (isDivision(node.kind) ? unitMeta(node) : seatMeta(node));
  const hTag = `h${Math.min(depth + 3, 6)}`;

  const stationInner = `
        <span class="org-station-dot" aria-hidden="true"></span>
        <span class="org-station-name">${highlight(node.name || '', filter?.q)}</span>
        ${meta ? `<span class="org-station-meta">${escHtml(meta)}</span>` : ''}
        ${collapsible ? '<i class="bi bi-chevron-right org-station-chev" aria-hidden="true"></i>' : ''}`;

  // ARIA accordion pattern: the heading WRAPS the button, so the outline still
  // reads as a hierarchy and the control is the whole row.
  const station = collapsible
    ? `<button type="button" class="org-station-btn" aria-expanded="${open}" aria-controls="${escHtml(bodyId)}">${stationInner}</button>`
    : `<span class="org-station-btn is-static">${stationInner}</span>`;

  return `
    <li class="org-node${collapsible ? ' is-collapsible' : ''}" data-depth="${depth}"${
  tint ? ` style="--org-tint:${tint}"` : ''}>
      <div class="org-box">
        <${hTag} class="org-station">${station}</${hTag}>
      </div>
      ${inner ? `<div class="org-node-body" id="${escHtml(bodyId)}"${open ? '' : ' hidden'}>${inner}</div>` : ''}
    </li>`;
}

/**
 * One scroller per root ฝ่าย — constraint (1) above, in markup.
 *
 * NO VIEWPORT BREAKOUT. The deleted version widened each section with
 * `width: 100vw; margin-inline: calc(50% - 50vw)`, which measured 395px of
 * content in a 390px viewport and gave the PAGE a horizontal scrollbar: `100vw`
 * includes the scrollbar gutter, and on a phone the ~24px it bought was worth
 * less than the sideways wobble it cost. The section scrolls inside the reading
 * column instead, which cannot overflow the page by construction.
 */
function linesHtml(roots, filter) {
  return roots.map((n) => {
    const one = lineBlock(n, 0, filter);
    return one
      ? `<div class="org-lines" data-view="lines"><ul class="org-tree">${one}</ul></div>`
      : '';
  }).join('');
}

/** ขยาย/ย่อทั้งหมด drives the page's own disclosures, which only แผนผัง and
 *  ผังสายงาน draw. ผังรวม has its แสดงถึง rung and ภาพรวม opens a sheet. */
function usesExpandAll() {
  return view === 'chart' || view === 'lines';
}

/** The ขยาย/ย่อทั้งหมด control. Hidden while searching (results are already
 *  fully open, so it would do nothing) and when nothing on the page collapses. */
function renderExpandAll(searching) {
  const btn = $('orgExpandAll');
  if (!btn) return;
  if (searching || !collapsibleIds.size) { btn.hidden = true; return; }
  btn.hidden = false;
  const allOpen = expanded.size >= collapsibleIds.size;
  btn.setAttribute('aria-expanded', String(allOpen));
  const icon = btn.querySelector('i');
  if (icon) icon.className = `bi ${allOpen ? 'bi-chevron-contract' : 'bi-chevron-expand'}`;
  const label = btn.querySelector('.org-expand-all-label');
  if (label) label.textContent = allOpen ? 'ย่อทั้งหมด' : 'ขยายทั้งหมด';
}

function render() {
  const body = $('orgBody');
  if (!body || !chart) return;
  renderYears();

  const filter = computeFilter(query);
  const roots = byParent.get('') || [];

  // ขยาย/ย่อทั้งหมด drives the DOM panels, which ผังรวม does not use — it has
  // its own แสดงถึง control, because "expanded" there is a d3 layout state
  // rather than a `hidden` attribute. Hide it rather than leave a button that
  // silently does nothing in one of the two views.
  renderExpandAll(!!filter || !usesExpandAll());

  const cnt = $('orgCount');
  if (cnt) {
    cnt.textContent = filter
      ? `พบ ${filter.keepMembers.size} คน`
      : `${(chart.nodes || []).length} ตำแหน่ง · ${(chart.members || []).length} คน`;
  }

  // Built before the shell so the empty state can be decided from the SAME
  // markup that would have been shown, rather than from a second guess at
  // whether the filter kept anything.
  const panels = view === 'chart'
    ? roots.map((n) => unitBlock(n, 0, filter)).join('')
    : view === 'lines' ? linesHtml(roots, filter)
      : view === 'overview' ? overviewPanels(roots, filter) : '';
  // ผังรวม builds its own DOM inside the canvas, so "did anything survive the
  // filter" is answered by the ROOT LIST there and by the MARKUP in the two
  // views that emit some — the same distinction the panel-only version made.
  const nothing = GRAPH_VIEWS.includes(view) ? !roots.length : !panels;

  if (nothing) {
    destroyOrgGraph();
    body.innerHTML = `<p class="org-status">${
      filter ? `ไม่พบ “${escHtml(filter.q)}” ในโครงสร้างองค์กร` : 'ยังไม่มีข้อมูลโครงสร้างองค์กร'
    }</p>`;
    return;
  }

  // Every paint replaces #orgBody's markup, which would strand the chart's
  // ResizeObserver and zoom behaviours on detached nodes. Tear down first,
  // unconditionally — including when leaving ผังรวม for แผนผัง.
  destroyOrgGraph();

  body.innerHTML = `
    <div class="org-tree-head">
      <h2 class="org-tree-heading">โครงสร้างทั้งหมด</h2>
      <div class="org-view-switch" role="group" aria-label="รูปแบบการแสดงผล">
        <button type="button" class="org-view-btn${view === 'overview' ? ' is-on' : ''}"
          data-org-view="overview" aria-pressed="${view === 'overview'}">
          <i class="bi bi-grid" aria-hidden="true"></i> ภาพรวม
        </button>
        <button type="button" class="org-view-btn${view === 'lines' ? ' is-on' : ''}"
          data-org-view="lines" aria-pressed="${view === 'lines'}">
          <i class="bi bi-diagram-2" aria-hidden="true"></i> ผังสายงาน
        </button>
        <button type="button" class="org-view-btn${view === 'chart' ? ' is-on' : ''}"
          data-org-view="chart" aria-pressed="${view === 'chart'}">
          <i class="bi bi-diagram-3" aria-hidden="true"></i> แผนผัง
        </button>
        <button type="button" class="org-view-btn${view === 'all' ? ' is-on' : ''}"
          data-org-view="all" aria-pressed="${view === 'all'}">
          <i class="bi bi-bounding-box" aria-hidden="true"></i> ผังรวม
        </button>
      </div>
    </div>
    ${view === 'all'
    ? graphShellHtml(filter)
    : view === 'lines' || view === 'overview'
      ? panels
      : `<div class="orgc-tree">${panels}</div>`}`;

  if (view === 'all') paintGraph(roots, filter);
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

/** ผังรวม's own toolbar + the host the chart mounts into. The depth control is
 *  separate from ขยาย/ย่อทั้งหมด because it is a LEVEL, not a boolean — the
 *  whole point of the view is choosing how far down to look. */
function graphShellHtml(filter) {
  const cur = graphRung[view];
  const lvl = (r, label) => `<button type="button" class="orgg-depth-btn${
    cur === r ? ' is-on' : ''}" data-org-rung="${r}" aria-pressed="${cur === r}">${label}</button>`;
  return `
    <div class="orgg-toolbar">
      ${filter ? '' : `
      <div class="orgg-depth" role="group" aria-label="ระดับที่แสดง">
        <span class="orgg-depth-label">แสดงถึง</span>
        ${(VIEW_RUNGS[view] || VIEW_RUNGS.all).map(([r, label]) => lvl(r, label)).join('')}
      </div>`}
      <div class="orgg-zoom" role="group" aria-label="ย่อ-ขยายมุมมอง">
        <button type="button" class="orgg-zoom-btn" data-org-zoom="out" aria-label="ซูมออก"><i class="bi bi-dash-lg" aria-hidden="true"></i></button>
        <button type="button" class="orgg-zoom-btn" data-org-zoom="in" aria-label="ซูมเข้า"><i class="bi bi-plus-lg" aria-hidden="true"></i></button>
        <button type="button" class="orgg-zoom-btn" data-org-zoom="fit" aria-label="พอดีหน้าจอ"><i class="bi bi-aspect-ratio" aria-hidden="true"></i></button>
      </div>
      <p class="orgg-hint">ผังเดียวทั้งองค์กร — ลากเพื่อเลื่อน กดที่ตัวเลขเพื่อเปิดตำแหน่งข้างใน</p>
    </div>
    <div class="orgg-host" id="orgGraphHost"></div>`;
}

/** Mount the charts. Async and fire-and-forget: the library is a dynamic import
 *  so the first switch into this view pays a network round trip, and awaiting it
 *  inside render() would freeze the other two views' repaint behind it. The
 *  token guards the case where the reader switches away (or changes year) while
 *  that import is still in flight — without it a late mount paints charts into a
 *  page that has moved on. */
/**
 * Widen a search result to the ancestors the CANVAS draws.
 *
 * `computeFilter` walks the stored parents, which is right for แผนผัง. On the
 * canvas, ฝ่าย PR's parent is the อุปนายก — a stored SIBLING —
 * so a search for "PR" would keep ฝ่าย PR without keeping the box the line is
 * drawn from, and `flatten`'s walk, which descends from the root and stops at
 * the first node the filter does not keep, would drop the whole branch.
 *
 * Widened HERE rather than in computeFilter so แผนผัง does not start listing a
 * head seat nobody searched for.
 */
function chartFilter(filter) {
  if (!filter) return null;
  const parentOf = new Map();
  for (const [k, kids] of byParentChart) for (const n of kids) parentOf.set(n.id, k);
  const keepNodes = new Set(filter.keepNodes);
  for (const id of filter.keepNodes) {
    let cur = parentOf.get(id);
    while (cur && !keepNodes.has(cur)) { keepNodes.add(cur); cur = parentOf.get(cur); }
  }
  return { ...filter, keepNodes };
}

let graphToken = 0;
async function paintGraph(roots, filter) {
  const mine = ++graphToken;
  const hostEl = $('orgGraphHost');
  if (!hostEl) return;
  hostEl.innerHTML = '<p class="org-status">กำลังวาดผังองค์กร…</p>';
  try {
    const ctx = {
      roots,
      byParent: byParentChart,
      byNode,
      subStats: subStatsChart,
      filter: chartFilter(filter),
      rung: graphRung[view],
      chart,
    };
    if (mine !== graphToken) return;
    hostEl.innerHTML = '';
    const drawn = await mountOrgGraph(hostEl, ctx);
    if (mine !== graphToken) { destroyOrgGraph(); return; }
    if (!drawn) {
      hostEl.innerHTML = `<p class="org-status">${
        filter ? `ไม่พบ “${escHtml(filter.q)}” ในโครงสร้างองค์กร` : 'ยังไม่มีข้อมูลโครงสร้างองค์กร'
      }</p>`;
    }
  } catch (err) {
    // A failed dynamic import (offline, a stale chunk after a deploy) must not
    // leave the reader on a spinner — the other two views still work, so say so
    // rather than pretending the data is missing.
    console.warn('org graph failed to load:', err);
    if (mine === graphToken && hostEl) {
      hostEl.innerHTML = '<p class="org-status is-error">แสดงผังองค์กรไม่ได้ ลองสลับไปมุมมอง แผนผัง</p>';
    }
  }
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

/** Toggle in the DOM rather than re-rendering. A full repaint of 296 ตำแหน่ง
 *  would drop the scroll position — and the row you clicked would jump out from
 *  under the pointer, which is exactly the wrong feel for a disclosure. */
/**
 * Open or close one disclosure — in EITHER view.
 *
 * Resolved through `aria-controls`, not through a parent class. แผนผัง's
 * markup is `.orgc-unit > .orgc-unit-body` and ผังสายงาน's is
 * `.org-node > .org-node-body`; a class-keyed lookup would need a branch per
 * view, and the second branch is the one that silently stops matching after a
 * markup change (`> .org-station` selectors, `frontend-ui.md`). The button
 * already names its panel because the ARIA accordion pattern requires it, so
 * the correct answer was in the markup all along.
 */
function toggleNode(btn) {
  const panel = document.getElementById(btn.getAttribute('aria-controls') || '');
  if (!panel) return;
  const willOpen = btn.getAttribute('aria-expanded') !== 'true';
  btn.setAttribute('aria-expanded', String(willOpen));
  panel.hidden = !willOpen;
  const id = panel.id.replace(/^org-n-/, '');
  if (willOpen) expanded.add(id); else expanded.delete(id);
  renderExpandAll(!!query || !usesExpandAll());
}

function revealOverview() {
  const head = $('orgBody')?.querySelector('.org-tree-head');
  const stage = $('orgBody')?.querySelector('.orgo');
  if (!head || !stage) return;
  const bottom = stage.getBoundingClientRect().bottom;
  if (bottom <= window.innerHeight && head.getBoundingClientRect().top >= 0) return;
  const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  head.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
}

export function initOrgChart() {
  // ESC leaves เต็มหน้าจอ. The overlay is ours, not the Fullscreen API (iOS and
  // iPadOS only honour requestFullscreen on <video>), so the browser will not
  // provide this for free — and an overlay with no keyboard exit is a trap on a
  // desktop, where ESC is the reflex.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && anyGraphFullscreen()) {
      exitGraphFullscreen();
      $('orgBody')?.querySelectorAll('[data-orgg-full] i').forEach((i) => {
        i.className = 'bi bi-arrows-fullscreen';
      });
    }
  });

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

    // Both views' disclosure rows. One handler, because toggleNode resolves the
    // panel from aria-controls rather than from either view's class names.
    const btn = e.target.closest('.orgc-unit-btn, .org-station-btn');
    if (btn && btn.tagName === 'BUTTON') { toggleNode(btn); return; }

    // ผังรวม's "แสดงถึง" control. A full re-layout rather than a DOM toggle:
    // the rung decides d3's LAYOUT, not just visibility, so every box moves.
    const db = e.target.closest('[data-org-rung]');
    if (db) {
      const next = db.dataset.orgRung;
      if (!RUNG[next] || next === graphRung[view]) return;
      graphRung[view] = next;
      setGraphRung(next);
      $('orgBody')?.querySelectorAll('[data-org-rung]').forEach((b) => {
        const on = b.dataset.orgRung === next;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      return;
    }

    // เต็มหน้าจอ. The button lives on the section, which org-graph.js builds —
    // delegated here because #orgBody is the one element that survives a paint.
    const fb = e.target.closest('[data-orgg-full]');
    if (fb) {
      const on = toggleGraphFullscreen(fb.closest('.orgg-section'));
      fb.querySelector('i')?.setAttribute('class',
        `bi bi-${on ? 'fullscreen-exit' : 'arrows-fullscreen'}`);
      fb.setAttribute('aria-label', on ? 'ออกจากเต็มหน้าจอ' : 'ดูเต็มหน้าจอ');
      return;
    }

    const zb = e.target.closest('[data-org-zoom]');
    if (zb) {
      const how = zb.dataset.orgZoom;
      if (how === 'fit') fitGraphs();
      else zoomGraphs(how === 'in' ? 1 : -1);
      return;
    }

    // ภาพรวม ⇄ ผังสายงาน ⇄ แผนผัง ⇄ ผังรวม.
    const vb = e.target.closest('[data-org-view]');
    if (!vb) return;
    const next = VIEWS.includes(vb.dataset.orgView) ? vb.dataset.orgView : 'chart';
    // 'chart' is the fallback because it is the DEFAULT view, not because it is
    // the first in VIEWS — those are two different facts and they used to be
    // the same value.
    if (next === view) return;
    view = next;
    try { localStorage.setItem('samo.org.view', view); } catch { /* private mode */ }
    render();
    // ภาพรวม is sized to the screen (on a computer), so it only fits once the
    // reader is AT it. Bring its heading to the top when it was chosen — never
    // on page load, which would hijack a scroll nobody asked for.
    if (view === 'overview') revealOverview();
  });

  $('orgExpandAll')?.addEventListener('click', () => {
    const allOpen = expanded.size >= collapsibleIds.size;
    expanded = allOpen ? new Set() : new Set(collapsibleIds);
    if (chart) render();
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
