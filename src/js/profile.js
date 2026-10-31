// ==============================================
// PROFILE — Self-service edit for the signed-in user.
//
// Single modal serves every account shape:
//
//   account shape           sections shown
//   ──────────────────────  ─────────────────────────────────────────
//   password-only           name · username (RO) · email · password
//                           (change) · link Google
//   Google-only             name · email (RO, from Google) ·
//                           password (set username + password) ·
//                           Google (linked, no unlink — would lock out)
//   both                    name · username (RO) · email · password
//                           (change) · Google (linked, unlink available)
//
// All mutations go through auth.js so the rules ("can't unlink Google
// without a password", "username uniqueness", etc.) live in one place.
//
// TWO HOMES SINCE 2026-10-31, ONE IMPLEMENTATION. The public site shows these
// controls inline on /me (tab-me.html, rows opened by me-settings.js); admin
// keeps the modal. Both markups carry the SAME element ids, so everything here
// paints and saves either one — profile-markup.test.js fails if they drift.
// On /me the page is always there, so a repaint can land while somebody is
// typing (a token refresh fires onAuthChange): a field the person has edited
// is left alone until it is saved or the account changes (`setField`).
// ==============================================

import {
  getUser, onAuthChange,
  updateDisplayName, updatePhone, updateEmail, unlinkEmail,
  linkGoogleIdentity, unlinkGoogleIdentity,
  setUsernameAndPassword, changePassword,
} from './auth.js';
import { escHtml } from './utils.js';
import { loadMySeat, renderMySeat } from './my-seat.js';

let modalEl = null;
let bsModal = null;
// True on the public site, where the controls live on /me rather than in a modal.
let onPage = false;
let paintedUid = null;

