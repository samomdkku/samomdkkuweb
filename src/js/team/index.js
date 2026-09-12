// ==============================================
// SAMO TEAM — org tree manager (admin section "team", vp_admin + dev)
//
// Two modes, toggled in the toolbar so the page never gets crowded:
//   • "team"  — roles + people: add/edit/move/delete nodes & members,
//               drag-and-drop reorder, plus an explicit "ย้าย" (move) picker
//               for promoting/demoting across levels without fiddly drag.
//   • "perms" — per-role app-permission assignment with inheritance
//               (org metadata only — NOT yet wired into live login; see STATE).
//
// Mutations are optimistic: update the in-memory model + re-render first,
// then persist; on a write failure we reload from the server and toast.
// ==============================================

import {
  PERM_CATALOG, PERM_LABEL, PERM_ICON, VS_DEPTS, VS_DEPT_LABEL,
  PROJECT_SEATS, PROJECT_SEAT_LABEL, IMPLICIT_PERMS,
  DEPT_PAGES, DEPT_PAGE_LABEL, DEPT_PAGES_ALL,
} from '../team-vocab.js';
import { escHtml } from '../utils.js';
import { normalizeKind } from '../node-kind.js';
import { tintColor, isHexColor } from '../dept-tint.js';
import { tierOf } from '../org-rung.js';
import { uploadTeamPhoto, portraitSrc, focusToObjectPosition } from '../uploads.js';
import { cropImage } from '../image-crop.js';
import { dbRest } from '../db.js';
import {
  fetchTree, createNode, updateNode, deleteNode,
  createMember, updateMember, deleteMember,
  patchNodePositions, patchMemberPositions, deleteTeamPhotoIfUnused, photoToRetire,
  fetchMajors, createMajor, updateMajor, deleteMajor,
  countMembersWithMajor, renameMajorOnMembers, searchPeople,
} from './api.js';
// The one definition of what a รหัสนักศึกษา / ชั้นปี / สาขา may look like,
// shared with the CSV importer and the public ตำแหน่งของฉัน card.
import {
  normalizeIdentityFields, majorKey, SID_HINT, suggestNameSplit,
} from './fields.js';
// An app-owned "are you sure?". `window.confirm` is not reliable control flow
// here: once Chrome's "Prevent this page from creating additional dialogs" box
// is ticked — and an admin session that deletes things is the session that
// reaches it first — every later confirm() returns FALSE instantly with no UI,
// so a delete, a bulk delete and a permission SAVE all become buttons that do
// nothing at all. This tab has already shipped that bug twice.
import { askConfirm, askDelete } from '../confirm-modal.js';
// The same 23505 translator ระบบบ้าน uses. เพิ่มสาขา has a client-side pre-check
// for an exact-match code, but `team_majors_code_uniq` can still fire on a race
// or a case/whitespace difference the pre-check normalised away — and when it
// does, the raw constraint name is what the admin would otherwise read.
import { duplicateMessage } from '../duplicate-message.js';
// ONE ชั้นปี rule for the whole app — see src/js/study-year.js. ทีม SAMO used to
// STORE its answer in `team_members.year` instead, and 0145 is what that cost:
// nine members reading a ชั้นปี exactly one year behind the truth, an edit box
// that silently reverted, and one person seeing ปี 5 / จบแล้ว / ปี 5 on three
// screens. This pane now computes, and offers no box that writes a year.
import { studyYearLabel, yearBasis } from '../study-year.js';
import { userCanAccess, getUser } from '../auth.js';
import { subscribeTeam } from './realtime.js';
import { initTerms, enterTerms, primeTerms } from './terms.js';
import { initHealth, enterHealth, issuesByMember } from './health.js';
import {
  buildExportJson, buildMembersCsv, parseMembersCsv, splitPath, PATH_SEP,
  isLikelyEmail, validateExportJson,
} from './io.js';

// App permissions that can be attached to a node (keys match userCanAccess).
// The grant vocabulary (permission keys, VS depts, project seats) lives in
// src/js/team-vocab.js so the PUBLIC "ตำแหน่งของฉัน" card names them the same
// way this admin UI does. Behaviour here is unchanged — same lists, one home.

// Keyed by the NORMALISED kind — two of them now (see src/js/node-kind.js).
const KIND_ICON = { division: 'bi-diagram-2', role: 'bi-person-badge' };

// Mirrors the CHECK on team_nodes.tier (0153). Two copies of one number, so the
// → button greys out at the same place the database refuses — otherwise the
// last press is a round trip that fails with a raw 23514.
const TIER_MAX = 9;

// ---- module state ----
let initialized = false;
let loaded = false;
let loading = null;            // in-flight load promise (single-flight)
let mode = 'team';             // 'team' | 'perms' | 'years'
// The live term's year — used to file photo uploads into Team/<ปี>/… and
// shown nowhere else. Populated by terms.js, which owns the registry.
let currentTermYear = null;
const nodesById = new Map();   // id -> node
let childrenByParent = new Map(); // parentId|'' -> [nodes]
const membersByNode = new Map(); // nodeId -> [members]
const expanded = new Set();     // expanded node ids
let searchQ = '';
let selectionMode = false;     // multi-select for bulk move / delete
const selectedNodes = new Set();
const selectedMembers = new Set();
let pendingPlan = null;        // CSV import plan awaiting per-conflict resolution
let sortables = [];            // live Sortable instances, destroyed on re-render
let rtStarted = false;         // realtime subscription established once
let dragging = false;          // a drag is in progress — defer remote re-renders
let pendingRender = false;     // a remote change arrived mid-drag
let renderTimer = null;        // debounce coalescing bursts of remote events
// memberId -> Set of reasons that row needs ตรวจสอบ, recomputed once per render
// and read by both renderMember() and the mode-button badge. Cheap: ~400 rows
// over 6 fields, no query — findIssues() is pure and the data is already here.
let healthFlags = new Map();
// nodeId -> how many flagged members sit anywhere BELOW it, so a collapsed
// branch still says there is something inside worth opening.
let healthNodeCounts = new Map();
// photo_focus of the member currently open in the editor. No longer a form
// control (the crop dialog replaced it) — carried so saving an unrelated field
// preserves a legacy row's 'top'/'bottom', and reset to 'center' on re-upload.
let memberPhotoFocus = 'center';
// The สาขา vocabulary (migration 0113). Loaded once per session, kept here so
// every chooser and every normalise call reads the SAME list — a select filled
// from a stale copy would offer a code the validator then rejects.
let majors = [];

const $ = (id) => document.getElementById(id);

/** The vocabulary as plain codes, for fields.js normalisation. */
function majorCodes() {
  return majors.map((m) => m.code);
}

// ============================================================
// DATA / INDEXES
// ============================================================

function rebuildIndexes(nodes, members) {
  nodesById.clear();
  childrenByParent = new Map();
  membersByNode.clear();
  nodes.forEach((n) => nodesById.set(n.id, n));
  rebuildChildrenIndexFromNodes();
  members.forEach((m) => {
    if (!membersByNode.has(m.node_id)) membersByNode.set(m.node_id, []);
    membersByNode.get(m.node_id).push(m);
  });
  for (const arr of membersByNode.values()) {
    arr.sort((a, b) => (a.position - b.position)
      || String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th'));
  }
}

function childrenOf(id) { return childrenByParent.get(id || '') || []; }

/**
 * Move a ตำแหน่ง one rung up or down inside its ฝ่าย.
 *
 * Optimistic: the row repaints from the local model and the write follows. The
 * alternative is a spinner on a button whose whole point is that it is cheaper
 * than a drag, and a failed write puts the old value back and says so.
 *
 * `null` is written rather than `1`, so "never been told otherwise" stays
 * distinguishable from "explicitly rung 1" — the column's default is the
 * former, and 296 rows should not acquire a value to say nothing.
 */
async function shiftTier(nodeId, delta) {
  const node = nodesById.get(nodeId);
  if (!node || !canEdit()) return;
  const from = tierOf(node);
  const to = Math.min(TIER_MAX, Math.max(1, from + delta));
  if (to === from) return;

  const stored = to === 1 ? null : to;
  node.tier = stored;
  render();
  try {
    await updateNode(nodeId, { tier: stored });
  } catch (err) {
    node.tier = from === 1 ? null : from;
    render();
    setStatus(`เปลี่ยนระดับไม่สำเร็จ: ${err.message || err}`);
  }
}
function membersOf(id) { return membersByNode.get(id) || []; }

function subtreeMemberCount(id) {
  let n = membersOf(id).length;
  for (const c of childrenOf(id)) n += subtreeMemberCount(c.id);
  return n;
}

/** "Division / Dept / Role" breadcrumb for a node (for select labels). */
function nodePath(id) {
  const parts = [];
  let cur = nodesById.get(id);
  while (cur) { parts.unshift(cur.name); cur = cur.parent_id ? nodesById.get(cur.parent_id) : null; }
  return parts.join(' / ');
}

function inheritedPermsFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    (cur.permissions || []).forEach((p) => out.add(p));
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** A node's full effective perms = its own perms ∪ what it inherits. */
function nodeEffectivePerms(nodeId) {
  const out = new Set(nodesById.get(nodeId)?.permissions || []);
  inheritedPermsFor(nodeId).forEach((p) => out.add(p));
  return out;
}

/** A member's effective app-permissions = their own extras ∪ (if the
 *  member inherits) the node's effective perms. Mirrors the SQL
 *  effective_team_permissions_for_email (migration 0081). */
function memberEffectivePerms(m) {
  const out = new Set(m.permissions || []);
  if (m.inherit_permissions !== false) nodeEffectivePerms(m.node_id).forEach((p) => out.add(p));
  return out;
}

/** VS depts a node inherits from its ancestors (mirrors inheritedPermsFor).
 *  `inheritOn` overrides the node's own inherit flag for live modal preview. */
function inheritedVsDeptsFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    if (cur.vs_dept) out.add(cur.vs_dept);
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** A node's full effective VS depts = its own binding ∪ inherited. */
function nodeEffectiveVsDepts(nodeId) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (node?.vs_dept) out.add(node.vs_dept);
  inheritedVsDeptsFor(nodeId).forEach((d) => out.add(d));
  return out;
}

/** The token the SERVER stores for a passport scope.
 *
 *  ⚠️ MIRROR of `public.passport_scope_tokens(dept, sub)` — a sub-department
 *  wins over its department, because `s:12` already says which ฝ่าย it is in.
 *  `team-vocab.test.js` pins the rule; if the SQL changes, change both.
 */
export function passportToken(deptId, subId) {
  if (subId != null && subId !== '') return `s:${subId}`;
  if (deptId != null && deptId !== '') return `d:${deptId}`;
  return null;
}

/** Passport scopes a node inherits from its ANCESTORS (mirrors
 *  inheritedVsDeptsFor, and `public.node_effective_passport_scopes` minus the
 *  node's own binding). */
function inheritedPassportScopesFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    const t = passportToken(cur.passport_dept_id, cur.passport_sub_dept_id);
    if (t) out.add(t);
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** ฝ่าย pages a node inherits from its ANCESTORS. Mirrors
 *  `public.node_effective_dept_pages` minus the node's own binding — and the
 *  SQL is the authority: if the two ever disagree the chip is wrong, not the
 *  grant. Same walk as its three siblings above, deliberately. */
function inheritedDeptPagesFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    if (cur.dept_page) out.add(cur.dept_page);
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** A node's full effective ฝ่าย pages = its own binding ∪ inherited. ADDITIVE,
 *  because holding two pages is holding two — unlike the project SEAT, where
 *  0092 had to make the nearest binding REPLACE what it inherits. */
function nodeEffectiveDeptPages(nodeId) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (node?.dept_page) out.add(node.dept_page);
  inheritedDeptPagesFor(nodeId).forEach((t) => out.add(t));
  return out;
}

/** A node's full effective passport scopes = its own binding ∪ inherited. */
function nodeEffectivePassportScopes(nodeId) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  const own = node && passportToken(node.passport_dept_id, node.passport_sub_dept_id);
  if (own) out.add(own);
  inheritedPassportScopesFor(nodeId).forEach((t) => out.add(t));
  return out;
}

/** Human label for a scope token. Falls back to the id rather than rendering
 *  an empty chip: `loadPassportDepts()` is async, so a row can paint before the
 *  names arrive, and a chip with no text reads as a bug rather than as "still
 *  loading". */
function passportScopeLabel(token) {
  if (!token) return '';
  const [kind, id] = String(token).split(':');
  if (kind === 's') {
    const sub = passportSubs.find((x) => String(x.id) === id);
    if (!sub) return `แผนกย่อย #${id}`;
    const dept = passportDepts.find((d) => String(d.id) === String(sub.department_id));
    return dept ? `${dept.name} — ${sub.name}` : sub.name;
  }
  const dept = passportDepts.find((d) => String(d.id) === id);
  return dept ? dept.name : `ฝ่าย #${id}`;
}

/** Project seats a node inherits from its ancestors. Unlike permissions and
 *  VS depts, seats are NOT additive: the NEAREST ancestor that names one is the
 *  answer, because a seat is a single role in one workflow and holding two is
 *  ambiguous rather than wider (migration 0092 — mirrors
 *  node_effective_project_seats). `inheritOn` overrides the node's own flag so
 *  the modal can preview a toggle before it is saved. */
function inheritedSeatsFor(nodeId, inheritOn = null) {
  const out = new Set();
  const node = nodesById.get(nodeId);
  if (!node) return out;
  const on = inheritOn === null ? node.inherit_permissions !== false : inheritOn;
  if (!on) return out;
  let cur = node.parent_id ? nodesById.get(node.parent_id) : null;
  while (cur) {
    if (cur.project_seat) { out.add(cur.project_seat); break; }   // nearest wins
    if (!cur.inherit_permissions) break;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return out;
}

/** A node's effective project seat. Its OWN binding replaces what it would
 *  otherwise inherit (0092) — so a ฝ่าย that says "เจ้าหน้าที่คณะ" is not
 *  widened back to "ผู้ส่งหนังสือ" by its parent. */
function nodeEffectiveSeats(nodeId) {
  const node = nodesById.get(nodeId);
  if (node?.project_seat) return new Set([node.project_seat]);
  return inheritedSeatsFor(nodeId);
}

function isAncestor(maybeAncestor, nodeId) {
  let cur = nodesById.get(nodeId);
  while (cur) {
    if (cur.id === maybeAncestor) return true;
    cur = cur.parent_id ? nodesById.get(cur.parent_id) : null;
  }
  return false;
}

// ============================================================
// LOAD
// ============================================================

export function initTeam() {
  if (initialized) return;
  initialized = true;
  // EACH WIRE-UP IS INDEPENDENT. They used to be ten bare calls in a row, so a
  // throw in any one of them silently skipped every later one — and
  // wireTreeDelegation() is in that list, which means one bad line in an
  // unrelated modal takes out every button in the tree. That is the shape
  // behind "the add-people button doesn't work, it doesn't show anything":
  // a dead tree looks identical to a missing handler, with nothing logged
  // where anyone would look.
  //
  // Now one failure costs its own feature and says so, instead of costing the
  // page.
  for (const [name, fn] of [
    ['toolbar', wireToolbar], ['nodeModal', wireNodeModal], ['picker', wirePicker],
    ['permModal', wirePermModal], ['memberPermModal', wireMemberPermModal],
    ['memberModal', wireMemberModal], ['modalSave', wireModalSave],
    ['treeDelegation', wireTreeDelegation], ['io', wireIO], ['majors', wireMajors],
  ]) {
    try { fn(); } catch (err) { console.error(`[team] wire ${name} failed:`, err); }
  }
  initTerms(document.getElementById('teamTermsPane'), {
    onChange: (year) => { currentTermYear = year; },
  });
  // health.js reads through getData rather than being handed a snapshot, so it
  // always sees the live in-memory tree — including rows another pane just
  // changed — without index.js having to push updates at it.
  initHealth(document.getElementById('teamHealthPane'), {
    getData: () => ({
      loaded,
      members: allMembersFlat(),
      nodeName: (id) => nodesById.get(id)?.name || '',
    }),
    onChanged: () => reload(),
  });
}

/** Surface the outstanding count on the mode button. Cheap — it runs over the
 *  members already in memory, no query. */
function refreshHealthFlags() {
  if (!loaded) { healthFlags = new Map(); healthNodeCounts = new Map(); return 0; }
  const { map, total } = issuesByMember(allMembersFlat(), (id) => nodesById.get(id)?.name || '');
  healthFlags = map;

  // Roll each flagged member up its ancestor chain. `seen` guards against a
  // cycle in parent_id — the tree should not contain one, but an infinite loop
  // inside render() would hang the whole tab rather than show a wrong number.
  healthNodeCounts = new Map();
  const nodeOf = new Map();
  for (const [nodeId, arr] of membersByNode) for (const mm of arr) nodeOf.set(mm.id, nodeId);
  for (const memberId of map.keys()) {
    let cur = nodeOf.get(memberId);
    const seen = new Set();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      healthNodeCounts.set(cur, (healthNodeCounts.get(cur) || 0) + 1);
      cur = nodesById.get(cur)?.parent_id || null;
    }
  }
  const badge = $('teamHealthBadge');
  if (badge) {
    badge.textContent = total ? String(total) : '';
    badge.classList.toggle('d-none', !total);
  }
  return total;
}

export function enterTeamWorkspace() {
  if (loaded || loading) return loading || undefined;
  return reload();
}

