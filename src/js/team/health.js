// ==============================================
// TEAM HEALTH — the ตรวจสอบข้อมูล pane (mode 'health').
//
// WHY THIS EXISTS AS A SCREEN AND NOT A SCRIPT: a person is currently stored
// once per ตำแหน่ง, so 403 rows describe ~285 humans, and each copy carries its
// own ชื่อเล่น / ชั้นปี / รูป / kkumail with nothing keeping them in step. They
// have already drifted for 9 people. A one-off cleanup would fix today and be
// wrong again after the next CSV import — so the ambiguity is surfaced
// continuously, computed live from the data that is already in memory.
//
// THE RESOLUTION RULE. This is implemented TWICE — here in JS and in SQL in
// tools/team-identity-dryrun.mjs — which this repo has been bitten by before
// ("two implementations of one rule drift silently"). Both key on the same
// email-first `person_key`, and as of 2026-08-01 they agree on the live data:
// 1 invalid_email · 2 sid_clash · 0 sid_drift · 11 drift (across 9 people) ·
// 10 no_key = 24. Re-run the tool after changing either; if they disagree, the
// tool is the reference because it sees every row without a client in between.
//   1. rows sharing a valid kkumail        → one person
//   2. rows with NO kkumail sharing a รหัส → one person
//   3. anything else                        → its own person
// NEVER on name. `673070332-6` in the live data is one mistyped รหัสนักศึกษา
// shared by two humans whose emails are correct and distinct — merging on รหัส
// would fuse two people irreversibly once สิทธิ์ flowed through the joined row.
// Name matches are offered as a SUGGESTION the admin clicks, never applied.
//
// WHO IS MEANT TO FIX THESE: mostly not the admin. An admin cannot know whether
// วรวลัญช์'s ชื่อเล่น is ปรายฟ้า or ปลายฟ้า. The durable answer is the person's
// own profile page, where they pick in one click. This pane is the half that
// works today, and the half that will always be needed for rows belonging to
// people who never sign in.
// ==============================================

import { escHtml } from '../utils.js';
import { updateMember } from './api.js';
// The rules themselves are pure and shared with the public ตำแหน่งของฉัน card;
// re-exported so every existing importer of health.js keeps working.
import {
  IDENTITY_FIELDS, findIssues, idsOf, issuesByMember, issueCount,
} from './identity.js';
export { IDENTITY_FIELDS, findIssues, idsOf, issuesByMember, issueCount };
import { askConfirm } from '../confirm-modal.js';

const $ = (id) => document.getElementById(id);

// ── pure: find everything worth a human's attention ─────────────────────────


/** Order the pane renders in: cheapest and most certain first, so the admin
 *  clears the mechanical ones before reaching the judgement calls. */
const GROUPS = [
  {
    kind: 'invalid_email',
    title: 'อีเมลไม่ถูกต้อง',
    blurb: 'ค่านี้ไม่ใช่อีเมล จึงใช้จับคู่ตอนเข้าสู่ระบบไม่ได้ — และทำให้คนคนเดียวถูกนับเป็นสองคน',
  },
  {
    kind: 'sid_clash',
    title: 'รหัสนักศึกษาซ้ำกันระหว่างคนละคน',
    blurb: 'สองคนนี้ถือรหัสนักศึกษาเดียวกัน แปลว่ามีคนหนึ่งถูกกรอกผิด — ระบบไม่รวมทั้งสองเข้าด้วยกัน เพราะอีเมลต่างกัน',
  },
  {
    kind: 'sid_drift',
    title: 'คนเดียวกันแต่รหัสนักศึกษาไม่ตรงกัน',
    blurb: 'อีเมลเดียวกันจึงเป็นคนเดียวกัน แต่รหัสในแต่ละแถวไม่ตรงกัน',
  },
  {
    kind: 'drift',
    title: 'ข้อมูลของคนเดียวกันไม่ตรงกัน',
    blurb: 'คนคนนี้อยู่หลายตำแหน่ง และแต่ละแถวเก็บข้อมูลคนละค่า เลือกค่าที่ถูกต้อง แล้วระบบจะเขียนให้ทุกแถว',
  },
  {
    kind: 'mail_gap',
    title: 'ตำแหน่งนี้ยังไม่มีอีเมล',
    blurb: 'คนคนนี้มีอีเมลอยู่แล้วในตำแหน่งอื่น แต่แถวนี้ยังว่าง — ทุกการจับคู่สิทธิ์และการ์ด '
      + '“ตำแหน่งของฉัน” ใช้อีเมลเป็นตัวจับ แถวนี้จึงยังมองไม่เห็นจากฝั่งเจ้าตัว '
      + 'อันนี้แก้ได้ทันทีเพราะรู้คำตอบอยู่แล้ว',
  },
  {
    kind: 'no_key',
    title: 'ไม่มีอีเมลและรหัสนักศึกษา',
    blurb: 'แถวนี้ไม่มีอะไรให้จับคู่กับบัญชีผู้ใช้ เจ้าตัวจึงยืนยันตัวตนเองไม่ได้',
  },
];

