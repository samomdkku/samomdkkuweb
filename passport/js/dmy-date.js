// A date field that always READS dd/mm/yyyy.
//
// A native <input type="date"> is drawn in the BROWSER's locale, not the page's:
// an English-US Chrome shows 10/31/2026 and no attribute (`lang` included)
// changes that. So a text box shows and takes dd/mm/yyyy, and the native input
// stays as the one source of truth — every caller keeps reading and writing
// `native.value` as 'YYYY-MM-DD', and listens for 'change' on it as before.
//
// The native input lies, invisible, over the calendar button: tapping it opens
// the platform picker on phones, and a click calls showPicker() on desktops.
// It is detached from its form (`form` → no such id) so its own min/max/required
// never take part in validation: a hidden control that is invalid blocks a
// submit with nothing on screen ("An invalid form control is not focusable").
// The TEXT box carries required/disabled and the min/max checks instead.

const BE_OFFSET = 543;

const pad = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → 'dd/mm/yyyy' ('' for anything else). */
export function isoToDmy(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** 'd/m/yyyy' (also '-' or '.', or 8 digits) → 'YYYY-MM-DD', or null when it
 *  is not a real day. A Buddhist-era year (2569) is read as 2026. */
export function dmyToIso(text) {
    const t = String(text || '').trim();
    const m = t.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/) || t.match(/^(\d{2})(\d{2})(\d{4})$/);
    if (!m) return null;
    const d = Number(m[1]), mo = Number(m[2]);
    let y = Number(m[3]);
    if (y > 2400) y -= BE_OFFSET;
    if (y < 1900 || mo < 1 || mo > 12 || d < 1) return null;
    const probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCMonth() !== mo - 1) return null;      // 31/02 and friends
    return `${y}-${pad(mo)}-${pad(d)}`;
}

const CAL_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></svg>';

export function attachDmy(native) {
    if (!native || native.dataset.dmy) return;
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    native.dataset.dmy = '1';

    const box = document.createElement('div');
    box.className = 'date-dmy';
    const text = document.createElement('input');
    text.type = 'text';
    text.inputMode = 'numeric';
    text.autocomplete = 'off';
    text.placeholder = 'วว/ดด/ปปปป';
    text.id = `${native.id}-text`;
    const pick = document.createElement('span');
    pick.className = 'date-dmy-pick';
    pick.innerHTML = CAL_ICON;

    native.parentNode.insertBefore(box, native);
    box.append(text, pick);
    pick.append(native);
    native.classList.add('date-dmy-native');
    native.tabIndex = -1;
    native.setAttribute('aria-label', 'เลือกวันจากปฏิทิน');
    native.setAttribute('form', '__dmy-none');
    // the visible box is what the label names
    document.querySelectorAll(`label[for="${native.id}"]`).forEach((l) => l.setAttribute('for', text.id));

    const validate = () => {
        const raw = text.value.trim();
        if (!raw) { text.setCustomValidity(''); return; }
        const iso = dmyToIso(raw);
        if (!iso) { text.setCustomValidity('ใส่วันที่แบบ วว/ดด/ปปปป เช่น 31/10/2026'); return; }
        if (native.min && iso < native.min) { text.setCustomValidity(`ต้องไม่ก่อน ${isoToDmy(native.min)}`); return; }
        if (native.max && iso > native.max) { text.setCustomValidity(`ต้องไม่หลัง ${isoToDmy(native.max)}`); return; }
        text.setCustomValidity('');
    };
    const show = () => { text.value = isoToDmy(proto.get.call(native)); validate(); };

    // Code that sets native.value (defaults, loading an activity) is reflected.
    Object.defineProperty(native, 'value', {
        configurable: true,
        get() { return proto.get.call(this); },
        set(v) { proto.set.call(this, v); show(); },
    });

    // Typing: the native follows as soon as the text is a whole, real day.
    const commit = (normalise) => {
        const raw = text.value.trim();
        const iso = raw ? dmyToIso(raw) : '';
        if (iso !== null && iso !== proto.get.call(native)) {
            proto.set.call(native, iso);
            native.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (normalise && iso) text.value = isoToDmy(iso);
        validate();
    };
    text.addEventListener('input', () => commit(false));
    text.addEventListener('blur', () => commit(true));

    native.addEventListener('change', show);                 // the picker
    native.addEventListener('click', () => { try { native.showPicker?.(); } catch { /* phone: the tap itself opens it */ } });

    // required / disabled / min / max are set on the native by the page.
    const mirror = () => {
        text.required = native.required;
        text.disabled = native.disabled;
        validate();
    };
    new MutationObserver(mirror).observe(native, { attributes: true, attributeFilter: ['required', 'disabled', 'min', 'max'] });
    mirror();
    show();
}