async function reload() {
  loading = (async () => {
    try {
      setStatus('กำลังโหลด…');
      const { nodes, members } = await fetchTree();
      rebuildIndexes(nodes, members);
      if (!loaded) childrenOf(null).forEach((n) => expanded.add(n.id));
      loaded = true;
      render();
      ensureRealtime();
      // Fire-and-forget: only needed to name the Drive upload folder, so it must
      // never delay or fail the tree load.
      primeTerms();
    } catch (e) {
      console.warn('[team] load failed:', e?.message || e);
      const tree = $('teamTree');
      if (tree) tree.innerHTML = `<div class="team-empty team-empty-error">โหลดไม่สำเร็จ: ${escHtml(e?.message || '')}</div>`;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

// ============================================================
// REALTIME (live multi-editor sync)
// ============================================================

function ensureRealtime() {
  if (rtStarted) return;
  rtStarted = true;
  subscribeTeam(applyRemoteChange);
}

/** Coalesce remote-change re-renders; never render mid-drag (it would cancel
 *  the user's in-flight SortableJS gesture). */
function scheduleRemoteRender() {
  if (dragging) { pendingRender = true; return; }
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => render(), 120);
}

function removeMemberEverywhere(id) {
  for (const [nid, arr] of membersByNode) {
    const i = arr.findIndex((m) => m.id === id);
    if (i >= 0) { arr.splice(i, 1); if (!arr.length) membersByNode.delete(nid); return; }
  }
}

/** Coerce a realtime node row: `permissions` can arrive as a Postgres array
 *  literal ("{pr,vs}") on some realtime versions instead of a JS array. */
function normalizeNodeRow(n) {
  let perms = n.permissions;
  if (typeof perms === 'string') {
    perms = perms.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
  }
  return { ...n, permissions: Array.isArray(perms) ? perms : [], inherit_permissions: n.inherit_permissions !== false };
}

/** Same array-literal coercion for a realtime member row (0081 added
 *  team_members.permissions / inherit_permissions). */
function normalizeMemberRow(m) {
  let perms = m.permissions;
  if (typeof perms === 'string') {
    perms = perms.replace(/^\{|\}$/g, '').split(',').map((s) => s.replace(/^"|"$/g, '')).filter(Boolean);
  }
  return { ...m, permissions: Array.isArray(perms) ? perms : [], inherit_permissions: m.inherit_permissions !== false };
}

function applyRemoteChange(table, payload) {
  const type = payload.eventType || payload.type;
  if (table === 'team_nodes') {
    if (type === 'DELETE') {
      const id = payload.old?.id;
      if (id) { nodesById.delete(id); membersByNode.delete(id); expanded.delete(id); }
    } else if (payload.new) {
      nodesById.set(payload.new.id, normalizeNodeRow(payload.new));
    }
    rebuildChildrenIndexFromNodes();
  } else if (table === 'team_members') {
    if (type === 'DELETE') {
      if (payload.old?.id) removeMemberEverywhere(payload.old.id);
    } else if (payload.new) {
      removeMemberEverywhere(payload.new.id);
      const nid = payload.new.node_id;
      if (!membersByNode.has(nid)) membersByNode.set(nid, []);
      membersByNode.get(nid).push(normalizeMemberRow(payload.new));
      rebuildMembersIndex();
    }
  }
  scheduleRemoteRender();
}

// ============================================================
// RENDER
// ============================================================

function destroySortables() {
  sortables.forEach((s) => { try { s.destroy(); } catch (_) {} });
  sortables = [];
}

function setStatus(msg) { const el = $('teamStatus'); if (el) el.textContent = msg || ''; }

function render() {
  // Read-only chrome (0110). Toggled on every render rather than once at boot,
  // because onAuthChange can hand us a different account mid-session (the
  // account switcher swaps the session in place) and a stale ADD button would
  // be a live-looking control that always 42501s.
  // The write controls ship HIDDEN in the markup and are revealed here. That
  // direction matters: a scheme that hides by ADDING a class shows everything
  // to everyone if this code never runs (the logged data-projects-role trap),
  // and "everything" here means the buttons a viewer must not be offered.
  const writable = canEdit();
  document.querySelectorAll('[data-team-write]').forEach((el) => el.classList.toggle('d-none', !writable));
  document.getElementById('teamReadOnlyNote')?.classList.toggle('d-none', writable);
  document.querySelectorAll('[data-team-modal-save]').forEach((el) => el.classList.toggle('d-none', !writable));

  const tree = $('teamTree');
  if (!tree) return;
  // Scope chips name a ฝ่าย, and the names live in the passport schema behind
  // an RPC. Without this the tree drew `ฝ่าย #5`.
  if (mode === 'perms') ensurePassportNames(render);
  destroySortables();

  // The ปีการศึกษา pane is a different surface, not a different rendering of the
  // tree — hide the tree and its toolbar rather than trying to express years
  // inside the node list.
  const isYears = mode === 'years';
  const isHealth = mode === 'health';
  const isPane = isYears || isHealth;
  tree.classList.toggle('d-none', isPane);
  $('teamTermsPane')?.classList.toggle('d-none', !isYears);
  $('teamHealthPane')?.classList.toggle('d-none', !isHealth);
  document.querySelector('.team-toolbar')?.classList.toggle('d-none', isPane);
  // BEFORE the tree paints — renderMember reads healthFlags.
  refreshHealthFlags();
  if (isPane) {
    document.querySelectorAll('.team-mode-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.teamMode === mode);
    });
    const h = $('teamModeHint');
    if (h) h.textContent = '';
    setStatus('');
    // Deliberately does NOT repaint the terms pane. render() is also the target
    // of scheduleRemoteRender(), so another admin editing the live tree would
    // innerHTML-rebuild this pane and destroy whatever the user is typing in the
    // archive editor — the same class of bug the `dragging` guard exists for.
    // terms.js owns its own pane and repaints on its own actions; the archive is
    // independent of the live tree, so a tree change is not news to it.
    //
    // Same for ตรวจสอบข้อมูล: health.js holds half-typed emails and รหัสนักศึกษา
    // in its inputs, and a remote tree edit rebuilding that pane would throw
    // them away. It repaints after its own writes.
    //
    // And the same, most sharply, for ข้อมูลของฉัน: its form is the person's own
    // half-typed record. showMySeat() runs from switchMode/enterTeam only.
    return;
  }

  // toolbar reflects mode
  $('teamAddRoot')?.classList.toggle('d-none', mode !== 'team');
  document.querySelectorAll('.team-mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.teamMode === mode);
  });
  const hint = $('teamModeHint');
  if (hint) {
    // On touch, say that reordering needs a deliberate hold. Without this the
    // new long-press requirement just reads as "dragging is broken now".
    const touchHint = coarsePointer() && !searchQ && !selectionMode
      ? 'จัดลำดับ: กดค้างที่ปุ่มลาก แล้วลาก — ปัดเพื่อเลื่อนหน้าได้ตามปกติ'
      : '';
    hint.textContent = mode === 'perms'
      ? 'แตะที่ตำแหน่งเพื่อกำหนดสิทธิ์ของทั้งตำแหน่ง หรือแตะที่ชื่อบุคคลเพื่อกำหนดสิทธิ์รายบุคคล — สีทึบคือสิทธิ์ที่กำหนดเอง สีเส้นประคือสิทธิ์ที่รับมาจากตำแหน่ง'
      : touchHint;
  }

  const roots = childrenOf(null);
  const filter = searchQ ? computeFilter(searchQ) : null;
  setStatus(`${nodesById.size} ตำแหน่ง · ${[...membersByNode.values()].reduce((a, b) => a + b.length, 0)} สมาชิก`);

  if (!roots.length) {
    tree.innerHTML = '<div class="team-empty">ยังไม่มีฝ่าย — กด “เพิ่มฝ่าย” เพื่อเริ่ม</div>';
    return;
  }

  const ul = document.createElement('ul');
  ul.className = 'team-children team-root';
  ul.dataset.parentId = '';
  roots.forEach((n) => { const li = renderNode(n, filter, 0); if (li) ul.appendChild(li); });
  tree.innerHTML = '';
  tree.appendChild(ul);

  // Drag is for fine reordering, so it belongs to จัดการทีม only — dragging in
  // จัดการสิทธิ์ could only ever reorder the tree by accident while the user is
  // there to edit permissions. Also off while filtering or selecting. The "ย้าย"
  // picker / bulk-move bar handle cross-level + multi moves.
  if (mode === 'team' && canEdit() && !searchQ && !selectionMode) attachSortables(tree);

  tree.classList.toggle('is-selectmode', selectionMode);
  $('teamSelectMode')?.classList.toggle('is-active', selectionMode);
  updateSelectionBar();
}

function renderNode(node, filter, depth = 0) {
  if (filter && !filter.visible.has(node.id)) return null;
  const kids = childrenOf(node.id);
  const mem = membersOf(node.id);
  // Both modes list people now. Team mode = identity/structure (add/move/edit
  // the person); perms mode = per-person permission editor rows under each node.
  const showMembers = true;
  // In team mode EVERY node is expandable — a role can always hold members, so
  // you must be able to open even an empty one to reveal its drop zone / add
  // button. In perms mode a node expands when it has child nodes OR people to
  // grant perms to.
  const expandable = mode === 'team' ? true : (kids.length > 0 || mem.length > 0);
  const isOpen = filter ? true : expanded.has(node.id);
  const count = subtreeMemberCount(node.id);

  const li = document.createElement('li');
  li.className = 'team-node' + (selectionMode && selectedNodes.has(node.id) ? ' is-selected' : '');
  li.dataset.nodeId = node.id;
  li.dataset.kind = normalizeKind(node.kind);
  // REPORTED: "every ฝ่าย got the same color, making it confusing what's outer,
  // what's inner, what's sub of which". Indentation alone stopped carrying the
  // hierarchy once every container became a ฝ่าย — 93 of them, all painted the
  // same green. The depth is what team.css grades the row and its guide rail
  // by. Capped at 3: past that the tint is already at its lightest, and an
  // uncapped attribute would need a rule per level forever.
  li.dataset.depth = String(Math.min(depth, 3));
  // Colour says WHICH root ฝ่าย you are inside; the depth grading above says how
  // deep. Set once on the root and inherited by the whole subtree — a custom
  // property cascades, so nothing has to carry the tint down by hand. The table
  // is shared with the public chart (dept-tint.js) so a ฝ่าย is not yellow on
  // one screen and green on the other. An unrecognised ฝ่าย sets nothing and
  // keeps the brand green that .team-tree declares.
  // A colour set ANYWHERE down the tree overrides what it inherits, so a
  // sub-ฝ่าย can be given its own identity without detaching it from its root.
  // Nothing set = inherit, which is why this is not applied unconditionally.
  const tint = tintColor(node, depth === 0);
  if (tint) li.style.setProperty('--node-tint', tint);

  const checkbox = selectionMode
    ? `<input type="checkbox" class="team-check" data-act="select" ${selectedNodes.has(node.id) ? 'checked' : ''} aria-label="เลือกตำแหน่ง" />`
    : '';

  let permChips = '';
  if (mode === 'perms') {
    permChips = permChipsHtml({
      own: new Set(node.permissions || []),
      inherited: inheritedPermsFor(node.id),
      vsOwn: node.vs_dept || null,
      vsInherited: inheritedVsDeptsFor(node.id),
      seatOwn: node.project_seat || null,
      seatInherited: inheritedSeatsFor(node.id),
      passOwn: passportToken(node.passport_dept_id, node.passport_sub_dept_id),
      passInherited: inheritedPassportScopesFor(node.id),
      pageOwn: node.dept_page || null,
      pageInherited: inheritedDeptPagesFor(node.id),
    });
  }

  // ระดับ — rank inside the ฝ่าย, so a ตำแหน่ง never has to be NESTED inside
  // another one just to be drawn a row lower (0153). Only offered where it
  // means something: on a ตำแหน่ง whose parent is a ฝ่าย. A seat still stored
  // under another seat draws by nesting, and showing a rung control there would
  // imply two ways of saying one thing.
  const parentNode = node.parent_id ? nodesById.get(node.parent_id) : null;
  const canTier = normalizeKind(node.kind) === 'role'
    && (!parentNode || normalizeKind(parentNode.kind) === 'division');
  const tier = tierOf(node);
  // The indent PREVIEWS the chart inside a flat list, so the admin can see the
  // shape they are describing without the tree having to be shaped like it.
  const tierIndent = canTier && tier > 1
    ? `<span class="team-tier-indent" style="width:${(tier - 1) * 1.4}rem"></span>` : '';
  const tierControl = !canTier ? '' : `
      ${tier > 1 ? `<span class="team-tier-pill" title="ระดับที่ ${tier} ในผังองค์กร">ระดับ ${tier}</span>` : ''}
      ${canEdit() ? `<span class="team-tier-arrows">
        <button type="button" class="team-tier-btn" data-act="tier-up" title="ขึ้นหนึ่งระดับ"
          aria-label="ขึ้นหนึ่งระดับ"${tier <= 1 ? ' disabled' : ''}>&#8592;</button>
        <button type="button" class="team-tier-btn" data-act="tier-down" title="ลงหนึ่งระดับ"
          aria-label="ลงหนึ่งระดับ"${tier >= TIER_MAX ? ' disabled' : ''}>&#8594;</button>
      </span>` : ''}`;

  const nameHtml = filter ? highlight(node.name, filter.q) : escHtml(node.name);
  const actions = !canEdit() ? '' : mode === 'team' ? `
        <button type="button" class="team-act" data-act="add-member" title="เพิ่มสมาชิก"><i class="bi bi-person-plus"></i></button>
        <button type="button" class="team-act" data-act="add-child" title="เพิ่มตำแหน่งย่อย"><i class="bi bi-plus-square"></i></button>
        <button type="button" class="team-act" data-act="move" title="ย้าย"><i class="bi bi-arrows-move"></i></button>
        <button type="button" class="team-act" data-act="edit" title="แก้ไข"><i class="bi bi-pencil"></i></button>
        <button type="button" class="team-act team-act-danger" data-act="delete" title="ลบ"><i class="bi bi-trash"></i></button>`
    : `
        <button type="button" class="team-act team-act-perm" data-act="edit-perms" title="กำหนดสิทธิ์"><i class="bi bi-shield-lock"></i></button>`;

  li.innerHTML = `
    <div class="team-row" data-node-id="${node.id}">
      ${checkbox}
      ${canEdit() ? '<span class="team-handle" title="ลากเพื่อจัดลำดับ"><i class="bi bi-grip-vertical"></i></span>' : ''}
      <button type="button" class="team-caret ${expandable ? '' : 'is-leaf'}" data-act="toggle"
        aria-label="ขยาย/ย่อ">${expandable ? `<i class="bi bi-chevron-${isOpen ? 'down' : 'right'}"></i>` : ''}</button>
      ${tierIndent}<i class="bi ${KIND_ICON[normalizeKind(node.kind)]} team-node-icon"></i>
      <span class="team-node-name" data-act="primary">${nameHtml}</span>
      ${tierControl}
      ${count ? `<span class="team-count" title="สมาชิกในสายนี้">${count}</span>` : ''}
      ${healthNodeCounts.get(node.id)
        ? `<button type="button" class="team-count team-count-warn" data-act="check-member"
             title="มี ${healthNodeCounts.get(node.id)} รายชื่อในสายนี้ที่ต้องตรวจสอบข้อมูล"
             aria-label="ต้องตรวจสอบ ${healthNodeCounts.get(node.id)} รายการ"
           ><i class="bi bi-exclamation-triangle-fill"></i> ${healthNodeCounts.get(node.id)}</button>`
        : ''}
      <span class="team-perms">${permChips}</span>
      <span class="team-row-actions">${actions}</span>
    </div>`;

  const body = document.createElement('div');
  body.className = 'team-node-body';
  if (!isOpen) body.classList.add('d-none');

  if (showMembers) {
    const mul = document.createElement('ul');
    mul.className = 'team-members';
    mul.dataset.nodeId = node.id;
    mem.forEach((m) => { const mli = renderMember(m, filter); if (mli) mul.appendChild(mli); });
    // Empty-role drop zone: on a LEAF role with no members, a placeholder gives
    // the (otherwise zero-height) list a droppable area AND tells the user they
    // can drag a person here or add one. Skipped on structural nodes (they have
    // child nodes) to avoid noise — use the + button to add a direct member.
    if (mode === 'team' && canEdit() && !mem.length && !kids.length && !filter) {
      const ph = document.createElement('li');
      ph.className = 'team-members-empty';
      ph.dataset.act = 'add-member';
      ph.innerHTML = '<i class="bi bi-arrow-down-circle"></i> ลากสมาชิกมาวางที่นี่ หรือกดเพื่อเพิ่ม';
      mul.appendChild(ph);
    }
    body.appendChild(mul);
  }

  const cul = document.createElement('ul');
  cul.className = 'team-children';
  cul.dataset.parentId = node.id;
  kids.forEach((c) => { const cli = renderNode(c, filter, depth + 1); if (cli) cul.appendChild(cli); });
  body.appendChild(cul);

  li.appendChild(body);
  return li;
}

function renderMember(m, filter) {
  if (filter && !filter.memberIds.has(m.id)) return null;
  const li = document.createElement('li');
  li.className = 'team-member' + (selectionMode && selectedMembers.has(m.id) ? ' is-selected' : '');
  li.dataset.memberId = m.id;
  li.dataset.nodeId = m.node_id;
  const name = m.full_name || '';
  const nameHtml = filter ? highlight(name, filter.q) : escHtml(name);
  const nick = m.nickname ? (filter ? highlight(m.nickname, filter.q) : escHtml(m.nickname)) : '';
  const mailHtml = m.kkumail ? (filter ? highlight(m.kkumail, filter.q) : escHtml(m.kkumail)) : '';
  const checkbox = selectionMode
    ? `<input type="checkbox" class="team-check" data-act="select" ${selectedMembers.has(m.id) ? 'checked' : ''} aria-label="เลือกสมาชิก" />`
    : '';

  if (mode === 'perms') {
    // Per-person permission row: name + effective chips (own solid,
    // node-inherited dashed) + a shield button opening the person's editor.
    // `inherit_permissions === false` cuts the person off from their ตำแหน่ง
    // entirely, so every inherited set is empty — including the seat, which the
    // node-row copy of this block used to get wrong.
    const inheriting = m.inherit_permissions !== false;
    const chips = permChipsHtml({
      own: new Set(m.permissions || []),
      inherited: inheriting ? nodeEffectivePerms(m.node_id) : new Set(),
      vsOwn: m.vs_dept || null,
      vsInherited: inheriting ? nodeEffectiveVsDepts(m.node_id) : new Set(),
      seatOwn: m.project_seat || null,
      seatInherited: inheriting ? nodeEffectiveSeats(m.node_id) : new Set(),
      passOwn: passportToken(m.passport_dept_id, m.passport_sub_dept_id),
      passInherited: inheriting ? nodeEffectivePassportScopes(m.node_id) : new Set(),
      pageOwn: m.dept_page || null,
      pageInherited: inheriting ? nodeEffectiveDeptPages(m.node_id) : new Set(),
    });
    li.innerHTML = `
      ${checkbox}
      ${canEdit() ? '<span class="team-handle team-handle-sm" title="ลากเพื่อจัดลำดับ"><i class="bi bi-grip-vertical"></i></span>' : ''}
      <span class="team-member-main" data-act="edit-member-perms">
        <span class="team-member-name">${nameHtml}${nick ? ` <span class="team-member-nick">(${nick})</span>` : ''}</span>
        ${mailHtml ? `<span class="team-member-mail"><i class="bi bi-envelope"></i> ${mailHtml}</span>` : ''}
        <span class="team-perms team-member-perms">${chips}</span>
      </span>
      <span class="team-member-actions">
        ${healthFlags.has(m.id)
          ? `<button type="button" class="team-act team-act-warn" data-act="check-member"
               title="ต้องตรวจสอบ: ${escHtml([...healthFlags.get(m.id)].join(' · '))}"
               aria-label="ต้องตรวจสอบข้อมูล"><i class="bi bi-exclamation-triangle-fill"></i></button>`
          : ''}
        ${canEdit() ? '<button type="button" class="team-act team-act-perm" data-act="edit-member-perms" title="กำหนดสิทธิ์รายบุคคล"><i class="bi bi-shield-lock"></i></button>' : ''}
      </span>`;
    return li;
  }

  li.innerHTML = `
    ${checkbox}
    <span class="team-handle team-handle-sm" title="ลากเพื่อจัดลำดับ"><i class="bi bi-grip-vertical"></i></span>
    <span class="team-member-main" data-act="edit-member">
      <span class="team-member-name">${nameHtml}${nick ? ` <span class="team-member-nick">(${nick})</span>` : ''}</span>
      ${mailHtml ? `<span class="team-member-mail"><i class="bi bi-envelope"></i> ${mailHtml}</span>` : ''}
      <span class="team-member-meta">
        ${m.major ? `<span class="team-tag team-tag-major">${escHtml(m.major)}</span>` : ''}
        ${studyYearLabel(m) ? `<span class="team-tag">${escHtml(studyYearLabel(m))}</span>` : ''}
        ${m.student_id ? `<span class="team-tag team-tag-sid">${escHtml(m.student_id)}</span>` : ''}
        ${m.confirmed
          ? '<span class="team-tag team-tag-ok"><i class="bi bi-check-circle-fill"></i> ยืนยัน</span>'
          : '<span class="team-tag team-tag-pending">รอยืนยัน</span>'}
        ${(() => {
          const eff = [...memberEffectivePerms(m)];
          const labels = eff.map((p) => PERM_LABEL[p] || p);
          // A SCOPED grant carries no capability key (0083), so counting keys
          // alone printed NOTHING for someone who holds one — the collapsed row
          // said "no permissions" about a person who really had them. Same bug
          // as the missing chip, one reader along.
          const inheriting = m.inherit_permissions !== false;
          if (!eff.includes('vs') && !eff.includes('master')) {
            const vsAll = new Set(m.vs_dept ? [m.vs_dept] : []);
            if (inheriting) nodeEffectiveVsDepts(m.node_id).forEach((d) => vsAll.add(d));
            if (vsAll.size) labels.push(PERM_LABEL.vs);
          }
          if (!eff.includes('passport') && !eff.includes('master')) {
            const own = passportToken(m.passport_dept_id, m.passport_sub_dept_id);
            const passAll = new Set(own ? [own] : []);
            if (inheriting) nodeEffectivePassportScopes(m.node_id).forEach((t) => passAll.add(t));
            if (passAll.size) labels.push(PERM_LABEL.passport);
          }
          return labels.length
            ? `<span class="team-tag team-tag-perm" title="${escHtml(labels.join(', '))}"><i class="bi bi-shield-lock"></i> ${labels.length} สิทธิ์</span>`
            : '';
        })()}
      </span>
    </span>
    <span class="team-member-actions">
      ${healthFlags.has(m.id)
        ? `<button type="button" class="team-act team-act-warn" data-act="check-member"
             title="ต้องตรวจสอบ: ${escHtml([...healthFlags.get(m.id)].join(' · '))}"
             aria-label="ต้องตรวจสอบข้อมูล"><i class="bi bi-exclamation-triangle-fill"></i></button>`
        : ''}
      ${canEdit() ? `
      <button type="button" class="team-act" data-act="move-member" title="ย้ายตำแหน่ง"><i class="bi bi-arrows-move"></i></button>
      <button type="button" class="team-act" data-act="edit-member" title="แก้ไข"><i class="bi bi-pencil"></i></button>
      <button type="button" class="team-act team-act-danger" data-act="delete-member" title="ลบ"><i class="bi bi-trash"></i></button>` : ''}
    </span>`;
  return li;
}

function highlight(text, q) {
  const t = String(text || '');
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escHtml(t);
  return escHtml(t.slice(0, i)) + '<mark>' + escHtml(t.slice(i, i + q.length)) + '</mark>' + escHtml(t.slice(i + q.length));
}

/** Touch-primary device? Used only to phrase hints; never to gate behaviour. */
function coarsePointer() {
  try { return window.matchMedia?.('(pointer: coarse)')?.matches === true; }
  catch { return false; }
}

function computeFilter(qRaw) {
  const q = qRaw.trim().toLowerCase();
  const memberIds = new Set();
  const visible = new Set();
  const markUp = (nodeId) => {
    let cur = nodesById.get(nodeId);
    while (cur) { visible.add(cur.id); cur = cur.parent_id ? nodesById.get(cur.parent_id) : null; }
  };
  for (const n of nodesById.values()) if (n.name.toLowerCase().includes(q)) markUp(n.id);
  // Search PEOPLE in both modes. This used to be gated on `mode === 'team'`,
  // which dated from when จัดการสิทธิ์ listed ตำแหน่ง only. It now renders a
  // per-person row (สิทธิ์รายบุคคล), and renderMember drops any member missing
  // from `memberIds` — so with the gate in place, typing a name in จัดการสิทธิ์
  // matched nobody and hid every person, i.e. search looked broken in the one
  // mode where you most need to find a specific individual.
  for (const arr of membersByNode.values()) {
    for (const m of arr) {
      const hay = `${m.full_name} ${m.nickname || ''} ${m.student_id || ''} ${m.major || ''} ${m.kkumail || ''}`.toLowerCase();
      if (hay.includes(q)) { memberIds.add(m.id); markUp(m.node_id); }
    }
  }
  return { visible, memberIds, q: qRaw.trim() };
}

// ============================================================
// DRAG / DROP (fine reordering; cross-level use the move picker)
// ============================================================

/** A list inside a collapsed (d-none) node body can't be a visible drop target,
 *  so skip it — attaching SortableJS to all ~2×N lists every render (most of
 *  them hidden) is the main source of jank on big trees / iPad. Structural
 *  check (not offsetParent) so it's correct even if the pane re-renders while
 *  the team section itself is hidden. */
function inCollapsedBody(ul, tree) {
  let el = ul.parentElement;
  while (el && el !== tree) {
    if (el.classList.contains('team-node-body') && el.classList.contains('d-none')) return true;
    el = el.parentElement;
  }
  return false;
}

// Touch drags open on a LONG PRESS, mouse drags stay instant.
//
// Before this, a finger that happened to land on a drag handle while scrolling
// started a reorder — the handle also carried `touch-action: none`, so the page
// could not scroll out from under it. `delayOnTouchOnly` keeps the desktop feel
// (no delay with a mouse) while requiring a deliberate hold on touch, and
// `touchStartThreshold` cancels the pending drag the moment the finger travels,
// so a scroll gesture that begins on a handle scrolls instead of dragging.
const TOUCH_DRAG = {
  delay: 220,
  delayOnTouchOnly: true,
  touchStartThreshold: 8,
  chosenClass: 'team-chosen',
};

function attachSortables(tree) {
  if (!window.Sortable) return;
  tree.querySelectorAll('ul.team-children').forEach((ul) => {
    if (inCollapsedBody(ul, tree)) return;
    sortables.push(window.Sortable.create(ul, {
      group: 'team-nodes', handle: '.team-handle:not(.team-handle-sm)',
      draggable: '.team-node', animation: 150, fallbackOnBody: true, ghostClass: 'team-ghost',
      ...TOUCH_DRAG,
      onStart: () => { dragging = true; },
      onMove: (evt) => {
        const draggedId = evt.dragged?.dataset?.nodeId;
        const targetParent = evt.to?.dataset?.parentId || null;
        if (draggedId && targetParent && isAncestor(draggedId, targetParent)) return false;
        return true;
      },
      onEnd: onNodeDrop,
    }));
  });
  if (mode === 'team') {
    tree.querySelectorAll('ul.team-members').forEach((ul) => {
      if (inCollapsedBody(ul, tree)) return;
      sortables.push(window.Sortable.create(ul, {
        group: 'team-members', handle: '.team-handle-sm',
        draggable: '.team-member', animation: 150, fallbackOnBody: true, ghostClass: 'team-ghost',
        ...TOUCH_DRAG,
        onStart: () => { dragging = true; },
        onEnd: onMemberDrop,
      }));
    });
  }
}

async function onNodeDrop(evt) {
  dragging = false; pendingRender = false;
  const id = evt.item.dataset.nodeId;
  const newParentId = evt.to.dataset.parentId || null;
  if (!id) return;
  if (newParentId && isAncestor(id, newParentId)) { render(); return; }
  const siblingIds = [...evt.to.children].filter((c) => c.dataset.nodeId).map((c) => c.dataset.nodeId);
  const node = nodesById.get(id);
  const updates = [];
  if (node.parent_id !== newParentId) {
    node.parent_id = newParentId;
    updates.push({ id, parent_id: newParentId, position: siblingIds.indexOf(id) });
  }
  siblingIds.forEach((sid, i) => {
    const n = nodesById.get(sid);
    if (!n) return;
    if (n.position !== i) { n.position = i; if (!updates.find((u) => u.id === sid)) updates.push({ id: sid, position: i }); }
  });
  rebuildChildrenIndexFromNodes();
  render();
  if (updates.length) {
    try { await patchNodePositions(updates); }
    catch (e) { console.warn('[team] node reorder failed:', e?.message || e); reload(); }
  }
}

async function onMemberDrop(evt) {
  dragging = false; pendingRender = false;
  const id = evt.item.dataset.memberId;
  const newNodeId = evt.to.dataset.nodeId;
  if (!id || !newNodeId) return;
  const memberIds = [...evt.to.children].filter((c) => c.dataset.memberId).map((c) => c.dataset.memberId);
  const m = findMember(id);
  const updates = [];
  if (m && m.node_id !== newNodeId) { m.node_id = newNodeId; updates.push({ id, node_id: newNodeId, position: memberIds.indexOf(id) }); }
  memberIds.forEach((mid, i) => {
    const mm = findMember(mid);
    if (mm && mm.position !== i) { mm.position = i; if (!updates.find((u) => u.id === mid)) updates.push({ id: mid, position: i }); }
  });
  rebuildMembersIndex();
  render();
  if (updates.length) {
    try { await patchMemberPositions(updates); }
    catch (e) { console.warn('[team] member reorder failed:', e?.message || e); reload(); }
  }
}

function rebuildChildrenIndexFromNodes() {
  childrenByParent = new Map();
  for (const n of nodesById.values()) {
    const key = n.parent_id || '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(n);
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => (a.position - b.position) || a.name.localeCompare(b.name, 'th'));
  }
}

function rebuildMembersIndex() {
  const all = [];
  for (const arr of membersByNode.values()) all.push(...arr);
  membersByNode.clear();
  all.forEach((m) => {
    if (!membersByNode.has(m.node_id)) membersByNode.set(m.node_id, []);
    membersByNode.get(m.node_id).push(m);
  });
  for (const arr of membersByNode.values()) {
    arr.sort((a, b) => (a.position - b.position)
      || String(a.full_name || '').localeCompare(String(b.full_name || ''), 'th'));
  }
}

function findMember(id) {
  for (const arr of membersByNode.values()) { const m = arr.find((x) => x.id === id); if (m) return m; }
  return null;
}

/** Find an existing member in a node that an import row would duplicate:
 *  same kkumail (case-insensitive), else same name + student_id. */
function findExistingMember(nodeId, r) {
  const mail = (r.kkumail || '').toLowerCase();
  return membersOf(nodeId).find((m) => mail
    ? (m.kkumail || '').toLowerCase() === mail
    : (m.full_name === r.full_name && (m.student_id || '') === (r.student_id || ''))) || null;
}

// ============================================================
// TREE EVENT DELEGATION
// ============================================================

function wireTreeDelegation() {
  const tree = $('teamTree');
  if (!tree) return;
  tree.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const nodeId = btn.closest('.team-node')?.dataset.nodeId;
    const memberId = btn.closest('.team-member')?.dataset.memberId;

    if (act === 'select') {
      // Local toggle — avoid a full re-render so the checkbox/scroll stay put.
      const checked = btn.checked;
      if (memberId) {
        checked ? selectedMembers.add(memberId) : selectedMembers.delete(memberId);
        btn.closest('.team-member')?.classList.toggle('is-selected', checked);
      } else if (nodeId) {
        checked ? selectedNodes.add(nodeId) : selectedNodes.delete(nodeId);
        btn.closest('.team-node')?.classList.toggle('is-selected', checked);
      }
      updateSelectionBar();
      return;
    }
    if (act === 'toggle') {
      if (!nodeId) return;
      if (expanded.has(nodeId)) expanded.delete(nodeId); else expanded.add(nodeId);
      render(); return;
    }
    if (act === 'tier-up' || act === 'tier-down') {
      if (nodeId) shiftTier(nodeId, act === 'tier-down' ? 1 : -1);
      return;
    }
    if (act === 'primary') {
      if (!nodeId) return;
      // ONE editor, opened on the tab that matches the mode you are in (0110).
      // Before this, จัดการทีม could only reach แก้ไขตำแหน่ง and จัดการสิทธิ์ only
      // reached สิทธิ์, so managing a record you had just clicked meant going
      // back and finding it again in the other mode.
      openNodeModal({ node: nodesById.get(nodeId), tab: modeTab() });
      return;
    }
    if (!nodeId && !memberId) return;
    switch (act) {
      case 'edit':        openNodeModal({ node: nodesById.get(nodeId), tab: modeTab() }); break;
      case 'add-child':   openNodeModal({ parentId: nodeId }); break;
      case 'add-member':  openMemberModal({ nodeId }); break;
      case 'move':        openMoveNode(nodeId); break;
      case 'delete':      onDeleteNode(nodeId); break;
      case 'edit-perms':  openPermModal(nodeId); break;
      case 'edit-member': openMemberModal({ member: findMember(memberId), tab: modeTab() }); break;
      case 'edit-member-perms': openMemberPermModal(memberId); break;
      case 'move-member': openMoveMember(memberId); break;
      case 'delete-member': onDeleteMember(memberId); break;
      // The flag is the shortcut, not just an indicator: seeing the problem and
      // being able to fix it should not be two separate navigations. And it
      // carries WHO — landing at the top of 24 findings and having to remember
      // the person you just clicked is the same work, moved.
      case 'check-member': openHealthFor({ memberId, nodeId }); break;
    }
  });
}

/** Which tab the entity editor should lead with, given the mode the click came
 *  from. Both tabs are always PRESENT — this only decides which one is on top. */
function modeTab() { return mode === 'perms' ? 'perm' : 'info'; }

/**
 * May this account WRITE the tree? (migration 0110)
 *
 * Since 0110 everyone with a posting holds `team` and can open this section to
 * look; only `team_edit` (or role vp_admin/dev) may change anything. Everything
 * below asks THIS function rather than re-deriving the answer, so the UI and
 * the RLS write policy cannot drift.
 *
 * Read-only is enforced by NOT RENDERING the affordance, not by disabling it
 * after a click: a live-looking ลบ button that 42501s is worse than no button,
 * and this repo has shipped that shape before (the scoped shop admin whose
 * product rows rendered Edit buttons that always failed).
 */
function canEdit() { return userCanAccess('team_edit'); }