// ── pane ────────────────────────────────────────────────────────────────────

let host = null;
// Arriving from a flag in จัดการทีม, this is the set of member ids the admin
// just clicked on and the label to name them by. Without it the pane opens at
// the top of 24 findings and the person has to be found again — the click
// already said who; the pane should not make them remember.
let focusIds = null;
let focusLabel = '';
let getData = null;
let onChanged = null;
let chain = Promise.resolve();

function status(msg, kind = '') {
  const el = $('teamHealthStatus');
  if (el) {
    el.textContent = msg || '';
    el.className = `team-health-status${kind ? ` is-${kind}` : ''}`;
  }
}

/**
 * Serialise writes instead of dropping them. An `if (busy) return` would
 * silently discard the second of two quick clicks — and each click here carries
 * a different decision, so dropping one is data loss that reports success.
 */
function run(fn, okMsg) {
  chain = chain.then(async () => {
    try {
      await fn();
      await onChanged?.();
      // AFTER the repaint, not before: renderHealth() replaces host.innerHTML,
      // which recreates #teamHealthStatus empty. Setting it first meant every
      // SUCCESS was silently wiped while every FAILURE showed — the exact
      // inverse of what the user needs.
      renderHealth();
      if (okMsg) status(okMsg, 'ok');
    } catch (e) {
      status(e?.message || 'บันทึกไม่สำเร็จ', 'error');
    }
  });
  return chain;
}

const chip = (text, cls = '') =>
  `<span class="team-health-chip${cls ? ` ${cls}` : ''}">${escHtml(text)}</span>`;

function valueLabel(field, value) {
  if (field !== 'photo_url') return value;
  return 'รูปที่ ' + String(value).slice(-6);
}

/** Exported for tests: the markup is a pure function of the finding, so the
 *  action attributes it emits can be checked against the click handler without
 *  a DOM. An attribute with no matching branch is a dead button. */
