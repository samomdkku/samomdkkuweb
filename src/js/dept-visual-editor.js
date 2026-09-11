// ============================================================
// dept-visual-editor.js — THE SPIKE. A visual editor for a ฝ่าย's HTML block.
//
// Reported, three times, of the หน้าฝ่าย form editor:
//   "it have to click เพิ่มหัวข้อ เพิ่มการ์ด and filll each, it is untuitive,
//    it should be like working with canva, powerpoint or something that more
//    like wysiwyg … you can look at example online like the wix.com cms system"
//
// ⚠️ THIS IS A SPIKE AND IT IS MEANT TO BE JUDGED, NOT EXTENDED. The block set
// below is deliberately small. If the feel is wrong, delete this file and the
// dependency; nothing else in the app knows it exists.
//
// WHY GrapesJS AND NOT Puck / Craft.js. Both are React-only —
// `peerDependencies: { react: "^18 || ^19" }`, checked on the registry — and
// this app is Vanilla JS + Vite + Bootstrap. GrapesJS is vanilla (its deps are
// backbone, underscore and codemirror), BSD-3, and outputs plain HTML + CSS.
//
// WHY IT COSTS ALMOST NOTHING ARCHITECTURALLY. GrapesJS emits HTML, and
// `kind:'html'` already exists: stored in `dept_content.html`, rendered verbatim
// into a sandboxed opaque-origin frame. So this is an EDITOR SWAP, not a new
// storage model, a new isolation model, or a new renderer. It writes into the
// textarea that is already there and the existing save path does the rest —
// this module performs no database write of its own, on purpose.
//
// ⛔ THE OUTPUT MUST BE SELF-CONTAINED, AND THIS IS THE THING THAT IS EASY TO
// GET WRONG. The block goes into `srcdoc` on a frame with NO allow-same-origin,
// so the document it lands in is BLANK: no Bootstrap, no site stylesheet, no
// fonts. A block built from Bootstrap classes would look perfect in this editor
// (which is inside the styled admin page) and completely unstyled on the real
// ฝ่าย page. Every block below therefore carries its own inline layout, and
// `wrapDocument()` prepends the base <style> and the height reporter.
//
// ⛔ AND NO MEDIA QUERIES IN THE BLOCKS. The columns stack by `flex-wrap` with a
// flex-basis, so a two-column row becomes one column on a phone with no
// breakpoint to get wrong. A non-designer cannot ship a laptop-only layout with
// these blocks, which was the whole objection to a free-position canvas.
//
// ✅ MEASURED 2026-09-11, because a screenshot appeared to show it failing and
// the screenshot was wrong: at a 364px content width both the 2- and 3-column
// blocks put every child on its OWN ROW at full width (`getBoundingClientRect`
// on the children, not the stylesheet). Flex line-breaking uses each item's
// hypothetical main size, so 260+260+16 > 364 wraps BEFORE flex-shrink is
// applied. The capture harness had no <meta name="viewport">, so Chrome's
// mobile emulation laid everything out at 980px and scaled it down — which
// looks exactly like "the columns refuse to stack". ⚠️ A layout measurement
// taken in a page with no viewport tag is not a phone measurement.
// ============================================================

/** The GrapesJS build is ~1.1 MB. It is loaded on demand, from the admin bundle
 *  only — `dept-visual-editor.test.js` fails if it reaches the public entry. */
let editorPromise = null;

/**
 * The base stylesheet every ฝ่าย block inherits, and the height reporter.
 *
 * The reporter is the same contract `public/embed/starter/` uses
 * (`samo-embed-height`), measured on `document.body` and NOT on
 * `documentElement` — inside an iframe `documentElement` IS the frame, so
 * measuring it asks the host how tall the host made it and the block can never
 * shrink. That bug already shipped once, on the tool frame.
 */
export function wrapDocument(html, css) {
  return `<style>
  :root { color-scheme: light; }
  body {
    margin: 0; padding: 4px;
    font-family: 'Noto Sans Thai', system-ui, -apple-system, 'Segoe UI', sans-serif;
    color: #1f2933; line-height: 1.65;
  }
  img { max-width: 100%; height: auto; display: block; }
  a { color: #105922; }
  * { box-sizing: border-box; }
${css || ''}
</style>
${html || ''}
<script>
  // Tell the host how tall this block really is. body, never documentElement.
  (function () {
    function report() {
      parent.postMessage({
        type: 'samo-embed-height',
        height: Math.ceil(document.body.getBoundingClientRect().height),
      }, '*');
    }
    new ResizeObserver(report).observe(document.body);
    window.addEventListener('load', report);
  })();
</script>`;
}