/**
 * The shared footer button of a two-tab entity modal submits whichever pane is
 * showing.
 *
 * A modal cannot have two footers, and the two panes hold two independent
 * <form>s with two independent submit handlers — which is deliberate: merging
 * them into one form would have meant rewriting onNodeSubmit / the perm save
 * path, the two most authorization-sensitive writes in this module, for a
 * layout change. So the button is `type="button"` and forwards instead.
 *
 * `requestSubmit()`, never `submit()`: the latter bypasses the submit event
 * entirely, so every handler in this file would silently stop running.
 */
function wireModalSave() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-team-modal-save]');
    if (!btn) return;
    const modal = document.getElementById(btn.getAttribute('data-team-modal-save'));
    const form = modal?.querySelector('.tab-pane.active form');
    if (form) form.requestSubmit();
  });
}

// ============================================================
// TOOLBAR + MODE
// ============================================================

/** The single path into a mode. Used by the mode buttons AND by the ต้องตรวจสอบ
 *  flag on a member row, so the two can never drift about what switching
 *  entails (clearing a half-made selection, painting the pane, cold entry). */
function switchMode(m) {
  if (!m || m === mode) return;
  mode = m;
  if (selectionMode) { selectionMode = false; clearSelection(); }  // perms mode has no member rows
  render();
  if (mode === 'years') enterTerms();
  if (mode === 'health') enterHealth();
}

// ข้อมูลของฉัน is no longer a mode here. The shared ตำแหน่งของฉัน card moved to
// the ADMIN LANDING (admin-main.js paintAdminMySeat) — it is the person's own
// record rather than org-tree management, and behind the `team` grant it was
// unreachable for an admin whose grants are e.g. `pr` and `samoshop`.

/** Every member id at or below a ตำแหน่ง. Used so the rolled-up count on a
 *  branch focuses that whole branch, not just one person. */
function memberIdsUnder(nodeId, out = []) {
  for (const m of membersOf(nodeId)) out.push(m.id);
  for (const child of childrenOf(nodeId)) memberIdsUnder(child.id, out);
  return out;
}

/** Open ตรวจสอบข้อมูล already filtered to what the admin clicked. A member row
 *  focuses that person; a ตำแหน่ง's rolled-up count focuses its whole branch. */
function openHealthFor({ memberId, nodeId }) {
  let focus = null;
  if (memberId) {
    const m = findMember(memberId);
    if (m) focus = { ids: [memberId], label: m.full_name || '(ไม่มีชื่อ)' };
  } else if (nodeId) {
    const ids = memberIdsUnder(nodeId);
    if (ids.length) focus = { ids, label: nodesById.get(nodeId)?.name || 'ตำแหน่งนี้' };
  }
  if (mode === 'health') { enterHealth(focus); return; }
  mode = 'health';
  if (selectionMode) { selectionMode = false; clearSelection(); }
  render();
  enterHealth(focus);
}

function wireToolbar() {
  $('teamAddRoot')?.addEventListener('click', () => openNodeModal({ parentId: null, kind: 'division' }));
  $('teamExpandAll')?.addEventListener('click', () => { for (const id of nodesById.keys()) expanded.add(id); render(); });
  $('teamCollapseAll')?.addEventListener('click', () => { expanded.clear(); render(); });

  document.querySelectorAll('.team-mode-btn').forEach((b) => {
    b.addEventListener('click', () => switchMode(b.dataset.teamMode));
  });

  // Multi-select: toggle checkboxes + the bulk action bar.
  $('teamSelectMode')?.addEventListener('click', () => {
    selectionMode = !selectionMode;
    if (!selectionMode) clearSelection();
    render();
  });
  $('teamSelMove')?.addEventListener('click', openBulkMove);
  $('teamSelDelete')?.addEventListener('click', bulkDelete);
  $('teamSelCancel')?.addEventListener('click', () => { selectionMode = false; clearSelection(); render(); });

  const search = $('teamSearch');
  const clear = $('teamSearchClear');
  let t = null;
  search?.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      searchQ = search.value.trim();
      clear?.classList.toggle('d-none', !searchQ);
      render();
    }, 180);
  });
  clear?.addEventListener('click', () => { search.value = ''; searchQ = ''; clear.classList.add('d-none'); render(); search.focus(); });
}

function modalInstance(id) {
  const el = $(id);
  return el && window.bootstrap ? window.bootstrap.Modal.getOrCreateInstance(el) : null;
}

// ============================================================
// DESTINATION PICKER — searchable list (used by node-move + member-role assign)
// A type-to-filter list beats a 200-option <select> and is touch-friendly:
// select a row, confirm. Far easier than precise nested drag.
// ============================================================

let pickerCandidates = [];   // [{ id, name, path, depth, current }]
let pickerSelected = null;   // chosen id ('' = root) or null = nothing yet
let pickerOnPick = null;     // (id|null) => void
let pickerAllowRoot = false;

function wirePicker() {
  $('teamPickerSearch')?.addEventListener('input', () => renderPickerList($('teamPickerSearch').value.trim()));
  $('teamPickerList')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pick-id]');
    if (!row) return;
    pickerSelected = row.dataset.pickId;  // '' for root
    $('teamPickerList').querySelectorAll('.is-selected').forEach((x) => x.classList.remove('is-selected'));
    row.classList.add('is-selected');
    $('teamPickerConfirm').disabled = false;
  });
  $('teamPickerConfirm')?.addEventListener('click', () => {
    if (pickerSelected === null) return;
    const cb = pickerOnPick;
    const sel = pickerSelected;
    modalInstance('teamPickerModal')?.hide();
    if (cb) cb(sel || null);
  });
  // The picker can open ON TOP of the member modal. When the (inner) picker
  // closes, Bootstrap can strip `modal-open` from <body> even though the outer
  // modal is still up, unlocking page scroll. Re-assert it if so.
  $('teamPickerModal')?.addEventListener('hidden.bs.modal', () => {
    if (document.querySelector('.modal.show')) document.body.classList.add('modal-open');
  });
}

function openPicker({ title, what, currentId = null, exclude = null, allowRoot = false, onPick }) {
  pickerOnPick = onPick;
  pickerAllowRoot = allowRoot;
  pickerSelected = null;
  $('teamPickerTitle').textContent = title || 'เลือกตำแหน่ง';
  $('teamPickerWhat').textContent = what || '';
  $('teamPickerConfirm').disabled = true;
  pickerCandidates = [];
  const walk = (parentId, depth, trail) => {
    for (const n of childrenOf(parentId)) {
      if (exclude && exclude(n.id)) continue;
      const path = trail.concat(n.name);
      pickerCandidates.push({ id: n.id, name: n.name, path: path.join(' / '), depth, current: n.id === currentId });
      walk(n.id, depth + 1, path);
    }
  };
  walk(null, 0, []);
  const search = $('teamPickerSearch');
  if (search) search.value = '';
  renderPickerList('');
  modalInstance('teamPickerModal')?.show();
  setTimeout(() => search?.focus(), 250);
}

function renderPickerList(q) {
  const list = $('teamPickerList');
  if (!list) return;
  const ql = q.toLowerCase();
  const matches = ql ? pickerCandidates.filter((c) => c.path.toLowerCase().includes(ql)) : pickerCandidates;
  let html = '';
  if (pickerAllowRoot && !ql) {
    html += `<button type="button" class="team-picker-item team-picker-root" data-pick-id="">
      <i class="bi bi-diagram-2"></i> — ระดับบนสุด (ฝ่ายหลัก) —</button>`;
  }
  html += matches.slice(0, 300).map((c) => {
    const parent = c.path.split(' / ').slice(0, -1).join(' / ');
    return `<button type="button" class="team-picker-item ${c.current ? 'is-current' : ''}" data-pick-id="${c.id}">
      <span class="team-picker-leaf">${highlightPlain(c.name, q)}</span>
      ${parent ? `<span class="team-picker-path">${highlightPlain(parent, q)}</span>` : ''}
      ${c.current ? '<span class="team-picker-badge">ปัจจุบัน</span>' : ''}
    </button>`;
  }).join('');
  if (!html) html = '<div class="team-picker-empty">ไม่พบตำแหน่ง</div>';
  list.innerHTML = html;
}

function highlightPlain(text, q) {
  if (!q) return escHtml(text);
  const t = String(text || ''); const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return escHtml(t);
  return escHtml(t.slice(0, i)) + '<mark>' + escHtml(t.slice(i, i + q.length)) + '</mark>' + escHtml(t.slice(i + q.length));
}

// ============================================================
// NODE MODAL (name + kind only)
// ============================================================

/** Paint the swatch row to match a stored value. '' = อัตโนมัติ. */
function setNodeColor(value) {
  const v = isHexColor(value) ? value : '';
  const hidden = $('teamNodeColor');
  if (hidden) hidden.value = v;
  const row = $('teamNodeSwatches');
  if (!row) return;
  let matched = false;
  row.querySelectorAll('.team-swatch[data-color]').forEach((b) => {
    const on = b.dataset.color.toLowerCase() === v.toLowerCase();
    if (on) matched = true;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  // A colour that is NOT one of the ten is still a real choice — show it on the
  // custom well rather than leaving the row looking like nothing is selected,
  // which is how a saved value gets overwritten by accident.
  const custom = row.querySelector('.is-custom');
  if (custom) {
    custom.classList.toggle('is-on', !!v && !matched);
    if (v) custom.style.setProperty('--sw', v);
    else custom.style.removeProperty('--sw');
  }
  const picker = $('teamNodeColorCustom');
  if (picker && /^#[0-9A-Fa-f]{6}$/.test(v)) picker.value = v;
}

/**
 * Show the ระดับ stepper only where a rung means something.
 *
 * A ฝ่าย has no rung — it IS the thing rungs are inside. A ตำแหน่ง stored under
 * another ตำแหน่ง already expresses its rank by nesting, and offering a second
 * way to say the same thing is how two mechanisms start disagreeing.
 */
function setNodeTier(node, parentId) {
  const field = $('teamNodeTierField');
  if (!field) return;
  const parent = parentId ? nodesById.get(parentId) : null;
  const eligible = normalizeKind($('teamNodeKind').value) === 'role'
    && (!parent || normalizeKind(parent.kind) === 'division');
  field.classList.toggle('d-none', !eligible);

  const tier = eligible ? tierOf(node) : 1;
  $('teamNodeTier').value = tier > 1 ? String(tier) : '';
  $('teamNodeTierValue').textContent = `ระดับ ${tier}`;
  $('teamNodeTierUp').disabled = tier <= 1;
  $('teamNodeTierDown').disabled = tier >= TIER_MAX;
}

function stepNodeTier(delta) {
  const cur = Number($('teamNodeTier').value) || 1;
  const next = Math.min(TIER_MAX, Math.max(1, cur + delta));
  $('teamNodeTier').value = next > 1 ? String(next) : '';
  $('teamNodeTierValue').textContent = `ระดับ ${next}`;
  $('teamNodeTierUp').disabled = next <= 1;
  $('teamNodeTierDown').disabled = next >= TIER_MAX;
}

/**
 * Say what the Discord tick-box will actually do to this node.
 *
 * Three outcomes, and ALL THREE are written — including the empty one. A
 * caption a renderer can turn on has to be turned off by every other branch
 * that reaches it, or it sits there describing the previous node.
 *
 * The load-bearing case is the third: unticking a node whose role has already
 * been PROVISIONED is not a no-op the owner can try out. It takes the role off
 * every member holding it the next time the sync runs, and with it whatever
 * channel access that role carried. The Discord role OBJECT survives (the bot
 * never deletes one — deleting takes its channel overwrites with it,
 * irreversibly), so this is recoverable by re-ticking; it is still not
 * something to discover afterwards.
 */
function setNodeDiscordState(node) {
  const el = $('teamNodeDiscordRoleState');
  if (!el) return;
  const ticked = !!$('teamNodeDiscordRole')?.checked;
  const provisioned = !!node?.discord_role_id;
  const was = !!node?.discord_role;

  let msg = '';
  if (ticked && !provisioned) {
    msg = 'ยังไม่ได้สร้าง role นี้ใน Discord — ระบบจะสร้างให้ตอนซิงก์ครั้งถัดไป';
  } else if (!ticked && provisioned && was) {
    msg = 'ปิดแล้ว role นี้จะถูกถอดออกจากสมาชิกทุกคนในตำแหน่งนี้ตอนซิงก์ครั้งถัดไป '
        + '(ตัว role ใน Discord ไม่ถูกลบ เปิดใหม่ได้)';
  }
  el.textContent = msg;
  el.classList.toggle('d-none', !msg);
}

function wireNodeModal() {
  $('teamNodeForm')?.addEventListener('submit', onNodeSubmit);
  $('teamNodeTierUp')?.addEventListener('click', () => stepNodeTier(-1));
  $('teamNodeTierDown')?.addEventListener('click', () => stepNodeTier(1));
  // Switching ประเภท to ฝ่าย must hide the rung, not leave a stale one that the
  // save would then write onto a ฝ่าย.
  $('teamNodeKind')?.addEventListener('change', () => {
    setNodeTier({ tier: Number($('teamNodeTier').value) || null },
      $('teamNodeParentId').value || null);
  });
  // The Discord line has to be re-decided on every toggle, not only on open —
  // its whole job is to say what UNTICKING will cost, and a caption that can be
  // turned on by one branch must be turned off by every other one that reaches
  // it (mistakes class 4).
  $('teamNodeDiscordRole')?.addEventListener('change', () => {
    setNodeDiscordState(nodesById.get($('teamNodeId').value) || null);
  });
  // Delegated: the swatches are static markup, but the modal is shared between
  // จัดการทีม and จัดการสิทธิ์ and this runs once either way.
  $('teamNodeSwatches')?.addEventListener('click', (e) => {
    const sw = e.target.closest('.team-swatch[data-color]');
    if (sw) setNodeColor(sw.dataset.color);
  });
  // `input`, not `change`: the native picker fires input while dragging, and a
  // swatch row that only updates on close makes the choice feel unregistered.
  $('teamNodeColorCustom')?.addEventListener('input', (e) => setNodeColor(e.target.value));
  $('teamNodeDelete')?.addEventListener('click', () => {
    const id = $('teamNodeId').value;
    if (id) { modalInstance('teamNodeModal')?.hide(); onDeleteNode(id); }
  });
}

function openNodeModal({ node = null, parentId = null, kind = null, tab = 'info' } = {}) {
  $('teamNodeId').value = node?.id || '';
  $('teamNodeParentId').value = node ? (node.parent_id || '') : (parentId || '');
  $('teamNodeName').value = node?.name || '';
  $('teamNodeKind').value = node?.kind || kind || 'role';
  setNodeColor(node?.color || '');
  setNodeTier(node, node ? node.parent_id : parentId);
  // New nodes default to visible; only an explicit false hides the subtree.
  if ($('teamNodeIsPublic')) $('teamNodeIsPublic').checked = node ? node.is_public !== false : true;
  // Board membership is opt-in, so a NEW ตำแหน่ง is never silently promoted into
  // the public headline grid.
  if ($('teamNodeIsBoard')) $('teamNodeIsBoard').checked = !!node?.is_board;
  // Discord role mirroring (0183). A NEW node starts unticked: a ฝ่าย created
  // today has no channel yet, and the seed's answer was about the org as it
  // stood, not a promise about every node added after it.
  if ($('teamNodeDiscordRole')) {
    $('teamNodeDiscordRole').checked = !!node?.discord_role;
    setNodeDiscordState(node || null);
  }
  $('teamNodeModalTitle').textContent = node ? 'แก้ไขตำแหน่ง' : (parentId ? 'เพิ่มตำแหน่งย่อย' : 'เพิ่มฝ่าย');
  $('teamNodeDelete').classList.toggle('d-none', !node);
  // Both editors live in one modal now (0110). An UNSAVED node has no row for a
  // grant to attach to, so its สิทธิ์ tab is disabled rather than shown empty.
  if (node) fillNodePermPane(node.id);
  showTeamModal('teamNodeModal', node ? tab : 'info', !!node);
  if (tab !== 'perm') setTimeout(() => $('teamNodeName')?.focus(), 250);
}

/**
 * Show a two-tab entity modal with one tab active.
 *
 * Bootstrap's Tab API is used rather than hand-toggling `.active`, so the
 * `aria-selected` / `tabindex` bookkeeping stays correct — and it is called
 * BEFORE `.show()` because switching panes on a visible modal is a visible
 * flicker. `getOrCreateInstance` throughout: constructing a fresh
 * `bootstrap.Modal` on an already-open modal stacks a second backdrop that the
 * first instance's hide() never clears (logged in the mistakes log), and these
 * modals genuinely can be re-opened while open — clicking another person in
 * the tree behind a stacked picker does exactly that.
 */
function showTeamModal(modalId, tab = 'info', permEnabled = true) {
  const permTab = document.getElementById(`${modalId}Pane2Tab`);
  const infoTab = document.getElementById(`${modalId}Pane1Tab`);
  if (permTab) {
    permTab.classList.toggle('disabled', !permEnabled);
    permTab.setAttribute('aria-disabled', String(!permEnabled));
    permTab.tabIndex = permEnabled ? 0 : -1;
  }
  const target = tab === 'perm' && permEnabled ? permTab : infoTab;
  if (target && window.bootstrap?.Tab) {
    window.bootstrap.Tab.getOrCreateInstance(target).show();
  }

  // A view-only member may OPEN the editor — that is how they read a record —
  // but every control in it is inert. Disabled rather than hidden: the point is
  // to show them the stored values, and an empty modal would read as a bug.
  const modal = document.getElementById(modalId);
  const writable = canEdit();
  // Only ever touch controls THIS pass disabled. A blanket `el.disabled =
  // !writable` also re-enabled everything the panes had deliberately locked —
  // the fill runs before this, so a master grant's implied checkboxes came back
  // editable and the modal contradicted what it would actually save.
  modal?.querySelectorAll('[data-readonly-locked]').forEach((el) => {
    el.disabled = false;
    delete el.dataset.readonlyLocked;
  });
  if (!writable) {
    modal?.querySelectorAll('input, select, textarea, button:not([data-bs-dismiss])')
      .forEach((el) => {
        if (el.closest('.modal-header')) return;      // close + the tab buttons stay live
        if (el.disabled) return;                      // already locked for another reason
        el.disabled = true;
        el.dataset.readonlyLocked = '1';
      });
  }
  if (!writable) {
    modal?.querySelector('#teamNodeDelete')?.classList.add('d-none');
    modal?.querySelector('#teamMemberDelete')?.classList.add('d-none');
  }

  modalInstance(modalId)?.show();
}

async function onNodeSubmit(e) {
  e.preventDefault();
  const id = $('teamNodeId').value;
  const name = $('teamNodeName').value.trim();
  if (!name) { $('teamNodeName').focus(); return; }
  const parentId = $('teamNodeParentId').value || null;
  const payload = {
    name,
    kind: normalizeKind($('teamNodeKind').value),
    // '' means "derive it from the name", and that has to reach the database as
    // NULL — an empty string would pass the hex CHECK's `is null` arm nowhere
    // and 23514 the save. Stored null is also what makes `tintColor` fall back.
    color: isHexColor($('teamNodeColor').value) ? $('teamNodeColor').value : null,
    // '' = the field was hidden (a ฝ่าย, or a seat under a seat) or the rung is
    // 1. Both mean NULL: "never told otherwise", which is the column's default.
    tier: Number($('teamNodeTier').value) > 1 ? Number($('teamNodeTier').value) : null,
    is_public: $('teamNodeIsPublic') ? $('teamNodeIsPublic').checked : true,
    is_board: $('teamNodeIsBoard') ? $('teamNodeIsBoard').checked : false,
    discord_role: $('teamNodeDiscordRole') ? $('teamNodeDiscordRole').checked : false,
  };
  modalInstance('teamNodeModal')?.hide();
  try {
    if (id) {
      Object.assign(nodesById.get(id), payload);
      render();
      await updateNode(id, payload);
    } else {
      payload.parent_id = parentId;
      payload.position = childrenOf(parentId).length;
      const row = await createNode(payload);
      nodesById.set(row.id, row);
      rebuildChildrenIndexFromNodes();
      if (parentId) expanded.add(parentId);
      render();
    }
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

async function onDeleteNode(id) {
  const node = nodesById.get(id);
  // Same silent-dead-button shape as onDeleteMember below.
  if (!node) {
    alert('ไม่พบตำแหน่งนี้ในหน้าจอปัจจุบัน — กำลังโหลดผังใหม่ แล้วลองอีกครั้ง');
    reload();
    return;
  }
  const count = subtreeMemberCount(id);
  const kids = childrenOf(id).length;
  const warn = (kids || count)
    ? `จะลบตำแหน่งย่อย ${kids} รายการ และสมาชิก ${count} คนในสายนี้ด้วย` : '';
  if (!await askDelete(node.name, warn)) return;
  const toDrop = [];
  const collect = (nid) => { toDrop.push(nid); childrenOf(nid).forEach((c) => collect(c.id)); };
  collect(id);
  toDrop.forEach((nid) => { nodesById.delete(nid); membersByNode.delete(nid); expanded.delete(nid); });
  rebuildChildrenIndexFromNodes();
  render();
  try { await deleteNode(id); } catch (e) { alert(e?.message || 'ลบไม่สำเร็จ'); reload(); }
}

// ============================================================
// MOVE (node → new parent, member → new role) via the picker
// ============================================================

function openMoveNode(id) {
  const node = nodesById.get(id);
  if (!node) return;
  openPicker({
    title: 'ย้ายตำแหน่ง', what: `กำลังย้าย: ${node.name}`,
    currentId: node.parent_id, allowRoot: true,
    exclude: (cid) => cid === id || isAncestor(id, cid),
    onPick: (target) => moveNodeTo(id, target),
  });
}

function moveNodeTo(id, newParentId) {
  const node = nodesById.get(id);
  if (!node) return;
  if (newParentId && isAncestor(id, newParentId)) { alert('ย้ายไปไว้ใต้ตำแหน่งลูกของตัวเองไม่ได้'); return; }
  if (newParentId === (node.parent_id || null)) return;
  node.parent_id = newParentId;
  node.position = childrenOf(newParentId).length;  // append at end of new parent
  rebuildChildrenIndexFromNodes();
  if (newParentId) expanded.add(newParentId);
  render();
  updateNode(id, { parent_id: newParentId, position: node.position })
    .catch((err) => { alert(err?.message || 'ย้ายไม่สำเร็จ'); reload(); });
}

function openMoveMember(id) {
  const m = findMember(id);
  if (!m) return;
  openPicker({
    title: 'ย้ายสมาชิกไปตำแหน่ง',
    what: m.full_name || '',
    currentId: m.node_id,
    onPick: (target) => { if (target) moveMemberTo(id, target); },
  });
}

function moveMemberTo(id, newNodeId) {
  const m = findMember(id);
  if (!m || !newNodeId || m.node_id === newNodeId) return;
  m.node_id = newNodeId;
  m.position = membersOf(newNodeId).length;
  rebuildMembersIndex();
  expanded.add(newNodeId);
  render();
  updateMember(id, { node_id: newNodeId, position: m.position })
    .catch((err) => { alert(err?.message || 'ย้ายไม่สำเร็จ'); reload(); });
}

// ============================================================
// MULTI-SELECT (bulk move / delete)
// ============================================================

function clearSelection() { selectedNodes.clear(); selectedMembers.clear(); updateSelectionBar(); }

function updateSelectionBar() {
  const bar = $('teamSelectionBar');
  if (!bar) return;
  const n = selectedNodes.size, m = selectedMembers.size;
  bar.classList.toggle('d-none', !selectionMode);
  const countEl = $('teamSelectionCount');
  if (countEl) countEl.textContent = `เลือก ${n} ตำแหน่ง, ${m} สมาชิก`;
  const none = !n && !m;
  $('teamSelMove')?.toggleAttribute('disabled', none);
  $('teamSelDelete')?.toggleAttribute('disabled', none);
}

function openBulkMove() {
  if (!selectedNodes.size && !selectedMembers.size) return;
  // Can't drop a moved node into any selected node's own subtree.
  const exclude = (id) => {
    for (const sid of selectedNodes) if (id === sid || isAncestor(sid, id)) return true;
    return false;
  };
  openPicker({
    title: 'ย้ายรายการที่เลือก',
    what: `${selectedNodes.size} ตำแหน่ง, ${selectedMembers.size} สมาชิก`,
    exclude,
    allowRoot: selectedNodes.size > 0 && selectedMembers.size === 0,  // root only valid for nodes
    onPick: (target) => bulkMoveTo(target),
  });
}

async function bulkMoveTo(target) {
  const patches = { nodes: [], members: [] };
  for (const id of selectedNodes) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (target && isAncestor(id, target)) continue;  // safety
    node.parent_id = target || null;
    node.position = childrenOf(target || null).length;
    rebuildChildrenIndexFromNodes();
    patches.nodes.push({ id, parent_id: target || null, position: node.position });
  }
  if (target) {
    for (const id of selectedMembers) {
      const m = findMember(id);
      if (!m || m.node_id === target) continue;
      m.node_id = target;
      m.position = membersOf(target).length;
      rebuildMembersIndex();
      patches.members.push({ id, node_id: target, position: m.position });
    }
  }
  if (target) expanded.add(target);
  clearSelection();
  render();
  try {
    await Promise.all([patchNodePositions(patches.nodes), patchMemberPositions(patches.members)]);
  } catch (e) { console.warn('[team] bulk move failed:', e?.message || e); reload(); }
}

async function bulkDelete() {
  const topNodes = [...selectedNodes];
  const memberIds = [...selectedMembers];
  if (!topNodes.length && !memberIds.length) return;
  if (!await askConfirm({
    title: `ลบ ${topNodes.length} ตำแหน่ง และ ${memberIds.length} สมาชิกที่เลือก?`,
    body: 'ตำแหน่งจะลบรายการย่อยและสมาชิกในสายด้วย — ย้อนกลับไม่ได้',
    yes: 'ลบ',
  })) return;

  // Collect the full subtree of selected nodes (members under them cascade).
  const delNodeIds = new Set();
  const collect = (nid) => { delNodeIds.add(nid); childrenOf(nid).forEach((c) => collect(c.id)); };
  topNodes.forEach(collect);
  // Only delete selected members that AREN'T already covered by a deleted node.
  const memToDelete = memberIds.filter((id) => { const m = findMember(id); return m && !delNodeIds.has(m.node_id); });

  // optimistic model removal
  delNodeIds.forEach((nid) => { nodesById.delete(nid); membersByNode.delete(nid); expanded.delete(nid); });
  memToDelete.forEach((id) => {
    const m = findMember(id);
    if (m) { const arr = membersByNode.get(m.node_id); if (arr) membersByNode.set(m.node_id, arr.filter((x) => x.id !== id)); }
  });
  rebuildChildrenIndexFromNodes();
  clearSelection();
  render();
  try {
    await Promise.all([...topNodes.map((id) => deleteNode(id)), ...memToDelete.map((id) => deleteMember(id))]);
  } catch (e) {
    // Now that a blocked delete THROWS rather than resolving, this catch is
    // reachable for a real reason (no สิทธิ์, or someone else got there first).
    // console.warn alone would leave the user watching rows reappear after the
    // reload with no explanation — the same silence this whole change removes.
    console.warn('[team] bulk delete failed:', e?.message || e);
    alert(`ลบบางรายการไม่สำเร็จ: ${e?.message || 'ไม่ทราบสาเหตุ'}\n\nกำลังโหลดผังใหม่เพื่อแสดงสถานะจริง`);
    reload();
  }
}

// ============================================================
// PERMISSION CHIPS — the row display in สิทธิ์ mode
//
// REPORTED 2026-08-18, with a screenshot: "look at this messy … even theres 5
// permission still messy but i want them to can still see all permission each
// one get like now." So the words stay; what changes is how many of them a row
// has to print, and in what order.
//
// Three rules, and they were separate bugs before they were a design:
//
//  1. VALUE-CARRYING CHIPS COME FIRST. บทบาท / VitalSound แผนก are the parts
//     that differ per person and that an admin is actually scanning for. They
//     used to print LAST, so on the reported row `ผู้ส่งหนังสือ (SAMO)` — the
//     single most important fact about that person — wrapped onto line 2 behind
//     eight interchangeable capability chips.
//
//  2. A MASTER ROW PRINTS ONE CHIP. It used to print `ทุกระบบ (Master)` and
//     then the inherited `SAMO Shop` / `จองโควตา Claude` chips as well, which
//     says the opposite of the truth: master already answers yes to every
//     permission key (0111), so listing two of them implies it is NOT covering
//     them. The seat is the exception and still prints, because it is the one
//     thing master genuinely does not imply.
//
//  3. ONE BUILDER, TWO CALLERS. The ตำแหน่ง row and the บุคคล row had two
//     copies of this logic that had already drifted (the member copy guards the
//     inherited seat on `inherit_permissions`, the node copy does not). That is
//     the "two implementations of one rule" class; the resolvers differ, the
//     drawing must not.
// ============================================================

/** One chip. `icon` is a bootstrap-icons class (pinned 1.10.5 — run
 *  `npm run check:icons` after adding one, a missing name renders as nothing). */
export function permChip(cls, label, { icon = '', title = '' } = {}) {
  // The icon is the ONE value here that goes into markup unescaped (it is a
  // class name, so escaping it would break it). Callers pass `PERM_ICON[key]`,
  // and PERM_ICON is a plain object built with Object.fromEntries — so a
  // permission key of `constructor` or `toString` does NOT miss, it returns a
  // FUNCTION, which stringifies to `function Object() { [native code] }` and
  // lands inside the class attribute. Permission keys are admin-writable
  // `text[]`, so this is reachable without being a privilege boundary (they
  // already hold team_edit). Validate the shape rather than trust the lookup;
  // it also catches a typo'd icon, which otherwise renders as nothing at all.
  const ic = /^bi-[a-z0-9-]+$/.test(icon) ? icon : '';
  return `<span class="team-perm-chip ${cls}"${title ? ` title="${escHtml(title)}"` : ''}>`
    + `${ic ? `<i class="${ic}"></i> ` : ''}${escHtml(label)}</span>`;
}

/**
 * Draw one row's grants. Callers resolve the sets; this decides the display.
 *
 * @param {Set<string>} own          permission keys stored ON this row
 * @param {Set<string>} inherited    permission keys reaching it from its parent
 * @param {string|null} vsOwn        this row's VitalSound dept binding
 * @param {Set<string>} vsInherited  dept bindings from the parent
 * @param {string|null} seatOwn      this row's หนังสือโครงการ seat
 * @param {Set<string>} seatInherited seats from the parent (own REPLACES, 0092)
 */
export function permChipsHtml({
  own, inherited = new Set(), vsOwn = null, vsInherited = new Set(),
  seatOwn = null, seatInherited = new Set(),
  passOwn = null, passInherited = new Set(),
  pageOwn = null, pageInherited = new Set(), flat = false,
}) {
  let out = '';
  const hasMaster = own.has('master') || inherited.has('master');
  // `flat` = render an EFFECTIVE set, where own-vs-inherited is not a
  // distinction the caller is making (the modal's "สิทธิ์รวมที่จะได้รับ"
  // preview). Everything draws solid, because a dashed chip there would claim
  // "inherited" about a value the admin just picked by hand.
  const st = (base, isOwn) => `${base} ${flat || isOwn ? 'is-own' : 'is-inherited'}`;

  // Rule 2 — master subsumes every capability key, so print it instead of them.
  if (hasMaster) {
    out += permChip(st('is-master', own.has('master')), PERM_LABEL.master, {
      icon: PERM_ICON.master,
      title: own.has('master') ? 'เข้าถึงได้ทุกระบบ' : 'เข้าถึงได้ทุกระบบ (รับมาจากตำแหน่งแม่)',
    });
  }

  // Rule 1 — the value-carrying chips, before the capability keys.
  // An own seat REPLACES what the parent offers (0092), so only ever one chip:
  // showing both would advertise a grant the person does not resolve to.
  if (seatOwn) {
    out += permChip(st('is-seat', true), PROJECT_SEAT_LABEL[seatOwn] || seatOwn,
      { icon: 'bi-file-earmark-text', title: `หนังสือโครงการ: ${PROJECT_SEAT_LABEL[seatOwn] || seatOwn}` });
  } else {
    [...seatInherited].forEach((x) => {
      out += permChip(st('is-seat', false), PROJECT_SEAT_LABEL[x] || x,
        { icon: 'bi-file-earmark-text', title: `หนังสือโครงการ: ${PROJECT_SEAT_LABEL[x] || x}` });
    });
  }
  // A VitalSound แผนก chip is a SCOPE, and master is already its widest value —
  // so under master it UNDERSTATES ("only บริหารองค์กร" for someone who reads
  // every department). Same rule as the capability chips below, and the same
  // reason the editor hides the VS picker under master. Two live member rows
  // were drawing one (measured 2026-08-18). The seat chip survives master
  // because a seat is an identity, not a scope.
  if (!hasMaster) {
    if (vsOwn) {
      out += permChip(st('is-vs', true), VS_DEPT_LABEL[vsOwn] || vsOwn,
        { icon: 'bi-soundwave', title: `VitalSound: ${vsOwn}` });
    }
    [...vsInherited].forEach((d) => {
      if (d === vsOwn) return;
      out += permChip(st('is-vs', false), VS_DEPT_LABEL[d] || d,
        { icon: 'bi-soundwave', title: `VitalSound: ${d}` });
    });

    // A SAMO Passport ฝ่าย is a SCOPE, exactly like the VitalSound แผนก above,
    // and it needs its own chip for the same reason: `readPermInputs` DROPS the
    // `passport` key when a scope is chosen (scoped-is-not-full, 0083), so a
    // scoped grant carries no capability key at all. Without this block it
    // rendered NOTHING — the row said "จองโควตา Claude" and never mentioned
    // Passport, while all 51 people under it really did hold it.
    // REPORTED 2026-08-30: "i set samopassport … and it doesn't show on the
    // จัดการสิทธิ์". The grant was live the whole time; only the chip was
    // missing. This is the SECOND TWIN again (0149) — VitalSound got its scope
    // chip when scopes were invented; Passport got the storage, the editor and
    // the server resolver, and not this.
    if (passOwn) {
      out += permChip(st('is-pass', true), passportScopeLabel(passOwn),
        { icon: 'bi-airplane', title: `SAMO Passport: ${passportScopeLabel(passOwn)}` });
    }
    [...passInherited].forEach((t) => {
      if (t === passOwn) return;
      out += permChip(st('is-pass', false), passportScopeLabel(t),
        { icon: 'bi-airplane', title: `SAMO Passport: ${passportScopeLabel(t)} (รับมาจากตำแหน่งแม่)` });
    });
  }

  // หน้าฝ่าย (0177) — its own chip for the SAME reason Passport needed one:
  // `readPermInputs` DROPS the `dept_pages` key when a ฝ่าย is chosen, so a
  // scoped grant carries no capability key and the generic loop below renders
  // NOTHING for it. That is the bug reported on 2026-08-30 about Passport
  // ("i set samopassport … and it doesn't show"), where the grant was live the
  // whole time and only the chip was missing. Written here in the same commit
  // as the grant so this twin does not have to be reported too.
  if (!hasMaster) {
    if (pageOwn) {
      out += permChip(st('is-page', true), DEPT_PAGE_LABEL[pageOwn] || pageOwn,
        { icon: 'bi-pencil-square', title: `หน้าฝ่าย: ${DEPT_PAGE_LABEL[pageOwn] || pageOwn}` });
    }
    [...pageInherited].forEach((t) => {
      if (t === pageOwn) return;
      out += permChip(st('is-page', false), DEPT_PAGE_LABEL[t] || t,
        { icon: 'bi-pencil-square', title: `หน้าฝ่าย: ${DEPT_PAGE_LABEL[t] || t} (รับมาจากตำแหน่งแม่)` });
    });
  }

  // The plain capability keys — skipped entirely under master (rule 2).
  //
  // `projects` is skipped once a SEAT chip is already on the row: the seat is
  // strictly more specific ("ผู้ส่งหนังสือ (SAMO)" says หนังสือโครงการ and then
  // says which desk), so printing both spends two chips on one fact. It is NOT
  // dropped unconditionally — a `projects` grant with no seat is the one state
  // that genuinely needs saying, because that person opens the tab onto no
  // controls (0086) and the plain chip is the only sign of it.
  const seatShown = !!(seatOwn || seatInherited.size);
  if (!hasMaster) {
    [...own].forEach((p) => {
      if (p === 'projects' && seatShown) return;
      out += permChip(st('', true).trim(), PERM_LABEL[p] || p, { icon: PERM_ICON[p] });
    });
    [...inherited].forEach((p) => {
      if (own.has(p) || (p === 'projects' && seatShown)) return;
      out += permChip(st('', false).trim(), PERM_LABEL[p] || p,
        { icon: PERM_ICON[p], title: 'รับมาจากตำแหน่งแม่' });
    });
  }

  return out || '<span class="team-perm-none">ไม่มีสิทธิ์</span>';
}

// ============================================================
// PERMISSION MODAL (perms mode)
// ============================================================

/** Paint the perm checkbox grid into a container.
 *
 *  An `implicit` key (today only `team` — ทีม SAMO ดู) renders ticked, disabled
 *  and with a padlock: the server grants it to everyone in the tree, so a live
 *  checkbox there would be a control that silently does nothing. The reason is
 *  in the hint AND on the row, because a disabled tick with no explanation reads
 *  as a bug. `readPermInputs` drops these keys on the way out. */
function fillPermGrid(grid) {
  if (!grid) return;
  grid.innerHTML = PERM_CATALOG.map((p) => {
    const cls = ['team-perm-opt'];
    if (p.danger) cls.push('is-danger');
    if (p.implicit) cls.push('is-auto');
    return `
    <label class="${cls.join(' ')}"${p.hint ? ` title="${escHtml(p.hint)}"` : ''}>
      <input type="checkbox" value="${p.key}"${p.implicit ? ' checked disabled' : ''} />
      <span>${escHtml(p.label)}</span>
      ${p.implicit ? '<i class="bi bi-lock-fill team-perm-lock" aria-hidden="true"></i>'
    + '<span class="team-perm-auto-note">อัตโนมัติ</span>' : ''}
    </label>`;
  }).join('');
}

/**
 * `master` implies every other permission (migration 0111), so the rest of the
 * grid is shown ticked-and-locked while it is on — otherwise the form would
 * invite an admin to untick `pr` from someone who still, in fact, has pr.
 *
 * The CONFIRM is on the way IN only. The lesson this repo keeps relearning is
 * that the direction which WIDENS privilege needs the friction (the vs_categories
 * confidential toggle, the "ทุกแผนก" default at index 0); making it hard to
 * REMOVE power is the wrong way round.
 */
function syncMasterVisibility(grid) {
  if (!grid) return;
  const master = grid.querySelector('input[value="master"]');
  const on = !!master?.checked;
  const was = grid.classList.contains('is-master');

  // Turning master ON force-ticks the rest (it implies them). Turning it OFF
  // must therefore put them BACK — otherwise unticking the strongest grant
  // leaves all eight ticked and the next save hands out every permission
  // individually. The admin's action said "take this away"; the result would
  // have been "keep everything, just spelled out". Snapshot before the force,
  // restore after it.
  if (on && !was) {
    grid.dataset.preMaster = JSON.stringify(
      [...grid.querySelectorAll('input[type=checkbox]')]
        .filter((cb) => cb.value !== 'master' && cb.checked).map((cb) => cb.value),
    );
  }
  let restore = null;
  if (!on && was) {
    try { restore = new Set(JSON.parse(grid.dataset.preMaster || '[]')); } catch { restore = new Set(); }
    delete grid.dataset.preMaster;
  }

  grid.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    if (cb.value === 'master') return;
    // An IMPLICIT key is ticked-and-locked by fillPermGrid and must STAY that
    // way in both directions: `cb.disabled = on` below would clear the lock the
    // markup set whenever master is off — which is the normal case — turning
    // ทีม SAMO (ดู) back into a live checkbox that readPermInputs then ignores.
    // Unticking it made the pane claim the person has no view access.
    if (IMPLICIT_PERMS.includes(cb.value)) return;
    cb.disabled = on;
    if (on) cb.checked = true;
    else if (restore) cb.checked = restore.has(cb.value);
    cb.closest('.team-perm-opt')?.classList.toggle('is-implied', on);
  });
  grid.classList.toggle('is-master', on);
}

/**
 * Forget everything the grid remembers about master, before painting a new row.
 *
 * `is-master` and `preMaster` live on the GRID ELEMENT, which outlives the row
 * being edited — the modal is filled and re-filled from the same DOM. Without
 * this, opening a master ตำแหน่ง and then an ordinary person made
 * syncMasterVisibility see "master was on, now it is off" and RESTORE THE
 * PREVIOUS ROW'S snapshot onto the new row. The grid is what gets saved, so
 * that is not a display glitch: it would write permissions the second person
 * never had. Reproduced in a headless browser before fixing.
 */
function resetMasterState(grid, seatSel) {
  if (grid) {
    grid.classList.remove('is-master');
    delete grid.dataset.preMaster;
  }
  // `masterAuto` is the same hazard one control over: it lives on the SELECT,
  // which also outlives the row. Left set, opening a master person and then an
  // ordinary one would let syncMasterSeatDefault clear the second person's real
  // seat as if the form had invented it.
  if (seatSel) {
    delete seatSel.dataset.masterAuto;
    delete seatSel.dataset.userSet;
  }
}

/** Ask before handing over everything. Resolves false if the admin backs out,
 *  in which case the checkbox is put back.
 *
 *  Async because the dialog is app-drawn (see the askConfirm import). The box
 *  therefore stays ticked for the length of the dialog and is un-ticked on a
 *  "no" — which is why every caller re-runs syncMasterVisibility AFTER awaiting,
 *  not before: the grid must be repainted from the answer, not from the
 *  optimistic tick. */
async function confirmMaster(cb) {
  if (!cb.checked) return true;
  const ok = await askConfirm({
    title: 'ให้สิทธิ์ “ทุกระบบ (Master)” ใช่หรือไม่?',
    body: 'ผู้ที่ได้รับจะเข้าถึงได้ทุกระบบ รวมถึงแก้ไขโครงสร้างทีม SAMO '
      + 'และกำหนดสิทธิ์ของทุกคน (รวมถึงให้สิทธิ์ Master กับคนอื่น)',
    yes: 'ให้สิทธิ์',
  });
  if (!ok) cb.checked = false;
  return ok;
}

// Sentinel for the "all departments" VS grant. It is NOT the empty string:
// the empty value is "nothing chosen yet", so a fresh grant can never fall
// into the widest scope just by leaving the select alone (the escalating
// option must be picked on purpose — cf. the destructive-direction-toggle
// entry in .claude/rules/mistakes.md).
const VS_SCOPE_ALL = '__all__';

/** Paint the VS scope select. "" = not chosen (blocked on save);
 *  VS_SCOPE_ALL = the full `vs` grant; a dept value = that dept ONLY
 *  (and the `vs` perm is dropped on save). */
function fillVsScopeSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">— เลือกขอบเขต —</option>'
    + `<option value="${VS_SCOPE_ALL}">ทุกแผนก (ดูแลทั้งระบบ เหมือน SE)</option>`
    + VS_DEPTS.map((d) => `<option value="${escHtml(d.value)}">เฉพาะ ${escHtml(d.label)}</option>`).join('');
}

/** Paint the หนังสือโครงการ seat select. "" = not chosen — blocked on save,
 *  because a projects grant without a seat has no working workflow. */
function fillSeatSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">— เลือกบทบาท —</option>'
    + PROJECT_SEATS.map((x) => `<option value="${escHtml(x.value)}">${escHtml(x.label)}</option>`).join('');
}

