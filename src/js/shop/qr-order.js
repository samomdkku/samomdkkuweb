// ==============================================
// SHOP QR — customer-facing order QR only
//
// Split out of qr.js (2026-10-20, speed sweep): orders.js imported
// showOrderQrModal with a STATIC import, which pulled the whole qr.js module
// — including Html5Qrcode, the camera-scanning engine qr.js's admin half
// needs — into the eagerly-loaded shared chunk every public visitor
// downloads before first paint, even one who never opens a shop order.
// admin.js already loads the scanner half with `await import('./qr.js')`;
// this file holds only the light `qrcode` encoder so the customer path never
// pays for the camera library at all, lazy or not.
// ==============================================

import QRCode from 'qrcode';
import { copyText } from '../utils.js';
import { showShopToast } from './products.js';

const ADMIN_SCAN_BASE = '/admin/?scan=';

/** Build the URL the QR encodes. Uses the current origin so a preview
 *  deploy stays scoped to itself; production lands on the real admin URL. */
export function orderDeepLink(orderId) {
  if (!orderId) return '';
  const origin = window.location.origin;
  return `${origin}${ADMIN_SCAN_BASE}${encodeURIComponent(orderId)}`;
}

/** Customer-side. Renders the order id as a QR (deep link to the admin
 *  order page) so the user can show it to admin when picking up. The deep
 *  link is a full HTTPS URL — works with LINE, iOS camera, Google Lens, and
 *  the in-app admin scanner (src/js/shop/qr.js). */
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
      console.error('[shop/qr-order] toString failed:', e);
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