/** Pull the author's HTML back out of a wrapped document, so re-opening the
 *  editor shows what they built rather than the wrapper around it. */
export function unwrapDocument(saved) {
  const s = String(saved || '');
  if (!s.includes('samo-embed-height')) return s;   // hand-written, leave alone
  return s
    .replace(/<style>[\s\S]*?<\/style>/, '')
    .replace(/<script>[\s\S]*?<\/script>/, '')
    .trim();
}

/**
 * THE BLOCK SET.
 *
 * Small on purpose — this is the spike. Every one is self-contained and stacks
 * on a phone without a media query. `flex: 1 1 260px` is the whole trick: below
 * about 560px there is no room for two, so they wrap.
 */
/**
 * Block categories. With one flat list of twenty a person scrolls past the one
 * they want; GrapesJS renders these as collapsible groups.
 */
export const CAT = {
  TEXT:   'ข้อความ',
  MEDIA:  'รูปภาพ',
  BOX:    'กล่องและการ์ด',
  LINK:   'ปุ่มและลิงก์',
  LAYOUT: 'จัดวาง',
};

/**
 * Force every link to open in a NEW TAB, whatever the author did.
 *
 * ⛔ THIS IS A MECHANISM, NOT A TIDY-UP, AND IT MUST RUN ON SAVE. The ฝ่าย page
 * puts this HTML in a frame sandboxed without `allow-same-origin` and without
 * `allow-top-navigation`, so a link with no target navigates THE FRAME: the
 * linked site loads inside the little embedded box, at the block's own height,
 * with no way back. `allow-popups` is in the sandbox list precisely so that
 * `_blank` still works.
 *
 * A note in a comment would not survive an author pasting a plain `<a>`, and
 * the person who finds out is whoever clicks it on the live page.
 */
export function forceExternalLinks(html) {
  return String(html || '').replace(/<a\b([^>]*)>/gi, (tag, attrs) => {
    let a = attrs;
    if (!/\btarget\s*=/i.test(a)) a += ' target="_blank"';
    else a = a.replace(/\btarget\s*=\s*("[^"]*"|'[^']*'|\S+)/i, 'target="_blank"');
    if (!/\brel\s*=/i.test(a)) a += ' rel="noopener"';
    else if (!/\brel\s*=\s*("[^"]*noopener|'[^']*noopener)/i.test(a)) {
      a = a.replace(/\brel\s*=\s*"([^"]*)"/i, 'rel="$1 noopener"');
    }
    return `<a${a}>`;
  });
}

/**
 * A placeholder image that needs NO NETWORK.
 *
 * ⛔ IT USED TO BE A placehold.co URL, AND A SCREENSHOT IS WHAT CAUGHT IT.
 * Three problems, none visible while reading the code: it is a third-party
 * request from a student-facing page; it renders as a BROKEN IMAGE icon
 * wherever that host is slow or blocked (it failed in the capture harness on a
 * healthy connection); and a broken image collapses to ~20px, so the
 * "does it stack on a phone" check silently measured nothing. Self-contained is
 * this module's whole rule — the block lands in a blank document — and an
 * external image is the one thing in it that was not.
 *
 * `#` must be percent-encoded in a data URI, and the SVG uses single quotes so
 * it can sit inside a double-quoted HTML attribute.
 */
const ph = (label, w = 600, h = 360) => `data:image/svg+xml;utf8,`
  + `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>`
  + `<rect width='${w}' height='${h}' fill='%23e9ecef'/>`
  + `<text x='${w / 2}' y='${h / 2}' fill='%235c6773' font-family='sans-serif'`
  + ` font-size='${Math.round(w / 16)}' text-anchor='middle'>${label}</text></svg>`;

