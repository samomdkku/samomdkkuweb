// ==============================================
// TEAM ARCHIVE EDITOR — one PAST ปี SAMO's list, opened from the year bar
// (year-bar.js) when a year before the current one is picked.
//
// 0270 made a year's list buildable by hand; 0271 (owner, 2026-10-31) moved the
// YEAR choice to a bar above the whole ทีม SAMO pane, so this module no longer
// lists years, adds them, shows/hides or publishes them — the bar does. A year
// AHEAD is not edited here either: it opens the real tree editor (index.js) on
// its prepared draft, permissions included. What is left is history: rename,
// re-photo, move, add or remove ฝ่าย / ตำแหน่ง / people of a year gone by.
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
import { walkNodes, subtreeIds } from './archive-tree.js';
import {
  fetchTree,
  fetchArchive, updateArchiveMember, deleteArchiveMember, updateArchiveNode,
  createArchiveNode, deleteArchiveNode, createArchiveMember,
  copyTeamYear,
  deleteTeamPhotoIfUnused,
} from './api.js';

const $ = (id) => document.getElementById(id);

let openYear = null;      // the past year on screen
let copyFrom = [];        // other years with a list, offered when this one is empty
let archive = null;       // { nodes, members } for openYear
let host = null;
let onEdited = null;      // tells the year bar a year's list changed (จัดรายชื่อเอง)
// Editor state. `adding` = an open inline form ({ kind: 'member'|'node',
// parent: nodeId|'' }); `moving` = a row whose ย้าย select is open.
let adding = null;
let moving = null;
// The live tree's people by name, so typing a current member's name into
// "เพิ่มคน" brings their ชื่อเล่น and photo along. Loaded when an editor opens;
// a failure only costs the suggestion.
let liveByName = new Map();

// ── rendering ───────────────────────────────────────────────────────────────

function statusLine(msg, kind = '') {
  const el = $('teamTermsStatus');
  if (el) {
    el.textContent = msg || '';
    el.className = `team-terms-status${kind ? ` is-${kind}` : ''}`;
  }
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
    out.push(`
      <div class="team-arc-empty">
        <p>ปีนี้ยังไม่มีรายชื่อ — เริ่มจาก “เพิ่มฝ่าย” หรือคัดลอกมาแล้วแก้</p>
        <form class="team-arc-copy" data-copy-form>
          <select class="form-select form-select-sm" name="from" aria-label="คัดลอกรายชื่อจาก">
            <option value="live">คัดลอกจากทีมปัจจุบัน</option>
            ${copyFrom.filter((y) => y !== openYear).map((y) => `<option value="${y}">คัดลอกจากปี ${y}</option>`).join('')}
          </select>
          <button type="submit" class="btn btn-sm btn-outline-primary">คัดลอก</button>
        </form>
      </div>`);
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

function renderArchive() {
  if (!host) return;
  const body = $('teamTermBody');
  const scroll = body ? body.scrollTop : 0;
  host.innerHTML = `
    <div class="team-terms">
      <div class="team-terms-status" id="teamTermsStatus" role="status"></div>
      <div class="team-term-body" id="teamTermBody">${archiveHtml()}</div>
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

/** Copy a list into this EMPTY year (0270's copy_team_year, from the live tree
 *  or another year), then reopen it. */
async function doCopyInto(from) {
  await guard(async () => {
    statusLine('กำลังคัดลอกรายชื่อ…');
    const res = await copyTeamYear(openYear, from === 'live' ? null : Number(from));
    await openEditor(openYear);
    onEdited?.(openYear);
    statusLine(`คัดลอก ${res?.nodes ?? 0} ตำแหน่ง · ${res?.members ?? 0} คน แล้ว`, 'ok');
  });
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
  renderArchive();
  const [a] = await Promise.all([fetchArchive(year), liveByName.size ? null : loadLiveNames()]);
  if (openYear !== year) return;   // another year was picked while this one loaded
  archive = a;
  renderArchive();
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
    onEdited?.(openYear);
    renderArchive();
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
    onEdited?.(openYear);
    renderArchive();
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
    onEdited?.(openYear);
    renderArchive();
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
    onEdited?.(openYear);
    renderArchive();
    for (const p of people) if (p.photo_url) deleteTeamPhotoIfUnused(p.photo_url);
  }, 'ลบแล้ว');
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
    renderArchive();
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
    renderArchive();
    // Declines if the live tree (or another year) still shows this portrait.
    if (photo) deleteTeamPhotoIfUnused(photo);
  }, 'ลบแล้ว');
}

export function initArchiveEditor(hostEl, { onEdited: edited } = {}) {
  host = hostEl;
  onEdited = edited;
  if (!host) return;

  host.addEventListener('click', (e) => {
    const t = e.target;
    const addNode = t.closest?.('[data-an-add-node]');
    if (addNode) { adding = { kind: 'node', parent: addNode.dataset.anAddNode }; moving = null; renderArchive();
      host.querySelector('[data-add-node-form] input[name="name"]')?.focus(); return; }
    const addMember = t.closest?.('[data-am-add]');
    if (addMember) { adding = { kind: 'member', parent: addMember.dataset.amAdd }; moving = null; renderArchive();
      host.querySelector('[data-add-member-form] input[name="name"]')?.focus(); return; }
    if (t.closest?.('[data-add-cancel]')) { adding = null; renderArchive(); return; }
    const mvNode = t.closest?.('[data-an-move]');
    if (mvNode) { moving = { kind: 'node', id: mvNode.dataset.anMove }; adding = null; renderArchive();
      host.querySelector('[data-move-target]')?.focus(); return; }
    const mvMember = t.closest?.('[data-am-move]');
    if (mvMember) { moving = { kind: 'member', id: mvMember.dataset.amMove }; adding = null; renderArchive();
      host.querySelector('[data-move-target]')?.focus(); return; }
    if (t.closest?.('[data-move-cancel]')) { moving = null; renderArchive(); return; }
    const anDel = t.closest?.('[data-an-delete]');
    if (anDel) return void doDeleteNode(anDel.dataset.anDelete);
    const amDel = t.closest?.('[data-am-delete]');
    if (amDel) return void doDeleteArchiveMember(amDel.dataset.amDelete);
  });

  host.addEventListener('submit', (e) => {
    const f = e.target;
    e.preventDefault();
    if (f.dataset.copyForm !== undefined) return void doCopyInto(f.elements.from?.value || 'live');
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
    if (e.key === 'Escape' && (adding || moving)) { adding = null; moving = null; renderArchive(); }
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

/** Show `year`'s archive editor. `years` = every other year that holds a list,
 *  offered as a source when this one is empty. */
export async function openArchiveYear(year, { years = [] } = {}) {
  copyFrom = years;
  statusLine('');
  await guard(() => openEditor(year));
}
