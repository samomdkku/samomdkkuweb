// load-quill.js — Quill on demand.
//
// CLAUDE.md: "Quill, d3-org-chart, GrapesJS — DYNAMIC IMPORT ONLY, never an
// entry bundle." GrapesJS and d3-org-chart follow that (dept-visual-editor.js,
// org-graph.js, both `import('…')`). Quill did not — index.html loaded it as
// a classic, render-blocking `<script src="https://cdn.quilljs.com/…">` in
// `<head>`, on EVERY public page view, for an editor only the VitalSound
// REPORT tab uses (a dedicated tab a visitor may never open). Quill isn't an
// npm dependency here (loaded from a CDN as a global, not bundled by Vite),
// so "dynamic import" means injecting the tags on first use instead of
// shipping them unconditionally — same effect, different mechanism.
//
// Cached so the second caller (if any) gets the same promise instead of a
// second <script> tag.
let quillPromise = null;

const QUILL_VERSION = '1.3.6';

export function loadQuill() {
  if (quillPromise) return quillPromise;
  if (window.Quill) return (quillPromise = Promise.resolve(window.Quill));

  quillPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://cdn.quilljs.com/${QUILL_VERSION}/quill.snow.css`;
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = `https://cdn.quilljs.com/${QUILL_VERSION}/quill.js`;
    script.onload = () => resolve(window.Quill);
    script.onerror = () => reject(new Error('โหลดตัวแก้ไขข้อความไม่สำเร็จ — เช็คการเชื่อมต่ออินเทอร์เน็ต'));
    document.head.appendChild(script);
  }).catch((err) => {
    // A failed load must not wedge every later caller behind the same
    // rejected promise — let the next attempt (e.g. re-opening the tab) retry.
    quillPromise = null;
    throw err;
  });
  return quillPromise;
}