export const BLOCKS = [
  // ── ข้อความ ───────────────────────────────────────────────────────────────
  {
    id: 'samo-heading', label: 'หัวข้อ', category: CAT.TEXT,
    content: '<h2 style="margin:0 0 8px;font-size:1.35rem;color:#105922">หัวข้อของฝ่าย</h2>',
  },
  {
    id: 'samo-subheading', label: 'หัวข้อย่อย', category: CAT.TEXT,
    content: '<h3 style="margin:14px 0 6px;font-size:1.08rem;color:#1f2933">หัวข้อย่อย</h3>',
  },
  {
    id: 'samo-text', label: 'ข้อความ', category: CAT.TEXT,
    content: '<p style="margin:0 0 12px">พิมพ์ข้อความของฝ่ายที่นี่ กดสองครั้งเพื่อแก้</p>',
  },
  {
    id: 'samo-list', label: 'รายการ', category: CAT.TEXT,
    content: '<ul style="margin:0 0 12px;padding-left:22px">'
      + '<li style="margin:0 0 4px">รายการที่หนึ่ง</li>'
      + '<li style="margin:0 0 4px">รายการที่สอง</li>'
      + '<li>รายการที่สาม</li></ul>',
  },
  {
    id: 'samo-steps', label: 'ขั้นตอน', category: CAT.TEXT,
    content: '<ol style="margin:0 0 12px;padding-left:22px">'
      + '<li style="margin:0 0 6px">ขั้นตอนแรก</li>'
      + '<li style="margin:0 0 6px">ขั้นตอนที่สอง</li>'
      + '<li>ขั้นตอนสุดท้าย</li></ol>',
  },
  {
    id: 'samo-quote', label: 'คำพูด', category: CAT.TEXT,
    content: '<blockquote style="margin:0 0 12px;padding:10px 16px;border-left:4px solid #105922;'
      + 'background:#f8f9fa;color:#3d4852;font-style:italic">'
      + 'ข้อความที่อยากเน้นให้คนอ่านจำได้</blockquote>',
  },

  // ── รูปภาพ ────────────────────────────────────────────────────────────────
  {
    id: 'samo-image', label: 'รูปภาพ', category: CAT.MEDIA,
    // A placeholder the author replaces by double-clicking; GrapesJS's asset
    // manager opens on an image component.
    content: { type: 'image', style: { width: '100%', margin: '0 0 12px' } },
  },
  {
    id: 'samo-image-text', label: 'รูปคู่ข้อความ', category: CAT.MEDIA,
    // The commonest ฝ่าย layout there is. Side by side on a laptop, stacked on
    // a phone, with nothing to configure — the image basis is the wider of the
    // two so the TEXT is what gives way first.
    content: '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start;margin:0 0 12px">'
      + `<img src="${ph('รูป')}" alt=""`
      + ' style="flex:1 1 260px;min-width:0;max-width:100%;border-radius:10px">'
      + '<div style="flex:1 1 240px"><h3 style="margin:0 0 6px;font-size:1.08rem">หัวข้อ</h3>'
      + '<p style="margin:0;color:#3d4852">คำอธิบายที่อยู่ข้างรูป</p></div></div>',
  },
  {
    id: 'samo-gallery', label: 'รูปหลายรูป', category: CAT.MEDIA,
    content: '<div style="display:flex;flex-wrap:wrap;gap:10px;margin:0 0 12px">'
      + `<img src="${ph('1', 400, 300)}" alt="" style="flex:1 1 160px;min-width:0;max-width:100%;border-radius:8px">`
      + `<img src="${ph('2', 400, 300)}" alt="" style="flex:1 1 160px;min-width:0;max-width:100%;border-radius:8px">`
      + `<img src="${ph('3', 400, 300)}" alt="" style="flex:1 1 160px;min-width:0;max-width:100%;border-radius:8px">`
      + '</div>',
  },

  // ── กล่องและการ์ด ─────────────────────────────────────────────────────────
  {
    id: 'samo-card', label: 'การ์ด', category: CAT.BOX,
    content: '<div style="border:1px solid #dee2e6;border-radius:12px;padding:16px;'
      + 'background:#fff;margin:0 0 12px">'
      + '<h3 style="margin:0 0 6px;font-size:1.05rem">หัวข้อการ์ด</h3>'
      + '<p style="margin:0;color:#5c6773">คำอธิบายสั้นๆ</p></div>',
  },
  {
    id: 'samo-card-image', label: 'การ์ดพร้อมรูป', category: CAT.BOX,
    content: '<div style="display:flex;flex-wrap:wrap;gap:16px;margin:0 0 12px">'
      + '<div style="flex:1 1 240px;border:1px solid #dee2e6;border-radius:12px;overflow:hidden;background:#fff">'
      + `<img src="${ph('รูป')}" alt="" style="width:100%">`
      + '<div style="padding:14px"><h3 style="margin:0 0 6px;font-size:1.05rem">หัวข้อการ์ด</h3>'
      + '<p style="margin:0;color:#5c6773">คำอธิบายสั้นๆ</p></div></div>'
      + '<div style="flex:1 1 240px;border:1px solid #dee2e6;border-radius:12px;overflow:hidden;background:#fff">'
      + `<img src="${ph('รูป')}" alt="" style="width:100%">`
      + '<div style="padding:14px"><h3 style="margin:0 0 6px;font-size:1.05rem">หัวข้อการ์ด</h3>'
      + '<p style="margin:0;color:#5c6773">คำอธิบายสั้นๆ</p></div></div></div>',
  },
  {
    id: 'samo-callout', label: 'กล่องสำคัญ', category: CAT.BOX,
    // Brand orange, the accent this site already uses for "pay attention".
    content: '<div style="border-left:4px solid #FF6F30;background:#fff6f1;border-radius:8px;'
      + 'padding:14px 16px;margin:0 0 12px">'
      + '<strong style="display:block;margin:0 0 4px;color:#9a3b12">สิ่งที่ต้องรู้</strong>'
      + '<span style="color:#3d4852">ข้อความสำคัญที่อยากให้คนอ่านเห็นก่อน</span></div>',
  },
  {
    id: 'samo-faq', label: 'คำถามที่พบบ่อย', category: CAT.BOX,
    // <details> is native HTML: it opens and closes with NO javascript, which
    // matters because this lands in a blank sandboxed document where nothing
    // this site loads exists. An accordion built on Bootstrap's JS would sit
    // there dead.
    content: '<div style="margin:0 0 12px">'
      + '<details style="border:1px solid #dee2e6;border-radius:8px;padding:10px 14px;margin:0 0 8px">'
      + '<summary style="cursor:pointer;font-weight:600">คำถามข้อแรก</summary>'
      + '<p style="margin:8px 0 0;color:#3d4852">คำตอบของคำถามข้อแรก</p></details>'
      + '<details style="border:1px solid #dee2e6;border-radius:8px;padding:10px 14px">'
      + '<summary style="cursor:pointer;font-weight:600">คำถามข้อที่สอง</summary>'
      + '<p style="margin:8px 0 0;color:#3d4852">คำตอบของคำถามข้อที่สอง</p></details></div>',
  },
  {
    id: 'samo-contact', label: 'ข้อมูลติดต่อ', category: CAT.BOX,
    content: '<div style="border:1px solid #dee2e6;border-radius:12px;padding:16px;'
      + 'background:#f8f9fa;margin:0 0 12px">'
      + '<h3 style="margin:0 0 8px;font-size:1.05rem;color:#105922">ติดต่อฝ่าย</h3>'
      + '<p style="margin:0 0 4px">ผู้ประสานงาน: ชื่อ-สกุล</p>'
      + '<p style="margin:0">อีเมล: name@kkumail.com</p></div>',
  },
  {
    id: 'samo-table', label: 'ตาราง', category: CAT.BOX,
    // The wrapper is the point: a table wider than the phone scrolls inside its
    // own box instead of pushing the whole ฝ่าย page sideways.
    content: '<div style="overflow-x:auto;margin:0 0 12px">'
      + '<table style="border-collapse:collapse;width:100%;min-width:320px">'
      + '<thead><tr style="background:#f1f3f5">'
      + '<th style="border:1px solid #dee2e6;padding:8px 10px;text-align:left">หัวตาราง</th>'
      + '<th style="border:1px solid #dee2e6;padding:8px 10px;text-align:left">หัวตาราง</th></tr></thead>'
      + '<tbody>'
      + '<tr><td style="border:1px solid #dee2e6;padding:8px 10px">ข้อมูล</td>'
      + '<td style="border:1px solid #dee2e6;padding:8px 10px">ข้อมูล</td></tr>'
      + '<tr><td style="border:1px solid #dee2e6;padding:8px 10px">ข้อมูล</td>'
      + '<td style="border:1px solid #dee2e6;padding:8px 10px">ข้อมูล</td></tr>'
      + '</tbody></table></div>',
  },

  // ── ลิงก์ ─────────────────────────────────────────────────────────────────
  // ⛔ EVERY LINK CARRIES target="_blank" rel="noopener", AND IT IS NOT STYLE.
  // These land in a frame sandboxed WITHOUT allow-same-origin and WITHOUT
  // allow-top-navigation, so a bare <a href> navigates THE FRAME: the linked
  // page loads inside the little embedded box on the ฝ่าย page, at the block's
  // own height. `allow-popups` is in the sandbox list precisely so _blank
  // works; dept-content.js already renders its card links this way.
  {
    id: 'samo-button', label: 'ปุ่มลิงก์', category: CAT.LINK,
    content: '<a href="#" target="_blank" rel="noopener" style="display:inline-block;'
      + 'padding:9px 18px;border-radius:8px;background:#105922;color:#fff;'
      + 'text-decoration:none;margin:0 0 12px">เปิดลิงก์</a>',
  },
  {
    id: 'samo-buttons', label: 'ปุ่มหลายปุ่ม', category: CAT.LINK,
    content: '<div style="display:flex;flex-wrap:wrap;gap:10px;margin:0 0 12px">'
      + '<a href="#" target="_blank" rel="noopener" style="flex:0 1 auto;padding:9px 18px;'
      + 'border-radius:8px;background:#105922;color:#fff;text-decoration:none">ปุ่มหลัก</a>'
      + '<a href="#" target="_blank" rel="noopener" style="flex:0 1 auto;padding:9px 18px;'
      + 'border-radius:8px;border:1px solid #105922;color:#105922;text-decoration:none">ปุ่มรอง</a>'
      + '</div>',
  },

  // ── จัดวาง ────────────────────────────────────────────────────────────────
  {
    id: 'samo-two', label: '2 คอลัมน์', category: CAT.LAYOUT,
    content: '<div style="display:flex;flex-wrap:wrap;gap:16px;margin:0 0 12px">'
      + '<div style="flex:1 1 260px">คอลัมน์ซ้าย</div>'
      + '<div style="flex:1 1 260px">คอลัมน์ขวา</div></div>',
  },
  {
    id: 'samo-three', label: '3 คอลัมน์', category: CAT.LAYOUT,
    content: '<div style="display:flex;flex-wrap:wrap;gap:16px;margin:0 0 12px">'
      + '<div style="flex:1 1 200px">คอลัมน์ 1</div>'
      + '<div style="flex:1 1 200px">คอลัมน์ 2</div>'
      + '<div style="flex:1 1 200px">คอลัมน์ 3</div></div>',
  },
  {
    id: 'samo-divider', label: 'เส้นคั่น', category: CAT.LAYOUT,
    content: '<hr style="border:0;border-top:1px solid #dee2e6;margin:20px 0">',
  },
  {
    id: 'samo-spacer', label: 'ระยะห่าง', category: CAT.LAYOUT,
    content: '<div style="height:28px"></div>',
  },
];

