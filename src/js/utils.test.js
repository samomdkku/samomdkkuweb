// Pure-function tests for utils.js. No DOM, no network — safe to run
// under plain Vitest with no jsdom env. The renderTimeline helper isn't
// covered here because it writes to a DOM container; smoke-test it in a
// browser instead.

import { describe, it, expect } from 'vitest';
import {
  escHtml, safeUrl, formatThaiDate, decodeJwtResponse, stripHtmlToText,
  remarkVis, VS_REMARK_VIS,
} from './utils.js';

// remarkVis mirrors public.vs_remark_vis() (migration 0096). Both sides must
// agree or the client hides a note the server sent (or worse, shows one it
// believes is staff-only). The server is the boundary — these cases exist to
// keep the mirror honest, and to pin the two failure modes that matter:
// a MISSING vis must read as 'ticket' (never 'public'), and a malformed value
// must fall back to the narrowest sane rung rather than throwing.
describe('remarkVis (0096 visibility ladder)', () => {
  it('reads an explicit rung', () => {
    for (const v of ['staff', 'ticket', 'thread', 'public']) {
      expect(remarkVis({ vis: v })).toBe(v);
    }
  });

  it('defaults a legacy remark with no vis to ticket', () => {
    expect(remarkVis({ by: 'SE', text: 'hi' })).toBe('ticket');
    expect(remarkVis({})).toBe('ticket');
  });

  // The truthy set is exactly what public.vs_remark_vis() accepts:
  // lower(e->>'internal') in ('true','t','1'). jsonb ->> stringifies, so a
  // numeric 1 arrives as '1'. tools/vs-remark-vis-mirror.mjs diffs the two
  // implementations against the live DB; it caught 't'/'1'/1 diverging.
  it('maps the legacy internal flag to staff, matching the SQL truthy set', () => {
    expect(remarkVis({ internal: true })).toBe('staff');
    expect(remarkVis({ internal: 'true' })).toBe('staff');   // jsonb->>text shape
    expect(remarkVis({ internal: 'TRUE' })).toBe('staff');   // SQL lower()s it
    expect(remarkVis({ internal: 't' })).toBe('staff');
    expect(remarkVis({ internal: '1' })).toBe('staff');
    expect(remarkVis({ internal: 1 })).toBe('staff');
    expect(remarkVis({ internal: false })).toBe('ticket');
    expect(remarkVis({ internal: 0 })).toBe('ticket');
  });

  it('lets an explicit vis win over the legacy flag', () => {
    expect(remarkVis({ vis: 'public', internal: false })).toBe('public');
    // staff-only entries are written with BOTH during the deploy window
    expect(remarkVis({ vis: 'staff', internal: true })).toBe('staff');
  });

  it('never widens on a malformed or hostile value', () => {
    // The remarks array is client-written, so these are reachable inputs.
    expect(remarkVis({ vis: 'PUBLIC' })).toBe('ticket');
    expect(remarkVis({ vis: 'everyone' })).toBe('ticket');
    expect(remarkVis({ vis: null })).toBe('ticket');
    expect(remarkVis({ vis: 42 })).toBe('ticket');
    expect(remarkVis({ internal: 'yes' })).toBe('ticket');
  });

  it('does not throw on null/undefined entries', () => {
    expect(remarkVis(null)).toBe('ticket');
    expect(remarkVis(undefined)).toBe('ticket');
  });

  it('has display metadata for every rung', () => {
    for (const v of ['staff', 'ticket', 'thread', 'public']) {
      expect(VS_REMARK_VIS[v]?.short).toBeTruthy();
      expect(VS_REMARK_VIS[v]?.icon).toMatch(/^bi-/);
    }
  });
});