// SAMO Passport departments + sub-departments, loaded once from
// list_passport_departments() (they live in the passport schema, whose tables
// have RLS on with no policy — a direct client read returns nothing).
let passportDepts = [];
let passportSubs = [];
const PASS_SCOPE_ALL = '__all__';

/** The one writer of the passport catalog. Exported because the chip labels
 *  are worth testing without a network. */
export function setPassportCatalog(depts, subs) {
  passportDepts = Array.isArray(depts) ? depts : [];
  passportSubs = Array.isArray(subs) ? subs : [];
}

async function loadPassportDepts() {
  if (passportDepts.length) return;
  try {
    const { data, error } = await dbRest('/rpc/list_passport_departments', { method: 'POST', body: {} });
    if (error || !data) return;
    setPassportCatalog(data.departments, data.sub_departments);
  } catch { /* picker falls back to "ทุกฝ่าย" only */ }
}

/**
 * The TREE needs the department names too, not just the editor.
 *
 * REPORTED 2026-08-30, right after the scope chip shipped: "currently it render
 * like ฝ่าย #5". Only the two modals called `loadPassportDepts()`, so a row
 * painted in perms mode had an empty catalog and every chip fell back to its
 * id. The fallback was doing its job; nothing was ever asking for the names.
 *
 * Requested ONCE per page. The flag is set BEFORE the await on purpose: if the
 * RPC fails, the chips keep their legible `ฝ่าย #5` fallback instead of the
 * re-render loop that "retry until it works" would produce here — render()
 * calls this, and this calls render().
 */
let passportNamesRequested = false;
function ensurePassportNames(after) {
  if (passportNamesRequested) return;
  passportNamesRequested = true;
  loadPassportDepts().then(() => { if (passportDepts.length) after(); });
}

/** Department select. "" = not chosen (blocked on save); PASS_SCOPE_ALL = the
 *  full `passport` grant; an id = that department (optionally narrowed by the
 *  sub-department select below it). */