/**
 * Open the visual editor over the page. Resolves with the HTML to store, or
 * `null` if the person cancelled.
 *
 * @param {string} initialHtml what the row holds today
 * @returns {Promise<string|null>}
 */
export async function openVisualEditor(initialHtml) {
  // Loaded here and nowhere else, so the ~1.1 MB never enters an entry bundle.
  if (!editorPromise) {
    editorPromise = Promise.all([
      import('grapesjs'),
      import('grapesjs/dist/css/grapes.min.css'),
    ]).then(([mod]) => mod.default || mod);
  }
  const grapesjs = await editorPromise;

  const overlay = document.createElement('div');
  overlay.className = 'dve-overlay';
  overlay.innerHTML = `
    <div class="dve-bar">
      <strong class="dve-title">แก้หน้าแบบเห็นภาพ</strong>
      <span class="dve-hint">ลากบล็อกจากขวามาวาง · ดับเบิลคลิกเพื่อแก้ข้อความ · คลิกปุ่มหรือรูป แล้วกรอกช่อง &quot;ลิงก์&quot; ที่ขึ้นมาทางขวา</span>
      <span class="dve-spacer"></span>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-dve="cancel">ยกเลิก</button>
      <button type="button" class="btn btn-sm btn-primary" data-dve="save">
        <i class="bi bi-check-lg"></i> ใช้เนื้อหานี้
      </button>
    </div>
    <div class="dve-body"><div class="dve-canvas"></div></div>`;
  document.body.appendChild(overlay);
  document.body.classList.add('dve-open');

  const editor = grapesjs.init({
    container: overlay.querySelector('.dve-canvas'),
    height: '100%',
    width: 'auto',
    // ⛔ NEVER localStorage. GrapesJS defaults to autosaving into it, which
    // would make the editor's idea of the page outlive — and silently override
    // — what the database actually holds.
    storageManager: false,
    // The author's markup, minus the wrapper this module added last time.
    components: unwrapDocument(initialHtml) || '<p>เริ่มจากลากบล็อกจากทางขวามาวางที่นี่</p>',
    blockManager: { blocks: BLOCKS.map((b) => ({ ...b, category: b.category || CAT.TEXT })) },
    // ⚠️ MOBILE FIRST, and that is the ORDER not just the list — GrapesJS opens
    // on the first device. Most of this site's traffic is phones, and a ฝ่าย who
    // never switches width is the person this defends against.
    deviceManager: {
      devices: [
        { id: 'mobile', name: 'มือถือ', width: '390px', widthMedia: '575px' },
        { id: 'tablet', name: 'แท็บเล็ต', width: '768px', widthMedia: '991px' },
        { id: 'desktop', name: 'คอมพิวเตอร์', width: '', widthMedia: '' },
      ],
    },
  });

  // ⛔ THE TRAIT LABELS ARE THAI, AND `href` IS THE ONLY ONE THAT MATTERS.
  // GrapesJS labels these "href" / "title" / "target" in English by default —
  // unreadable to the audience this editor exists for. `target` is deliberately
  // NOT offered: forceExternalLinks() pins it to _blank, because any other
  // value loads the linked site inside the ฝ่าย page's little embedded box.
  editor.DomComponents.addType('link', {
    extend: 'link',
    model: {
      defaults: {
        traits: [
          { type: 'text', name: 'href', label: 'ลิงก์', placeholder: 'https://…' },
          { type: 'text', name: 'title', label: 'คำอธิบาย (ไม่ใส่ก็ได้)' },
        ],
      },
    },
  });
  editor.DomComponents.addType('image', {
    extend: 'image',
    model: {
      defaults: {
        traits: [
          { type: 'text', name: 'alt', label: 'คำบรรยายรูป (สำหรับคนตาบอด)' },
        ],
      },
    },
  });

  // ⛔ OPEN THE BLOCKS PANEL. GrapesJS hides it behind an icon by default, so
  // the first thing a ฝ่าย sees is an empty canvas and a Style Manager saying
  // "Select an element" — which IS the complaint this spike exists to answer:
  // "it is untuitive". Found by screenshotting it, not by reading the docs.
  // The blocks are the only thing on screen that says what to do next.
  const showPanel = (id) => {
    try { editor.Panels.getButton('views', id)?.set('active', true); }
    catch { /* a panel id GrapesJS renamed — the icon still works */ }
  };
  showPanel('open-blocks');

  // ⛔ AND SHOW THE SETTINGS PANEL THE MOMENT SOMETHING IS SELECTED. Reported
  // by the owner on the first real test, in the plainest possible terms:
  //
  //     "i've tested it, i don't even know how to attach link to the button"
  //
  // The URL field EXISTS — it is a GrapesJS trait — but it lives in a panel
  // behind a gear icon, so selecting a button shows you the Style Manager and
  // no way to type a link. The feature was there and unreachable, which is
  // indistinguishable from missing. Switching the panel on selection is what
  // makes it findable, and the Thai trait labels below are what make it
  // readable once found.
  editor.on('component:selected', (component) => {
    if (component?.get('traits')?.length) showPanel('open-tm');
  });

  return new Promise((resolve) => {
    const close = (value) => {
      editor.destroy();
      overlay.remove();
      document.body.classList.remove('dve-open');
      resolve(value);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target.closest('[data-dve="cancel"]')) close(null);
      else if (e.target.closest('[data-dve="save"]')) {
        // getCss() carries whatever the style manager produced; the blocks
        // themselves are inline-styled, so this is usually small or empty.
        close(wrapDocument(forceExternalLinks(editor.getHtml()), editor.getCss()));
      }
    });
  });
}
