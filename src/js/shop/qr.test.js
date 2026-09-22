import { describe, it, expect, vi } from 'vitest';
vi.mock('html5-qrcode', () => ({ Html5Qrcode: class {} }));
vi.mock('qrcode', () => ({ default: {} }));
vi.mock('./products.js', () => ({ showShopToast: () => {} }));
const { parseScannedText } = await import('./qr.js');

describe('parseScannedText', () => {
  it('forgives case and stray spaces in a typed code', () => {
    expect(parseScannedText('sh1234')).toBe('SH1234');
    expect(parseScannedText(' SH 1234 ')).toBe('SH1234');
  });
  it('reads ?scan= from a URL and refuses anything else', () => {
    expect(parseScannedText('https://samo.md.kku.ac.th/admin/?scan=EP1234')).toBe('EP1234');
    expect(parseScannedText('https://example.com/pay')).toBe('');
    expect(parseScannedText('<img src=x>')).toBe('');
  });
});