function fillPassDeptSelect(sel) {
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">— เลือกขอบเขต —</option>'
    + `<option value="${PASS_SCOPE_ALL}">ทุกฝ่าย (ดูแลทั้งระบบ)</option>`
    + passportDepts.map((d) => `<option value="${escHtml(String(d.id))}">${escHtml(d.name)}</option>`).join('');
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

/** Sub-department select — only rendered for departments that HAVE children
 *  (2 of 10 today), so the common case stays a single dropdown. */
function fillPassSubSelect(sel, deptId) {
  if (!sel) return;
  const kids = passportSubs.filter((x) => String(x.department_id) === String(deptId));
  if (!kids.length) { sel.innerHTML = ''; sel.classList.add('d-none'); return; }
  const prev = sel.value;
  sel.innerHTML = '<option value="">ทั้งฝ่าย (ทุกแผนกย่อย)</option>'
    + kids.map((x) => `<option value="${escHtml(String(x.id))}">เฉพาะ ${escHtml(x.name)}</option>`).join('');
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  sel.classList.remove('d-none');
}

/** Is `master` ticked in this grid? One reader, so the four sync functions
 *  below cannot disagree about what "master mode" means. */
function masterOn(grid) {
  return !!grid?.querySelector('input[value="master"]')?.checked;
}

/**
 * A SCOPE picker is meaningless under master and must be HIDDEN, not left live.
 *
 * Master force-ticks every box, so before this the VS and Passport blocks
 * appeared (their checkbox was ticked), stayed enabled — `syncMasterVisibility`
 * only disables checkboxes, never the selects — and had their value discarded
 * by `readPermInputs`. Three live controls with no effect, which is precisely
 * how "i cant select…" gets reported: the control answers, the save does not.
 *
 * The seat block is deliberately NOT in this pair; see syncSeatVisibility.
 */
function syncPassVisibility(grid, wrap) {
  if (!grid || !wrap) return;
  const on = !!grid.querySelector('input[value="passport"]')?.checked && !masterOn(grid);
  wrap.classList.toggle('d-none', !on);
}

// ---------------------------------------------------------------------------
// หน้าฝ่าย (0177). Third instance of the SAME scoped-grant shape as VitalSound
// (0083) and Passport (0087), and written to look like them on purpose: a
// fourth spelling of one idea is how the three drift apart.
//   DEPT_PAGE_ALL  → the blanket `dept_pages` permission, every ฝ่าย page
//   a dept key     → that page ONLY, and the blanket key is DROPPED on save
// ---------------------------------------------------------------------------
const DEPT_PAGE_ALL = '__all__';

/** ฝ่าย-page select. "" = not chosen (blocked on save); DEPT_PAGE_ALL = blanket. */
function fillDeptPageSelect(sel) {
  if (!sel) return;
  sel.innerHTML = '<option value="">— เลือกขอบเขต —</option>'
    + `<option value="${DEPT_PAGE_ALL}">ทุกฝ่าย (แก้ได้ทุกหน้า)</option>`
    + DEPT_PAGES.map((d) => `<option value="${escHtml(d.value)}">${escHtml(d.label)}</option>`).join('');
}

/** Show the ฝ่าย-page block only while the key is ticked and master is off. */
function syncDeptPageVisibility(grid, wrap) {
  if (!grid || !wrap) return;
  const on = !!grid.querySelector(`input[value="${DEPT_PAGES_ALL}"]`)?.checked && !masterOn(grid);
  wrap.classList.toggle('d-none', !on);
}

/** Show the VS scope block only while "VitalSound" is ticked and master is off. */
function syncVsScopeVisibility(grid, wrap) {
  if (!grid || !wrap) return;
  const on = !!grid.querySelector('input[value="vs"]')?.checked && !masterOn(grid);
  wrap.classList.toggle('d-none', !on);
}

/** The หนังสือโครงการ seat block — shown under master TOO, because the seat is
 *  a desk, not a scope, and master does not answer it. */
function syncSeatVisibility(grid, wrap) {
  if (!grid || !wrap) return;
  const on = !!grid.querySelector('input[value="projects"]')?.checked;
  wrap.classList.toggle('d-none', !on);
}

/** The one-line replacement for the two scope pickers master just hid. Without
 *  it the blocks would simply vanish and an admin would wonder where the
 *  VitalSound แผนก choice went. */
function syncMasterNote(grid, ...notes) {
  const on = masterOn(grid);
  notes.forEach((n) => n?.classList.toggle('d-none', !on));
}

/**
 * Turning master on pre-selects ผู้ส่งหนังสือ — in the บุคคล editor ONLY.
 *
 * The owner's call (2026-08-18): a master holder should get the same screen AND
 * the same notifications as someone who picked the seat by hand, without having
 * to know that the seat is a separate question. So the บุคคล editor fills it in.
 *
 * A ตำแหน่ง is NOT pre-filled, because a seat set there is inherited by the
 * whole subtree: measured on the live tree, auto-filling every master-bearing
 * ตำแหน่ง would have handed `vpa` to 57 more people, each of whom would then be
 * on `list_project_seat_users('vpa')` — i.e. notified on every หนังสือ update
 * in the faculty. Ticking master on a ฝ่าย must not sign 57 people up for mail.
 * That row shows a fan-out COUNT instead (see seatFanoutCount).
 *
 * `masterAuto` marks the value as OURS, so turning master back off removes it
 * again — the same rule `preMaster` follows for the checkboxes, and for the
 * same reason: a value the form invented must not survive as if a human chose
 * it. Any human `change` on the select clears the mark (see the wiring below),
 * and `resetMasterState` clears it between rows.
 */
const MASTER_DEFAULT_SEAT = 'vpa';
function syncMasterSeatDefault(grid, sel, hint) {
  const on = masterOn(grid);
  if (sel) {
    // `userSet` is the guard that makes "— เลือกบทบาท —" selectable at all.
    // Without it the fill condition is just `on && !sel.value`, so clearing the
    // seat re-filled it on the very next sync and the empty option could not be
    // chosen while master was on. Shipped that way and caught by tracing it.
    if (on && !sel.value && !sel.dataset.userSet) {
      sel.value = MASTER_DEFAULT_SEAT;
      // Mark it ours only if the value actually TOOK. Assigning a value with no
      // matching <option> silently leaves the select empty, and the hint would
      // then claim "ตั้งเป็นผู้ส่งหนังสือให้แล้ว" over a blank control.
      if (sel.value) sel.dataset.masterAuto = '1';
    } else if (!on && sel.dataset.masterAuto) { sel.value = ''; delete sel.dataset.masterAuto; }
  }
  hint?.classList.toggle('d-none', !on);
}

/** Any human touch on a seat select — including choosing the EMPTY option —
 *  makes the value theirs. Must run before the sync that would refill it. */
function markSeatUserSet(sel) {
  if (!sel) return;
  sel.dataset.userSet = '1';
  delete sel.dataset.masterAuto;
}

/**
 * How many people would actually RECEIVE a seat set on this ตำแหน่ง.
 *
 * Mirrors the descent in SQL's `node_effective_project_seats()`: a person with
 * their own `project_seat`, a person who opted out of inheriting, and anything
 * under a descendant ตำแหน่ง that sets its own seat are all shielded — they
 * already resolve to something nearer. Showing `subtreeMemberCount` instead
 * would overstate it and train the admin to ignore the number.
 */
export function seatFanoutCount(nodeId, members = membersOf, children = childrenOf) {
  let n = 0;
  const walk = (id, blocked) => {
    for (const m of members(id)) {
      // No อีเมล means no account, so this person can never resolve a seat, get
      // the screen, or receive a notification — counting them would inflate the
      // very sentence the number appears in. 31 of the 447 member rows are in
      // that state (measured 2026-08-18), and the SQL simulation that produced
      // the "57 people" figure filtered on it, so leaving it out here would
      // make the UI and the instrument disagree about the same subtree.
      if (!m.kkumail || !String(m.kkumail).trim()) continue;
      if (!blocked && !m.project_seat && m.inherit_permissions !== false) n += 1;
    }
    for (const c of children(id)) {
      walk(c.id, blocked || !!c.project_seat || c.inherit_permissions === false);
    }
  };
  walk(nodeId, false);
  return n;
}

/** Say out loud who a ตำแหน่ง-level seat lands on, before it lands on them. */
function refreshSeatFanout(nodeId, el) {
  if (!el) return;
  const n = nodeId ? seatFanoutCount(nodeId) : 0;
  if (!n) { el.classList.add('d-none'); return; }
  el.innerHTML = `<i class="bi bi-people"></i> บทบาทที่เลือกตรงนี้จะมีผลกับคนในตำแหน่งนี้และตำแหน่งย่อย
    <b>${n} คน</b> — ทุกคนจะได้หน้าจอนั้น และจะได้รับแจ้งเตือนหนังสือโครงการด้วย`;
  el.classList.remove('d-none');
}

/** Split the modal inputs into the { permissions, vs_dept } the row stores.
 *  vs unticked          → no `vs`, no dept
 *  vs + ทุกแผนก          → `vs` (full), no dept
 *  vs + a dept          → NO `vs`, that dept (scoped — 0083)
 *  vs + nothing chosen  → null (caller must abort; see readPermInputsOrWarn) */
export function readPermInputs(grid, vsSel, seatSel, passSel, passSubSel, pageSel) {
  const perms = [...(grid?.querySelectorAll('input:checked') || [])]
    .map((cb) => cb.value)
    // Never store an implicit key. `input:checked` matches a DISABLED box too,
    // so the locked ทีม SAMO (ดู) tick would otherwise be written onto every row
    // the modal saves — making an implicit grant look like an explicit one that
    // someone could later untick, which is the 0083 "scope stored beside the
    // blanket key" trap. The resolver adds it; the row must not claim it.
    .filter((k) => !IMPLICIT_PERMS.includes(k));
  // `master` subsumes everything, so store it ALONE. Writing the implied keys
  // alongside it would make them look like independent grants that could be
  // unticked — the same trap as storing `vs` next to a vs_dept (0083) — and
  // would silently rot the day a new permission key is added.
  if (perms.includes('master')) {
    // ...but the หนังสือโครงการ SEAT is not an implied permission, so it stays.
    //
    // VitalSound แผนก and Passport ฝ่าย are SCOPES: each has a widest value and
    // master IS that value, so storing a narrower one beside the blanket grant
    // is the 0083 trap. The seat is not a scope — ผู้ส่ง / เจ้าหน้าที่ / อาจารย์
    // are three DESKS in one transaction and there is no "all three" desk. The
    // stored seat is also what `list_project_seat_users()` reads to decide who
    // gets NOTIFIED (projects/notify.js) and who can be picked as the signing
    // อาจารย์ (projects/sign.js), so nulling it made a master holder invisible
    // to both while the DB happily let them do the work.
    //
    // REPORTED 2026-08-18: "i cant select sub of the หนังสือโครงการ … so my
    // friend has to tick manually like 7 tickcheckbox". The select was live and
    // its value was thrown away right here.
    // หน้าฝ่าย is a SCOPE whose widest value master already is, so it is nulled
    // here for the same reason as the VS แผนก and the Passport ฝ่าย. ⚠️ Unlike
    // the project SEAT, nothing else reads this column — it is not a notify
    // list and not a desk — so "all" really does mean all, and nulling it
    // costs nothing. That distinction is the whole of 0176's lesson.
    return {
      permissions: ['master'], vs_dept: null,
      project_seat: (seatSel?.value || '') || null,
      passport_dept_id: null, passport_sub_dept_id: null,
      dept_page: null,
    };
  }
  const vsOn = perms.includes('vs');
  const scope = vsOn ? (vsSel?.value || '') : '';
  if (vsOn && !scope) return null;
  // A หนังสือโครงการ grant must name its seat — see PROJECT_SEATS.
  const projOn = perms.includes('projects');
  const seat = projOn ? (seatSel?.value || '') : '';
  if (projOn && !seat) return { missing: 'seat' };
  // SAMO Passport: same scoped-is-not-full rule as VitalSound — a specific
  // department/sub-department drops the blanket `passport` permission.
  const passOn = perms.includes('passport');
  const passScope = passOn ? (passSel?.value || '') : '';
  if (passOn && !passScope) return { missing: 'passport' };
  const scoped = passScope && passScope !== PASS_SCOPE_ALL;
  const passDept = scoped ? Number(passScope) : null;
  const passSub = scoped && passSubSel && !passSubSel.classList.contains('d-none')
    ? (Number(passSubSel.value) || null) : null;
  // หน้าฝ่าย: same rule again — one ฝ่าย means the blanket key must go, or
  // `current_user_dept_page_scope()` returns NULL (all) and the ฝ่าย that was
  // chosen is decorative.
  const pageOn = perms.includes(DEPT_PAGES_ALL);
  const pageScope = pageOn ? (pageSel?.value || '') : '';
  if (pageOn && !pageScope) return { missing: 'deptpage' };
  const pageScoped = pageScope && pageScope !== DEPT_PAGE_ALL;
  const dept = scope === VS_SCOPE_ALL ? '' : scope;
  let out = dept ? perms.filter((p) => p !== 'vs') : perms;
  if (scoped) out = out.filter((p) => p !== 'passport');
  if (pageScoped) out = out.filter((p) => p !== DEPT_PAGES_ALL);
  return {
    permissions: out,
    vs_dept: dept || null,
    project_seat: seat || null,
    passport_dept_id: passDept,
    passport_sub_dept_id: passSub,
    dept_page: pageScoped ? pageScope : null,
  };
}

/** readPermInputs + the two user-facing guards: a VS grant must state its
 *  scope, and "ทุกแผนก" (which hands over every department's confidential
 *  tickets) is confirmed because it is the privilege-ESCALATING direction.
 *  Resolves null when the save should be aborted.
 *
 *  ASYNC, and it must stay awaited. These two confirmations sit on the SAVE
 *  path, not a delete path — with `window.confirm` suppressed they both
 *  answered "no" instantly and บันทึก did nothing at all, with no message, for
 *  the whole life of the page. */
async function readPermInputsOrWarn(grid, vsSel, seatSel, passSel, passSubSel, pageSel, subject) {
  const out = readPermInputs(grid, vsSel, seatSel, passSel, passSubSel, pageSel);
  if (!out) {
    alert('กรุณาเลือกขอบเขต VitalSound — "ทุกแผนก" หรือเฉพาะแผนกที่รับผิดชอบ');
    vsSel?.focus();
    return null;
  }
  if (out.missing === 'deptpage') {
    alert('กรุณาเลือกขอบเขตหน้าฝ่าย — "ทุกฝ่าย" หรือฝ่ายที่ดูแล');
    return null;
  }
  if (out.missing === 'passport') {
    alert('กรุณาเลือกขอบเขต SAMO Passport — "ทุกฝ่าย" หรือฝ่าย/แผนกย่อยที่ดูแล');
    passSel?.focus();
    return null;
  }
  if (out.missing === 'seat') {
    alert('กรุณาเลือกบทบาทหนังสือโครงการ — ผู้ส่ง, เจ้าหน้าที่คณะ หรือ อาจารย์ (ลงนาม)\n\n'
      + 'ถ้าไม่เลือก ผู้ใช้จะเปิดแท็บได้แต่ไม่มีปุ่มใช้งานใด ๆ');
    seatSel?.focus();
    return null;
  }
  if (out.permissions.includes('passport')
      && !await askConfirm({
        title: `ให้สิทธิ์ SAMO Passport แบบ "ทุกฝ่าย" กับ${subject}`,
        body: 'จะเห็นและจัดการกิจกรรมของ "ทุกฝ่าย" — '
          + 'ถ้าต้องการจำกัดเฉพาะฝ่ายที่ดูแล ให้กดยกเลิกแล้วเลือกฝ่ายนั้น',
        yes: 'ให้ทุกฝ่าย',
      })) {
    return null;
  }
  if (out.permissions.includes('vs')
      && !await askConfirm({
        title: `ให้สิทธิ์ VitalSound แบบ "ทุกแผนก" กับ${subject}`,
        body: 'จะเห็นและจัดการเรื่องร้องเรียนของ "ทุกแผนก" (เทียบเท่า SE) — '
          + 'ถ้าต้องการจำกัดเฉพาะแผนกที่รับผิดชอบ ให้กดยกเลิกแล้วเลือกแผนกนั้น',
        yes: 'ให้ทุกแผนก',
      })) {
    return null;
  }
  return out;
}

function wirePermModal() {
  const grid = $('teamPermGrid');
  fillPermGrid(grid);
  fillVsScopeSelect($('teamPermVsDept'));
  fillSeatSelect($('teamPermSeat'));
  fillDeptPageSelect($('teamPermDeptPage'));
  const syncPermGrid = () => {
    syncMasterVisibility(grid);
    syncVsScopeVisibility(grid, $('teamPermVsWrap'));
    syncSeatVisibility(grid, $('teamPermSeatWrap'));
    syncPassVisibility(grid, $('teamPermPassWrap'));
    syncDeptPageVisibility(grid, $('teamPermDeptPageWrap'));
    // Two notes on this modal: what master already covers, and why the seat is
    // still a real question here. The second must NOT ride on refreshSeatFanout,
    // which hides itself at a head-count of 0 — that is exactly how a ตำแหน่ง
    // under master ended up with an unexplained empty dropdown.
    syncMasterNote(grid, $('teamPermMasterNote'), $('teamPermSeatMasterHint'));
    // A ตำแหน่ง auto-fills TOO, since 2026-08-19. It deliberately did not, on
    // the grounds that a node seat fans out to the subtree and would sign ~57
    // people up for notifications. Re-measured on the owner's challenge, and
    // that cost was wrong: `notifyVpAdmin` fires ONE Discord message to ONE
    // channel OUTSIDE the recipient loop, and email goes to a fixed address in
    // settings — so extra recipients add neither. What they add is background
    // `project_notifications` rows and a bell badge. Against that: `master`
    // exists so the dev team can TEST every workflow, and a master holder who
    // silently misses the notification half cannot. Owner's call, and correct.
    syncMasterSeatDefault(grid, $('teamPermSeat'), null);
    refreshSeatFanout($('teamPermNodeId').value, $('teamPermSeatFanout'));
  };
  grid?.addEventListener('change', async (e) => {
    // Repaint FIRST so the grid never sits mid-dialog showing neither state,
    // then again with the answer — confirmMaster may have put the box back.
    syncPermGrid();
    if (e.target?.value === 'master') {
      await confirmMaster(e.target);
      syncPermGrid();
    }
  });
  $('teamPermSeat')?.addEventListener('change', (e) => { markSeatUserSet(e.target); syncPermGrid(); });
  $('teamPermPassDept')?.addEventListener('change', () =>
    fillPassSubSelect($('teamPermPassSub'), $('teamPermPassDept').value));
  $('teamPermForm')?.addEventListener('submit', onPermSubmit);
  $('teamPermInherit')?.addEventListener('change', refreshPermInherited);
}

/** Should a permission checkbox be ticked for this row?
 *  A SCOPED grant deliberately stores no blanket permission key (0083/0087) —
 *  the binding IS the grant — so the box must be ticked from either signal.
 *  Miss this and re-opening the modal reads as "no grant", and the next save
 *  silently wipes the binding. */
export function permTicked(key, own, row) {
  // An implicit key is always on — the server grants it regardless of what the
  // row stores, and the box is disabled. Without this, re-filling the modal from
  // a row that (correctly) does not store `team` would UNTICK the locked box and
  // the pane would claim the person has no view access.
  if (IMPLICIT_PERMS.includes(key)) return true;
  if (key === 'vs') return own.has('vs') || !!row?.vs_dept;
  if (key === 'passport') {
    return own.has('passport')
      || row?.passport_dept_id != null || row?.passport_sub_dept_id != null;
  }
  return own.has(key);
}

/** Fill the สิทธิ์ pane of the ตำแหน่ง modal. Does NOT show anything — the modal
 *  is opened by openNodeModal, which decides which tab leads. */
function fillNodePermPane(id) {
  const node = nodesById.get(id);
  if (!node) return;
  $('teamPermNodeId').value = id;
  $('teamPermNodeName').textContent = nodePath(id);
  const own = new Set(node.permissions || []);
  resetMasterState($('teamPermGrid'), $('teamPermSeat'));
  $('teamPermGrid').querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.checked = permTicked(cb.value, own, node);
  });
  $('teamPermInherit').checked = node.inherit_permissions !== false;
  if ($('teamPermVsDept')) {
    $('teamPermVsDept').value = node.vs_dept || (own.has('vs') ? VS_SCOPE_ALL : '');
    // Same "the select remembers the scoped grant" rule as the member modal.
    if ($('teamPermDeptPage')) {
      $('teamPermDeptPage').value = node.dept_page || (own.has(DEPT_PAGES_ALL) ? DEPT_PAGE_ALL : '');
    }
    syncDeptPageVisibility($('teamPermGrid'), $('teamPermDeptPageWrap'));
  }
  if ($('teamPermSeat')) $('teamPermSeat').value = node.project_seat || '';
  loadPassportDepts().then(() => {
    fillPassDeptSelect($('teamPermPassDept'));
    const cur = node.passport_dept_id != null ? String(node.passport_dept_id)
      : (own.has('passport') ? PASS_SCOPE_ALL : '');
    if ($('teamPermPassDept')) $('teamPermPassDept').value = cur;
    fillPassSubSelect($('teamPermPassSub'), cur);
    if ($('teamPermPassSub') && node.passport_sub_dept_id != null) {
      $('teamPermPassSub').value = String(node.passport_sub_dept_id);
    }
  });
  syncMasterVisibility($('teamPermGrid'));
  syncVsScopeVisibility($('teamPermGrid'), $('teamPermVsWrap'));
  syncSeatVisibility($('teamPermGrid'), $('teamPermSeatWrap'));
  syncPassVisibility($('teamPermGrid'), $('teamPermPassWrap'));
  syncMasterNote($('teamPermGrid'), $('teamPermMasterNote'), $('teamPermSeatMasterHint'));
  syncMasterSeatDefault($('teamPermGrid'), $('teamPermSeat'), null);
  refreshSeatFanout(id, $('teamPermSeatFanout'));
  refreshPermInherited();
}

/** Open the ตำแหน่ง editor straight on its สิทธิ์ tab. */
function openPermModal(id) {
  const node = nodesById.get(id);
  if (node) openNodeModal({ node, tab: 'perm' });
}

function refreshPermInherited() {
  const id = $('teamPermNodeId').value;
  const inheritOn = $('teamPermInherit').checked;
  const wrap = $('teamPermInheritedWrap');
  const list = $('teamPermInheritedList');
  if (wrap && list && id) {
    const set = inheritedPermsFor(id, inheritOn);
    if (set.size) {
      // Through the shared builder: this list has the same master redundancy
      // the tree rows had — inheriting master AND the nine keys it implies is
      // nine chips saying one thing. `own` is empty because everything here is,
      // by definition, from the parent.
      list.innerHTML = permChipsHtml({ own: new Set(), inherited: set });
      wrap.classList.remove('d-none');
    } else wrap.classList.add('d-none');
  }
  // Inherited project-seat preview
  const sw = $('teamPermSeatInheritedWrap');
  const sl = $('teamPermSeatInheritedList');
  if (sw && sl && id) {
    const set = inheritedSeatsFor(id, inheritOn);
    if (set.size) {
      // Single-purpose list under its own label, so no collapse rule applies —
      // but it still emits through permChip(), the one place that writes this
      // markup, so escaping and styling cannot drift per copy.
      sl.innerHTML = [...set].map((x) => permChip('is-seat is-inherited',
        PROJECT_SEAT_LABEL[x] || x, { icon: 'bi-file-earmark-text' })).join(' ');
      sw.classList.remove('d-none');
    } else sw.classList.add('d-none');
  }
  // Inherited VS depts preview
  const vw = $('teamPermVsInheritedWrap');
  const vl = $('teamPermVsInheritedList');
  if (vw && vl && id) {
    const set = inheritedVsDeptsFor(id, inheritOn);
    if (set.size) {
      vl.innerHTML = [...set].map((d) => permChip('is-vs is-inherited',
        VS_DEPT_LABEL[d] || d, { icon: 'bi-soundwave' })).join(' ');
      vw.classList.remove('d-none');
    } else vw.classList.add('d-none');
  }
}

