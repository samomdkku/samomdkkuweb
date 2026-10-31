// ==============================================
// TEAM TERMS — the ทีมแต่ละปี pane of the ทีม SAMO admin (mode 'years').
//
// 0270 (owner, 2026-10-31): any year's list can be BUILT here — the year ahead
// or one gone by — and shown on เกี่ยวกับเรา without moving the portal's year.
// Start it empty, from the live tree, or from another year (copy_team_year);
// add, rename, move and remove ฝ่าย / ตำแหน่ง / people; show or hide the year
// as a whole (set_team_term_shown). A published year wins over the live tree on
// the public page, so a shown 2570 keeps showing after the 1 มี.ค. switch.
// ⛔ publish_team_term REBUILDS a year from the live tree; on a hand-built year
// it now refuses until the person confirms (publishTermAsking).
//
// Two jobs:
//   1. The year ARCHIVE: which years have been published to the public page,
//      re-publishing the current one, adding or deleting a year. WHICH year is
//      current is NOT set here any more — that is the ปี SAMO admin page
//      (samo-year-admin.js, /admin/#years), because every system files new work
//      under it and it deserved more than one outline button in this list.
//   2. Edit a published year. The snapshot is frozen in the sense that editing
//      the live tree does not change it — but it is NOT read-only: a misspelled
//      name or a missing photo in ปี 2567 is fixed here, without disturbing the
//      current committee.
//
// WHY THE ARCHIVE IS SEPARATE FROM THE LIVE TREE (the thing not to undo):
// team_nodes / team_members feed the permission engine — managed_permissions,
// VS dept scopes, project seats, passport scopes — through a recompute trigger.
// Putting a year column on them would mean a 2565 row still resolving to a live
// grant for someone who left three years ago. The archive tables carry ONLY the
// columns the public projection publishes, so there is nothing on an archived
// row for any resolver to read. Keep it that way: if you find yourself wanting
// kkumail or a permission here, that belongs on the live tree, not in history.
// ==============================================

import { escHtml } from '../utils.js';
// App-drawn confirmations. `window.confirm` returns false forever once Chrome's
// "prevent additional dialogs" box is ticked, which turns เผยแพร่ / ตั้งเป็นปี
// ปัจจุบัน / ลบ into buttons that do nothing at all — the failure this tab has
// already shipped twice on other controls.
import { askConfirm } from '../confirm-modal.js';
import { uploadTeamPhoto, portraitSrc } from '../uploads.js';
import { cropImage } from '../image-crop.js';
import { publishTermAsking } from './term-dialogs.js';
import { walkNodes, subtreeIds } from './archive-tree.js';
import {
  fetchTerms, createTerm, deleteTerm,
  fetchTermStatus, fetchTree,
  fetchArchive, updateArchiveMember, deleteArchiveMember, updateArchiveNode,
  createArchiveNode, deleteArchiveNode, createArchiveMember,
  copyTeamYear, setTermShown,
  deleteTeamPhotoIfUnused,
} from './api.js';

const $ = (id) => document.getElementById(id);

let terms = [];
let staleByYear = new Map();   // year -> true when the live tree moved after publish
let openYear = null;      // the archived year currently expanded for editing
let archive = null;       // { nodes, members } for openYear
let host = null;
let onTermsChanged = null; // lets index.js keep its currentTermYear in step
// 0270 editor state. `adding` = an open inline form ({ kind: 'member'|'node',
// parent: nodeId|'' }); `moving` = a row whose ย้าย select is open.
let adding = null;
let moving = null;
// The live tree's people by name, so typing a current member's name into
// "เพิ่มคน" brings their ชื่อเล่น and photo along. Loaded when an editor opens;
// a failure only costs the suggestion.
let liveByName = new Map();

// Internal only. NOT exported: index.js learns the current year through the
// onChange callback passed to initTerms(), so it never needs to reach in here.
function currentTerm() {
  return terms.find((t) => t.is_current) || null;
}

// ── rendering ───────────────────────────────────────────────────────────────

function statusLine(msg, kind = '') {
  const el = $('teamTermsStatus');
  if (el) {
    el.textContent = msg || '';
    el.className = `team-terms-status${kind ? ` is-${kind}` : ''}`;
  }
}

/** A year can be edited when it HAS a list to edit: any non-current year
 *  (built here, or a past snapshot), or the current one once published. */
function canEditYear(t) {
  return !t.is_current || !!t.published_at;
}