export function issueCard(is) {
  if (is.kind === 'invalid_email') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who">
          <strong>${escHtml(is.name || '(ไม่มีชื่อ)')}</strong>
          ${is.node ? chip(is.node) : ''}
        </div>
        <div class="team-health-detail">ค่าปัจจุบัน: <code>${escHtml(is.value)}</code></div>
        <div class="team-health-acts">
          <input type="email" class="form-control form-control-sm" data-hmail="${escHtml(is.memberId)}"
            placeholder="name@kkumail.com" aria-label="อีเมลที่ถูกต้อง" />
          <button type="button" class="btn btn-sm btn-primary" data-hsavemail="${escHtml(is.memberId)}">บันทึกอีเมล</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-hclearmail="${escHtml(is.memberId)}">ล้างค่าทิ้ง</button>
        </div>
      </li>`;
  }

  if (is.kind === 'drift') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who">
          <strong>${escHtml(is.name)}</strong>
          ${chip(is.fieldLabel, 'is-field')}
        </div>
        <div class="team-health-detail">เลือกค่าที่ถูกต้อง — จะเขียนทับให้ทุกตำแหน่งของคนนี้</div>
        <div class="team-health-acts">
          ${is.values.map((v) => `
            <button type="button" class="btn btn-sm btn-outline-primary"
              data-hpick="${escHtml(is.id)}" data-hfield="${escHtml(is.field)}"
              data-hvalue="${escHtml(v.value)}"
              data-hids="${escHtml(is.memberIds.join(','))}">
              ${escHtml(valueLabel(is.field, v.value))}
            </button>`).join('')}
        </div>
      </li>`;
  }

  if (is.kind === 'sid_drift') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who"><strong>${escHtml(is.name)}</strong></div>
        <div class="team-health-detail">เลือกรหัสที่ถูกต้อง — จะเขียนให้ทุกตำแหน่งของคนนี้</div>
        <div class="team-health-acts">
          ${is.values.map((v) => `
            <button type="button" class="btn btn-sm btn-outline-primary"
              data-hpick="${escHtml(is.id)}" data-hfield="student_id"
              data-hvalue="${escHtml(v)}" data-hids="${escHtml(is.memberIds.join(','))}">
              ${escHtml(v)}
            </button>`).join('')}
        </div>
      </li>`;
  }

  if (is.kind === 'sid_clash') {
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who">
          <strong>รหัส ${escHtml(is.sid)}</strong>
          ${chip(`${is.people.length} คน`, 'is-warn')}
        </div>
        <div class="team-health-detail">แก้รหัสของคนที่กรอกผิด — ปล่อยอีกคนไว้ตามเดิม</div>
        ${is.people.map((p) => `
          <div class="team-health-sub">
            <div class="team-health-who">
              <span>${escHtml(p.name)}</span>
              ${p.email ? chip(p.email) : chip('ไม่มีอีเมล', 'is-warn')}
              ${p.nodes.slice(0, 2).map((x) => chip(x)).join('')}
            </div>
            <div class="team-health-acts">
              <input type="text" class="form-control form-control-sm" data-hsid="${escHtml(p.key)}"
                placeholder="รหัสนักศึกษาที่ถูกต้อง" aria-label="รหัสนักศึกษาของ ${escHtml(p.name)}" />
              <button type="button" class="btn btn-sm btn-primary"
                data-hsavesid="${escHtml(p.key)}" data-hids="${escHtml(p.memberIds.join(','))}">บันทึก</button>
            </div>
          </div>`).join('')}
      </li>`;
  }

  if (is.kind === 'mail_gap') {
    // The one finding here with an OBVIOUSLY correct answer, so it gets a
    // one-click apply rather than an input box. The address is not guessed: it
    // is the one this person's other postings already carry, which is what made
    // them one person in the first place (identity.js rule 2).
    return `
      <li class="team-health-item" data-hi="${escHtml(is.id)}">
        <div class="team-health-who">
          <strong>${escHtml(is.name || '(ไม่มีชื่อ)')}</strong>
          ${is.node ? chip(is.node) : ''}
          ${chip('ไม่มีอีเมล', 'is-warn')}
        </div>
        <div class="team-health-detail">
          ตำแหน่งอื่นของคนนี้ใช้ <code>${escHtml(is.value)}</code>
        </div>
        <div class="team-health-acts">
          <button type="button" class="btn btn-sm btn-primary"
            data-hfillmail="${escHtml(is.memberId)}" data-hfillvalue="${escHtml(is.value)}">
            ใช้อีเมลนี้กับตำแหน่งนี้
          </button>
        </div>
      </li>`;
  }

  // no_key. ⚠️ This is also the FALLBACK for an unrecognised kind, so it must
  // not assume a shape only no_key has — `is.suggestions.length` on a finding
  // without the field is a crash inside a render, i.e. a blank pane. A new kind
  // added above without a branch here lands on this one.
  const suggestions = Array.isArray(is.suggestions) ? is.suggestions : [];
  return `
    <li class="team-health-item" data-hi="${escHtml(is.id)}">
      <div class="team-health-who">
        <strong>${escHtml(is.name || '(ไม่มีชื่อ)')}</strong>
        ${is.node ? chip(is.node) : ''}
      </div>
      ${suggestions.length ? `
        <div class="team-health-detail">
          มีคนชื่อเดียวกันที่มีอีเมลอยู่แล้ว — ถ้าเป็นคนเดียวกัน กดเพื่อใช้ข้อมูลเดียวกัน
          <span class="team-health-warn">ชื่อไม่ใช่หลักฐาน ระบบจะไม่รวมให้เอง</span>
        </div>
        <div class="team-health-acts">
          ${suggestions.map((s) => `
            <button type="button" class="btn btn-sm btn-outline-primary"
              data-hlink="${escHtml(is.memberId)}"
              data-hlinkmail="${escHtml(s.email || '')}"
              data-hlinksid="${escHtml(s.sid || '')}"
              data-hlinkname="${escHtml(s.name)}">
              เป็นคนเดียวกับ ${escHtml(s.name)}${s.nodes[0] ? ` (${escHtml(s.nodes[0])})` : ''}
            </button>`).join('')}
        </div>` : ''}
      <div class="team-health-acts">
        <input type="email" class="form-control form-control-sm" data-hnkmail="${escHtml(is.memberId)}"
          placeholder="kkumail" aria-label="อีเมล" />
        <input type="text" class="form-control form-control-sm" data-hnksid="${escHtml(is.memberId)}"
          placeholder="รหัสนักศึกษา" aria-label="รหัสนักศึกษา" />
        <button type="button" class="btn btn-sm btn-primary" data-hsavenk="${escHtml(is.memberId)}">บันทึก</button>
      </div>
    </li>`;
}

