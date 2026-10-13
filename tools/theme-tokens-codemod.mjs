#!/usr/bin/env node
// ============================================================
// theme-tokens-codemod.mjs — rewrite hard-coded neutral colours in src/css/
// into the tokens base.css flips for dark mode (2026-10-13).
//
// WHY A CODEMOD. ~2,000 colour literals across ~40 files, written for a site
// that was light-only on purpose. Dark mode works by FLIPPING the neutral
// scale (--ink-*, --gray-*, --surface) — so every literal that is one of those
// exact values must read the token instead. By EXACT value only: in light
// mode every computed colour is identical before and after, so the rewrite
// cannot change how the site looks today.
//
// THE PROPERTY DECIDES, because one colour plays several roles:
//   • slate / gray hex (Tailwind's, = --ink-* / --gray-*) → the token, anywhere
//   • white → var(--surface) only where it is a SURFACE: background, border,
//     outline, a box-shadow ring (a cut-out matching what is behind it). White
//     TEXT (`color: #fff` on a green button) stays white.
//   • rgba(255,255,255,a) on a surface → rgb(var(--surface-rgb) / a)
//   • rgba(15,23,42,a) — slate-900 — as TEXT or a BORDER hairline →
//     rgb(var(--ink-900-rgb) / a). As a background or shadow it is a scrim or a
//     shadow, which stays dark in both themes: left alone.
// SKIPPED: the token definitions themselves, @media print, QR codes (a QR must
// stay dark-on-white to scan), and the files listed in SKIP_FILES.
//
//   node tools/theme-tokens-codemod.mjs          # dry run: counts per file
//   node tools/theme-tokens-codemod.mjs --write
// Guarded afterwards by src/css/theme-tokens.test.js (no new literal sneaks in).
// ============================================================
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import postcss from 'postcss';

const DIR = 'src/css';
const WRITE = process.argv.includes('--write');
// image-crop.css: the crop stage is a deliberate dark island in BOTH themes.
export const SKIP_FILES = new Set(['image-crop.css']);

export const SLATE = {
  '#0f172a': '--ink-900', '#1e293b': '--ink-800', '#334155': '--ink-700', '#475569': '--ink-600',
  '#64748b': '--ink-500', '#94a3b8': '--ink-400', '#cbd5e1': '--ink-300', '#e2e8f0': '--ink-200',
  '#f1f5f9': '--ink-100', '#f8fafc': '--ink-50',
};
export const GRAY = {
  '#111827': '--gray-900', '#1f2937': '--gray-800', '#374151': '--gray-700', '#4b5563': '--gray-600',
  '#6b7280': '--gray-500', '#9ca3af': '--gray-400', '#d1d5db': '--gray-300', '#e5e7eb': '--gray-200',
  '#f3f4f6': '--gray-100', '#f9fafb': '--gray-50',
};
const NEUTRAL = { ...SLATE, ...GRAY };
const TOKEN_DEFS = /^--(ink|gray)-\d+$|^--surface(-rgb)?$|^--ink-900-rgb$/;

const SURFACE_PROP = /^(background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?|outline(-color)?|box-shadow|--.*(bg|surface|card|panel|paper|backdrop).*)$/i;
const LINE_OR_TEXT_PROP = /^(color|border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?|outline(-color)?|text-decoration-color|caret-color|column-rule-color|--.*(text|ink|line|border|muted|fg).*)$/i;

const hex = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
const rgbaWhite = /rgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9.]+%?)\s*\)/g;
const rgbaSlate900 = /rgba?\(\s*15\s*,\s*23\s*,\s*42\s*,\s*([0-9.]+%?)\s*\)/g;
const isWhite = (h) => /^#(fff|ffffff)$/i.test(h);