async function onPermSubmit(e) {
  e.preventDefault();
  const id = $('teamPermNodeId').value;
  const node = nodesById.get(id);
  if (!node) return;
  const grants = await readPermInputsOrWarn($('teamPermGrid'), $('teamPermVsDept'), $('teamPermSeat'),
    $('teamPermPassDept'), $('teamPermPassSub'), $('teamPermDeptPage'), `ตำแหน่ง "${node.name}"`);
  if (!grants) return;
  const payload = { ...grants, inherit_permissions: $('teamPermInherit').checked };
  // The สิทธิ์ pane lives inside the ตำแหน่ง modal since 0110.
  modalInstance('teamNodeModal')?.hide();
  Object.assign(node, payload);
  render();
  try { await updateNode(id, payload); } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

// ============================================================
// สาขา VOCABULARY (migration 0113)
//
// Free-text สาขา produced `MD`, `md` and `M.D.` for one answer, which the
// ตรวจสอบข้อมูล pane then reported as a `drift` finding about nothing. The
// choosers below are filled from `team_majors`, and this is the CRUD the user
// asked for ("add, edit, remove สาขา names").
//
// THE ONE THING TO KNOW BEFORE EDITING: the list is a VOCABULARY, not a foreign
// key — `team_members.major` is still plain text. So REMOVE only shrinks the
// picker (every person keeps the value they had, and the pane will report it as
// off-list), while RENAME is a real data edit and backfills the people who carry
// the old code. Both say how many rows they touch before doing it.
// ============================================================

async function loadMajors(force = false) {
  if (majors.length && !force) return majors;
  try {
    majors = await fetchMajors();
  } catch (e) {
    console.warn('[team] majors load failed:', e?.message || e);
  }
  return majors;
}

/** Fill a สาขา select. `current` is kept as an extra option when it is not in
 *  the vocabulary — the alternative is a select that silently REWRITES an
 *  off-list value the moment someone saves an unrelated field on that row. */
function fillMajorSelect(sel, current) {
  if (!sel) return;
  const cur = String(current ?? '').trim();
  const known = majors.some((m) => majorKey(m.code) === majorKey(cur));
  sel.innerHTML = '<option value="">— ไม่ระบุ —</option>'
    + majors.map((m) => `<option value="${escHtml(m.code)}">${escHtml(m.code)}${
      m.label ? ` — ${escHtml(m.label)}` : ''}</option>`).join('')
    + (cur && !known
      ? `<option value="${escHtml(cur)}">${escHtml(cur)} (ไม่อยู่ในรายการ)</option>` : '');
  sel.value = cur;
}

/**
 * Paint the COMPUTED ชั้นปี into the read-only box, live as the รหัส is typed.
 *
 * There is nothing to fill and nothing to save: `member.cohort_year` and
 * `member.year_offset` are mirrored down from the person registry, and the
 * answer is `ปีการศึกษา − ปีที่เข้า + 1 + offset`. Repainting on `input` is the
 * point — an admin correcting a mistyped รหัส sees the ชั้นปี move with it, which
 * is the behaviour that was previously impossible to get and is the whole reason
 * the two systems disagreed.
 */
function paintDerivedYear(member) {
  const box = $('teamMemberYear');
  if (!box) return;
  const sid = $('teamMemberStudentId')?.value || member?.student_id || '';
  // yearBasis, NEVER `{ ...member, student_id: sid }` — studyYear prefers a
  // stored cohort_year over the รหัส, so spreading the member keeps the OLD
  // ปีที่เข้า and the box refuses to move as the รหัส is corrected. That is 0128
  // put back on the screen.
  const label = studyYearLabel(yearBasis(member, sid));
  box.value = label || '—';
  const hint = $('teamMemberYearHint');
  if (!hint) return;
  if (!label) {
    hint.textContent = 'คำนวณจากรหัสนักศึกษา — ยังไม่มีรหัส จึงยังคำนวณไม่ได้';
  } else if (member?.year_offset) {
    hint.textContent = `คำนวณจากรหัสนักศึกษา และปรับ ${
      member.year_offset > 0 ? '+' : ''}${member.year_offset} ปี ที่เจ้าตัวตั้งไว้ (ลาพัก/เรียนซ้ำ)`;
  } else {
    hint.textContent = 'คำนวณจากรหัสนักศึกษาโดยอัตโนมัติ — แก้ที่รหัสนักศึกษา '
      + 'ส่วนกรณีลาพัก/เรียนซ้ำ เจ้าตัวตั้งเองได้ที่การ์ด “ข้อมูลของฉัน”';
  }
}

function wireMajors() {
  $('teamMemberMajorsManage')?.addEventListener('click', openMajorsModal);
  $('teamMajorsAdd')?.addEventListener('submit', onMajorAdd);
  $('teamMajorsList')?.addEventListener('click', onMajorsListClick);
  $('teamMajorsList')?.addEventListener('submit', onMajorsListSubmit);
}

async function openMajorsModal() {
  await loadMajors(true);
  await renderMajorsList();
  // Stacks ON TOP of the member editor (same as the picker and the crop dialog),
  // so getOrCreateInstance — a fresh bootstrap.Modal on an already-open modal
  // leaves a backdrop nothing clears (mistakes log).
  modalInstance('teamMajorsModal')?.show();
}

/** The list, with a live count of how many people carry each code — that count
 *  is the whole reason this pane is safe to use: it turns "remove RT" from a
 *  guess into "remove RT, which 19 people still have". */
async function renderMajorsList() {
  const host = $('teamMajorsList');
  if (!host) return;
  host.innerHTML = '<div class="text-muted small">กำลังนับจำนวนสมาชิก…</div>';
  const counts = new Map();
  await Promise.all(majors.map(async (m) => {
    try { counts.set(m.id, await countMembersWithMajor(m.code)); } catch { counts.set(m.id, null); }
  }));
  if (!majors.length) {
    host.innerHTML = '<div class="text-muted small">ยังไม่มีสาขาในรายการ</div>';
    return;
  }
  host.innerHTML = majors.map((m) => {
    const n = counts.get(m.id);
    return `
    <div class="team-major-row" data-major-id="${escHtml(m.id)}">
      <div class="team-major-main" data-major-view>
        <span class="team-major-code">${escHtml(m.code)}</span>
        ${m.label ? `<span class="team-major-label">${escHtml(m.label)}</span>` : ''}
      </div>
      <!-- The new name is typed HERE, in the row it renames, rather than into a
           native prompt(). Once Chrome suppresses dialogs, prompt() returns null
           instantly and the pencil became a button that did nothing — the same
           failure this tab's deletes had. A value the user types also belongs
           where they can see what it applies to. -->
      <form class="team-major-rename" data-major-rename hidden>
        <input type="text" class="form-control form-control-sm" value="${escHtml(m.code)}"
               aria-label="ชื่อสาขาใหม่ของ ${escHtml(m.code)}" />
        <button type="submit" class="team-act" title="บันทึกชื่อใหม่">
          <i class="bi bi-check-lg"></i></button>
        <button type="button" class="team-act" data-major-act="rename-cancel" title="ยกเลิก">
          <i class="bi bi-x-lg"></i></button>
      </form>
      <span class="team-major-count">${n == null ? '—' : `${n} คน`}</span>
      <button type="button" class="team-act" data-major-act="rename" title="เปลี่ยนชื่อ">
        <i class="bi bi-pencil"></i></button>
      <button type="button" class="team-act team-act-danger" data-major-act="delete" title="ลบออกจากรายการ">
        <i class="bi bi-trash"></i></button>
    </div>`;
  }).join('');
}

async function onMajorAdd(e) {
  e.preventDefault();
  const codeEl = $('teamMajorsNewCode');
  const labelEl = $('teamMajorsNewLabel');
  const code = codeEl.value.trim();
  if (!code) { codeEl.focus(); return; }
  if (majors.some((m) => majorKey(m.code) === majorKey(code))) {
    alert(`“${code}” อยู่ในรายการแล้ว`);
    return;
  }
  try {
    await createMajor({
      code, label: labelEl.value.trim() || null,
      position: (majors[majors.length - 1]?.position ?? 0) + 1,
    });
    codeEl.value = '';
    labelEl.value = '';
    await loadMajors(true);
    await renderMajorsList();
    refreshMajorPickers();
  } catch (err) {
    alert(duplicateMessage(err, { code }) || err?.message || 'เพิ่มสาขาไม่สำเร็จ');
  }
}

async function onMajorsListClick(e) {
  const btn = e.target.closest('[data-major-act]');
  if (!btn) return;
  const row = btn.closest('[data-major-id]');
  const act = btn.dataset.majorAct;
  // Opening/closing the rename box is pure DOM — it must NOT depend on finding
  // the row in the in-memory list first, or a stale model turns the pencil into
  // a button that does nothing (this file spent a session on that exact shape).
  // The lookup happens on SUBMIT, where a miss has something to say.
  if (act === 'rename') { showMajorRename(row, true); return; }
  if (act === 'rename-cancel') { showMajorRename(row, false); return; }
  const m = majors.find((x) => x.id === row?.dataset.majorId);
  if (!m) return;
  await removeMajor(m);
}

/** Swap one row between its label and its rename box. */
function showMajorRename(row, on) {
  if (!row) return;
  const view = row.querySelector('[data-major-view]');
  const form = row.querySelector('[data-major-rename]');
  if (view) view.hidden = on;
  if (form) {
    form.hidden = !on;
    // Focus inside the click that opened it — iOS only raises the keyboard for a
    // focus() that happens during a user gesture, and this is one.
    if (on) { const i = form.querySelector('input'); i?.focus(); i?.select(); }
  }
  // The row's own pencil + trash would otherwise sit beside the ✓/✕ of the box
  // they opened — four buttons for one row, on a phone.
  row.querySelectorAll('[data-major-act="rename"], [data-major-act="delete"]')
    .forEach((b) => { b.hidden = on; });
}

/** Submit of a row's rename box. `submit` bubbles, so ONE listener on the list
 *  host covers every row and survives every re-render of its children. */
async function onMajorsListSubmit(e) {
  const form = e.target.closest('[data-major-rename]');
  if (!form) return;
  e.preventDefault();
  const row = form.closest('[data-major-id]');
  const m = majors.find((x) => x.id === row?.dataset.majorId);
  if (m) await renameMajor(m, form.querySelector('input')?.value ?? '');
}

async function renameMajor(m, raw) {
  const code = String(raw || '').trim();
  if (!code || code === m.code) return;
  if (majors.some((x) => x.id !== m.id && majorKey(x.code) === majorKey(code))) {
    alert(`“${code}” อยู่ในรายการแล้ว`);
    return;
  }
  let n = 0;
  try { n = await countMembersWithMajor(m.code); } catch { /* shown as unknown below */ }
  if (!await askConfirm({
    title: `เปลี่ยน “${m.code}” เป็น “${code}” ?`,
    body: `จะแก้ข้อมูลสาขาของสมาชิก ${n} คนด้วย`,
    yes: 'เปลี่ยนชื่อ',
    danger: false,
  })) return;
  try {
    // The PEOPLE first. If the vocabulary row were renamed first and this failed,
    // the list would say `code` while 348 rows still said `m.code` — i.e. every
    // one of them would read as "off-list" until someone noticed.
    await renameMajorOnMembers(m.code, code);
    await updateMajor(m.id, { code });
    await loadMajors(true);
    await renderMajorsList();
    refreshMajorPickers();
    reload();
  } catch (err) { alert(err?.message || 'เปลี่ยนชื่อไม่สำเร็จ'); }
}

async function removeMajor(m) {
  let n = 0;
  try { n = await countMembersWithMajor(m.code); } catch { /* shown as unknown below */ }
  const warn = n
    ? `\n\nสมาชิก ${n} คนยังมีสาขา “${m.code}” อยู่ — ข้อมูลของพวกเขาจะไม่เปลี่ยน `
      + 'แต่จะขึ้นว่า “ไม่อยู่ในรายการ” จนกว่าจะแก้ให้เป็นสาขาอื่น'
    : '';
  if (!await askConfirm({
    title: `ลบ “${m.code}” ออกจากรายการสาขา?`,
    body: warn || 'ไม่มีสมาชิกคนใดใช้สาขานี้อยู่',
    yes: 'ลบ',
  })) return;
  try {
    await deleteMajor(m.id);
    await loadMajors(true);
    await renderMajorsList();
    refreshMajorPickers();
  } catch (err) { alert(err?.message || 'ลบไม่สำเร็จ'); }
}

/** Repaint any สาขา chooser that is currently on screen, keeping its value. */
function refreshMajorPickers() {
  const sel = $('teamMemberMajor');
  if (sel) fillMajorSelect(sel, sel.value);
}

// ============================================================
// MEMBER MODAL
// ============================================================

// `onFillFromHouse` and its "ดึงจากระบบบ้าน" button lived here until 0141.
// REPORTED: "why are there still ดึงจากระบบบ้าน, isn't teamsamo and house system
// sync, or what is it for". Correct — it was 0130's interim bridge between two
// copies of one person, and since 0132 there is only one `people` row with
// mirrors in both directions, so there is nothing to pull FROM. The search box
// at the top of the form (0137) does what the button was reaching for, by any
// field rather than by an exact address nobody has to hand.
//
// ⚠️ That removal also took the block BELOW with it — the 0137 picker's
// module-scope state and its two renderers — which is why this comment now
// stands next to them. See `docs/mistakes/frontend-ui.md`: deleting a feature
// took out the unrelated neighbour it happened to sit beside, and nothing in
// the build catches a call to a function that no longer exists.
// ---- the person picker (0137) ---------------------------------------------

/**
 * Type anything you know about a person; pick them; the form fills itself.
 *
 * WHY THIS EXISTS. 0130's "ดึงจากระบบบ้าน" needs an exact kkumail, which is the
 * one field an admin adding somebody does not have — so in practice the six
 * boxes below were retyped, and retyping is where one human becomes two
 * slightly different records. `public.people` already holds all six for every
 * person the faculty knows, so the form can ask for the person instead.
 *
 * The state is ONE module-scope token, not a flag on the input. Two things make
 * that necessary: results arrive out of order (a 2-character query is slower
 * than the 5-character one typed after it, and the stale reply would overwrite
 * the fresh list), and the modal is one DOM element reused for every row, so
 * anything parked on it outlives the person it describes — the exact shape that
 * leaked a permission grid across rows in 0110.
 */
// The picker's two RESTING sentences. เพิ่ม asks who this is; แก้ไข has to warn
// that picking somebody REPLACES what is already typed, because there the same
// click reassigns an existing posting to a different human.
//
// ⚠️ `PERSON_SEARCH_HINT_ADD` is also the literal in `src/html/tab-team.html`
// (`#teamMemberSearchHint`), which is what the box says before any modal has
// opened. HTML cannot import a constant, so that copy is pinned by
// `person-search-hint.test.js` rather than by care.
export const PERSON_SEARCH_HINT_ADD =
  'พิมพ์อย่างน้อย 2 ตัวอักษร แล้วเลือกจากรายการเพื่อเติมข้อมูลให้อัตโนมัติ';
export const PERSON_SEARCH_HINT_EDIT =
  'ค้นหาเพื่อเติมข้อมูลจากระบบทับของเดิม — หรือแก้ในช่องด้านล่างได้เลย';

let personSearchToken = 0;
let personSearchTimer = null;
let personSearchHits = [];
/**
 * What the hint says when the picker has nothing to say about a QUERY.
 *
 * It is a variable, not two string literals at two call sites, because the
 * resting sentence differs between เพิ่มสมาชิก and แก้ไขสมาชิก and only
 * `openMemberModal` knows which one this open is. Retyping it in the renderer
 * would be one rule with two implementations (class 6): the two would agree
 * until somebody edited one.
 *
 * REPORTED (docs/NEXT.md §0b, item 2): typing a second query left
 * “ไม่พบใครที่ตรงกับ <old query>” on screen while the NEW results were listed
 * directly beneath it. The hint was written on the empty path and never
 * withdrawn on the path that finds rows — a message with an entry but no exit.
 */
let personSearchResting = PERSON_SEARCH_HINT_ADD;

function renderPersonResults(hits, q) {
  const box = $('teamMemberSearchResults');
  if (!box) return;
  personSearchHits = hits;
  const hint = $('teamMemberSearchHint');
  if (!hits.length) {
    box.classList.add('d-none');
    box.innerHTML = '';
    // Under two characters nothing was SEARCHED, so there is no verdict to
    // report — and any verdict still on screen is about a query that is gone.
    if (hint) {
      hint.textContent = q.length >= 2
        ? `ไม่พบใครที่ตรงกับ “${q}” — กรอกข้อมูลเองด้านล่างได้เลย`
        : personSearchResting;
    }
    return;
  }
  box.classList.remove('d-none');
  // Rows are on screen, so the hint must stop claiming there are none.
  if (hint) hint.textContent = personSearchResting;
  box.innerHTML = hits.map((p, i) => {
    const name = p.full_name || [p.first_name_th, p.last_name_th].filter(Boolean).join(' ') || '(ไม่มีชื่อ)';
    // WHERE they already are, not just THAT they are. "อยู่แล้ว" alone makes an
    // admin close the dialog and go looking; naming the ฝ่าย answers the
    // question that would have sent them looking. A person legitimately holds
    // two postings, so this informs rather than blocks.
    const badge = p.in_team
      ? `<span class="team-person-badge">อยู่ในทีมแล้ว${p.team_nodes ? ` — ${escHtml(p.team_nodes)}` : ''}</span>`
      : '';
    const meta = [
      p.nickname ? `(${p.nickname})` : '',
      p.student_id || '',
      p.major || '',
      p.kkumail || '',
    ].filter(Boolean).join(' · ');
    return `<li><button type="button" class="team-person-hit" data-person-idx="${i}">
      <span class="team-person-name">${escHtml(name)}</span>
      ${badge}
      <span class="team-person-meta">${escHtml(meta)}</span>
    </button></li>`;
  }).join('');
}

/**
 * Fill the form from a picked person.
 *
 * OVERWRITES, unlike "ดึงจากระบบบ้าน" which only fills blanks. The difference is
 * intent: that button augments a form someone is already filling in, while this
 * one IS the answer to "who is this" — leaving a half-typed guess sitting next
 * to the record it was a guess at is how the two disagree. What it will not do
 * is invent a name split; a registry row with only a combined name leaves the
 * two boxes empty and says so (0135).
 */
async function pickPerson(p) {
  if (!p) return;

  // ── THE IDENTITY SWAP GUARD ────────────────────────────────────────────────
  //
  // Reported: "when i press at myself แก้ไขสมาชิก then i ค้นหาคนจากระบบ พู่กัน
  // then click … it fills this information, and พู่กัน picture become myself."
  //
  // This picker was written for เพิ่มสมาชิก, where "who is this" has no previous
  // answer and overwriting is the whole point. In แก้ไขสมาชิก the same click
  // means something entirely different: it REASSIGNS an existing posting to a
  // different human. And it does not stop at this form. On save,
  // `team_members_link_person` repoints the row's `person_id` at the picked
  // person's registry row, `team_member_mirror_up` writes THIS FORM's fields up
  // into it, and `person_mirror_down` fans that out to every other posting that
  // person holds and to their ระบบบ้าน record. One misclick rewrites a second
  // person's identity in three systems, with no error anywhere.
  //
  // So: ask, but only when it is genuinely a swap. A posting with no kkumail yet
  // (15 of them live) is the case this picker legitimately serves during an
  // edit — attaching a real person to a row that never had one — and it must
  // stay one click.
  const editingId = $('teamMemberId').value;
  const stored = editingId ? findMember(editingId) : null;
  const storedMail = String(stored?.kkumail || '').trim().toLowerCase();
  const pickedMail = String(p.kkumail || '').trim().toLowerCase();
  if (stored && storedMail && pickedMail && storedMail !== pickedMail) {
    const storedWho = String(stored.full_name || '').trim() || storedMail;
    const pickedWho = String(p.full_name || '').trim() || pickedMail;
    // askConfirm, never window.confirm — a suppressed native dialog returns
    // false instantly and has already shipped here twice as "the button does
    // nothing". Default is cancel, and the wording says what it costs.
    const ok = await askConfirm({
      title: 'เปลี่ยนเจ้าของตำแหน่งนี้?',
      body: `ตำแหน่งนี้เป็นของ ${storedWho} (${storedMail}) อยู่ตอนนี้ `
        + `ถ้าเลือก ${pickedWho} (${pickedMail}) ตำแหน่งนี้จะกลายเป็นของ ${pickedWho} `
        + `และเมื่อกดบันทึก ข้อมูลของ ${pickedWho} ในระบบ — ทั้งชื่อ ชื่อเล่น รหัสนักศึกษา `
        + 'สาขา และรูป — จะถูกเขียนทับด้วยสิ่งที่อยู่ในฟอร์มนี้ ทั้งในทีม SAMO และระบบบ้าน '
        + `ถ้าเพียงต้องการแก้ข้อมูลของ ${storedWho} ให้กดยกเลิก แล้วพิมพ์แก้ในช่องได้เลย`,
      yes: 'ใช่ เปลี่ยนเป็นคนนี้',
      danger: true,
    });
    if (!ok) {
      const box0 = $('teamMemberSearchResults');
      if (box0) { box0.classList.add('d-none'); box0.innerHTML = ''; }
      return;
    }
  }

  $('teamMemberFirstName').value = p.first_name_th || '';
  $('teamMemberLastName').value = p.last_name_th || '';
  $('teamMemberNickname').value = p.nickname || '';
  $('teamMemberStudentId').value = p.student_id || '';
  $('teamMemberEmail').value = p.kkumail || '';
  // The picked person brings their own รหัส — and their own ลาพัก offset, which
  // is a registry fact, not this posting's. Repaint from THEIR ingredients, or
  // the box keeps showing the ชั้นปี of whoever the form was opened on.
  paintDerivedYear(p);
  const legacyName = $('teamMemberNameLegacy');
  if (legacyName) {
    legacyName.textContent = (!p.first_name_th && !p.last_name_th && p.full_name)
      ? `ชื่อในระบบตอนนี้: ${p.full_name} — ยังไม่ได้แยกช่อง กรอกแยกด้านบนได้เลย `
        + '(ระบบไม่แยกให้เอง เพราะเดาแล้วอาจได้ชื่อผิดตัว)'
      : '';
  }
  if (p.major) {
    await loadMajors();
    fillMajorSelect($('teamMemberMajor'), p.major);
  }

  // THE PORTRAIT TRAVELS WITH THE PERSON (0148). Without this the form describes
  // the picked person while still holding the previous row's face, and
  // `team_member_mirror_up` then writes that face onto them across ทีม SAMO, the
  // registry and ระบบบ้าน. That is the reported bug, and it is not cosmetic:
  // the mirror assigns photo_url unconditionally, so leaving the wrong one is a
  // silent overwrite of a real person's picture.
  //
  // Clearing instead would be no safer — `photo_url = null` is not "leave it
  // alone" to that same mirror; it wipes the portrait everywhere. The picker
  // either knows the real portrait or it corrupts one, which is why 0148 added
  // it to `search_people` rather than fixing this in the client alone.
  //
  // A PENDING UPLOAD WINS. It is a file this admin chose for this posting
  // moments ago, and it is about to be published for the person now named here;
  // discarding it would throw away the more deliberate of the two signals.
  if (!memberPhotoPending) {
    memberPhotoFocus = p.photo_focus || 'center';
    setMemberPhoto(p.photo_url || '');
  }

  const box = $('teamMemberSearchResults');
  if (box) { box.classList.add('d-none'); box.innerHTML = ''; }
  // The confirmation BECOMES the resting text, so clearing the search box (or
  // typing one character) falls back to “you filled this from X”, not to the
  // generic invitation — the form really does hold that person now. Leaving it
  // out of `personSearchResting` would make an emptied query undo a true
  // statement about the form.
  personSearchResting = `เติมข้อมูลของ ${p.full_name || p.kkumail || 'คนนี้'} แล้ว `
    + '— ตรวจดูอีกครั้งก่อนบันทึก แก้ตรงนี้จะเปลี่ยนในระบบบ้านด้วย';
  const hint = $('teamMemberSearchHint');
  if (hint) hint.textContent = personSearchResting;
  $('teamMemberFirstName')?.focus();
}

// ── "พบคนนี้ในระบบแล้ว" — the passive half of the picker ────────────────────
//
// The search box above is OPT-IN: it only fires if the admin thinks to use it.
// Typing the person's details straight into the fields — the natural thing when
// you already have them — used to produce no signal at all, and ทีม SAMO cannot
// fall back on the database the way ระบบบ้าน does: `students.kkumail` is UNIQUE,
// so a duplicate there is REFUSED, while `team_members` has no unique key on
// purpose (82 people hold 2–4 ตำแหน่ง). A second posting is legal, so nothing
// stops it and nothing mentions it.
//
// Hence a panel rather than a block. It answers "who is this" before บันทึก,
// names the ตำแหน่ง this person already holds so a real duplicate is obvious,
// and says which typed fields disagree with the registry. Saving still works.
let teamPersonMatch = null;
let teamPersonMatchToken = 0;
let teamPersonMatchTimer = null;

/** Registry field → label → the input that holds the typed value. */
const TEAM_FILL_FIELDS = [
  ['first_name_th', 'ชื่อจริง', 'teamMemberFirstName'],
  ['last_name_th', 'นามสกุล', 'teamMemberLastName'],
  ['nickname', 'ชื่อเล่น', 'teamMemberNickname'],
  ['student_id', 'รหัสนักศึกษา', 'teamMemberStudentId'],
  ['major', 'สาขา', 'teamMemberMajor'],
];

function paintTeamPersonMatch() {
  const box = $('teamMemberPersonMatch');
  if (!box) return;
  const p = teamPersonMatch;
  if (!p) { box.className = 'person-match d-none'; box.innerHTML = ''; return; }

  const who = escHtml(p.full_name || p.first_name_th || '(ไม่มีชื่อ)');
  const posts = String(p.team_nodes || '').split(' · ').map((s) => s.trim()).filter(Boolean);

  const differs = TEAM_FILL_FIELDS
    .filter(([key, , el]) => {
      const typed = String($(el)?.value || '').trim();
      const known = String(p[key] || '').trim();
      return typed && known && typed !== known;
    })
    .map(([key, label]) => `${label}: <code>${escHtml(String(p[key]))}</code>`);

  // Never `is-block`: unlike ระบบบ้าน there is nothing here the database will
  // refuse, so a red "you cannot do this" would be a lie.
  box.className = 'person-match is-known';
  box.innerHTML = `
    <div class="person-match-head"><i class="bi bi-person-check-fill" aria-hidden="true"></i>
      <strong>พบคนนี้ในระบบแล้ว</strong></div>
    <p class="person-match-body">${who}${p.student_id ? ` · ${escHtml(p.student_id)}` : ''}${
  p.in_house ? ' · อยู่ในระบบบ้าน' : ''}</p>
    ${posts.length
    ? `<p class="person-match-body">มีตำแหน่งอยู่แล้ว:</p>
       <ul class="person-match-posts">${posts.map((n) => `<li>${escHtml(n)}</li>`).join('')}</ul>
       <p class="person-match-body">ถ้าต้องการเพิ่มอีกตำแหน่งให้คนเดิม บันทึกได้เลย</p>`
    : '<p class="person-match-body">ยังไม่มีตำแหน่งในทีม SAMO — บันทึกได้เลย ระบบจะผูกให้เป็นคนเดียวกันเอง</p>'}
    ${differs.length
    ? `<p class="person-match-diff"><i class="bi bi-info-circle" aria-hidden="true"></i>
         ข้อมูลในระบบต่างจากที่กรอก — ${differs.join(' · ')}</p>` : ''}
    <button type="button" class="btn btn-sm btn-outline-secondary"
      data-team-act="use-person">ใช้ข้อมูลจากระบบ</button>`;
}

/** Fill only the EMPTY boxes. Never overwrites what is typed — the diff line
 *  says what disagrees, and choosing between two spellings of a real person's
 *  name is a decision, not a merge. (`pickPerson` DOES overwrite, because there
 *  the admin explicitly said "this is who it is".) */
function useTeamPersonData() {
  const p = teamPersonMatch;
  if (!p) return;
  for (const [key, , el] of TEAM_FILL_FIELDS) {
    const node = $(el);
    const known = String(p[key] || '').trim();
    if (!node || !known || String(node.value || '').trim()) continue;
    node.value = known;
  }
  paintDerivedYear({ student_id: $('teamMemberStudentId')?.value || '', year_offset: p.year_offset });
  paintTeamPersonMatch();
}

/**
 * Look up whatever identifies a person, debounced.
 *
 * Triggered by KKU Mail *and* รหัสนักศึกษา, because either one alone identifies
 * somebody and an admin filling this form often has only one of them —
 * `search_people` ranks an exact match on either as rank 0. The token is bumped
 * per call so a slow reply for a half-typed value cannot land after a faster one
 * for the finished value; this modal is a single DOM element reused for every
 * row, and state outliving the record it described is a bug this repo has
 * shipped more than once.
 */
function lookupTeamPerson() {
  const mail = String($('teamMemberEmail')?.value || '').trim().toLowerCase();
  const sid = String($('teamMemberStudentId')?.value || '').trim();
  const q = mail.includes('@') && mail.length >= 4 ? mail
    : (sid.replace(/\D/g, '').length >= 9 ? sid : '');
  const token = ++teamPersonMatchToken;
  clearTimeout(teamPersonMatchTimer);
  if (!q) { teamPersonMatch = null; paintTeamPersonMatch(); return; }

  // Editing an existing posting: a match on the row's OWN person is not news,
  // and "พบคนนี้ในระบบแล้ว" pointed at itself would be nonsense.
  const editingId = $('teamMemberId')?.value || '';
  const selfMail = editingId
    ? String(findMember(editingId)?.kkumail || '').trim().toLowerCase() : '';

  teamPersonMatchTimer = setTimeout(() => {
    searchPeople(q, 5)
      .then((hits) => {
        if (token !== teamPersonMatchToken) return;
        const exact = (hits || []).find((h) => {
          const hm = String(h.kkumail || '').trim().toLowerCase();
          if (mail && hm === mail) return true;
          const hd = String(h.student_id || '').replace(/\D/g, '');
          return !mail && hd && hd === sid.replace(/\D/g, '');
        }) || null;
        const isSelf = exact && selfMail
          && String(exact.kkumail || '').trim().toLowerCase() === selfMail;
        teamPersonMatch = isSelf ? null : exact;
        paintTeamPersonMatch();
      })
      .catch((err) => {
        // A failed lookup must NOT block the save. This panel is a courtesy —
        // and unlike ระบบบ้าน there is no unique index behind it, so a courtesy
        // that turned into a wall on a network hiccup would be pure loss.
        console.warn('team: person lookup failed:', err);
        if (token === teamPersonMatchToken) { teamPersonMatch = null; paintTeamPersonMatch(); }
      });
  }, 250);
}

function wireMemberModal() {
  $('teamMemberForm')?.addEventListener('submit', onMemberSubmit);
  $('teamMemberEmail')?.addEventListener('input', lookupTeamPerson);
  $('teamMemberStudentId')?.addEventListener('input', lookupTeamPerson);
  // Delegated onto the panel's own host, which outlives every repaint of its
  // innerHTML — a listener re-attached per paint fires N times on the Nth paint.
  $('teamMemberPersonMatch')?.addEventListener('click', (e) => {
    if (e.target.closest('[data-team-act="use-person"]')) useTeamPersonData();
  });

  const search = $('teamMemberSearch');
  search?.addEventListener('input', () => {
    const q = search.value.trim();
    clearTimeout(personSearchTimer);
    const token = ++personSearchToken;
    if (q.length < 2) { renderPersonResults([], q); return; }
    // Debounced, because one request per keystroke over 1,800 rows is a lot of
    // requests to throw away. 200 ms is below the point where typing feels
    // laggy and above the point where every letter is its own query.
    personSearchTimer = setTimeout(async () => {
      try {
        const hits = await searchPeople(q);
        // A LATER query has already been sent; this reply is stale and painting
        // it would show results for a prefix of what is now in the box.
        if (token !== personSearchToken) return;
        renderPersonResults(hits, q);
      } catch (err) {
        if (token !== personSearchToken) return;
        const hint = $('teamMemberSearchHint');
        if (hint) hint.textContent = err?.message || 'ค้นหาไม่สำเร็จ';
      }
    }, 200);
  });

  // Delegated, and attached ONCE to a host that outlives every repaint. A
  // listener re-attached per render onto a surviving node fires N times on the
  // Nth paint — the ระบบบ้าน panel that opened only on odd-numbered clicks.
  $('teamMemberSearchResults')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-person-idx]');
    if (!btn) return;
    pickPerson(personSearchHits[Number(btn.dataset.personIdx)]);
  });

  $('teamMemberPhotoFile')?.addEventListener('change', onMemberPhotoPick);
  $('teamMemberPhotoClear')?.addEventListener('click', () => {
    // Dropping a PENDING pick must also drop the pick, not just the stored URL —
    // otherwise นำรูปออก appears to work and the save uploads the picked file.
    clearPendingPhoto();
    setMemberPhoto('');
    const hint = $('teamMemberPhotoHint');
    if (hint) hint.textContent = PHOTO_HINT_DEFAULT;
  });
  $('teamMemberDelete')?.addEventListener('click', () => {
    const id = $('teamMemberId').value;
    if (id) { modalInstance('teamMemberModal')?.hide(); onDeleteMember(id); }
  });
  // The node selector opens the searchable picker (the member modal stays open
  // underneath; we just stamp the choice into the hidden input + label).
  $('teamMemberNodeBtn')?.addEventListener('click', () => {
    openPicker({
      title: 'เลือกตำแหน่ง', currentId: $('teamMemberNodeId').value || null,
      onPick: (target) => { if (target) setMemberNode(target); },
    });
  });
}

function setMemberNode(nid) {
  $('teamMemberNodeId').value = nid || '';
  const label = $('teamMemberNodeLabel');
  if (label) {
    label.textContent = nid ? nodePath(nid) : 'เลือกตำแหน่ง…';
    label.classList.toggle('text-muted', !nid);
  }
}

// ============================================================
// MEMBER PERMISSION MODAL (perms mode — สิทธิ์รายบุคคล)
// ============================================================

