// ==============================================
// SHOP QR — Customer order QR + admin scanner
//
// Two surfaces:
//
//   (a) showOrderQrModal(order)
//       Customer-side. Renders the order id as a QR (deep link to the
//       admin order page) so the user can show it to admin when picking
//       up. The deep link is a full HTTPS URL — works with LINE,
//       iOS camera, Google Lens, and the in-app admin scanner.
//
//   (b) openScannerModal(onResult)
//       Admin-side. Mounts a camera viewfinder via html5-qrcode. On a
//       successful scan, extracts the order id from the URL (or accepts
//       a raw id), tears down the camera, and calls onResult(id).
//       Manual entry input below the viewfinder works when the camera
//       is denied / unavailable.
//
// LINE edge case worth knowing: LINE's in-app QR scanner opens links in
// its own webview, which does NOT share auth cookies with regular Chrome
// / Safari. The customer-visible QR is for admin's phone (or LINE) to
// scan — the admin themselves is expected to be signed in already in
// their normal browser. So we always encode an HTTPS URL (universal),
// not a custom scheme; and our admin scanner extracts the id and routes
// internally instead of redirecting (no auth handshake needed).
// ==============================================

import QRCode from 'qrcode';
import { Html5Qrcode } from 'html5-qrcode';
import { copyText, escHtml } from '../utils.js';
import { showShopToast } from './products.js';

const ADMIN_SCAN_BASE = '/admin/?scan=';

/** Build the URL that the QR encodes. Uses the current origin so a
 *  preview deploy stays scoped to itself; production lands on the real
 *  admin URL. */
export function orderDeepLink(orderId) {
  if (!orderId) return '';
  const origin = window.location.origin;
  return `${origin}${ADMIN_SCAN_BASE}${encodeURIComponent(orderId)}`;
}

/** Pull an order id out of whatever the camera or input gave us.
 *  Accepts:
 *    - the bare id ("SH0042")
 *    - the full URL ("https://.../admin/?scan=SH0042")
 *    - any URL with a ?scan= param (defensive against future paths)
 *  Returns the id, or '' if nothing usable was found. */
export function parseScannedText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  // URL form
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      const fromQuery = u.searchParams.get('scan');
      if (fromQuery) return fromQuery.trim();
    } catch { /* fall through */ }
  }
  // Raw id form — order ids in this app are alnum + maybe a separator. Typed
  // by hand as often as scanned, so case and stray spaces ("sh 1234") are
  // forgiven: ids are generated upper-case.
  const typed = text.replace(/\s+/g, '').toUpperCase();
  if (/^[A-Z0-9_-]{1,40}$/.test(typed)) return typed;
  return '';
}

// ---- (a) Customer-facing order QR modal -------------------------------

