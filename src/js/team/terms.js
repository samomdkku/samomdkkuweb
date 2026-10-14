// ==============================================
// TEAM TERMS — the ปีการศึกษา pane of the ทีม SAMO admin (mode 'years').
//
// Two jobs:
//   1. Manage the year registry: which ปีการศึกษา the LIVE tree represents, and
//      which past years have been published to the public page.
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
import {
  fetchTerms, createTerm, updateTerm, deleteTerm, setCurrentTerm, publishTerm,
  fetchTermStatus,
  fetchArchive, updateArchiveMember, deleteArchiveMember, updateArchiveNode,
  deleteTeamPhotoIfUnused,
} from './api.js';

const $ = (id) => document.getElementById(id);

let terms = [];
let staleByYear = new Map();   // year -> true when the live tree moved after publish
let openYear = null;      // the archived year currently expanded for editing
let archive = null;       // { nodes, members } for openYear
let busy = false;
let host = null;
let onTermsChanged = null; // lets index.js keep its currentTermYear in step

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

function termRow(t) {
  const published = !!t.published_at;
  const when = published
    ? new Date(t.published_at).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })
    : '';
  return `
    <li class="team-term${t.is_current ? ' is-current' : ''}${openYear === t.year ? ' is-open' : ''}">
      <div class="team-term-head">
        <div class="team-term-id">
          <span class="team-term-year">${escHtml(String(t.year))}</span>
          ${t.label ? `<span class="team-term-label">${escHtml(t.label)}</span>` : ''}
        </div>
        <div class="team-term-badges">
          ${t.is_current ? '<span class="team-term-badge is-live">ปีปัจจุบัน (ผังสด)</span>' : ''}
          ${published
            ? `<span class="team-term-badge is-pub">เผยแพร่แล้ว · ${escHtml(when)}</span>`
            : (t.is_current
                ? '<span class="team-term-badge is-draft">ยังไม่เผยแพร่ — หน้าสาธารณะแสดงผังสด</span>'
                : '<span class="team-term-badge is-draft" title="ยังไม่เผยแพร่และไม่ใช่ปีปัจจุบัน จึงไม่ปรากฏบนหน้าสาธารณะ">ยังไม่เผยแพร่ — ไม่แสดงบนหน้าสาธารณะ</span>')}
          ${staleByYear.get(t.year)
            ? '<span class="team-term-badge is-stale" title="ผังสดถูกแก้ไขหลังเผยแพร่ครั้งล่าสุด — หน้าสาธารณะยังแสดงภาพนิ่งเดิม">ผังสดเปลี่ยนแล้ว · ควรเผยแพร่ซ้ำ</span>'
            : ''}
        </div>
        <div class="team-term-actions">
          ${t.is_current
            ? `<button type="button" class="btn btn-sm btn-primary" data-term-publish="${t.year}">
                 <i class="bi bi-camera"></i> ${published ? 'เผยแพร่ซ้ำ' : 'เผยแพร่ปีนี้'}
               </button>`
            : `<button type="button" class="btn btn-sm btn-outline-secondary" data-term-current="${t.year}">
                 ตั้งเป็นปีปัจจุบัน
               </button>`}
          ${published
            ? `<button type="button" class="btn btn-sm btn-outline-secondary" data-term-edit="${t.year}">
                 <i class="bi bi-pencil"></i> ${openYear === t.year ? 'ปิด' : 'แก้ไขรายชื่อ/รูป'}
               </button>`
            : ''}
          <button type="button" class="btn btn-sm btn-outline-danger" data-term-delete="${t.year}"
            ${t.is_current ? 'disabled title="ลบปีปัจจุบันไม่ได้ — ตั้งปีอื่นเป็นปีปัจจุบันก่อน"' : ''}>
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
  if (!members.length) return '<div class="team-terms-loading">ปีนี้ไม่มีรายชื่อ</div>';

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const byNode = new Map();
  for (const m of members) {
    if (!byNode.has(m.node_id)) byNode.set(m.node_id, []);
    byNode.get(m.node_id).push(m);
  }
  // Depth-first so the editor lists people in the same order the public page
  // shows them — otherwise "the third card" here and there are different people.
  const byParent = new Map();
  for (const n of nodes) {
    const k = n.parent_id || '';
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(n);
  }
  const out = [];
  // Track what actually got rendered by ID. An earlier version inferred this by
  // regex-ing the generated HTML for data-am-id, which is both fragile and a
  // second source of truth for something the loop already knows.
  const rendered = new Set();
  const walk = (key, trail) => {
    for (const n of byParent.get(key) || []) {
      const path = trail ? `${trail} › ${n.name}` : n.name;
      const people = byNode.get(n.id) || [];
      if (people.length) {
        out.push(nodeGroup(n, path, people));
        people.forEach((m) => rendered.add(m.id));
      }
      walk(n.id, path);
    }
  };
  walk('', '');

  // Orphans should be impossible — publish_team_term maps every parent
  // faithfully (asserted at 0 in tools/team0104-terms.mjs) — but a hand-edited
  // archive or a deleted node could strand a row. Showing them is the only way
  // they can be fixed or removed; dropping them would make a name invisible in
  // the editor while it is still absent from the public page.
  const missed = members.filter((m) => !rendered.has(m.id));
  if (missed.length) {
    out.push(nodeGroup({ id: '', is_board: false }, 'ไม่ทราบตำแหน่ง', missed));
  }
  return out.join('');
}

function nodeGroup(node, path, people) {
  return `
    <section class="team-arc-group">
      <header class="team-arc-head">
        <h6 class="team-arc-path">${escHtml(path)}</h6>
        ${node.id ? `
        <label class="team-arc-board">
          <input type="checkbox" data-an-board="${node.id}" ${node.is_board ? 'checked' : ''} />
          <span>คณะกรรมการ</span>
        </label>` : ''}
      </header>
      <ul class="team-arc-list">${people.map(archiveMemberRow).join('')}</ul>
    </section>`;
}

function archiveMemberRow(m) {
  return `
    <li class="team-arc-row" data-am-id="${m.id}">
      <div class="team-arc-photo">
        ${m.photo_url
          ? `<img src="${escHtml(portraitSrc(m.photo_url, 96, m.photo_focus || 'center'))}" alt="" loading="lazy" />`
          : '<span class="team-arc-photo-empty"><i class="bi bi-person"></i></span>'}
        <input type="file" accept="image/*" data-am-photo="${m.id}" class="team-arc-file"
          aria-label="เปลี่ยนรูป ${escHtml(m.full_name || '')}" />
      </div>
      <div class="team-arc-fields">
        <input type="text" class="form-control form-control-sm" data-am-name="${m.id}"
          value="${escHtml(m.full_name || '')}" placeholder="ชื่อ-สกุล" />
        <input type="text" class="form-control form-control-sm" data-am-nick="${m.id}"
          value="${escHtml(m.nickname || '')}" placeholder="ชื่อเล่น" />
        <button type="button" class="btn btn-sm btn-outline-danger" data-am-delete="${m.id}"
          aria-label="ลบ ${escHtml(m.full_name || '')}"><i class="bi bi-trash"></i></button>
      </div>
    </li>`;
}

// Internal only. render() in index.js deliberately does NOT call this — it is
// also the realtime re-render target and would destroy in-progress archive
// edits (see the isYears branch there). terms.js owns its own repaints.
function renderTerms() {
  if (!host) return;
  const nextYear = (currentTerm()?.year || new Date().getFullYear() + 543) + 1;
  host.innerHTML = `
    <div class="team-terms">
      <p class="team-terms-lead">
        ผังที่แก้ไขในแท็บ “จัดการทีม” คือ <strong>ปีปัจจุบัน</strong> เสมอ
        กด “เผยแพร่ปีนี้” เพื่อบันทึกภาพนิ่งของผังไว้เป็นประวัติเมื่อไรก็ได้
        ทุกปีที่เผยแพร่แล้วจะเลือกดูได้จากหน้าสาธารณะ และกลับมาแก้ไขชื่อ/รูปได้ที่นี่ —
        ตอน “ตั้งเป็นปีปัจจุบัน” ให้ปีอื่น ถ้าปีที่กำลังจะพ้นวาระยังไม่เคยเผยแพร่ ระบบจะบันทึกภาพนิ่งให้อัตโนมัติก่อนเปลี่ยน
      </p>
      <p class="team-terms-note">
        <i class="bi bi-info-circle"></i>
        <span>
          หน้าสาธารณะแสดง <strong>ภาพนิ่งของปีที่เผยแพร่แล้ว</strong> ทุกปี รวมถึงปีปัจจุบัน
          — แก้ชื่อ/รูปที่นี่แล้วเห็นผลทันทีโดยไม่กระทบผังสด
          ปีที่ <em>ยังไม่เผยแพร่</em> จะแสดงผังสดแทน (เฉพาะปีปัจจุบัน)
          <br />
          เมื่อแก้ผังสดในแท็บ “จัดการทีม” แล้ว ต้องกด <strong>เผยแพร่ซ้ำ</strong>
          จึงจะเห็นบนหน้าสาธารณะ — ระบบจะขึ้นป้ายเตือนให้เอง
        </span>
      </p>
      <div class="team-terms-add">
        <input type="number" class="form-control form-control-sm" id="teamTermNewYear"
          value="${nextYear}" min="2500" max="2700" aria-label="ปีการศึกษาใหม่" />
        <button type="button" class="btn btn-sm btn-outline-primary" id="teamTermAdd">
          <i class="bi bi-plus-lg"></i> เพิ่มปีการศึกษา
        </button>
      </div>
      <div class="team-terms-status" id="teamTermsStatus"></div>
      <ul class="team-terms-list">${terms.map(termRow).join('')}</ul>
    </div>`;
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
    busy = true;
    try {
      await fn();
      if (okMsg) statusLine(okMsg, 'ok');
    } catch (err) {
      statusLine(err?.message || 'ทำรายการไม่สำเร็จ', 'error');
    } finally {
      busy = false;
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
  if (!await askConfirm({
    title: again ? `เผยแพร่ปี ${year} ซ้ำ?` : `เผยแพร่ผังปัจจุบันเป็นภาพนิ่งของปี ${year}?`,
    body: again
      ? 'รายชื่อและรูปที่แก้ไขไว้ในประวัติปีนี้จะถูกแทนที่ด้วยผังปัจจุบันทั้งหมด'
      : 'หลังจากนี้หน้าสาธารณะจะแสดงภาพนิ่งนี้ (ไม่ใช่ผังสด) '
        + 'แก้ชื่อ/รูปของปีนี้ได้ที่ปุ่ม “แก้ไขรายชื่อ/รูป” และเห็นผลทันที '
        + 'ถ้าแก้ผังสดในภายหลัง ต้องกดเผยแพร่ซ้ำ',
    yes: 'เผยแพร่',
    danger: again,
  })) return;
  await guard(async () => {
    statusLine('กำลังบันทึกภาพนิ่งของผัง…');
    const res = await publishTerm(year);
    await reloadTerms();
    const kept = Number(res?.photos_kept || 0);
    statusLine(`เผยแพร่ปี ${year} แล้ว — ${res?.nodes ?? 0} ตำแหน่ง · ${res?.members ?? 0} คน`
      + (kept ? ` · คงรูปที่แก้ไว้ในประวัติ ${kept} รูป` : ''), 'ok');
  });
}

async function doSetCurrent(year) {
  const out = currentTerm();
  const outgoing = out?.year;
  // Mirrors start_team_term (0224): it snapshots the outgoing year ONLY when
  // that year has never been published — an existing archive is kept as is.
  const willSnapshot = outgoing && !out?.published_at;
  if (!await askConfirm({
    title: `ตั้งปี ${year} เป็นปีปัจจุบัน?`,
    body: (willSnapshot
        ? `ปี ${outgoing} ยังไม่เคยเผยแพร่ ระบบจะบันทึกผังตอนนี้เป็นประวัติของปี ${outgoing} ให้อัตโนมัติก่อนเปลี่ยน `
          + `(ถ้าแก้ผังเป็นทีมใหม่ไปแล้ว ประวัติจะเป็นทีมใหม่ — ให้กดปุ่มนี้ก่อนแก้ผังเสมอ) `
        : (outgoing ? `ประวัติของปี ${outgoing} ที่เผยแพร่ไว้แล้วจะคงเดิม ไม่ถูกบันทึกทับ ` : ''))
      + 'จากนั้นผังสด (แท็บ “จัดการทีม”) จะกลายเป็นผังของปีนี้ '
      + 'และหน้าสาธารณะจะแสดงปีนี้เป็นค่าเริ่มต้น — '
      + 'สิทธิ์การใช้งานทั้งหมดยังผูกกับผังสดเหมือนเดิม ไม่มีการเปลี่ยนแปลง',
    yes: 'ตั้งเป็นปีปัจจุบัน',
    danger: false,
  })) return;
  await guard(async () => { await setCurrentTerm(year); await reloadTerms(); }, `ตั้งปี ${year} เป็นปีปัจจุบันแล้ว`);
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

async function toggleEdit(year) {
  if (openYear === year) { openYear = null; archive = null; renderTerms(); return; }
  openYear = year;
  archive = null;
  renderTerms();
  await guard(async () => {
    archive = await fetchArchive(year);
    renderTerms();
  });
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
    const cur = t.closest?.('[data-term-current]');
    if (cur) return void doSetCurrent(Number(cur.dataset.termCurrent));
    const del = t.closest?.('[data-term-delete]');
    if (del) return void doDeleteTerm(Number(del.dataset.termDelete));
    const edit = t.closest?.('[data-term-edit]');
    if (edit) return void toggleEdit(Number(edit.dataset.termEdit));
    if (t.id === 'teamTermAdd') {
      const y = Number($('teamTermNewYear')?.value);
      if (!Number.isFinite(y) || y < 2500 || y > 2700) return statusLine('ปีการศึกษาไม่ถูกต้อง', 'error');
      return void guard(async () => { await createTerm(y); await reloadTerms(); }, `เพิ่มปี ${y} แล้ว`);
    }
    const amDel = t.closest?.('[data-am-delete]');
    if (amDel) return void doDeleteArchiveMember(amDel.dataset.amDelete);
  });

  // `change` rather than `input`: one write per finished edit, not per keystroke.
  host.addEventListener('change', (e) => {
    const t = e.target;
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
    host.innerHTML = '<div class="team-terms"><div class="team-terms-loading">กำลังโหลดปีการศึกษา…</div></div>';
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