// HSL lightness of a hex colour, 0..1.
export function lightness(h) {
  let x = h.slice(1);
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

// WCAG relative luminance, 0..1 — what contrast is computed from. A text
// colour below ~0.22 cannot reach 4.5:1 on the dark surface (#151b26).
export function luminance(h) {
  let x = h.slice(1);
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(x.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// THE LONG TAIL — every other literal, decided by role + lightness. Each is a
// color-mix whose amount is 100% in light mode (base.css), i.e. EXACTLY the
// original colour; only the dark block changes the amount.
//   pale background (L ≥ .86) → mixed into the surface   (--tint-mix)
//   pale border     (L ≥ .78) → mixed into the surface   (--line-mix)
//   dark text  (luminance < .22) → mixed toward light text  (--fg-mix)
const BG_PROP = /^(background(-color|-image)?)$/i;
const BORDER_PROP = /^(border(-(top|right|bottom|left|block|inline)(-start|-end)?)?(-color)?|outline(-color)?)$/i;
const TEXT_PROP = /^(color|text-decoration-color|caret-color)$/i;

export function rewriteValue(prop, value) {
  let changed = 0;
  let mixed = false;
  const surfaceProp = SURFACE_PROP.test(prop);
  const lineProp = LINE_OR_TEXT_PROP.test(prop);
  let v = value.replace(hex, (h, at, whole) => {
    const k = h.toLowerCase();
    if (NEUTRAL[k]) { changed++; return `var(${NEUTRAL[k]})`; }
    if (isWhite(k) && surfaceProp) { changed++; return 'var(--surface)'; }
    if (isWhite(k) || /^#0{3}(0{3})?$/.test(k)) return h;
    // already inside a color-mix (a second run) — leave it
    if (/color-mix\([^)]*$/.test(whole.slice(0, at))) return h;
    const L = lightness(k);
    if (BG_PROP.test(prop) && L >= 0.86) { changed++; mixed = true; return `color-mix(in srgb, ${h} var(--tint-mix), var(--surface))`; }
    if (BORDER_PROP.test(prop) && L >= 0.78) { changed++; mixed = true; return `color-mix(in srgb, ${h} var(--line-mix), var(--surface))`; }
    // Text by LUMINANCE, not HSL lightness: #4338ca is "50% light" by HSL and
    // still unreadable on dark (2.3:1) — HSL missed it (2026-10-13).
    if (TEXT_PROP.test(prop) && luminance(k) < 0.22) { changed++; mixed = true; return `color-mix(in srgb, ${h} var(--fg-mix), var(--fg-mix-to))`; }
    return h;
  });
  if (/^(border|outline|color)/i.test(prop)) {
    v = v.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([0-9.]+%?)\s*\)/g, (_, a) => { changed++; return `rgb(var(--ink-900-rgb) / ${a})`; });
  }
  if (surfaceProp) {
    v = v.replace(/\bwhite\b/gi, () => { changed++; return 'var(--surface)'; });
    v = v.replace(rgbaWhite, (_, a) => { changed++; return `rgb(var(--surface-rgb) / ${a})`; });
  }
  if (lineProp && !/^background|box-shadow/.test(prop)) {
    v = v.replace(rgbaSlate900, (_, a) => { changed++; return `rgb(var(--ink-900-rgb) / ${a})`; });
  }
  return { value: v, changed, mixed };
}

function inPrint(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && p.name === 'media' && /\bprint\b/.test(p.params)) return true;
  }
  return false;
}
const isQrRule = (decl) => decl.parent?.type === 'rule' && /\bqr[-_a-z]*/i.test(decl.parent.selector);

export function rewriteCss(css, from = 'x.css') {
  const root = postcss.parse(css, { from });
  let changed = 0;
  root.walkDecls((d) => {
    if (TOKEN_DEFS.test(d.prop) || inPrint(d) || isQrRule(d)) return;
    // A fallback written by an earlier run (the next declaration is its
    // color-mix twin) — leave it, or a second run would mix it again.
    const nx = d.next();
    if (nx && nx.type === 'decl' && nx.prop === d.prop && /color-mix\(/.test(nx.value)) return;
    const r = rewriteValue(d.prop, d.value);
    if (!r.changed) return;
    // color-mix() is Safari 16.2+ / Chrome 111+. An older browser DROPS the
    // whole declaration — so the original stays in front as its fallback.
    if (r.mixed) d.cloneBefore({ value: d.value });
    d.value = r.value;
    changed += r.changed;
  });
  return { css: root.toString(), changed };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  let total = 0;
  for (const f of readdirSync(DIR).filter((x) => x.endsWith('.css')).sort()) {
    if (SKIP_FILES.has(f)) continue;
    const path = join(DIR, f);
    const before = readFileSync(path, 'utf8');
    const { css, changed } = rewriteCss(before, path);
    if (!changed) continue;
    total += changed;
    console.log(`${String(changed).padStart(4)}  ${f}`);
    if (WRITE) writeFileSync(path, css);
  }
  console.log(`${total} rewrites${WRITE ? ' written' : ' (dry run — pass --write)'}`);
}