export function initProfileModal() {
  modalEl = document.getElementById('profileModal');
  onPage = !modalEl && !!document.getElementById('meSettings');
  if (!modalEl && !onPage) return;
  if (modalEl) {
    bsModal = window.bootstrap?.Modal.getOrCreateInstance(modalEl);
    modalEl.addEventListener('show.bs.modal', () => repaint({ fresh: true }));
    onAuthChange(() => { if (modalEl.classList.contains('show')) repaint(); });
  } else {
    // Signed out: forget whose values are on the page, so signing back in —
    // even as the same account — repaints every field from scratch.
    onAuthChange((u) => { if (u) repaint(); else paintedUid = null; });
  }

  // -------- Display name --------
  document.getElementById('profileNameSaveBtn')?.addEventListener('click', onSaveName);
  document.getElementById('profileName')?.addEventListener('input', () => {
    const u = getUser(); const btn = document.getElementById('profileNameSaveBtn');
    const input = document.getElementById('profileName');
    if (!u || !btn || !input) return;
    btn.disabled = !input.value.trim() || input.value.trim() === (u.name || '');
  });

  // -------- Phone --------
  document.getElementById('profilePhoneSaveBtn')?.addEventListener('click', onSavePhone);
  document.getElementById('profilePhone')?.addEventListener('input', () => {
    const u = getUser(); const btn = document.getElementById('profilePhoneSaveBtn');
    const input = document.getElementById('profilePhone');
    if (!u || !btn || !input) return;
    btn.disabled = input.value.trim() === (u.phone || '');
  });

  // -------- Email --------
  document.getElementById('profileEmailSaveBtn')?.addEventListener('click', onSaveEmail);
  document.getElementById('profileEmailUnlinkBtn')?.addEventListener('click', onUnlinkEmail);
  document.getElementById('profileEmail')?.addEventListener('input', () => {
    const u = getUser(); const btn = document.getElementById('profileEmailSaveBtn');
    const input = document.getElementById('profileEmail');
    if (!u || !btn || !input) return;
    const v = input.value.trim().toLowerCase();
    btn.disabled = !v || v === (u.email || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  });

  // -------- Password (set or change) --------
  document.getElementById('profilePwSetBtn')?.addEventListener('click', onSetPassword);
  document.getElementById('profilePwChangeToggle')?.addEventListener('click', () => {
    document.getElementById('profilePwChangeForm')?.classList.toggle('d-none');
  });
  document.getElementById('profilePwChangeSaveBtn')?.addEventListener('click', onChangePassword);

  // -------- Google link / unlink --------
  document.getElementById('profileLinkGoogleBtn')?.addEventListener('click', onLinkGoogle);
  document.getElementById('profileUnlinkGoogleBtn')?.addEventListener('click', onUnlinkGoogle);
}

export function openProfileModal() {
  if (!getUser()) return;
  if (onPage) return;
  if (!bsModal) {
    modalEl = document.getElementById('profileModal');
    bsModal = window.bootstrap?.Modal.getOrCreateInstance(modalEl);
  }
  repaint({ fresh: true });
  bsModal?.show();
}

// ==============================================
// Repaint — single source of truth for what the modal shows.
// ==============================================

/** Write a value into an input — unless, on /me, the person has edited it
 *  since the last paint (and it is still the same account). */
function setField(el, v) {
  if (!el) return;
  const dirty = onPage && el.dataset.painted !== undefined && el.value !== el.dataset.painted;
  if (dirty && !forcePaint) return;
  el.value = v;
  el.dataset.painted = v;
}
/** After a save: what is in the field IS the account's value now. */
function settle(el) { if (el) el.dataset.painted = el.value; }
let forcePaint = false;

/** The value each /me row shows beside its title. Absent in the modal. */
function paintSummaries(u) {
  const put = (k, text, muted) => {
    const el = document.querySelector(`[data-set-value="${k}"]`);
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-muted', !!muted);
  };
  put('name', u.name || 'ยังไม่ได้ตั้ง', !u.name);
  put('email', u.email || (u.pendingEmail ? 'รอยืนยัน' : 'ยังไม่มี'), !u.email);
  put('phone', u.phone || 'ยังไม่ได้ใส่', !u.phone);
  put('password', u.hasPassword ? 'ตั้งแล้ว' : 'ยังไม่ได้ตั้ง', !u.hasPassword);
  put('google', u.hasGoogle ? 'เชื่อมแล้ว' : 'ยังไม่เชื่อม', !u.hasGoogle);
}

function repaint({ fresh = false } = {}) {
  const u = getUser();
  if (!u) return;
  // A different account: nothing typed for the previous one survives.
  forcePaint = paintedUid !== u.id;
  paintedUid = u.id;
  paintSummaries(u);

  // -------- ตำแหน่งในทีม SAMO (read-only) --------
  // Async, and the section reveals itself only if there IS a posting — so an
  // ordinary student opening โปรไฟล์ sees no empty "no position" block. Cached
  // in my-seat.js, so re-opening the modal does not re-fetch.
  const seatSection = document.getElementById('profileSeatSection');
  const seatHost = document.getElementById('profileMySeat');
  if (seatSection && seatHost) {
    loadMySeat(u.id).then((seat) => {
      // The user may have closed the modal — or switched account — while this
      // was in flight; re-read the identity before painting.
      if (getUser()?.id !== u.id) return;
      seatSection.hidden = !seat;
      renderMySeat(seatHost, seat, { compact: true });
    });
  }

  // -------- Display name --------
  const nameInput = document.getElementById('profileName');
  if (nameInput) {
    setField(nameInput, u.name || '');
    const btn = document.getElementById('profileNameSaveBtn');
    if (btn) btn.disabled = !nameInput.value.trim() || nameInput.value.trim() === (u.name || '');
  }

  // -------- Phone --------
  const phoneInput = document.getElementById('profilePhone');
  if (phoneInput) {
    setField(phoneInput, u.phone || '');
    const btn = document.getElementById('profilePhoneSaveBtn');
    if (btn) btn.disabled = phoneInput.value.trim() === (u.phone || '');
  }

  // -------- Username read-only --------
  const usernameRow = document.getElementById('profileUsernameSection');
  const usernameEl = document.getElementById('profileUsername');
  if (u.username && usernameRow && usernameEl) {
    usernameRow.classList.remove('d-none');
    // An <input> in the modal, a text row on /me.
    if (usernameEl.tagName === 'INPUT') usernameEl.value = u.username;
    else usernameEl.textContent = u.username;
  } else if (usernameRow) {
    usernameRow.classList.add('d-none');
  }

  // -------- Email --------
  // Google-only users: email is owned by Google, disable editing.
  // Password users with a real email AND username AND password:
  // expose "ลบอีเมลออกจากบัญชี" (revert to synthetic).
  const emailInput  = document.getElementById('profileEmail');
  const emailBadges = document.getElementById('profileEmailBadges');
  const emailHelp   = document.getElementById('profileEmailHelp');
  const emailSave   = document.getElementById('profileEmailSaveBtn');
  const emailUnlinkRow = document.getElementById('profileEmailUnlinkRow');
  const googleOwned = u.hasGoogle && !u.hasPassword;
  if (emailInput) {
    setField(emailInput, u.email || '');
    emailInput.disabled = googleOwned;
  }
  if (emailSave) {
    const v = (emailInput?.value || '').trim().toLowerCase();
    emailSave.disabled = !v || v === (u.email || '') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
    emailSave.classList.toggle('d-none', googleOwned);
  }
  if (emailHelp) {
    emailHelp.textContent = googleOwned
      ? 'อีเมลนี้มาจากบัญชี Google — เปลี่ยนได้โดยเปลี่ยนบัญชี Google ที่เชื่อมต่อ'
      : 'อีเมลใช้สำหรับติดต่อกลับและสำหรับเชื่อมเข้ากับบัญชี Google';
  }
  if (emailUnlinkRow) {
    // Show "remove email" only if: there's a real email, there's a
    // username to revert to, and there's a password identity (so the
    // user still has a way to sign in).
    const canUnlinkEmail = !!u.email && !!u.username && u.hasPassword;
    emailUnlinkRow.classList.toggle('d-none', !canUnlinkEmail);
  }

  // Badges
  if (emailBadges) {
    const badges = [];
    const googleVerifies = u.email && u.hasGoogle &&
      (u.googleEmail || '').toLowerCase() === u.email.toLowerCase();
    if (googleVerifies) {
      badges.push(`<span class="badge bg-success-subtle text-success border border-success-subtle">
        <i class="bi bi-check-circle me-1"></i>ยืนยันแล้วผ่าน Google</span>`);
    } else if (u.email) {
      badges.push(`<span class="badge bg-secondary-subtle text-secondary border">
        <i class="bi bi-envelope me-1"></i>บันทึกแล้ว</span>`);
    }
    if (u.pendingEmail) {
      badges.push(`<span class="badge bg-info-subtle text-info border border-info-subtle">
        <i class="bi bi-envelope-exclamation me-1"></i>รอยืนยัน: ${escHtml(u.pendingEmail)}</span>`);
    }
    if (!u.email && !u.pendingEmail) {
      badges.push(`<span class="badge bg-secondary-subtle text-secondary border">
        <i class="bi bi-info-circle me-1"></i>ยังไม่มีอีเมล</span>`);
    }
    emailBadges.innerHTML = badges.join(' ');
  }

  // -------- Password section --------
  const pwSet    = document.getElementById('profilePwSetBlock');
  const pwExists = document.getElementById('profilePwExistsBlock');
  const pwUserRow = document.getElementById('profilePwUsernameRow');
  if (u.hasPassword) {
    pwSet?.classList.add('d-none');
    pwExists?.classList.remove('d-none');
    document.getElementById('profilePwUsernameHint')?.replaceChildren(
      document.createTextNode(u.username || u.email || ''));
    // Reset change form so reopening doesn't carry stale input.
    const f = document.getElementById('profilePwChangeForm');
    const typing = onPage && !forcePaint && ['profilePwChangeNew', 'profilePwChangeConfirm']
      .some((id) => document.getElementById(id)?.value);
    if (!typing) {
      if (f) f.classList.add('d-none');
      ['profilePwChangeNew', 'profilePwChangeConfirm']
        .forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
    }
  } else {
    pwSet?.classList.remove('d-none');
    pwExists?.classList.add('d-none');
    // Show the username input only if the user doesn't already have one
    // (i.e. Google-only). Password users always have a username already.
    if (pwUserRow) pwUserRow.classList.toggle('d-none', !!u.username);
    const ids = ['profilePwUsername', 'profilePwNew', 'profilePwConfirm'];
    const typing = onPage && !forcePaint && ids.some((id) => document.getElementById(id)?.value);
    if (!typing) ids.forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  }

  // -------- Google card --------
  const gStatus = document.getElementById('profileGoogleStatusText');
  const gSub    = document.getElementById('profileGoogleStatusSub');
  const gLink   = document.getElementById('profileLinkGoogleBtn');
  const gUnlink = document.getElementById('profileUnlinkGoogleBtn');
  if (gStatus && gLink && gUnlink) {
    if (u.hasGoogle) {
      gStatus.textContent = 'เชื่อมต่อแล้ว';
      if (gSub) gSub.textContent = u.googleEmail || '';
      gLink.classList.add('d-none');
      // Allow unlink only when BOTH conditions hold:
      //   - identities.length >= 2 (Supabase's hard rule — see the docs
      //     "must have at least 2 identities to unlink" and the server
      //     error code `single_identity_not_deletable`)
      //   - hasPassword=true (UX rule — so the user keeps a way in)
      // Either alone is insufficient: a Google-only user who set a
      // password via updateUser({password}) may have hasPassword=true
      // but identities=[google] only.
      const identityCount = Array.isArray(u.identities) ? u.identities.length : 0;
      const canUnlink = u.hasPassword && identityCount >= 2;
      gUnlink.classList.toggle('d-none', !canUnlink);
    } else {
      gStatus.textContent = 'ยังไม่ได้เชื่อมต่อ';
      if (gSub) {
        gSub.textContent = u.email
          ? `กด "เชื่อมต่อ" แล้วเข้าสู่ระบบ Google ด้วย ${u.email}`
          : 'เพิ่มอีเมลก่อน แล้วจึงเชื่อม Google ที่ใช้อีเมลเดียวกัน';
      }
      gLink.classList.remove('d-none');
      gLink.disabled = !u.email;
      gLink.innerHTML = '<i class="bi bi-link-45deg me-1"></i>เชื่อมต่อ';
      gUnlink.classList.add('d-none');
    }
  }

  // Clear stale alerts — when the form is opened fresh or the account changed,
  // NOT on every repaint: a save refreshes the account more than once, and a
  // later repaint used to erase the "บันทึกแล้ว" the save had just shown.
  if (!fresh && !forcePaint) return;
  ['profileNameAlert', 'profilePhoneAlert', 'profileEmailAlert', 'profilePwAlert', 'profileGoogleAlert']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) { el.className = 'alert small py-2 mt-2 d-none'; el.textContent = ''; }
    });
}

