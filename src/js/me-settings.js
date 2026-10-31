// ============================================================
// me-settings.js — the บัญชี rows on /me open their editor IN PLACE.
//
// Settings-style: each row shows its current value (profile.js paints it), and
// a tap opens that row's editor under it. One open at a time — a page of six
// open forms is the modal it replaced, unrolled. Closed panels are `inert`, so
// a keyboard user does not tab into controls they cannot see, and the open one
// is announced through aria-expanded on the row.
//
// The open/close is a CSS grid-rows transition (me.css): it starts from where
// the panel IS, so a second tap mid-animation reverses it rather than waiting.
// ============================================================

function setOpen(set, open) {
  const row = set.querySelector('.me-set-row');
  const panel = set.querySelector('.me-set-panel');
  if (!row || !panel) return;
  set.classList.toggle('is-open', open);
  row.setAttribute('aria-expanded', String(open));
  panel.toggleAttribute('inert', !open);
  // A closed row forgets its last result, so reopening it later does not show
  // "บันทึกแล้ว" for a save from an hour ago.
  if (!open) {
    panel.querySelectorAll('.alert').forEach((el) => { el.className = 'alert small py-2 mt-2 d-none'; el.textContent = ''; });
  }
}

/** Open the row named `key` (data-set), closing the others. */
export function openSetting(key) {
  const root = document.getElementById('meSettings');
  if (!root) return;
  root.querySelectorAll('.me-set[data-set]').forEach((s) => setOpen(s, s.dataset.set === key));
}

export function initMeSettings() {
  const root = document.getElementById('meSettings');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const row = e.target.closest('.me-set-row');
    if (!row || !root.contains(row)) return;
    const set = row.closest('.me-set');
    const willOpen = !set.classList.contains('is-open');
    root.querySelectorAll('.me-set.is-open').forEach((s) => { if (s !== set) setOpen(s, false); });
    setOpen(set, willOpen);
    if (!willOpen) return;
    // Focus the field to edit — on a pointer with a keyboard. On a phone this
    // would throw the keyboard up over the row the person just tapped to READ.
    if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
      const field = set.querySelector('.me-set-panel input:not([disabled]):not([type="hidden"])');
      field?.focus({ preventScroll: true });
    }
  });
  // Esc closes the open row and returns focus to it.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const set = e.target.closest?.('.me-set.is-open');
    if (!set) return;
    setOpen(set, false);
    set.querySelector('.me-set-row')?.focus();
  });
}

/** The old "จัดการบัญชี" entry points on the public site: go to /me's บัญชี. */
export function goToAccountSettings() {
  window.activateTab?.('pills-me-tab');
  requestAnimationFrame(() => {
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('meAccount')?.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  });
}