function wireMemberPermModal() {
  const grid = $('teamMPermGrid');
  fillPermGrid(grid);
  fillVsScopeSelect($('teamMPermVsDept'));
  fillSeatSelect($('teamMPermSeat'));
  fillDeptPageSelect($('teamMPermDeptPage'));
  grid?.addEventListener('change', async (e) => {
    syncMasterVisibility(grid);
    syncDeptPageVisibility(grid, $('teamMPermDeptPageWrap'));
    refreshMemberPermEff();
    if (e.target?.value === 'master') {
      await confirmMaster(e.target);
      syncMasterVisibility(grid);
      refreshMemberPermEff();
    }
  });
  $('teamMPermPassDept')?.addEventListener('change', () => {
    fillPassSubSelect($('teamMPermPassSub'), $('teamMPermPassDept').value);
    refreshMemberPermEff();
  });
  $('teamMPermVsDept')?.addEventListener('change', refreshMemberPermEff);
  $('teamMPermDeptPage')?.addEventListener('change', refreshMemberPermEff);
  $('teamMPermSeat')?.addEventListener('change', (e) => {
    // A human touched it, so the value is theirs now and must survive master
    // being turned off again. Marking BEFORE the refresh matters:
    // syncMasterSeatDefault runs inside it and would otherwise still see ours.
    markSeatUserSet(e.target);
    refreshMemberPermEff();
  });
  $('teamMPermInherit')?.addEventListener('change', refreshMemberPermEff);
  $('teamMPermForm')?.addEventListener('submit', onMemberPermSubmit);
}

/** Fill the สิทธิ์ pane of the สมาชิก modal. Does NOT show anything. */
function fillMemberPermPane(memberId) {
  const m = findMember(memberId);
  if (!m) return;
  $('teamMPermMemberId').value = m.id;
  $('teamMPermName').textContent = m.full_name || '';
  $('teamMPermNode').textContent = nodePath(m.node_id);
  const own = new Set(m.permissions || []);
  resetMasterState($('teamMPermGrid'), $('teamMPermSeat'));
  $('teamMPermGrid')?.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.checked = permTicked(cb.value, own, m);
  });
  if ($('teamMPermVsDept')) {
    $('teamMPermVsDept').value = m.vs_dept || (own.has('vs') ? VS_SCOPE_ALL : '');
  }
  if ($('teamMPermSeat')) $('teamMPermSeat').value = m.project_seat || '';
  // A SCOPED grant carries no blanket key, so the select — not the checkbox —
  // is what remembers it. Re-opening the modal with only the checkbox read
  // would show the grant as absent and SAVE it away (0087's "re-opening the
  // editor wipes the grant").
  if ($('teamMPermDeptPage')) {
    $('teamMPermDeptPage').value = m.dept_page || (own.has(DEPT_PAGES_ALL) ? DEPT_PAGE_ALL : '');
  }
  syncDeptPageVisibility($('teamMPermGrid'), $('teamMPermDeptPageWrap'));
  loadPassportDepts().then(() => {
    fillPassDeptSelect($('teamMPermPassDept'));
    const cur = m.passport_dept_id != null ? String(m.passport_dept_id)
      : (own.has('passport') ? PASS_SCOPE_ALL : '');
    if ($('teamMPermPassDept')) $('teamMPermPassDept').value = cur;
    fillPassSubSelect($('teamMPermPassSub'), cur);
    if ($('teamMPermPassSub') && m.passport_sub_dept_id != null) {
      $('teamMPermPassSub').value = String(m.passport_sub_dept_id);
    }
    refreshMemberPermEff();
  });
  $('teamMPermInherit').checked = m.inherit_permissions !== false;
  refreshMemberPermEff();
}

/** Open the สมาชิก editor straight on its สิทธิ์ tab. */
function openMemberPermModal(memberId) {
  const m = findMember(memberId);
  if (m) openMemberModal({ member: m, tab: 'perm' });
}

/** Effective perms + VS scope the member-perm modal is about to grant, from
 *  live inputs: own picks ∪ (inherit ? the member's node effective grants). */
function refreshMemberPermEff() {
  syncMasterVisibility($('teamMPermGrid'));
  syncVsScopeVisibility($('teamMPermGrid'), $('teamMPermVsWrap'));
  syncSeatVisibility($('teamMPermGrid'), $('teamMPermSeatWrap'));
  syncPassVisibility($('teamMPermGrid'), $('teamMPermPassWrap'));
  syncMasterNote($('teamMPermGrid'), $('teamMPermMasterNote'));
  // บุคคล only: a person's seat lands on that person, so pre-filling it is safe.
  syncMasterSeatDefault($('teamMPermGrid'), $('teamMPermSeat'), $('teamMPermSeatMasterHint'));
  const wrap = $('teamMPermEffWrap');
  const list = $('teamMPermEffList');
  if (!wrap || !list) return;
  const m = findMember($('teamMPermMemberId').value);
  // Preview only — a not-yet-chosen scope shows the perms without a VS chip.
  const { permissions, vs_dept: vsDept, project_seat: seat } =
    readPermInputs($('teamMPermGrid'), $('teamMPermVsDept'), $('teamMPermSeat'),
      $('teamMPermPassDept'), $('teamMPermPassSub'), $('teamMPermDeptPage'))
    || { permissions: [], vs_dept: null, project_seat: null };
  const set = new Set(permissions);
  const vsSet = new Set(vsDept ? [vsDept] : []);
  // A seat the person picked REPLACES the one their ตำแหน่ง would give them
  // (0092) — so the preview must not add the inherited seat on top, or the
  // admin is shown "เจ้าหน้าที่คณะ ผู้ส่งหนังสือ" for a grant that resolves to
  // เจ้าหน้าที่คณะ alone.
  const seatSet = new Set(seat ? [seat] : []);
  if (m && $('teamMPermInherit')?.checked) {
    nodeEffectivePerms(m.node_id).forEach((p) => set.add(p));
    nodeEffectiveVsDepts(m.node_id).forEach((d) => vsSet.add(d));
    if (!seat) nodeEffectiveSeats(m.node_id).forEach((x) => seatSet.add(x));
  }
  // ONE chip builder, three callers. This preview used to hand-roll its own —
  // a third copy, and the one that never learned the master rule, so ticking
  // ทุกระบบ (Master) previewed the Master chip PLUS every inherited capability
  // it already implies. Exactly the display the tree rows were just fixed for,
  // one modal away. `flat: true` because this answers "what will they end up
  // with", where own-vs-inherited is not a distinction being drawn.
  //
  // A dept chip only means anything when it isn't already swallowed by full VS
  // (permChipsHtml drops it under master on its own).
  const showVs = !set.has('vs');
  if (set.size || (showVs && vsSet.size) || seatSet.size) {
    list.innerHTML = permChipsHtml({
      own: set,
      vsInherited: showVs ? vsSet : new Set(),
      seatInherited: seatSet,
      flat: true,
    });
    wrap.classList.remove('d-none');
  } else wrap.classList.add('d-none');
}

async function onMemberPermSubmit(e) {
  e.preventDefault();
  const id = $('teamMPermMemberId').value;
  const m = findMember(id);
  if (!m) return;
  const grants = await readPermInputsOrWarn($('teamMPermGrid'), $('teamMPermVsDept'), $('teamMPermSeat'),
    $('teamMPermPassDept'), $('teamMPermPassSub'), $('teamMPermDeptPage'), `"${m.full_name}"`);
  if (!grants) return;
  const payload = { ...grants, inherit_permissions: $('teamMPermInherit').checked };
  // The สิทธิ์ pane lives inside the สมาชิก modal since 0110.
  modalInstance('teamMemberModal')?.hide();
  Object.assign(m, payload);
  render();
  try { await updateMember(id, payload); } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

/**
 * Open the member editor. THE MODAL OPENS NO MATTER WHAT.
 *
 * REPORTED (iPad): "when i press add people button in admin teamsamo, it
 * doesn't work, it doesn't show anything". A silent nothing is the signature of
 * an exception thrown while PREPARING the dialog — every prefill step ran
 * before `showTeamModal`, so one bad step meant no modal at all and no message,
 * on a device with no console to look at.
 *
 * The root cause was not reproduced on desktop and is not confirmed. What IS
 * certain is the SHAPE: preparation and presentation were in one straight line,
 * so anything in the former could silently cancel the latter. Splitting them
 * makes the worst case a modal with an unfilled field — visibly wrong, and
 * recoverable — instead of a dead button.
 *
 * Every `$('...')` write inside `fillMemberModal` is also optional-chained now,
 * so a markup change that drops one field cannot take the whole editor down.
 */
function openMemberModal({ member = null, nodeId = null, tab = 'info' } = {}) {
  try {
    fillMemberModal(member, nodeId, tab);
  } catch (err) {
    // Deliberately not rethrown and not an alert: the dialog still opens, and a
    // half-filled form the admin can see beats a button that does nothing.
    console.error('[team] member modal prefill failed, opening anyway:', err);
  }
  showTeamModal('teamMemberModal', member ? tab : 'info', !!member);
  // iOS ignores programmatic focus outside a user gesture; harmless there, and
  // it is the reason this is last rather than something the open depends on.
  if (tab !== 'perm') setTimeout(() => $('teamMemberFirstName')?.focus(), 250);
}

function fillMemberModal(member, nodeId, tab) {
  const nid = member?.node_id || nodeId || '';
  $('teamMemberId').value = member?.id || '';
  setMemberNode(nid);
  // ชื่อ / นามสกุล. A row that predates 0135 has no split, and the first cut of
  // this form left both boxes EMPTY — which reported as "แก้ไขสมาชิก shows
  // ชื่อ นามสกุล as blank, that isn't good". Correct: an editor that opens with
  // the most visible field empty reads as data loss, and it made the split
  // something nobody would ever fill in for 399 people.
  //
  // So the boxes are PREFILLED with a suggestion and the admin reviews it. That
  // is not a relaxation of "never split a stored name" — the rule is that no
  // UNREVIEWED guess is written, and here there is one human looking at one
  // person with the stored name printed beneath. `nameWasSuggested` remembers
  // that these values came from the machine, so the save path can ask once
  // before committing them (see onMemberSubmit).
  const storedFull = String(member?.full_name || '').trim();
  const hasSplit = !!(member?.first_name_th || member?.last_name_th);
  const guess = hasSplit ? null : suggestNameSplit(storedFull);
  nameWasSuggested = !!guess;
  $('teamMemberFirstName').value = member?.first_name_th || guess?.first || '';
  $('teamMemberLastName').value = member?.last_name_th || guess?.last || '';
  const legacyName = $('teamMemberNameLegacy');
  if (legacyName) {
    legacyName.className = 'form-text';
    if (guess) {
      legacyName.className = 'form-text text-warning-emphasis';
      legacyName.textContent = `ชื่อเดิมในระบบ: “${storedFull}” — ยังไม่เคยแยกช่อง `
        + 'ระบบเดาให้แล้วจากช่องว่างแรก กรุณาตรวจว่าถูกต้อง '
        + '(นามสกุลไทยมีเว้นวรรคได้ เช่น “ณ อยุธยา” ถ้าชื่อจริงมีเว้นวรรคด้วย ระบบจะเดาผิด)';
    } else if (storedFull && !hasSplit) {
      // One word, nothing to propose a boundary in.
      legacyName.textContent = `ชื่อเดิมในระบบ: “${storedFull}” — มีคำเดียว กรุณากรอกแยกช่องเอง`;
      $('teamMemberFirstName').value = storedFull;
    } else {
      legacyName.textContent = '';
    }
  }
  $('teamMemberNickname').value = member?.nickname || '';
  $('teamMemberStudentId').value = member?.student_id || '';
  const sidHint = $('teamMemberStudentIdHint');
  if (sidHint) sidHint.textContent = SID_HINT;
  // ชั้นปี, COMPUTED — never prefilled-then-stored. The old form preselected the
  // derived value in a chooser that then SAVED it, which is how a computed answer
  // became a frozen copy of itself.
  //
  // The listener goes on the node THIS open is using, and is replaced (not added
  // to) each time via `oninput` rather than addEventListener — one listener per
  // re-render, accumulating on a modal element that is reused for every row, is a
  // bug this tab has shipped before (my-house.js's "ต้องกดหลายครั้งถึงจะขึ้น").
  paintDerivedYear(member);
  const sidBox = $('teamMemberStudentId');
  if (sidBox) sidBox.oninput = () => paintDerivedYear(member);
  // The vocabulary may not be loaded yet on the very first open; paint what we
  // have, then repaint when it arrives. Painting nothing would show an empty
  // chooser next to a person who HAS a สาขา, which reads as data loss.
  fillMajorSelect($('teamMemberMajor'), member?.major || '');
  loadMajors().then(() => fillMajorSelect($('teamMemberMajor'), member?.major || ''));
  $('teamMemberEmail').value = member?.kkumail || '';
  // The picker is reset on EVERY open, and its in-flight token is bumped so a
  // reply for the previous person cannot land in this one's form. One modal
  // element is reused for every row; state left on it outlives the record it
  // describes (0110's permission grid, and the same shape again here).
  personSearchToken += 1;
  clearTimeout(personSearchTimer);
  personSearchHits = [];
  const searchBox = $('teamMemberSearch');
  if (searchBox) searchBox.value = '';
  const searchResults = $('teamMemberSearchResults');
  if (searchResults) { searchResults.classList.add('d-none'); searchResults.innerHTML = ''; }
  personSearchResting = member ? PERSON_SEARCH_HINT_EDIT : PERSON_SEARCH_HINT_ADD;
  const searchHint = $('teamMemberSearchHint');
  if (searchHint) searchHint.textContent = personSearchResting;
  $('teamMemberConfirmed').checked = !!member?.confirmed;
  // Same reuse hazard as the pending photo below: a match painted for the LAST
  // row must not still be on screen for this one. Cancel the in-flight lookup
  // too — bumping the token is what stops its reply repainting this modal.
  teamPersonMatch = null;
  teamPersonMatchToken++;
  clearTimeout(teamPersonMatchTimer);
  paintTeamPersonMatch();
  // A pick left pending by a previous open must not follow the next person into
  // the editor — the modal is one DOM element reused for every row, which is
  // exactly how the permission grid leaked state across rows in 0110.
  clearPendingPhoto();
  const photoHint = $('teamMemberPhotoHint');
  if (photoHint) photoHint.textContent = PHOTO_HINT_DEFAULT;
  // Carried, not edited. A photo uploaded through the crop dialog is already 3:4
  // so its focus is 'center'; an older row keeps whatever it had until someone
  // re-uploads, and editing an unrelated field must not silently re-frame it.
  // Set BEFORE setMemberPhoto — the preview reads it.
  memberPhotoFocus = member?.photo_focus || 'center';
  setMemberPhoto(member?.photo_url || '');
  $('teamMemberModalTitle').textContent = member ? 'แก้ไขสมาชิก' : 'เพิ่มสมาชิก';
  $('teamMemberDelete')?.classList.toggle('d-none', !member);
  // One modal, two tabs (0110). A member who has not been saved yet has no row
  // for a grant to hang on, so the สิทธิ์ tab is disabled until they exist.
  if (member) fillMemberPermPane(member.id);
}

/**
 * The framed-but-not-yet-uploaded portrait, or null.
 *
 * THE BUG THIS FIXES (reported: "when there's already a picture of me uploaded
 * on teamsamo and i press upload files, and upload it without pressing the
 * นำรูปออก, the drive now store both files"). The old flow uploaded on PICK.
 * Every intermediate choice therefore became a real Drive file, and only the
 * last one ended up in the row — so picking twice, or picking once and then
 * closing the editor, left files nothing would ever reference. The delete side
 * could not clean them up either: it trashes the photo the DB was POINTING AT,
 * which is exactly the file that is NOT the orphan.
 *
 * Now nothing leaves the browser until บันทึก. Cancel costs nothing, re-picking
 * costs nothing, and there is exactly one upload per saved change — so the only
 * file in Drive that no row references is one whose save failed mid-flight.
 */
let memberPhotoPending = null;   // { file, previewUrl }

/** Drop a pending pick and release its blob URL. Called when the editor opens,
 *  when the pick is replaced, and after a successful save — a revoked-late blob
 *  is a leak the browser keeps for the life of the document. */
function clearPendingPhoto() {
  if (memberPhotoPending?.previewUrl) URL.revokeObjectURL(memberPhotoPending.previewUrl);
  memberPhotoPending = null;
}

/** Paint the preview from a URL (or the empty state) and sync the hidden input. */
function setMemberPhoto(url) {
  const hidden = $('teamMemberPhotoUrl');
  const prev = $('teamMemberPhotoPreview');
  const clear = $('teamMemberPhotoClear');
  if (hidden) hidden.value = url || '';
  if (clear) clear.classList.toggle('d-none', !url && !memberPhotoPending);
  if (!prev) return;
  // A pending pick wins the preview: it is what บันทึก is about to publish, and
  // showing the OLD portrait next to "รูปใหม่ (ยังไม่บันทึก)" is the kind of
  // half-truth that makes someone press upload a second time.
  if (memberPhotoPending) {
    prev.innerHTML = `<img src="${escHtml(memberPhotoPending.previewUrl)}" alt="" />`;
    return;
  }
  if (url) {
    // portraitSrc, NOT convertDriveUrl(url, 320): convertDriveUrl returns an
    // ALREADY-lh3 URL untouched, so its `size` argument is silently ignored for
    // exactly the rows this app writes — the preview was asking for 320px and
    // being handed the stored =w1200. portraitSrc rebuilds the option string
    // from the file id, so the thumbnail is a thumbnail. It also rewrites the
    // legacy drive.google.com/thumbnail form, which intermittently fails to load
    // on iOS Safari (mistakes.md).
    // A legacy row may still carry top/bottom; the preview must show the same
    // framing the card will, or it is quietly lying about what will publish.
    const pos = focusToObjectPosition(memberPhotoFocus);
    prev.innerHTML = `<img src="${escHtml(portraitSrc(url, 168, memberPhotoFocus))}"`
      + ` alt="" loading="lazy"`
      + `${memberPhotoFocus === 'center' ? '' : ` style="object-position:${pos}"`} />`;
  } else {
    prev.innerHTML = '<span class="team-photo-empty"><i class="bi bi-person"></i></span>';
  }
}

/** Walk to the root ฝ่าย so the Drive folder groups a person under the division
 *  a human would look for them in, not their immediate sub-ตำแหน่ง. */
function rootDeptName(nodeId) {
  let cur = nodesById.get(nodeId);
  while (cur && cur.parent_id && nodesById.get(cur.parent_id)) cur = nodesById.get(cur.parent_id);
  return cur?.name || 'ทั่วไป';
}

const PHOTO_HINT_DEFAULT =
  'แสดงบนหน้าโครงสร้างองค์กรที่เปิดให้บุคคลทั่วไปดูได้ — ใช้รูปที่เจ้าตัวยินยอมให้เผยแพร่';

/** Pick + frame a portrait. Nothing is uploaded here — see memberPhotoPending. */
async function onMemberPhotoPick(e) {
  const picked = e.target.files?.[0];
  if (!picked) return;
  const hint = $('teamMemberPhotoHint');
  const input = e.target;
  let file;
  try {
    file = await cropImage(picked, {
      title: 'ปรับกรอบรูปประจำตัว',
      hint: 'กรอบนี้คือสิ่งที่แสดงบนหน้าโครงสร้างองค์กร — ลากให้ใบหน้าอยู่กลางกรอบ',
    });
  } catch (err) {
    alert('เปิดรูปไม่สำเร็จ: ' + (err?.message || err));
  }
  // Clear the file input either way, or re-picking the SAME file fires no change
  // event and the crop dialog silently does not re-open.
  input.value = '';
  if (!file) return;
  clearPendingPhoto();
  memberPhotoPending = { file, previewUrl: URL.createObjectURL(file) };
  // The uploaded frame IS 3:4, so lh3's server-side centre crop is exact: no
  // head is cut and the card fetches ~38 KB instead of ~78 KB.
  memberPhotoFocus = 'center';
  setMemberPhoto($('teamMemberPhotoUrl').value);
  if (hint) hint.textContent = 'รูปใหม่ยังไม่ถูกบันทึก — กดบันทึกเพื่ออัปโหลด หรือปิดหน้าต่างเพื่อยกเลิก';
}

/** Upload the pending pick, if there is one, and return the URL to store.
 *  Runs from the submit handler — BEFORE the modal closes — so a failure can
 *  still be reported into the form the person is looking at. */
async function uploadPendingPhoto(nodeId) {
  if (!memberPhotoPending) return { url: $('teamMemberPhotoUrl').value.trim() || null };
  const hint = $('teamMemberPhotoHint');
  // The downscale happens before the network call and is the slow part on a
  // phone, so say "processing" rather than "uploading" up front.
  if (hint) hint.textContent = 'กำลังย่อและอัปโหลดรูป…';
  // `order` is only the numeric prefix on the Drive filename, so a person can
  // be found by browsing the folder. For an EXISTING member that is their own
  // position — `membersOf().length` would file the first of five people as
  // "05-", which is exactly backwards. A new member really is going on the end.
  const editingId = $('teamMemberId').value;
  const editing = editingId ? findMember(editingId) : null;
  const res = await uploadTeamPhoto(memberPhotoPending.file, {
    year: currentTermYear || 'unsorted',
    dept: rootDeptName(nodeId),
    order: editing ? (editing.position ?? 0) : membersOf(nodeId).length,
    // The Drive filename, so a human browsing the folder finds the person.
    // Composed from the boxes when they are filled; otherwise whatever combined
    // name the row already carries (a pre-0135 row being edited).
    name: [$('teamMemberFirstName').value.trim(), $('teamMemberLastName').value.trim()]
      .filter(Boolean).join(' ')
      || String(editing?.full_name || '').trim()
      || 'member',
  });
  // Surface the un-organised fallback instead of hiding it — the file DID
  // upload, but into PR/ with no folder structure, which is the exact thing
  // uploadTeamPhoto exists to fix. Silence here would mean nobody notices the
  // GAS project still needs redeploying.
  if (!res.organised) {
    alert('อัปโหลดรูปแล้ว แต่ยังไม่ได้จัดโฟลเดอร์ (ต้อง redeploy Apps Script)');
  }
  return res;
}

/**
 * What the two name boxes say, and what that means for the row.
 *
 * Three outcomes, and the third is the one worth being careful about:
 *  • both filled  → the split is authoritative, full_name is derived from it
 *    (by the DB trigger, 0135 — this returns the same string so the on-screen
 *    row updates without a refetch);
 *  • both empty   → leave the name alone entirely. An existing combined name
 *    survives, which is what makes editing a pre-0135 row's ชั้นปี safe;
 *  • one filled   → refused. Half a split written over a whole name is how a
 *    person ends up with no surname, and there is no way to tell later that it
 *    happened.
 */
/** True when the two name boxes were filled by `suggestNameSplit` on open and
 *  the admin has not been asked about them yet. Module-scope because the modal
 *  is ONE element reused for every row — a flag parked on the DOM outlives the
 *  record it describes, which is how a permission grid leaked across rows in
 *  0110. Reset on every open. */
let nameWasSuggested = false;

function readMemberName(existing) {
  const first = $('teamMemberFirstName').value.trim();
  const last = $('teamMemberLastName').value.trim();
  if (!first && !last) {
    if (String(existing?.full_name || '').trim()) return { keep: true };
    return { error: 'กรุณากรอกชื่อและนามสกุล', focus: 'teamMemberFirstName' };
  }
  if (!first) return { error: 'กรุณากรอกชื่อ', focus: 'teamMemberFirstName' };
  if (!last) return { error: 'กรุณากรอกนามสกุล', focus: 'teamMemberLastName' };
  return { first, last, full: `${first} ${last}` };
}

/**
 * ONE submit at a time.
 *
 * THE BUG THIS CLOSES, which I opened today. `onMemberSubmit` disabled the
 * button only inside the `if (memberPhotoPending)` branch, and everything else
 * ran straight through to `modalInstance(...).hide()` with no await in between —
 * so there was no window to click twice in. Then the ชื่อ/นามสกุล confirmation
 * (0141) put an `await askConfirm(...)` BEFORE the hide, with the modal still
 * open and บันทึก still live. Two presses → two dialogs → for a NEW member, two
 * `createMember` calls and two rows for one person.
 *
 * DROPPING the second press is correct here, and is not the "a busy flag that
 * returns early silently discards the second action" trap in mistakes.md: that
 * entry is about two DIFFERENT actions being collapsed. This is the same submit
 * twice, and the honest answer to "save this form again while it is saving" is
 * nothing.
 */
let memberSubmitting = false;

async function onMemberSubmit(e) {
  e.preventDefault();
  if (memberSubmitting) return;
  memberSubmitting = true;
  const busyBtn = $('teamMemberModalSave');
  if (busyBtn) busyBtn.disabled = true;
  try {
    await runMemberSubmit();
  } finally {
    memberSubmitting = false;
    if (busyBtn) busyBtn.disabled = false;
  }
}

async function runMemberSubmit() {
  const id = $('teamMemberId').value;
  const nodeId = $('teamMemberNodeId').value;
  const stored0 = id ? findMember(id) : null;
  const nm = readMemberName(stored0);
  if (nm.error) { alert(nm.error); $(nm.focus)?.focus(); return; }
  const name = nm.keep ? String(stored0?.full_name || '').trim() : nm.full;
  if (!nodeId) { alert('กรุณาเลือกตำแหน่ง'); return; }

  // THE REVIEW STEP. The boxes were filled by the machine and the admin has not
  // touched them, so pressing บันทึก would write a guessed boundary — which is
  // the thing this repo refuses a whole CSV over. Asking once turns the guess
  // into a decision, and it only ever happens on the FIRST edit of a pre-0135
  // row: afterwards the row has a real split and there is nothing to confirm.
  //
  // askConfirm, never window.confirm — Chrome's "prevent additional dialogs"
  // checkbox makes every later native confirm return false instantly, which has
  // already shipped as "the button does nothing" twice here.
  if (nameWasSuggested && !nm.keep
      && stored0 && !stored0.first_name_th && !stored0.last_name_th) {
    const suggestion = suggestNameSplit(String(stored0.full_name || ''));
    if (suggestion && suggestion.first === nm.first && suggestion.last === nm.last) {
      // NOT escaped: askConfirm writes `body` with textContent, so escaping
      // here would print &quot; to the user.
      const ok = await askConfirm({
        title: 'ยืนยันการแยกชื่อ',
        body: `ชื่อเดิม “${String(stored0.full_name || '').trim()}” ยังไม่เคยแยกช่อง — `
          + `ระบบเดาให้เป็น ชื่อ “${nm.first}” นามสกุล “${nm.last}” `
          + 'ถูกต้องไหม? ถ้าไม่ถูก กดยกเลิกแล้วแก้ในช่องได้เลย',
        yes: 'ถูกต้อง บันทึกเลย',
        danger: false,
      });
      if (!ok) { $('teamMemberFirstName')?.focus(); return; }
    }
  }

  // Canonicalise รหัสนักศึกษา / ชั้นปี / สาขา through the one rule module. A
  // รหัส that cannot be read is REFUSED — but only when this save changed it,
  // because two live rows carry an unfixable legacy id and holding an unrelated
  // nickname edit hostage to somebody else's typo just teaches people to avoid
  // the form.
  const stored = stored0;
  const typedSid = $('teamMemberStudentId').value;
  // No `year` key: ชั้นปี is not a field this form owns any more (0145).
  const fields = normalizeIdentityFields({
    student_id: typedSid,
    major: $('teamMemberMajor').value,
  }, majorCodes());
  const sidProblem = fields.problemFor('student_id');
  if (sidProblem && String(stored?.student_id ?? '') !== String(typedSid ?? '').trim()) {
    alert(sidProblem.message);
    $('teamMemberStudentId').focus();
    return;
  }

  const payload = {
    // `keep` sends NOTHING about the name — not even full_name — so a legacy
    // combined row edited for its ชั้นปี is not rewritten with a value this
    // form composed. The DB derives full_name from the parts when they are
    // sent (0135); it is sent here too so the on-screen row updates without a
    // refetch, and the two can only agree because both are `first + ' ' + last`.
    ...(nm.keep ? {} : { first_name_th: nm.first, last_name_th: nm.last, full_name: name }),
    nickname: $('teamMemberNickname').value.trim() || null,
    student_id: fields.student_id,
    major: fields.major,
    kkumail: $('teamMemberEmail').value.trim() || null,
    confirmed: $('teamMemberConfirmed').checked,
    photo_url: $('teamMemberPhotoUrl').value.trim() || null,
    photo_focus: memberPhotoFocus || 'center',
  };

  // THE PHOTO UPLOAD HAPPENS HERE, not on pick (see memberPhotoPending). The
  // modal therefore stays open — and the submit button stays busy — until the
  // bytes are in Drive, because closing first would leave a failure with nowhere
  // to be reported and an orphan file with nothing pointing at it.
  const submitBtn = $('teamMemberModalSave');
  if (memberPhotoPending) {
    const label = submitBtn?.textContent;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'กำลังอัปโหลดรูป…'; }
    try {
      const res = await uploadPendingPhoto(nodeId);
      payload.photo_url = res.url || null;
      clearPendingPhoto();
    } catch (err) {
      alert('อัปโหลดรูปไม่สำเร็จ: ' + (err?.message || err));
      const hint = $('teamMemberPhotoHint');
      if (hint) hint.textContent = 'อัปโหลดไม่สำเร็จ — ลองกดบันทึกอีกครั้ง หรือเลือกรูปใหม่';
      return;   // nothing saved, nothing uploaded, the pick is still pending
    } finally {
      // Label only — the wrapper owns `disabled` now, and re-enabling here
      // would re-open the double-submit window for the rest of the save.
      if (submitBtn) submitBtn.textContent = label;
    }
  }

  modalInstance('teamMemberModal')?.hide();
  // Snapshot the photo BEFORE Object.assign overwrites it. Cleared or replaced
  // portraits are trashed AFTER the write lands, never on the นำรูปออก click —
  // deleting there would destroy a photo the DB still points at if the admin
  // then cancels.
  const prevPhoto = id ? (findMember(id)?.photo_url || '') : '';
  try {
    if (id) {
      const m = findMember(id);
      const movedNode = m && m.node_id !== nodeId;
      if (m) Object.assign(m, payload);
      if (movedNode) { payload.node_id = nodeId; m.node_id = nodeId; rebuildMembersIndex(); }
      render();
      await updateMember(id, movedNode ? { ...payload, node_id: nodeId } : payload);
    } else {
      payload.node_id = nodeId;
      payload.position = membersOf(nodeId).length;
      const row = await createMember(payload);
      if (!membersByNode.has(nodeId)) membersByNode.set(nodeId, []);
      membersByNode.get(nodeId).push(row);
      expanded.add(nodeId);
      render();
    }
    const retire = photoToRetire(prevPhoto, payload);
    if (retire) deleteTeamPhotoIfUnused(retire);
  } catch (err) { alert(err?.message || 'บันทึกไม่สำเร็จ'); reload(); }
}