// ==============================================
// Action handlers — each spins its button, calls auth.js, posts
// success/danger to its alert pane. State is re-published by
// refreshCurrentUser() which fires onAuthChange → repaint.
// ==============================================

function showAlert(id, text, kind = 'danger') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${kind} small py-2 mt-2`;
  el.textContent = text;
}

function spin(btn) {
  if (!btn) return () => {};
  const original = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  return () => { btn.innerHTML = original; btn.disabled = wasDisabled; };
}

async function onSaveName() {
  const input = document.getElementById('profileName');
  const stop = spin(document.getElementById('profileNameSaveBtn'));
  try {
    await updateDisplayName(input?.value || '');
    settle(input);
    showAlert('profileNameAlert', 'บันทึกชื่อแล้ว', 'success');
  } catch (e) {
    showAlert('profileNameAlert', e.message || 'อัปเดตชื่อไม่สำเร็จ');
  } finally { stop(); }
}

async function onSavePhone() {
  const input = document.getElementById('profilePhone');
  const stop = spin(document.getElementById('profilePhoneSaveBtn'));
  try {
    await updatePhone(input?.value || '');
    settle(input);
    showAlert('profilePhoneAlert', 'บันทึกเบอร์โทรศัพท์แล้ว', 'success');
  } catch (e) {
    showAlert('profilePhoneAlert', e.message || 'บันทึกเบอร์โทรศัพท์ไม่สำเร็จ');
  } finally { stop(); }
}

async function onSaveEmail() {
  const input = document.getElementById('profileEmail');
  const stop = spin(document.getElementById('profileEmailSaveBtn'));
  try {
    await updateEmail(input?.value || '');
    settle(input);
    const u = getUser();
    const sent = !!u?.pendingEmail;
    showAlert('profileEmailAlert',
      sent
        ? `ส่งลิงก์ยืนยันไปที่ ${input.value.trim()} แล้ว — เปิดอีเมลแล้วคลิกลิงก์`
        : 'บันทึกอีเมลแล้ว',
      'success');
  } catch (e) {
    showAlert('profileEmailAlert', e.message || 'บันทึกอีเมลไม่สำเร็จ');
  } finally { stop(); }
}

async function onUnlinkEmail() {
  if (!confirm('ลบอีเมลออกจากบัญชี? จะใช้เฉพาะ username/password เข้าสู่ระบบเท่านั้น')) return;
  const stop = spin(document.getElementById('profileEmailUnlinkBtn'));
  try {
    await unlinkEmail();
    showAlert('profileEmailAlert', 'ลบอีเมลออกจากบัญชีแล้ว', 'success');
  } catch (e) {
    showAlert('profileEmailAlert', e.message || 'ลบอีเมลไม่สำเร็จ');
  } finally { stop(); }
}

async function onSetPassword() {
  const u = getUser();
  const usernameEl = document.getElementById('profilePwUsername');
  const newEl      = document.getElementById('profilePwNew');
  const confirmEl  = document.getElementById('profilePwConfirm');
  if (!newEl || !confirmEl) return;
  if ((newEl.value || '') !== (confirmEl.value || '')) {
    showAlert('profilePwAlert', 'รหัสผ่านยืนยันไม่ตรงกัน');
    return;
  }
  const username = u.username || (usernameEl?.value || '');
  const stop = spin(document.getElementById('profilePwSetBtn'));
  try {
    await setUsernameAndPassword(username, newEl.value);
    [usernameEl, newEl, confirmEl].forEach((el) => { if (el) el.value = ''; });
    showAlert('profilePwAlert',
      u.username
        ? 'ตั้งรหัสผ่านแล้ว — เข้าสู่ระบบด้วย username/password ได้แล้ว'
        : `ตั้ง username + รหัสผ่านแล้ว — เข้าสู่ระบบด้วย ${username} + รหัสผ่าน ได้แล้ว`,
      'success');
  } catch (e) {
    showAlert('profilePwAlert', e.message || 'ตั้งรหัสผ่านไม่สำเร็จ');
  } finally { stop(); }
}

async function onChangePassword() {
  const newEl      = document.getElementById('profilePwChangeNew');
  const confirmEl  = document.getElementById('profilePwChangeConfirm');
  if (!newEl || !confirmEl) return;
  if ((newEl.value || '') !== (confirmEl.value || '')) {
    showAlert('profilePwAlert', 'รหัสผ่านยืนยันไม่ตรงกัน');
    return;
  }
  const stop = spin(document.getElementById('profilePwChangeSaveBtn'));
  try {
    await changePassword(newEl.value);
    newEl.value = ''; confirmEl.value = '';
    document.getElementById('profilePwChangeForm')?.classList.add('d-none');
    showAlert('profilePwAlert', 'เปลี่ยนรหัสผ่านแล้ว', 'success');
  } catch (e) {
    showAlert('profilePwAlert', e.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
  } finally { stop(); }
}

async function onLinkGoogle() {
  const stop = spin(document.getElementById('profileLinkGoogleBtn'));
  try {
    await linkGoogleIdentity();
    // OAuth redirect happens — no success path here.
  } catch (e) {
    showAlert('profileGoogleAlert', e.message || 'เริ่มเชื่อม Google ไม่สำเร็จ');
    stop();
  }
}

async function onUnlinkGoogle() {
  if (!confirm('ยกเลิกการเชื่อม Google? คุณจะเข้าสู่ระบบได้ผ่าน username/password เท่านั้น')) return;
  const stop = spin(document.getElementById('profileUnlinkGoogleBtn'));
  try {
    await unlinkGoogleIdentity();
    showAlert('profileGoogleAlert', 'ยกเลิกการเชื่อม Google แล้ว', 'success');
  } catch (e) {
    showAlert('profileGoogleAlert', e.message || 'ยกเลิกการเชื่อมไม่สำเร็จ');
  } finally { stop(); }
}
