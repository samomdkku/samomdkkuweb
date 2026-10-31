// org-face.js — the ONE way a person's face is drawn on the ทีม SAMO page.
//
// Extracted when two views (the panels and a d3 canvas) shared it — a second
// copy of the srcset/initials logic would have drifted silently, since a wrong
// `sizes` hint just downloads the wrong file. Since 2026-10-31 only ภาพรวม
// draws faces; the canvas and its GRAPH_SHAPE (zoomed portraits) are gone.
//
// Initials are ALWAYS rendered, with the photo layered over them. A Drive link
// can rot (file unshared, moved, deleted) and an <img alt=""> that fails to load
// draws nothing — so without this a broken photo would leave an empty box.
// Layering means it degrades to the same initials as someone who never uploaded
// one, with no error handler to wire up.
import { escHtml } from './utils.js';
import {
  portraitSrc, portraitSrcSet, focusToObjectPosition, PORTRAIT_RATIO,
} from './uploads.js';

/** Initials for the no-photo state. Thai names have no case, so take the first
 *  glyph of the first two words — enough to differentiate at a glance without
 *  pretending to be a monogram. */
export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  return (parts[0][0] || '') + (parts[1] ? parts[1][0] : '');
}

// The shapes a face appears in, and the exact widths lh3 is asked for.
//
// A portrait renders at a fixed CSS width, so handing it a bigger file would
// waste bytes across 448 people. Widths cover 1× through 3×; the browser
// downloads exactly one per image using `sizes`.

/**
 * แผนผัง — the page. A 52px-wide 3:4 portrait with the name BESIDE it, not
 * under it.
 *
 * The widths shrank from [130, 200, 260, 390] when the layout did. The portrait
 * used to sit above its name in a ~130px column; it now sits beside the name in
 * a row, because a column of portrait-over-name leaves the width of the name
 * empty next to every one-person ตำแหน่ง — and one-person ตำแหน่ง are most of
 * this page. `sizes: '52px'` with candidates at 1×/2×/3× is the whole ask: 448
 * portraits at 260px each was ~5× the pixels any of them are drawn at.
 *
 * If the CSS width of `.orgc-person .org-face` changes, these change with it —
 * an over-large `sizes` only wastes bytes, but an under-large one is visibly
 * soft on a retina screen.
 */
export const TREE_SHAPE = {
  cls: 'org-face',
  ratio: PORTRAIT_RATIO,
  widths: [52, 104, 156],
  sizes: '52px',
  base: 104,
};

/**
 * `focus` decides HOW the 3:4 crop happens: 'center' lets lh3 crop server-side
 * (half the bytes), 'top'/'bottom' fetch the uncropped frame and crop in CSS,
 * because lh3 has no focal-point option and a centre crop of a landscape studio
 * shot can slice the head.
 */
export function faceHtml(m, shape) {
  const { cls, ratio, widths, sizes, base } = shape;
  const photo = m.photo_url || '';
  const focus = m.photo_focus || 'center';
  const inner = `<span class="${cls}-initials" aria-hidden="true">${escHtml(initials(m.name))}</span>`;
  if (!photo) return inner;
  const set = portraitSrcSet(photo, widths, focus, ratio);
  const pos = focusToObjectPosition(focus);
  return `${inner}<img class="${cls}-img" src="${escHtml(portraitSrc(photo, base, focus, ratio))}"${
    set ? ` srcset="${escHtml(set)}" sizes="${sizes}"` : ''
  } alt="" loading="lazy" decoding="async"${
    focus === 'center' ? '' : ` style="object-position:${pos}"`
  } />`;
}