export function renderHealth() {
  if (!host) return;
  const { members, nodeName, loaded } = getData?.() || { members: [], nodeName: () => '' };
  // "ข้อมูลครบถ้วน" over an empty array is a LIE, not an empty state: before the
  // tree has loaded there are zero members and therefore zero findings. Say so.
  if (!loaded) {
    host.innerHTML = '<div class="team-health"><div class="team-health-clear">'
      + '<p>กำลังโหลดข้อมูล…</p></div></div>';
    return;
  }
  const { people, issues: all } = findIssues(members, nodeName);

  const issues = focusIds
    ? all.filter((i) => idsOf(i).some((id) => focusIds.has(id)))
    : all;

  const groups = GROUPS
    .map((g) => ({ ...g, items: issues.filter((i) => i.kind === g.kind) }))
    .filter((g) => g.items.length);

  host.innerHTML = `
    <div class="team-health">
      <div class="team-health-head">
        <div>
          <h6 class="team-health-title">ตรวจสอบข้อมูล</h6>
          <p class="team-health-sum">
            ${members.length} แถว · ${people.length} คน ·
            ${issues.length ? `<strong>${issues.length} รายการที่ควรตรวจสอบ</strong>` : 'ไม่พบปัญหา'}
          </p>
        </div>
      </div>
      ${focusIds ? `
        <div class="team-health-focus">
          <span><i class="bi bi-funnel-fill"></i>
            แสดงเฉพาะ <strong>${escHtml(focusLabel)}</strong>
            ${issues.length ? `· ${issues.length} รายการ` : '· แก้ครบแล้ว'}</span>
          <button type="button" class="btn btn-sm btn-outline-secondary ms-auto" data-hshowall="1">
            ดูทั้งหมด (${all.length})
          </button>
        </div>` : ''}
      <div class="team-health-status" id="teamHealthStatus"></div>
      ${groups.length ? groups.map((g) => `
        <section class="team-health-group">
          <header>
            <h6>${escHtml(g.title)} <span class="team-health-count">${g.items.length}</span></h6>
            <p>${escHtml(g.blurb)}</p>
          </header>
          <ul class="team-health-list">${g.items.map(issueCard).join('')}</ul>
        </section>`).join('') : `
        <div class="team-health-clear">
          <i class="bi bi-check2-circle"></i>
          <p>${focusIds
            ? `ไม่มีรายการที่ต้องตรวจสอบสำหรับ ${escHtml(focusLabel)} แล้ว`
            : 'ข้อมูลครบถ้วน ไม่มีรายการที่ต้องตรวจสอบ'}</p>
        </div>`}
      <p class="team-health-foot">
        รายการนี้คำนวณสดจากข้อมูลจริงทุกครั้งที่เปิด — การนำเข้าครั้งต่อไปที่ทำให้ข้อมูลไม่ตรงกัน จะขึ้นที่นี่เอง
      </p>
    </div>`;
}

/** Write one field to EVERY row of a person, which is the whole point: the
 *  drift exists because the rows are separate copies. */
function setOnAll(ids, field, value) {
  return Promise.all(ids.map((id) => updateMember(id, { [field]: value })));
}