describe('escHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escHtml(`<img src=x onerror=alert(1)>`))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escHtml(`"&'<>`)).toBe('&quot;&amp;&#39;&lt;&gt;');
  });

  it('returns empty string for null and undefined', () => {
    expect(escHtml(null)).toBe('');
    expect(escHtml(undefined)).toBe('');
  });

  it('coerces non-strings safely', () => {
    expect(escHtml(42)).toBe('42');
    expect(escHtml(true)).toBe('true');
  });

  it('leaves benign text alone', () => {
    expect(escHtml('hello world')).toBe('hello world');
  });
});

describe('safeUrl', () => {
  it('cannot be broken out of — safe to interpolate bare into an attribute or url()', () => {
    // A buyer-writable slip URL reached `<img src="${safeUrl(u)}">` unescaped.
    for (const u of ['https://x/"onerror="alert(1)', "https://x/'onerror='alert(1)", 'https://x/"><script>1</script>',
                     'https://x/`a', 'https://x/ onerror=alert(1)', "https://x/') ; background:url('//evil"]) {
      const out = safeUrl(u);
      expect(out).not.toMatch(/["'<>`\s]/);
      const html = `<img src="${out}">`;
      expect(html.match(/"/g)).toHaveLength(2); // still one attribute
    }
  });
  it('encodes non-ASCII whitespace as valid UTF-8', () => {
    expect(safeUrl('https://x/a\u00a0b')).toBe('https://x/a%C2%A0b');
    expect(safeUrl('https://x/a\u3000b')).toBe('https://x/a%E3%80%80b');
  });
  it('leaves an ordinary Drive / lh3 URL unchanged', () => {
    const u = 'https://lh3.googleusercontent.com/d/1AbC_d-E=w1200?x=1&y=2#f';
    expect(safeUrl(u)).toBe(u);
  });
  it('allows http and https URLs through', () => {
    expect(safeUrl('http://example.com/a')).toBe('http://example.com/a');
    expect(safeUrl('https://drive.google.com/file/d/X/view')).toBe('https://drive.google.com/file/d/X/view');
  });

  it('allows mailto and tel', () => {
    expect(safeUrl('mailto:a@b.com')).toBe('mailto:a@b.com');
    expect(safeUrl('tel:+66891234567')).toBe('tel:+66891234567');
  });

  it('blocks javascript: scheme', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#');
    expect(safeUrl('  javascript:alert(1)')).toBe('#');
    expect(safeUrl('JAVASCRIPT:alert(1)')).toBe('#');
  });

  it('blocks data: scheme', () => {
    expect(safeUrl('data:text/html,<script>alert(1)</script>')).toBe('#');
  });

  it('blocks attribute-injection payloads', () => {
    // Without quotes for context — this is what an attacker would put
    // in a free-text "url" field hoping it lands inside href="${url}".
    // Either the safeUrl rejects it, or escHtml neutralizes the quote.
    // We test both layers behave defensively.
    expect(safeUrl('" onclick=alert(1) "')).toBe('#');
    expect(safeUrl('vbscript:msgbox(1)')).toBe('#');
  });

  it('returns # for empty / null / undefined', () => {
    expect(safeUrl('')).toBe('#');
    expect(safeUrl(null)).toBe('#');
    expect(safeUrl(undefined)).toBe('#');
  });
});

describe('formatThaiDate', () => {
  it('formats an ISO date to dd/MM/yyyy HH:mm:ss', () => {
    // Force a stable UTC date — the function uses local time getters,
    // so we pass a date with a fixed local-time interpretation.
    const iso = '2026-05-23T14:30:00';
    const out = formatThaiDate(iso);
    expect(out).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/);
  });

  it('passes already-slash-formatted strings through', () => {
    expect(formatThaiDate('23/05/2026 14:30:00')).toBe('23/05/2026 14:30:00');
  });

  it('returns "-" for null / undefined / empty', () => {
    expect(formatThaiDate(null)).toBe('-');
    expect(formatThaiDate(undefined)).toBe('-');
    expect(formatThaiDate('')).toBe('-');
  });

  it('returns the input as a string for unparseable values', () => {
    expect(formatThaiDate('not a date')).toBe('not a date');
  });
});

describe('decodeJwtResponse', () => {
  // Build a minimal valid JWT: header.payload.signature, payload is
  // base64url-encoded JSON. Signature is decorative for decode tests.
  function makeJwt(payload) {
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64')
      .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `header.${b64(payload)}.sig`;
  }

  it('decodes a well-formed token', () => {
    const token = makeJwt({ sub: 'abc', email: 'a@b.com' });
    expect(decodeJwtResponse(token)).toEqual({ sub: 'abc', email: 'a@b.com' });
  });

  it('throws on non-string input', () => {
    expect(() => decodeJwtResponse(null)).toThrow(/string/i);
    expect(() => decodeJwtResponse(undefined)).toThrow(/string/i);
    expect(() => decodeJwtResponse(42)).toThrow(/string/i);
  });

  it('throws on wrong segment count', () => {
    expect(() => decodeJwtResponse('only.two')).toThrow(/segments/);
    expect(() => decodeJwtResponse('one.two.three.four')).toThrow(/segments/);
  });

  it('throws on malformed base64 payload', () => {
    expect(() => decodeJwtResponse('header.!!!.sig')).toThrow(/decode failed/);
  });
});

describe('stripHtmlToText', () => {
  it('strips tags and decodes entities Quill leaves behind', () => {
    expect(stripHtmlToText('<p>อยากให้หอแพทย์ 4&nbsp;&nbsp;เอาขนมมาขาย</p>'))
      .toBe('อยากให้หอแพทย์ 4 เอาขนมมาขาย');
    expect(stripHtmlToText('a &amp; b &lt;tag&gt; &quot;q&quot; &#39;s&#39;'))
      .toBe(`a & b <tag> "q" 's'`);
    expect(stripHtmlToText('&#3648;&#3626;&#3637;&#3618;')).toBe('เสีย');
  });
  it('collapses whitespace and truncates with an ellipsis', () => {
    expect(stripHtmlToText('<p>a</p>\n<p>b</p>')).toBe('a b');
    expect(stripHtmlToText('hello world', 5)).toBe('hello…');
    expect(stripHtmlToText('short', 90)).toBe('short');
  });
  it('handles null/empty', () => {
    expect(stripHtmlToText(null)).toBe('');
    expect(stripHtmlToText('')).toBe('');
  });
});