export async function showOrderQrModal(order) {
  const modalEl = document.getElementById('shopOrderQrModal');
  if (!modalEl || !order?.id) return;
  const codeEl = document.getElementById('shopOrderQrCode');
  const imgWrap = document.getElementById('shopOrderQrImage');
  const copyBtn = document.getElementById('shopOrderQrCopyBtn');
  if (codeEl) codeEl.textContent = order.id;
  if (imgWrap) {
    imgWrap.innerHTML = '<div class="spinner-border text-muted"></div>';
    try {
      const svg = await QRCode.toString(orderDeepLink(order.id), {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 240,
        color: { dark: '#0d1a14', light: '#ffffff' },
      });
      imgWrap.innerHTML = svg;
    } catch (e) {
      imgWrap.innerHTML = `<div class="text-danger small">สร้าง QR ไม่สำเร็จ</div>`;
      console.error('[shop/qr] toString failed:', e);
    }
  }
  if (copyBtn) {
    copyBtn.onclick = async () => {
      const ok = await copyText(order.id);
      showShopToast(ok ? 'คัดลอกรหัสแล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'success' : 'warn');
    };
  }
  const inst = window.bootstrap?.Modal.getOrCreateInstance(modalEl);
  inst?.show();
}

// ---- (b) Admin scanner modal -----------------------------------------

let scannerInstance = null;

/** Open the camera scanner. The promise resolves with a normalised
 *  order id (string) when a scan or manual entry succeeds, or with ''
 *  if the user closes the modal without scanning.
 *
 *  iPad/iOS notes: html5-qrcode's `start({facingMode:'environment'})`
 *  is unreliable on iOS Safari — it throws "Camera streaming not
 *  supported by the browser" in many WebKit modal contexts. The
 *  reliable pattern from the html5-qrcode README is:
 *    1. Html5Qrcode.getCameras() → resolves to [{id, label}, …]
 *    2. pick the back camera (`label` contains "back"/"rear"/"environment"),
 *       fall back to the last entry (often the rear lens on iPad)
 *    3. start with the device id, NOT a facingMode constraint
 *  We do that here. We also expose a camera <select> when >1 device,
 *  and a "scan a photo" file input as a hard fallback. */
export function openScannerModal(onResult) {
  const modalEl = document.getElementById('shopAdminScanModal');
  if (!modalEl) return;
  const errEl   = document.getElementById('shopScanError');
  const manual  = document.getElementById('shopScanManualInput');
  const goBtn   = document.getElementById('shopScanManualGoBtn');
  const cameraRow    = document.getElementById('shopScanCameraRow');
  const cameraSelect = document.getElementById('shopScanCameraSelect');
  const imageInput   = document.getElementById('shopScanImageInput');

  if (errEl) { errEl.classList.add('d-none'); errEl.textContent = ''; }
  if (manual) manual.value = '';
  if (imageInput) imageInput.value = '';
  if (cameraRow) cameraRow.classList.add('d-none');

  const inst = window.bootstrap?.Modal.getOrCreateInstance(modalEl);
  // One per open. At 10 fps the decode callback fires again while stop() is
  // still pending, and a close during the camera prompt used to start the
  // camera in a hidden modal — every await below re-checks this.
  const session = { done: false, closed: false };

  const finish = (id) => {
    if (session.done) return;
    session.done = true;
    teardownScanner();
    inst?.hide();
    if (id) onResult?.(id);
  };

  // ---- Manual text entry ----
  if (goBtn) {
    goBtn.onclick = () => {
      const id = parseScannedText(manual?.value || '');
      if (!id) {
        if (errEl) {
          errEl.classList.remove('d-none');
          errEl.textContent = 'รหัสไม่ถูกต้อง';
        }
        return;
      }
      finish(id);
    };
  }
  if (manual) {
    manual.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); goBtn?.click(); } };
  }

  // ---- Image-file scan fallback (iPadOS camera-blocked path) ----
  if (imageInput) {
    imageInput.onchange = async () => {
      const f = imageInput.files?.[0];
      if (!f) return;
      try {
        // scanFile() needs no viewfinder, but Html5Qrcode still needs an
        // element to bind to — and #shopScanRegion only exists once the camera
        // started, i.e. never on the camera-refused path this fallback is for.
        let region = document.getElementById('shopScanFileRegion');
        if (!region) {
          region = document.createElement('div');
          region.id = 'shopScanFileRegion';
          region.hidden = true;
          modalEl.appendChild(region);
        }
        const tmp = new Html5Qrcode('shopScanFileRegion');
        const decoded = await tmp.scanFile(f, /* showImage */ false);
        try { await tmp.clear(); } catch {}
        const id = parseScannedText(decoded);
        if (id) { finish(id); return; }
        if (errEl) {
          errEl.classList.remove('d-none');
          errEl.textContent = 'อ่าน QR จากภาพไม่ออก — ลองภาพที่คมชัดกว่า';
        }
      } catch (e) {
        if (errEl) {
          errEl.classList.remove('d-none');
          // The library's reasons are English ("No MultiFormat Readers…").
          console.warn('[shop/qr] image scan failed:', e);
          errEl.textContent = 'อ่าน QR จากภาพไม่ออก — ลองภาพที่คมชัดกว่า หรือพิมพ์รหัสแทน';
        }
      }
    };
  }

  // ---- Camera picker ----
  if (cameraSelect) {
    cameraSelect.onchange = () => {
      if (cameraSelect.value) {
        startScanner(cameraSelect.value, errEl, session, (text) => {
          const id = parseScannedText(text);
          if (id) finish(id);
        });
      }
    };
  }

  // ---- Start camera after modal is fully shown ----
  const onShown = async () => {
    modalEl.removeEventListener('shown.bs.modal', onShown);
    try {
      const cameras = await Html5Qrcode.getCameras();
      if (session.closed) return;
      if (!cameras || cameras.length === 0) {
        throw new Error('ไม่พบกล้องในอุปกรณ์นี้');
      }
      // Populate the camera <select> if more than one device.
      if (cameraSelect) {
        cameraSelect.innerHTML = cameras.map((c) =>
          `<option value="${escHtml(c.id)}">${escHtml(c.label || c.id)}</option>`).join('');
      }
      if (cameraRow && cameras.length > 1) cameraRow.classList.remove('d-none');

      // Pick the back camera: prefer a label hint, otherwise iOS's
      // convention of putting the rear lens last in the array.
      const back = cameras.find((c) =>
        /back|rear|environment/i.test(c.label || '')) || cameras[cameras.length - 1];
      if (cameraSelect) cameraSelect.value = back.id;

      await startScanner(back.id, errEl, session, (text) => {
        const id = parseScannedText(text);
        if (id) finish(id);
      });
    } catch (e) {
      console.warn('[shop/qr] camera enumerate failed:', e);
      if (errEl) {
        errEl.classList.remove('d-none');
        errEl.textContent =
          'เปิดกล้องไม่ได้ (' + (e?.message || e) + ') — ' +
          'ใช้ "อัปโหลดรูป QR" หรือ "พิมพ์รหัส" ด้านล่างแทนได้';
      }
    }
  };
  modalEl.addEventListener('shown.bs.modal', onShown);
  modalEl.addEventListener('hidden.bs.modal', () => {
    session.closed = true;
    // Closed before it was ever shown: this open's onShown must not fire on
    // the NEXT open, or that one starts two scanners.
    modalEl.removeEventListener('shown.bs.modal', onShown);
    teardownScanner();
  }, { once: true });

  inst?.show();
}