export function initHealth(hostEl, opts = {}) {
  host = hostEl;
  getData = opts.getData;
  onChanged = opts.onChanged;
  if (!host) return;

  host.addEventListener('click', (e) => {
    const t = e.target.closest?.('button');
    // No `busy` guard. run() already serialises through a promise chain, and
    // every handler below reads its input values SYNCHRONOUSLY here, so a click
    // that lands mid-write carries the right data and simply queues. Dropping it
    // would be the antipattern the run() comment exists to warn against — which
    // an earlier version of this very function committed.
    if (!t) return;

    if (t.dataset.hshowall !== undefined) {
      focusIds = null; focusLabel = '';
      return void renderHealth();
    }

    if (t.dataset.hpick !== undefined) {
      const ids = t.dataset.hids.split(',').filter(Boolean);
      const field = t.dataset.hfield;
      const value = t.dataset.hvalue;
      return void run(() => setOnAll(ids, field, value), `ตั้งเป็น “${value}” ให้ทุกตำแหน่งแล้ว`);
    }

    if (t.dataset.hfillmail !== undefined) {
      const id = t.dataset.hfillmail;
      const v = t.dataset.hfillvalue;
      if (!v || !v.includes('@')) return void status('ไม่พบอีเมลที่จะใช้', 'error');
      return void run(() => updateMember(id, { kkumail: v }), 'ใส่อีเมลให้ตำแหน่งนี้แล้ว');
    }

    if (t.dataset.hclearmail !== undefined) {
      const id = t.dataset.hclearmail;
      return void run(() => updateMember(id, { kkumail: null }), 'ล้างค่าแล้ว');
    }

    if (t.dataset.hsavemail !== undefined) {
      const id = t.dataset.hsavemail;
      const v = host.querySelector(`[data-hmail="${CSS.escape(id)}"]`)?.value.trim();
      if (!v || !v.includes('@')) return void status('กรอกอีเมลให้ถูกต้องก่อน', 'error');
      return void run(() => updateMember(id, { kkumail: v }), 'บันทึกอีเมลแล้ว');
    }

    if (t.dataset.hsavesid !== undefined) {
      const key = t.dataset.hsavesid;
      const ids = t.dataset.hids.split(',').filter(Boolean);
      const v = host.querySelector(`[data-hsid="${CSS.escape(key)}"]`)?.value.trim();
      if (!v) return void status('กรอกรหัสนักศึกษาก่อน', 'error');
      return void run(() => setOnAll(ids, 'student_id', v), 'บันทึกรหัสแล้ว');
    }

    if (t.dataset.hsavenk !== undefined) {
      const id = t.dataset.hsavenk;
      const mail = host.querySelector(`[data-hnkmail="${CSS.escape(id)}"]`)?.value.trim();
      const sid = host.querySelector(`[data-hnksid="${CSS.escape(id)}"]`)?.value.trim();
      if (!mail && !sid) return void status('กรอกอีเมลหรือรหัสนักศึกษาอย่างน้อยหนึ่งอย่าง', 'error');
      if (mail && !mail.includes('@')) return void status('อีเมลไม่ถูกต้อง', 'error');
      const patch = {};
      if (mail) patch.kkumail = mail;
      if (sid) patch.student_id = sid;
      return void run(() => updateMember(id, patch), 'บันทึกแล้ว');
    }

    if (t.dataset.hlink !== undefined) {
      const id = t.dataset.hlink;
      const mail = t.dataset.hlinkmail || '';
      const sid = t.dataset.hlinksid || '';
      const who = t.dataset.hlinkname;
      // The one action here that can be WRONG in a way the data cannot catch —
      // it is driven by a name match. Say what it does before doing it. Linking
      // an email also hands over whatever สิทธิ์ that person's ตำแหน่ง carry,
      // which is why this is never automatic.
      // askConfirm, NOT window.confirm. Chrome's "prevent this page from
      // creating additional dialogs" makes every later native confirm return
      // false instantly and for the rest of the page's life, so the button
      // silently does nothing — shipped twice here already, and an admin
      // session reaches that checkbox faster than anyone else's.
      const patch = {};
      if (mail) patch.kkumail = mail;
      if (sid) patch.student_id = sid;
      if (!Object.keys(patch).length) return void status('คนที่เลือกไม่มีอีเมลหรือรหัสให้ใช้', 'error');
      return void (async () => {
        const ok = await askConfirm({
          title: `ยืนยันว่าแถวนี้คือ “${who}” คนเดียวกัน?`,
          body: 'ตำแหน่งนี้จะถูกย้ายไปอยู่กับคนคนนั้น และจะใช้ชื่อ ชื่อเล่น รหัสนักศึกษา '
            + 'และรูปเดียวกัน — รวมถึงสิทธิ์ที่ตำแหน่งนั้นมีด้วย '
            + 'หากเป็นคนละคน ให้กดยกเลิกแล้วกรอกข้อมูลเองด้านล่าง',
          yes: 'ใช่ คนเดียวกัน',
          danger: false,
        });
        if (!ok) return;
        run(() => updateMember(id, patch), `รวมกับ ${who} แล้ว`);
      })();
    }
  });
}

/**
 * Cold entry — render immediately from what index.js already has in memory.
 *
 * `focus` is `{ ids, label }` when the admin arrived by clicking a ต้องตรวจสอบ
 * flag, and null when they used the mode button. Passing null CLEARS a previous
 * focus: coming back via the tab must not silently keep showing one person's
 * subset, which would read as "everything else is fixed".
 */
export function enterHealth(focus = null) {
  focusIds = focus?.ids?.length ? new Set(focus.ids) : null;
  focusLabel = focus?.label || '';
  status('');
  renderHealth();
}

/** Short Thai label per finding kind, for the flag on a tree row. Deliberately
 *  states the PROBLEM, not the kind — "ตรวจสอบข้อมูล" on a row tells nobody
 *  what is wrong with it. */