async function onDeleteMember(id) {
  const m = findMember(id);
  // A miss here means the DOM row outlived the model it was rendered from — the
  // click is real, so returning in silence looks exactly like a dead button.
  // (The other way it used to do nothing — a `confirm()` the browser had
  // suppressed — is gone: the question below is drawn by this app.) Say so and
  // resync.
  if (!m) {
    alert('ไม่พบข้อมูลสมาชิกนี้ในหน้าจอปัจจุบัน — กำลังโหลดผังใหม่ แล้วลองอีกครั้ง');
    reload();
    return;
  }
  if (!await askDelete(m.full_name || 'สมาชิกคนนี้', 'สมาชิกจะถูกนำออกจากผังทีม SAMO')) return;
  const photo = m.photo_url || '';
  const arr = membersByNode.get(m.node_id);
  if (arr) membersByNode.set(m.node_id, arr.filter((x) => x.id !== id));
  render();
  try {
    await deleteMember(id);
    // Only now is the row actually gone, so the ref-count can tell the truth.
    if (photo) deleteTeamPhotoIfUnused(photo);
  } catch (e) { alert(e?.message || 'ลบไม่สำเร็จ'); reload(); }
}

// ============================================================
// IMPORT / EXPORT
// ============================================================

function allNodesFlat() { return [...nodesById.values()]; }
function allMembersFlat() { const out = []; for (const arr of membersByNode.values()) out.push(...arr); return out; }

function downloadBlob(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function wireIO() {
  $('teamExportJson')?.addEventListener('click', () => {
    const data = buildExportJson(allNodesFlat(), allMembersFlat());
    downloadBlob(`samo-team-${stamp()}.json`, JSON.stringify(data, null, 2), 'application/json');
  });
  $('teamExportCsv')?.addEventListener('click', () => {
    const rows = allMembersFlat().map((m) => ({
      path: nodePath(m.node_id).split(' / ').join(PATH_SEP),
      full_name: m.full_name, nickname: m.nickname,
      student_id: m.student_id, major: m.major,
      // The two ingredients, so buildMembersCsv can COMPUTE the ชั้นปี column
      // rather than copy a dead one (0145). first/last are carried for the
      // round trip; the export used to lose them.
      cohort_year: m.cohort_year, year_offset: m.year_offset,
      first_name_th: m.first_name_th, last_name_th: m.last_name_th,
      kkumail: m.kkumail, confirmed: m.confirmed,
    }));
    // ﻿ BOM so Excel opens Thai UTF-8 correctly.
    downloadBlob(`samo-team-members-${stamp()}.csv`, '﻿' + buildMembersCsv(rows), 'text/csv;charset=utf-8');
  });

  $('teamImportOpen')?.addEventListener('click', () => {
    $('teamImportText').value = '';
    $('teamImportFile').value = '';
    setImportStatus('');
    resetImportView();
    // Prime the สาขา vocabulary before anyone pastes a CSV — planMembersCsv()
    // canonicalises through it, and an empty list would silently degrade every
    // สาขา in the file to "keep as typed".
    loadMajors();
    modalInstance('teamImportModal')?.show();
  });
  $('teamImportFile')?.addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    if (f) $('teamImportText').value = await f.text();
  });
  $('teamImportRun')?.addEventListener('click', runImport);

  // Conflict resolver: per-card keep/replace toggle + bulk buttons.
  $('teamImportConflictList')?.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-choice]');
    if (!opt) return;
    const card = opt.closest('[data-conflict-idx]');
    card?.querySelectorAll('[data-choice]').forEach((b) => b.classList.remove('active'));
    opt.classList.add('active');
  });
  $('teamImportConflicts')?.addEventListener('click', (e) => {
    const all = e.target.closest('[data-conflict-all]');
    if (!all) return;
    const choice = all.dataset.conflictAll;
    $('teamImportConflictList').querySelectorAll('[data-conflict-idx]').forEach((card) => {
      card.querySelectorAll('[data-choice]').forEach((b) => b.classList.toggle('active', b.dataset.choice === choice));
    });
  });
}

function resetImportView() {
  pendingPlan = null;
  $('teamImportFormArea')?.classList.remove('d-none');
  $('teamImportConflicts')?.classList.add('d-none');
  const list = $('teamImportConflictList'); if (list) list.innerHTML = '';
  const btn = $('teamImportRun');
  if (btn) btn.innerHTML = '<i class="bi bi-box-arrow-in-down me-1"></i>นำเข้า';
}

function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-'); }
function setImportStatus(msg, isErr = false) {
  const el = $('teamImportStatus');
  if (el) { el.textContent = msg || ''; el.classList.toggle('is-error', isErr); }
}

function detailBlock(cls, title, items) {
  if (!items.length) return '';
  const shown = items.slice(0, 12).map((s) => `<li>${escHtml(s)}</li>`).join('');
  const more = items.length > 12 ? `<li>… อีก ${items.length - 12} รายการ</li>` : '';
  return `<div class="${cls}"><b>${escHtml(title)} (${items.length})</b><ul>${shown}${more}</ul></div>`;
}

function setImportReport(r) {
  const el = $('teamImportStatus');
  if (!el) return;
  el.classList.remove('is-error');
  const upd = r.updated ? `, อัปเดต ${r.updated}` : '';
  el.innerHTML =
    `<div class="team-import-ok"><i class="bi bi-check-circle-fill"></i> นำเข้าแล้ว: เพิ่ม ${r.nodes} ตำแหน่ง, ${r.members} สมาชิก${upd}</div>` +
    detailBlock('team-import-skip', 'ข้าม', r.skipped) +
    detailBlock('team-import-warn', 'เตือน', r.warnings);
}

async function runImport() {
  const btn = $('teamImportRun');

  // Phase 2 — apply a plan whose conflicts the user just resolved in the UI.
  if (pendingPlan) {
    btn.disabled = true;
    try {
      readConflictChoices(pendingPlan);
      const report = await applyPlan(pendingPlan, $('teamImportCreateRoles').checked);
      pendingPlan = null;
      $('teamImportFormArea')?.classList.remove('d-none');
      $('teamImportConflicts')?.classList.add('d-none');
      btn.innerHTML = '<i class="bi bi-box-arrow-in-down me-1"></i>นำเข้า';
      await reload();
      setImportReport(report);
    } catch (e) {
      console.warn('[team] import apply failed:', e);
      setImportStatus(`นำเข้าไม่สำเร็จ: ${e?.message || e}`, true);
    } finally { btn.disabled = false; }
    return;
  }

  const raw = $('teamImportText').value.trim();
  if (!raw) { setImportStatus('ไม่มีข้อมูล', true); return; }
  btn.disabled = true;
  setImportStatus('กำลังตรวจสอบ…');
  try {
    if (raw[0] === '{' || raw[0] === '[') {
      let data;
      try { data = JSON.parse(raw); }
      catch { throw new Error('JSON ไม่ถูกต้อง (อ่านไม่สำเร็จ)'); }
      const report = await importJson(data);
      await reload();
      setImportReport(report);
      return;
    }
    const mode = $('teamImportDupMode')?.value || 'choose';
    const plan = planMembersCsv(raw);
    if (mode === 'choose' && plan.conflicts.length) {
      // Pause and let the user resolve each conflict (git-merge style).
      renderConflictView(plan);
      pendingPlan = plan;
      btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>ยืนยันนำเข้า';
      setImportStatus('');
      return;
    }
    // No interactive conflicts: pin each conflict's choice from the mode.
    plan.conflicts.forEach((k) => { k.choice = (mode === 'update') ? 'replace' : 'keep'; });
    const report = await applyPlan(plan, $('teamImportCreateRoles').checked);
    await reload();
    setImportReport(report);
  } catch (e) {
    console.warn('[team] import failed:', e);
    setImportStatus(`นำเข้าไม่สำเร็จ: ${e?.message || e}`, true);
  } finally {
    btn.disabled = false;
  }
}

/** Append an exported structure (new ids), parents before children. Validates
 *  shape; skips bad members with reasons; de-dupes within the file. */
async function importJson(data) {
  const v = validateExportJson(data);
  if (!v.ok) throw new Error(v.error);
  const nodes = data.nodes;
  const members = Array.isArray(data.members) ? data.members : [];
  const report = { nodes: 0, members: 0, skipped: [], warnings: [] };

  const byParent = new Map();
  nodes.forEach((n) => { const k = n.parent_id || ''; if (!byParent.has(k)) byParent.set(k, []); byParent.get(k).push(n); });
  for (const arr of byParent.values()) arr.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  const idMap = new Map();
  const mkNode = async (n, newParent, position) => {
    const row = await createNode({
      parent_id: newParent, name: n.name.trim(), kind: normalizeKind(n.kind),
      color: isHexColor(n.color) ? n.color : null,
      tier: tierOf(n) > 1 ? tierOf(n) : null,
      position, permissions: Array.isArray(n.permissions) ? n.permissions : [],
      inherit_permissions: n.inherit_permissions !== false,
      vs_dept: n.vs_dept || null,
      project_seat: n.project_seat || null,
      is_public: n.is_public !== false,
      is_board: !!n.is_board,
      // The DECISION travels; the MAPPING does not. This import appends with
      // new ids, so a node created here is a new group that will get its own
      // Discord role — it may not claim the exported node's. See the note in
      // io.js buildExportJson.
      discord_role: !!n.discord_role,
      passport_dept_id: n.passport_dept_id ?? null,
      passport_sub_dept_id: n.passport_sub_dept_id ?? null,
    });
    idMap.set(n.id, row.id); report.nodes++;
    nodesById.set(row.id, row);
    setImportStatus(`กำลังสร้างตำแหน่ง… ${report.nodes}/${nodes.length}`);
    return row.id;
  };
  const createSubtree = async (oldParent, newParent) => {
    const kids = byParent.get(oldParent || '') || [];
    for (let i = 0; i < kids.length; i++) {
      const newId = await mkNode(kids[i], newParent, i);
      await createSubtree(kids[i].id, newId);
    }
  };
  await createSubtree(null, null);
  // Orphans (parent_id points at a node absent from the file) → put at root.
  for (const n of nodes) {
    if (idMap.has(n.id)) continue;
    await mkNode(n, null, childrenOf(null).length);
    report.warnings.push(`ตำแหน่ง “${n.name}” ไม่มีฝ่ายแม่ในไฟล์ จึงวางไว้ระดับบนสุด`);
  }
  rebuildChildrenIndexFromNodes();

  const seen = new Set();
  for (const m of members) {
    const who = String(m?.full_name ?? '').trim();
    if (!who) { report.skipped.push('สมาชิกที่ไม่มีชื่อ'); continue; }
    const newNode = idMap.get(m.node_id);
    if (!newNode) { report.skipped.push(`${who}: ไม่พบตำแหน่งในไฟล์`); continue; }
    const key = newNode + '::' + ((m.kkumail || '').toLowerCase() || `${who}|${m.student_id || ''}`);
    if (seen.has(key)) { report.skipped.push(`${who}: ซ้ำในไฟล์`); continue; }
    seen.add(key);
    if (m.kkumail && !isLikelyEmail(m.kkumail)) report.warnings.push(`${who}: อีเมลอาจไม่ถูกต้อง (${m.kkumail})`);
    await createMember({
      node_id: newNode, position: m.position ?? 0,
      full_name: who,
      // Carried through the round trip, never reconstructed. A row exported
      // without the split comes back without it (0135).
      first_name_th: m.first_name_th || null, last_name_th: m.last_name_th || null,
      nickname: m.nickname || null, student_id: m.student_id || null,
      // NO `year` (0145) — ชั้นปี is derived, and its ingredients belong to the
      // person registry, which mirrors them down on its own.
      major: m.major || null, kkumail: m.kkumail || null,
      confirmed: !!m.confirmed,
      // Restore the portrait too. Omitting these is not a no-op — it is data
      // loss on every export→import round trip (see buildExportJson's header).
      photo_url: m.photo_url || null,
      photo_focus: m.photo_focus || null,
      permissions: Array.isArray(m.permissions) ? m.permissions : [],
      inherit_permissions: m.inherit_permissions !== false,
      vs_dept: m.vs_dept || null,
      project_seat: m.project_seat || null,
      passport_dept_id: m.passport_dept_id ?? null,
      passport_sub_dept_id: m.passport_sub_dept_id ?? null,
    });
    report.members++;
    setImportStatus(`กำลังเพิ่มสมาชิก… ${report.members}`);
  }
  return report;
}

const DIFF_FIELDS = [
  ['full_name', 'ชื่อ-สกุล'], ['first_name_th', 'ชื่อ'], ['last_name_th', 'นามสกุล'],
  ['nickname', 'ชื่อเล่น'],
  ['student_id', 'รหัส'], ['major', 'สาขา'],
  ['kkumail', 'KKU Mail'], ['confirmed', 'ยืนยัน'],
];

function rowFields(r) {
  const out = {
    full_name: r.full_name, nickname: r.nickname || null,
    // NO `year`: the CSV's ชั้นปี column is export-only (0145).
    student_id: r.student_id || null, major: r.major || null,
    kkumail: r.kkumail || null, confirmed: !!r.confirmed,
  };
  // ONLY when the file carried them. Sending `first_name_th: null` for a file
  // that has no ชื่อ column would clear the split on every row it touches —
  // "an upsert that sends EVERY column wipes the ones the file did not have",
  // which this repo has already paid for once on the house import.
  if (r.first_name_th || r.last_name_th) {
    out.first_name_th = r.first_name_th || null;
    out.last_name_th = r.last_name_th || null;
  }
  return out;
}

/** Resolve a name path to an existing node WITHOUT creating anything. */
function resolvePathReadOnly(segs) {
  let parentId = null;
  for (const name of segs) {
    const ex = childrenOf(parentId).find((c) => c.name === name);
    if (!ex) return null;
    parentId = ex.id;
  }
  return parentId;
}

function memberDiff(existing, fields) {
  const out = [];
  for (const [k, label] of DIFF_FIELDS) {
    // A field the file did not carry is not a change to nothing — it is a
    // field this import will not write (see rowFields). Diffing it would show
    // "ชื่อ: สมชาย → —" for a file that simply has no ชื่อ column, which is a
    // preview promising a deletion that will not happen.
    if (!(k in fields)) continue;
    const a = k === 'confirmed' ? !!existing[k] : (existing[k] || '');
    const b = k === 'confirmed' ? !!fields[k] : (fields[k] || '');
    if (String(a) !== String(b)) out.push({ field: k, label, old: a, new: b });
  }
  return out;
}

function fmtVal(field, v) {
  if (field === 'confirmed') return v ? 'ยืนยัน' : 'รอยืนยัน';
  return v === '' || v == null ? '—' : String(v);
}

/** Read-only pass: classify each CSV row as create / conflict / skip without
 *  mutating the model. Path creation (for new roles) is deferred to applyPlan. */
function planMembersCsv(raw) {
  // The vocabulary is passed in so an import canonicalises สาขา the same way the
  // two forms do (`md` → `MD`). Without it every value reads as off-list and is
  // kept verbatim — not data loss, but it is how `md` gets back in beside `MD`.
  // `majors` is primed by openImport(); an empty list degrades to "keep as typed".
  const rows = parseMembersCsv(raw, majorCodes());
  if (!rows.length) throw new Error('ไม่พบสมาชิกใน CSV (ต้องมีคอลัมน์ ชื่อ-สกุล / full_name)');
  const plan = { creates: [], conflicts: [], identical: 0, skipped: [], warnings: [] };
  // SAY WHAT WILL BE IGNORED, ONCE. A file with a ชั้นปี column will not have it
  // imported (0145) — the value is computed from รหัสนักศึกษา now. Ignoring a
  // column the file clearly meant to set, silently, is how somebody spends an
  // afternoon fixing 400 ชั้นปี cells and then cannot work out why nothing moved.
  if (rows.some((r) => r.yearInFile)) {
    plan.warnings.push('คอลัมน์ “ชั้นปี” ในไฟล์จะไม่ถูกนำเข้า — '
      + 'ระบบคำนวณชั้นปีจากรหัสนักศึกษาให้เองทุกปี '
      + '(กรณีลาพัก/เรียนซ้ำ เจ้าตัวตั้งเองได้ที่การ์ด “ข้อมูลของฉัน”)');
  }
  const seen = new Set();
  for (const r of rows) {
    const who = r.full_name;
    if (!r.confirmedRecognized) plan.warnings.push(`${who} (แถว ${r._row}): ค่า "ยืนยัน" ไม่ชัดเจน — ถือว่ายังไม่ยืนยัน`);
    if (r.kkumail && !isLikelyEmail(r.kkumail)) plan.warnings.push(`${who} (แถว ${r._row}): อีเมลอาจไม่ถูกต้อง`);

    const segs = splitPath(r.path);
    if (!segs.length) { plan.skipped.push(`${who} (แถว ${r._row}): ไม่ได้ระบุตำแหน่ง (path)`); continue; }
    const nodeId = resolvePathReadOnly(segs);
    const fields = rowFields(r);
    const dupKey = (nodeId || segs.join(' / ')) + '::' + ((r.kkumail || '').toLowerCase() || `${who}|${r.student_id || ''}`);
    if (seen.has(dupKey)) { plan.skipped.push(`${who} (แถว ${r._row}): ซ้ำในไฟล์`); continue; }
    seen.add(dupKey);

    if (nodeId) {
      const existing = findExistingMember(nodeId, r);
      if (existing) {
        const diffs = memberDiff(existing, fields);
        if (!diffs.length) { plan.identical++; continue; }   // already up to date
        plan.conflicts.push({ who, row: r._row, existingId: existing.id, path: nodePath(nodeId), fields, diffs, choice: 'replace' });
        continue;
      }
      plan.creates.push({ nodeId, segs: null, fields });
    } else {
      plan.creates.push({ nodeId: null, segs, fields });     // role created at apply time
    }
  }
  return plan;
}

async function applyPlan(plan, createMissing) {
  const report = { nodes: 0, members: 0, updated: 0, skipped: [...plan.skipped], warnings: [...plan.warnings] };
  if (plan.identical) report.skipped.push(`เหมือนเดิม ${plan.identical} รายการ (ไม่ต้องเปลี่ยน)`);

  for (const c of plan.creates) {
    let nodeId = c.nodeId;
    if (!nodeId) {
      const before = nodesById.size;
      nodeId = await ensurePath(c.segs, createMissing);
      if (!nodeId) { report.skipped.push(`${c.fields.full_name}: ไม่พบ/สร้างตำแหน่งไม่ได้`); continue; }
      report.nodes += nodesById.size - before;
    }
    const row = await createMember({ node_id: nodeId, position: membersOf(nodeId).length, ...c.fields });
    if (!membersByNode.has(nodeId)) membersByNode.set(nodeId, []);
    membersByNode.get(nodeId).push(row);
    report.members++;
    setImportStatus(`กำลังเพิ่มสมาชิก… ${report.members}`);
  }
  for (const k of plan.conflicts) {
    if (k.choice === 'replace') {
      const m = findMember(k.existingId);
      if (m) Object.assign(m, k.fields);
      await updateMember(k.existingId, k.fields);
      report.updated++;
      setImportStatus(`กำลังอัปเดต… ${report.updated}`);
    } else {
      report.skipped.push(`${k.who} (แถว ${k.row}): เก็บของเดิม`);
    }
  }
  return report;
}

/** Render the per-conflict resolver (git-merge style) into the import modal. */
function renderConflictView(plan) {
  $('teamImportFormArea')?.classList.add('d-none');
  $('teamImportConflicts')?.classList.remove('d-none');
  const countEl = $('teamConflictCount');
  if (countEl) countEl.textContent = `พบข้อมูลซ้ำ ${plan.conflicts.length} รายการ — เลือกว่าจะเก็บอันไหน`;
  const list = $('teamImportConflictList');
  if (!list) return;
  list.innerHTML = plan.conflicts.map((k, i) => `
    <div class="team-conflict" data-conflict-idx="${i}">
      <div class="team-conflict-head"><b>${escHtml(k.who)}</b> <span class="team-conflict-path">${escHtml(k.path)}</span></div>
      <table class="team-conflict-diff"><thead><tr><th></th><th>เดิม</th><th>ใหม่</th></tr></thead><tbody>
        ${k.diffs.map((d) => `<tr><td>${escHtml(d.label)}</td><td class="old">${escHtml(fmtVal(d.field, d.old))}</td><td class="new">${escHtml(fmtVal(d.field, d.new))}</td></tr>`).join('')}
      </tbody></table>
      <div class="team-conflict-choice btn-group btn-group-sm" role="group">
        <button type="button" class="btn btn-outline-secondary" data-choice="keep">เก็บเดิม</button>
        <button type="button" class="btn btn-outline-primary active" data-choice="replace">ใช้ใหม่</button>
      </div>
    </div>`).join('');
}

function readConflictChoices(plan) {
  const list = $('teamImportConflictList');
  if (!list) return;
  list.querySelectorAll('[data-conflict-idx]').forEach((card) => {
    const idx = Number(card.dataset.conflictIdx);
    const active = card.querySelector('[data-choice].active');
    if (plan.conflicts[idx]) plan.conflicts[idx].choice = active?.dataset.choice || 'replace';
  });
}

/** Resolve a name path to a node id under the live model, creating missing
 *  levels when allowed. Returns null if unresolved and creation is off. */
async function ensurePath(segs, createMissing) {
  if (!segs.length) return null;
  let parentId = null;
  for (let i = 0; i < segs.length; i++) {
    const name = segs[i];
    const existing = childrenOf(parentId).find((c) => c.name === name);
    if (existing) { parentId = existing.id; continue; }
    if (!createMissing) return null;
    // Every level but the last is a container; the leaf is the seat.
    const kind = i === segs.length - 1 ? 'role' : 'division';
    const row = await createNode({
      parent_id: parentId, name, kind, position: childrenOf(parentId).length,
      permissions: [], inherit_permissions: true,
    });
    nodesById.set(row.id, row);
    rebuildChildrenIndexFromNodes();
    parentId = row.id;
  }
  return parentId;
}
