// qr-order.test.js — the customer-facing QR must never re-absorb the
// camera scanner. orders.js statically imports this file (cheap: just
// `qrcode`); qr.js's scanner half is only ever reached by `await
// import('./qr.js')` in admin.js. If a future edit merges them back, the
// whole html5-qrcode engine lands in the public entry's eager chunk again
// — exactly the regression this split (2026-10-20) fixed. Source-text
// guard, not a runtime one: jsdom has no camera and no QR decoder to
// exercise either way.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('shop/qr-order.js stays light', () => {
  const src = readFileSync(new URL('./qr-order.js', import.meta.url), 'utf8');

  it('does not import the camera-scanning library', () => {
    expect(src).not.toMatch(/html5-qrcode/);
  });

  it('still imports the lightweight QR encoder', () => {
    expect(src).toMatch(/from 'qrcode'/);
  });
});

describe('shop/qr.js (the admin scanner) stays out of the customer path', () => {
  const src = readFileSync(new URL('./qr.js', import.meta.url), 'utf8');

  it('no longer exports the customer-facing modal', () => {
    expect(src).not.toMatch(/export (async )?function showOrderQrModal/);
  });

  it('orders.js (statically imported from main.js) does not pull it in', () => {
    const orders = readFileSync(new URL('./orders.js', import.meta.url), 'utf8');
    expect(orders).not.toMatch(/from '\.\/qr\.js'/);
    expect(orders).toMatch(/from '\.\/qr-order\.js'/);
  });
});