async function startScanner(cameraId, errEl, session, onText) {
  await teardownScanner();
  if (session.closed) return;
  const viewer = document.getElementById('shopScanViewfinder');
  if (!viewer) return;
  viewer.innerHTML = '<div id="shopScanRegion" style="width:100%; height:100%; min-height:280px;"></div>';
  try {
    scannerInstance = new Html5Qrcode('shopScanRegion');
    await scannerInstance.start(
      cameraId,
      { fps: 10, qrbox: { width: 240, height: 240 } },
      (decoded) => onText(decoded),
      () => {},  // per-frame "no QR yet" — noisy, ignore.
    );
    // Closed while the camera was starting: stop it rather than leave it
    // running in a hidden modal.
    if (session.closed) { await teardownScanner(); return; }
    // iOS Safari needs playsinline on the <video> to render in-page
    // instead of fullscreening. html5-qrcode creates the element with
    // it set in newer releases, but stamp it just in case.
    const v = viewer.querySelector('video');
    if (v) { v.setAttribute('playsinline', 'true'); v.setAttribute('muted', 'true'); }
  } catch (e) {
    console.warn('[shop/qr] camera start failed:', e);
    if (errEl) {
      errEl.classList.remove('d-none');
      errEl.textContent =
        'เปิดกล้องไม่ได้ (' + (e?.message || e) + ') — ' +
        'ใช้ "อัปโหลดรูป QR" หรือ "พิมพ์รหัส" ด้านล่างแทนได้';
    }
  }
}

async function teardownScanner() {
  if (!scannerInstance) return;
  try { await scannerInstance.stop(); } catch {}
  try { await scannerInstance.clear(); } catch {}
  scannerInstance = null;
}