function termRow(t) {
  const published = !!t.published_at;
  const when = published
    ? new Date(t.published_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
  const current = currentTerm();
  // Only the year right after the current one is "next year"; a further one is just a year.
  const ahead = !t.is_current && current && t.year === current.year + 1;
  let badge;
  if (t.is_current) {
    badge = published
      ? `<span class="team-term-badge is-pub">เผยแพร่แล้ว · ${escHtml(when)}</span>`
      : '<span class="team-term-badge is-draft">ยังไม่เผยแพร่ — หน้าเกี่ยวกับเราแสดงผังสด</span>';
  } else {
    badge = published
      ? '<span class="team-term-badge is-pub"><i class="bi bi-eye"></i> แสดงบนหน้าเกี่ยวกับเรา</span>'
      : '<span class="team-term-badge is-draft"><i class="bi bi-eye-slash"></i> ยังไม่แสดง</span>';
  }
  return `
    <li class="team-term${t.is_current ? ' is-current' : ''}${openYear === t.year ? ' is-open' : ''}">
      <div class="team-term-head">
        <div class="team-term-id">
          <span class="team-term-year">${escHtml(String(t.year))}</span>
          ${t.label ? `<span class="team-term-label">${escHtml(t.label)}</span>` : ''}
        </div>
        <div class="team-term-badges">
          ${t.is_current ? '<span class="team-term-badge is-live">ปีปัจจุบัน (ผังสด)</span>' : ''}
          ${ahead ? '<span class="team-term-badge">ปีหน้า</span>' : ''}
          ${badge}
          ${t.hand_edited_at ? '<span class="team-term-badge" title="รายชื่อปีนี้เพิ่มหรือแก้ไว้เอง — การเผยแพร่จากผังสดจะถามก่อนแทนที่">จัดรายชื่อเอง</span>' : ''}
          ${staleByYear.get(t.year)
            ? '<span class="team-term-badge is-stale" title="ผังสดถูกแก้ไขหลังเผยแพร่ครั้งล่าสุด — หน้าสาธารณะยังแสดงภาพนิ่งเดิม ถ้ากำลังเตรียมทีมปีหน้า ให้จัดที่ปีหน้าแทนการเผยแพร่ซ้ำ">ผังสดเปลี่ยนแล้ว · เผยแพร่ซ้ำถ้ายังเป็นทีมปีนี้</span>'
            : ''}
        </div>
        <div class="team-term-actions">
          ${t.is_current
            ? `<button type="button" class="btn btn-sm btn-primary" data-term-publish="${t.year}">
                 <i class="bi bi-camera"></i> ${published ? 'เผยแพร่ซ้ำ' : 'เผยแพร่ปีนี้'}
               </button>`
            : `<button type="button" class="btn btn-sm ${published ? 'btn-outline-secondary' : 'btn-primary'}" data-term-shown="${t.year}" data-shown="${published ? '0' : '1'}">
                 <i class="bi ${published ? 'bi-eye-slash' : 'bi-eye'}"></i> ${published ? 'ซ่อนจากหน้าเกี่ยวกับเรา' : 'แสดงบนหน้าเกี่ยวกับเรา'}
               </button>`}
          ${canEditYear(t)
            ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-term-edit="${t.year}">
                 <i class="bi bi-pencil"></i> ${openYear === t.year ? 'ปิด' : 'จัดรายชื่อ'}
               </button>`
            : ''}
          <button type="button" class="btn btn-sm btn-outline-danger" data-term-delete="${t.year}"
            aria-label="ลบปี ${t.year}"
            ${t.is_current ? 'disabled title="ลบปีปัจจุบันไม่ได้ — เริ่มปีอื่นที่หน้า ปี SAMO ก่อน"' : ''}>
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
      ${openYear === t.year ? `<div class="team-term-body" id="teamTermBody">${archiveHtml()}</div>` : ''}
    </li>`;
}

function archiveHtml() {
  if (!archive) return '<div class="team-terms-loading">กำลังโหลด…</div>';
  const { nodes, members } = archive;

  const byNode = new Map();
  for (const m of members) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }
  for (const list of byNode.values()) list.sort((a, b) => a.position - b.position);

  const walked = walkNodes(nodes);
  const rendered = new Set();
  const out = [`
    <div class="team-arc-toolbar">
      <span class="team-arc-count">${walked.length} ตำแหน่ง · ${members.length} คน</span>
      <button type="button" class="btn btn-sm btn-outline-primary" data-an-add-node="">
        <i class="bi bi-plus-lg"></i> เพิ่มฝ่าย
      </button>
    </div>`];
  if (adding?.kind === 'node' && adding.parent === '') out.push(addNodeForm(''));
  if (!walked.length) {
    out.push('<div class="team-terms-loading">ปีนี้ยังไม่มีรายชื่อ — เริ่มจาก “เพิ่มฝ่าย”</div>');
  }
  for (const w of walked) {
    const people = byNode.get(w.node.id) || [];
    people.forEach((m) => rendered.add(m.id));
    out.push(nodeGroup(w, people));
  }

  // Orphans should be impossible (a person's node is in the same year, 0270),
  // but a row stranded by an older bug must stay fixable, not invisible.
  const missed = members.filter((m) => !rendered.has(m.id));
  if (missed.length) {
    out.push(`
      <section class="team-arc-group">
        <header class="team-arc-head"><h6 class="team-arc-path">ไม่ทราบตำแหน่ง</h6></header>
        <ul class="team-arc-list">${missed.map(archiveMemberRow).join('')}</ul>
      </section>`);
  }
  out.push(`<datalist id="teamArcLiveNames">${[...liveByName.keys()]
    .map((n) => `<option value="${escHtml(n)}"></option>`).join('')}</datalist>`);
  return out.join('');
}

function moveSelect(kind, id) {
  const { nodes } = archive;
  const banned = kind === 'node' ? subtreeIds(nodes, id) : new Set();
  const here = kind === 'node'
    ? (nodes.find((n) => n.id === id)?.parent_id || '')
    : (archive.members.find((m) => m.id === id)?.node_id || '');
  const opts = walkNodes(nodes)
    .filter((w) => !banned.has(w.node.id))
    .map((w) => `<option value="${escHtml(w.node.id)}"${w.node.id === here ? ' selected' : ''}>${escHtml(w.path)}</option>`);
  return `
    <span class="team-arc-move">
      <select class="form-select form-select-sm" data-move-target="${escHtml(id)}" data-move-kind="${kind}"
        aria-label="ย้ายไปที่">
        ${kind === 'node' ? `<option value=""${here === '' ? ' selected' : ''}>— ระดับบนสุด —</option>` : ''}
        ${opts.join('')}
      </select>
      <button type="button" class="btn btn-sm btn-link" data-move-cancel>ยกเลิก</button>
    </span>`;
}

function addNodeForm(parent) {
  return `
    <form class="team-arc-add" data-add-node-form="${escHtml(parent)}">
      <input type="text" class="form-control form-control-sm" name="name" maxlength="200" required
        placeholder="${parent ? 'ชื่อตำแหน่งหรือฝ่ายย่อย' : 'ชื่อฝ่าย'}" aria-label="ชื่อ" />
      <select class="form-select form-select-sm" name="kind" aria-label="ประเภท">
        <option value="role"${parent ? ' selected' : ''}>ตำแหน่ง</option>
        <option value="division"${parent ? '' : ' selected'}>ฝ่าย (มีตำแหน่งย่อย)</option>
      </select>
      <button type="submit" class="btn btn-sm btn-primary">เพิ่ม</button>
      <button type="button" class="btn btn-sm btn-link" data-add-cancel>ยกเลิก</button>
    </form>`;
}

function addMemberForm(nodeId) {
  return `
    <form class="team-arc-add" data-add-member-form="${escHtml(nodeId)}">
      <input type="text" class="form-control form-control-sm" name="name" maxlength="200" required
        list="teamArcLiveNames" placeholder="ชื่อ-สกุล (พิมพ์ชื่อคนในทีมตอนนี้เพื่อใช้รูปเดิม)" aria-label="ชื่อ-สกุล" />
      <input type="text" class="form-control form-control-sm" name="nickname" maxlength="60"
        placeholder="ชื่อเล่น" aria-label="ชื่อเล่น" />
      <button type="submit" class="btn btn-sm btn-primary">เพิ่ม</button>
      <button type="button" class="btn btn-sm btn-link" data-add-cancel>ยกเลิก</button>
    </form>`;
}

function nodeGroup({ node, trail, depth }, people) {
  const id = escHtml(node.id);
  const division = node.kind === 'division';
  return `
    <section class="team-arc-group${division ? ' is-division' : ''}" style="--arc-depth:${Math.min(depth, 6)}">
      <header class="team-arc-head">
        <div class="team-arc-title">
          ${trail ? `<span class="team-arc-trail">${escHtml(trail)} ›</span>` : ''}
          <input type="text" class="form-control form-control-sm team-arc-name" data-an-name="${id}"
            value="${escHtml(node.name || '')}" maxlength="200" aria-label="ชื่อ${division ? 'ฝ่าย' : 'ตำแหน่ง'}" />
          <span class="team-arc-kind">${division ? 'ฝ่าย' : 'ตำแหน่ง'}</span>
        </div>
        <label class="team-arc-board">
          <input type="checkbox" data-an-board="${id}" ${node.is_board ? 'checked' : ''} />
          <span>คณะกรรมการ</span>
        </label>
        <div class="team-arc-node-actions">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-am-add="${id}"><i class="bi bi-person-plus"></i> คน</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-an-add-node="${id}"><i class="bi bi-diagram-2"></i> ตำแหน่งย่อย</button>
          ${moving?.kind === 'node' && moving.id === node.id
            ? moveSelect('node', node.id)
            : `<button type="button" class="btn btn-sm btn-outline-secondary" data-an-move="${id}">ย้าย</button>`}
          <button type="button" class="btn btn-sm btn-outline-danger" data-an-delete="${id}"
            aria-label="ลบ ${escHtml(node.name || '')}"><i class="bi bi-trash"></i></button>
        </div>
      </header>
      ${people.length ? `<ul class="team-arc-list">${people.map(archiveMemberRow).join('')}</ul>` : ''}
      ${adding?.kind === 'member' && adding.parent === node.id ? addMemberForm(node.id) : ''}
      ${adding?.kind === 'node' && adding.parent === node.id ? addNodeForm(node.id) : ''}
    </section>`;
}

function archiveMemberRow(m) {
  const id = escHtml(m.id);
  return `
    <li class="team-arc-row" data-am-id="${id}">
      <div class="team-arc-photo">
        ${m.photo_url
          ? `<img src="${escHtml(portraitSrc(m.photo_url, 96, m.photo_focus || 'center'))}" alt="" loading="lazy" />`
          : '<span class="team-arc-photo-empty"><i class="bi bi-person"></i></span>'}
        <input type="file" accept="image/*" data-am-photo="${id}" class="team-arc-file"
          aria-label="เปลี่ยนรูป ${escHtml(m.full_name || '')}" />
      </div>
      <div class="team-arc-fields">
        <input type="text" class="form-control form-control-sm" data-am-name="${id}"
          value="${escHtml(m.full_name || '')}" placeholder="ชื่อ-สกุล" maxlength="200" aria-label="ชื่อ-สกุล" />
        <input type="text" class="form-control form-control-sm" data-am-nick="${id}"
          value="${escHtml(m.nickname || '')}" placeholder="ชื่อเล่น" maxlength="60" aria-label="ชื่อเล่น" />
        <span class="team-arc-row-actions">
          ${moving?.kind === 'member' && moving.id === m.id
            ? moveSelect('member', m.id)
            : `<button type="button" class="btn btn-sm btn-outline-secondary" data-am-move="${id}" aria-label="ย้าย ${escHtml(m.full_name || '')}">ย้าย</button>`}
          <button type="button" class="btn btn-sm btn-outline-danger" data-am-delete="${id}"
            aria-label="ลบ ${escHtml(m.full_name || '')}"><i class="bi bi-trash"></i></button>
        </span>
      </div>
    </li>`;
}

// Internal only. render() in index.js deliberately does NOT call this — it is
// also the realtime re-render target and would destroy in-progress archive
// edits (see the isYears branch there). terms.js owns its own repaints.
function renderTerms() {
  if (!host) return;
  const nextYear = (currentTerm()?.year || new Date().getFullYear() + 543) + 1;
  // Prefer the open editor's scroll position over a jump to the top: every
  // structural edit repaints the pane.
  const body = $('teamTermBody');
  const scroll = body ? body.scrollTop : 0;
  host.innerHTML = `
    <div class="team-terms">
      <p class="team-terms-lead">
        จัดรายชื่อทีมของปีไหนก็ได้ที่นี่ — <strong>ทีมปีหน้า</strong> หรือปีที่ผ่านมา —
        แล้วกด “แสดงบนหน้าเกี่ยวกับเรา” โดยไม่ต้องเปลี่ยนปี SAMO ของทั้งระบบ
        รายชื่อที่จัดที่นี่ใช้แสดงผลอย่างเดียว ไม่ให้สิทธิ์ใคร
        สิทธิ์ของแต่ละคนยังมาจากผังในแท็บ “จัดการทีม” เหมือนเดิม
      </p>
      <p class="team-terms-note team-terms-note--go">
        <i class="bi bi-calendar2-range"></i>
        <span>
          <strong>ส่งต่อให้ทีมใหม่ และเปลี่ยนปีปัจจุบัน</strong> ทำที่หน้า
          <button type="button" class="team-terms-golink" data-term-goto-year>ปี SAMO</button>
          ถ้าแสดงทีมปีหน้าไว้แล้ว เมื่อถึงวันเปลี่ยนปี หน้าเกี่ยวกับเราจะแสดงรายชื่อที่จัดไว้นี้ต่อ
        </span>
      </p>
      <p class="team-terms-note">
        <i class="bi bi-info-circle"></i>
        <span>
          <strong>ปีปัจจุบัน</strong> หน้าเกี่ยวกับเราแสดงผังสดจากแท็บ “จัดการทีม”
          จนกว่าจะกด “เผยแพร่ปีนี้” ซึ่งบันทึกภาพนิ่งของผังไว้ — หลังจากนั้นแก้ผังสดแล้วต้องกดเผยแพร่ซ้ำจึงจะเห็น
        </span>
      </p>
      <form class="team-terms-add" id="teamTermAddForm">
        <label class="visually-hidden" for="teamTermNewYear">ปี SAMO ที่จะเพิ่ม</label>
        <input type="number" class="form-control form-control-sm" id="teamTermNewYear"
          value="${nextYear}" min="2500" max="2700" />
        <label class="visually-hidden" for="teamTermStart">เริ่มรายชื่อจาก</label>
        <select class="form-select form-select-sm" id="teamTermStart">
          <option value="live">คัดลอกผังตอนนี้</option>
          <option value="empty">เริ่มจากว่าง</option>
          ${terms.filter((x) => canEditYear(x)).map((x) =>
            `<option value="${x.year}">คัดลอกจากปี ${x.year}</option>`).join('')}
        </select>
        <button type="submit" class="btn btn-sm btn-outline-primary" id="teamTermAdd">
          <i class="bi bi-plus-lg"></i> เพิ่มปี
        </button>
      </form>
      <div class="team-terms-status" id="teamTermsStatus" role="status"></div>
      <ul class="team-terms-list">${terms.map(termRow).join('')}</ul>
    </div>`;
  const nb = $('teamTermBody');
  if (nb && scroll) nb.scrollTop = scroll;
}

// ── actions ─────────────────────────────────────────────────────────────────

// SERIALISED, never dropped. The first version was `if (busy) return;`, which
// silently discarded the second action — type a name, tab to ชื่อเล่น, blur
// quickly, and the ชื่อเล่น PATCH disappeared while the first one reported
// "บันทึกแล้ว", so the edit looked saved and was not. Every call now queues
// behind the previous one; concurrent PATCHes to different rows are independent
// anyway, and serialising them keeps the status line honest about the last
// outcome.
let chain = Promise.resolve();

function guard(fn, okMsg) {
  chain = chain.then(async () => {
    try {
      await fn();
      if (okMsg) statusLine(okMsg, 'ok');
    } catch (err) {
      statusLine(err?.message || 'ทำรายการไม่สำเร็จ', 'error');
    }
  });
  return chain;
}

async function reloadTerms() {
  terms = await fetchTerms();
  // Best-effort: a failed status read must not blank the whole pane, it only
  // costs the "snapshot is behind" hint.
  try {
    const st = await fetchTermStatus();
    staleByYear = new Map((st.terms || []).map((t) => [t.year, !!t.stale]));
  } catch { staleByYear = new Map(); }
  onTermsChanged?.(currentTerm()?.year || null);
  renderTerms();
}

async function doPublish(year) {
  const t = terms.find((x) => x.year === year);
  const again = !!t?.published_at;
  // The wording is shared with the ปี SAMO page (term-dialogs.js) — it is
  // what stops a re-publish mid-handover filing the next team as this year,
  // and (0270) what stops it erasing a list built by hand.
  await guard(async () => {
    statusLine('กำลังบันทึกภาพนิ่งของผัง…');
    const res = await publishTermAsking(year, again);
    if (!res) { statusLine(''); return; }
    if (openYear === year) archive = await fetchArchive(year);
    await reloadTerms();
    const kept = Number(res?.photos_kept || 0);
    statusLine(`เผยแพร่ปี ${year} แล้ว — ${res?.nodes ?? 0} ตำแหน่ง · ${res?.members ?? 0} คน`
      + (kept ? ` · คงรูปที่แก้ไว้ในประวัติ ${kept} รูป` : ''), 'ok');
  });
}

/** Add a year and start its list (0270). The year row is created first, so a
 *  failed copy leaves an empty year to retry on, not nothing. */
async function doAddYear(year, start) {
  if (terms.some((x) => x.year === year)) {
    statusLine(`มีปี ${year} อยู่แล้ว — กด “จัดรายชื่อ” ที่ปีนั้น`, 'error');
    return;
  }
  await guard(async () => {
    await createTerm(year);
    let res = null;
    if (start !== 'empty') {
      statusLine('กำลังคัดลอกรายชื่อ…');
      res = await copyTeamYear(year, start === 'live' ? null : Number(start));
    }
    await reloadTerms();
    await openEditor(year);
    statusLine(res
      ? `เพิ่มปี ${year} แล้ว — คัดลอก ${res.nodes ?? 0} ตำแหน่ง · ${res.members ?? 0} คน ยังไม่แสดงบนหน้าเกี่ยวกับเราจนกว่าจะกดแสดง`
      : `เพิ่มปี ${year} แล้ว — เริ่มจาก “เพิ่มฝ่าย” ด้านล่าง`, 'ok');
  });
}

async function doSetShown(year, shown) {
  if (!shown && !await askConfirm({
    title: `ซ่อนทีมปี ${year} จากหน้าเกี่ยวกับเรา?`,
    body: 'รายชื่อยังเก็บไว้ครบ กดแสดงอีกครั้งเมื่อไหร่ก็ได้',
    yes: 'ซ่อน',
    danger: false,
  })) return;
  await guard(async () => {
    await setTermShown(year, shown);
    await reloadTerms();
  }, shown ? `ทีมปี ${year} แสดงบนหน้าเกี่ยวกับเราแล้ว` : `ซ่อนทีมปี ${year} แล้ว`);
}

async function doDeleteTerm(year) {
  if (!await askConfirm({
    title: `ลบปี ${year} และรายชื่อ/รูปที่เก็บไว้ทั้งหมด?`,
    body: 'ลบแล้วกู้คืนไม่ได้ (ผังสดไม่ได้รับผลกระทบ)',
    yes: 'ลบ',
  })) return;
  await guard(async () => {
    await deleteTerm(year);
    if (openYear === year) { openYear = null; archive = null; }
    await reloadTerms();
  }, `ลบปี ${year} แล้ว`);
}

async function loadLiveNames() {
  try {
    const { members } = await fetchTree();
    liveByName = new Map();
    for (const m of members) {
      const k = String(m.full_name || '').trim();
      if (k && !liveByName.has(k)) liveByName.set(k, m);
    }
  } catch { liveByName = new Map(); }
}

async function openEditor(year) {
  openYear = year;
  archive = null;
  adding = null;
  moving = null;
  renderTerms();
  const [a] = await Promise.all([fetchArchive(year), liveByName.size ? null : loadLiveNames()]);
  archive = a;
  renderTerms();
}

async function toggleEdit(year) {
  if (openYear === year) { openYear = null; archive = null; adding = null; moving = null; renderTerms(); return; }
  await guard(() => openEditor(year));
}

const nextPosition = (rows) => rows.reduce((mx, r) => Math.max(mx, Number(r.position) || 0), -1) + 1;

async function doAddNode(parent, name, kind) {
  await guard(async () => {
    const siblings = archive.nodes.filter((n) => (n.parent_id || '') === parent);
    const row = await createArchiveNode({
      year: openYear,
      parent_id: parent || null,
      name,
      kind: kind === 'division' ? 'division' : 'role',
      position: nextPosition(siblings),
    });
    archive.nodes.push(row);
    adding = null;
    await reloadTermsQuiet();
    renderTerms();
  }, `เพิ่ม “${name}” แล้ว`);
}

async function doAddMember(nodeId, name, nickname) {
  await guard(async () => {
    const live = liveByName.get(name);
    const here = archive.members.filter((m) => m.node_id === nodeId);
    // A current member typed by name brings their ชื่อเล่น and photo, and the
    // src link that lets a later publish keep the photo. Never an identity.
    const row = await createArchiveMember({
      year: openYear,
      node_id: nodeId,
      full_name: name,
      nickname: nickname || live?.nickname || null,
      photo_url: live?.photo_url || null,
      photo_focus: live?.photo_url ? (live.photo_focus || 'center') : null,
      src_member_id: live?.id || null,
      position: nextPosition(here),
    });
    archive.members.push(row);
    adding = { kind: 'member', parent: nodeId };   // keep the form open for the next name
    await reloadTermsQuiet();
    renderTerms();
    host.querySelector(`[data-add-member-form="${CSS.escape(nodeId)}"] input[name="name"]`)?.focus();
  }, `เพิ่ม ${name} แล้ว`);
}

async function doMove(kind, id, target) {
  await guard(async () => {
    if (kind === 'node') {
      const siblings = archive.nodes.filter((n) => (n.parent_id || '') === target && n.id !== id);
      const row = await updateArchiveNode(id, { parent_id: target || null, position: nextPosition(siblings) });
      const i = archive.nodes.findIndex((n) => n.id === id);
      if (i >= 0) archive.nodes[i] = { ...archive.nodes[i], ...row };
    } else {
      const here = archive.members.filter((m) => m.node_id === target && m.id !== id);
      const row = await updateArchiveMember(id, { node_id: target, position: nextPosition(here) });
      const i = archive.members.findIndex((m) => m.id === id);
      if (i >= 0) archive.members[i] = { ...archive.members[i], ...row };
    }
    moving = null;
    await reloadTermsQuiet();
    renderTerms();
  }, 'ย้ายแล้ว');
}

async function doDeleteNode(id) {
  const node = archive?.nodes.find((n) => n.id === id);
  if (!node) return;
  const ids = subtreeIds(archive.nodes, id);
  const people = archive.members.filter((m) => ids.has(m.node_id));
  if (!await askConfirm({
    title: `ลบ “${node.name}” ออกจากปี ${openYear}?`,
    body: (ids.size > 1 || people.length)
      ? `จะลบตำแหน่งย่อย ${ids.size - 1} ตำแหน่ง และรายชื่อ ${people.length} คนที่อยู่ข้างใต้ไปด้วย — ผังสดไม่ได้รับผลกระทบ`
      : 'ผังสดไม่ได้รับผลกระทบ',
    yes: 'ลบ',
  })) return;
  await guard(async () => {
    await deleteArchiveNode(id);
    archive.nodes = archive.nodes.filter((n) => !ids.has(n.id));
    archive.members = archive.members.filter((m) => !ids.has(m.node_id));
    await reloadTermsQuiet();
    renderTerms();
    for (const p of people) if (p.photo_url) deleteTeamPhotoIfUnused(p.photo_url);
  }, 'ลบแล้ว');
}

/** Re-read the year list (for the จัดรายชื่อเอง badge) WITHOUT painting —
 *  each action calls it before its own single repaint, so focus placed after
 *  that repaint (the next-name field) is not stolen by a second one. */
async function reloadTermsQuiet() {
  try { terms = await fetchTerms(); } catch { /* a hint; the edit already succeeded */ }
}

/** Patch one archived member and repaint just that row's model, not the pane —
 *  a full re-render on every keystroke-blur would steal focus mid-edit. */
async function patchMember(id, patch) {
  await guard(async () => {
    const row = await updateArchiveMember(id, patch);
    const i = archive?.members.findIndex((m) => m.id === id) ?? -1;
    if (i >= 0) archive.members[i] = { ...archive.members[i], ...row };
  }, 'บันทึกแล้ว');
}

async function onArchivePhoto(id, file) {
  const m = archive?.members.find((x) => x.id === id);
  if (!m) return;
  // Frame first — cancelling must upload nothing. The crop lands exactly on the
  // 3:4 the card renders, so photo_focus goes back to 'center' with it (an
  // archived row may still be carrying a legacy 'top'/'bottom').
  const cropped = await cropImage(file, {
    title: `ปรับกรอบรูป — ${m.full_name || ''}`.trim(),
    hint: 'ลากให้ใบหน้าอยู่กลางกรอบ',
  }).catch((err) => { statusLine('เปิดรูปไม่สำเร็จ: ' + (err?.message || err), 'error'); return null; });
  if (!cropped) return;
  await guard(async () => {
    statusLine('กำลังย่อและอัปโหลดรูป…');
    const res = await uploadTeamPhoto(cropped, {
      year: openYear,
      dept: 'archive',
      order: m.position,
      // Guarded, like the other three writers. An archived row from before the
      // 0135 name split can carry a blank full_name, and an empty `name` here is
      // not an error — uploadTeamPhoto files it as the literal "member" and the
      // person becomes unfindable in the Drive folder. Found by
      // portrait-filename.test.js the moment that ratchet existed.
      name: String(m.full_name || '').trim()
        || String(m.nickname || '').trim()
        || 'member',
    });
    const prevPhoto = m.photo_url || '';
    const row = await updateArchiveMember(id, { photo_url: res.url, photo_focus: 'center' });
    const i = archive.members.findIndex((x) => x.id === id);
    if (i >= 0) archive.members[i] = { ...archive.members[i], ...row };
    // After the repoint, so the ref-count sees the new truth. It will decline to
    // delete if the LIVE member still carries the same file — a published year
    // shares the Drive id with the live tree.
    if (prevPhoto && prevPhoto !== res.url) deleteTeamPhotoIfUnused(prevPhoto);
    renderTerms();
    statusLine(res.organised ? 'อัปเดตรูปแล้ว' : 'อัปเดตรูปแล้ว (ยังไม่ได้จัดโฟลเดอร์ — ต้อง redeploy Apps Script)', 'ok');
  });
}

// ── wiring ──────────────────────────────────────────────────────────────────

/** Drop one person from a published year's snapshot. Extracted from the click
 *  delegate because the confirmation is now awaited — a `void`-ed async branch
 *  inside a sync handler is how a dialog answer gets dropped on the floor. */
async function doDeleteArchiveMember(id) {
  const m = archive?.members.find((x) => x.id === id);
  if (!await askConfirm({
    title: `ลบ ${m?.full_name || 'รายการนี้'} ออกจากประวัติปี ${openYear}?`,
    body: 'ผังสดไม่ได้รับผลกระทบ',
    yes: 'ลบ',
  })) return;
  const photo = m?.photo_url || '';
  await guard(async () => {
    await deleteArchiveMember(id);
    archive.members = archive.members.filter((x) => x.id !== id);
    renderTerms();
    // Declines if the live tree (or another year) still shows this portrait.
    if (photo) deleteTeamPhotoIfUnused(photo);
  }, 'ลบแล้ว');
}

export function initTerms(hostEl, { onChange } = {}) {
  host = hostEl;
  onTermsChanged = onChange;
  if (!host) return;

  host.addEventListener('click', (e) => {
    const t = e.target;
    const pub = t.closest?.('[data-term-publish]');
    if (pub) return void doPublish(Number(pub.dataset.termPublish));
    if (t.closest?.('[data-term-goto-year]')) return void window.openAdminSection?.('years');
    const shown = t.closest?.('[data-term-shown]');
    if (shown) return void doSetShown(Number(shown.dataset.termShown), shown.dataset.shown === '1');
    const del = t.closest?.('[data-term-delete]');
    if (del) return void doDeleteTerm(Number(del.dataset.termDelete));
    const edit = t.closest?.('[data-term-edit]');
    if (edit) return void toggleEdit(Number(edit.dataset.termEdit));

    // ── the list editor (0270) ──
    const addNode = t.closest?.('[data-an-add-node]');
    if (addNode) { adding = { kind: 'node', parent: addNode.dataset.anAddNode }; moving = null; renderTerms();
      host.querySelector('[data-add-node-form] input[name="name"]')?.focus(); return; }
    const addMember = t.closest?.('[data-am-add]');
    if (addMember) { adding = { kind: 'member', parent: addMember.dataset.amAdd }; moving = null; renderTerms();
      host.querySelector('[data-add-member-form] input[name="name"]')?.focus(); return; }
    if (t.closest?.('[data-add-cancel]')) { adding = null; renderTerms(); return; }
    const mvNode = t.closest?.('[data-an-move]');
    if (mvNode) { moving = { kind: 'node', id: mvNode.dataset.anMove }; adding = null; renderTerms();
      host.querySelector('[data-move-target]')?.focus(); return; }
    const mvMember = t.closest?.('[data-am-move]');
    if (mvMember) { moving = { kind: 'member', id: mvMember.dataset.amMove }; adding = null; renderTerms();
      host.querySelector('[data-move-target]')?.focus(); return; }
    if (t.closest?.('[data-move-cancel]')) { moving = null; renderTerms(); return; }
    const anDel = t.closest?.('[data-an-delete]');
    if (anDel) return void doDeleteNode(anDel.dataset.anDelete);
    const amDel = t.closest?.('[data-am-delete]');
    if (amDel) return void doDeleteArchiveMember(amDel.dataset.amDelete);
  });

  host.addEventListener('submit', (e) => {
    const f = e.target;
    e.preventDefault();
    if (f.id === 'teamTermAddForm') {
      const y = Number($('teamTermNewYear')?.value);
      if (!Number.isInteger(y) || y < 2500 || y > 2700) return statusLine('ปี SAMO ไม่ถูกต้อง', 'error');
      return void doAddYear(y, $('teamTermStart')?.value || 'live');
    }
    const name = String(f.elements?.name?.value || '').trim();
    if (f.dataset.addNodeForm !== undefined) {
      if (!name) return statusLine('ใส่ชื่อก่อน', 'error');
      return void doAddNode(f.dataset.addNodeForm, name, f.elements.kind?.value);
    }
    if (f.dataset.addMemberForm !== undefined) {
      if (!name) return statusLine('ใส่ชื่อ-สกุลก่อน', 'error');
      return void doAddMember(f.dataset.addMemberForm, name, String(f.elements.nickname?.value || '').trim());
    }
  });

  host.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (adding || moving)) { adding = null; moving = null; renderTerms(); }
  });

  // `change` rather than `input`: one write per finished edit, not per keystroke.
  host.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset?.moveTarget !== undefined) {
      return void doMove(t.dataset.moveKind, t.dataset.moveTarget, t.value);
    }
    if (t.dataset?.anName !== undefined) {
      const v = t.value.trim();
      const id = t.dataset.anName;
      if (!v) { statusLine('ชื่อว่างไม่ได้', 'error'); return; }
      return void guard(async () => {
        const row = await updateArchiveNode(id, { name: v });
        const n = archive?.nodes.find((x) => x.id === id);
        if (n) Object.assign(n, row);
      }, 'บันทึกแล้ว');
    }
    if (t.dataset?.amName !== undefined) {
      const v = t.value.trim();
      if (!v) { statusLine('ชื่อว่างไม่ได้', 'error'); return; }
      return void patchMember(t.dataset.amName, { full_name: v });
    }
    if (t.dataset?.amNick !== undefined) {
      return void patchMember(t.dataset.amNick, { nickname: t.value.trim() || null });
    }
    if (t.dataset?.anBoard !== undefined) {
      const id = t.dataset.anBoard;
      const checked = t.checked;
      return void guard(async () => {
        await updateArchiveNode(id, { is_board: checked });
        const n = archive?.nodes.find((x) => x.id === id);
        if (n) n.is_board = checked;
      }, 'บันทึกแล้ว');
    }
    if (t.dataset?.amPhoto !== undefined) {
      const file = t.files?.[0];
      // Clear it, or re-picking the same file fires no change event.
      const id = t.dataset.amPhoto;
      t.value = '';
      if (file) return void onArchivePhoto(id, file);
    }
  });
}

/** Called when the pane becomes visible. render() deliberately does not paint
 *  this pane (see index.js), so on a cold first entry it is empty until the
 *  fetch lands — say so rather than showing a blank panel. */
export async function enterTerms() {
  if (host && !host.querySelector('.team-terms')) {
    host.innerHTML = '<div class="team-terms"><div class="team-terms-loading">กำลังโหลดทีมแต่ละปี…</div></div>';
  }
  statusLine('');
  await guard(reloadTerms);
}

/** The live term's year, for filing uploads into the right Drive folder. */
export async function primeTerms() {
  try {
    terms = await fetchTerms();
    onTermsChanged?.(currentTerm()?.year || null);
  } catch { /* the pane will report it when opened */ }
}
