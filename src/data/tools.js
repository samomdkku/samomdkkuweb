// ============================================================
// tools.js — THE ฝ่าย TOOL REGISTRY. One list, three consumers.
//
// Before this file existed the same tools were written down TWICE by hand:
// `DEPT_DEFS` in src/js/departments.js rendered the per-ฝ่าย cards, and
// src/html/tab-tools.html hand-wrote every card again for the searchable
// launcher. Adding Golden Period on 2026-08-27 nearly made it a third copy.
// That is `.claude/rules/mistakes.md` class 6 — one fact with many homes — and
// `dept-tool-mirror.test.js` existed only to stop the two drifting silently.
//
// Now both render from here, so the drift is gone by construction rather than
// by ratchet. Designed in docs/DEPT-TOOLS.md §2; this is its step 1. Step 2
// (later) moves this list into a table with an editor so a ฝ่าย can add a tool
// with no deploy at all — which is why every entry carries the fields an editor
// would need, not just the ones the renderer reads today.
//
// ⚠️ ADDING A TOOL IS ONE ENTRY HERE. Do not add markup to tab-tools.html —
// its grid is generated (src/js/launcher.js), and anything hand-written there
// is a second copy again.
//
// FIELD NAMES. `name`/`desc` rather than the `title`/`desc` in the §2 sketch:
// the card renderer has always called it `name`, and renaming it would have
// touched every consumer for nothing. Everything else follows §2.
//
//   slug      stable id — the key an editor/table would store. Never reuse.
//   dept      which ฝ่าย page it appears on, or null for launcher-only tools
//             (ระบบจองห้องสโม belongs to no single ฝ่าย). Must be a key of
//             DEPT_DEFS — `tools-registry.test.js` fails on a typo.
//   kind      'tab' | 'path' | 'external' | 'embed'
//   tabId     kind:'tab'      — the Bootstrap pill to activate
//   path      kind:'path'     — an IN-APP route; MUST exist in PATH_ROUTES
//   href      kind:'external' — opens in a new tab
//   (embed)   kind:'embed'    — a ฝ่าย tool in public/embed/<slug>/, shown in
//             a sandboxed frame at /tools/<slug>. It needs NO path field: the
//             route IS the slug, which is what stops a folder and a route from
//             disagreeing. ⛔ THE ENTRY IS THE GATE — a folder with no entry
//             here is unreachable, which is why CODEOWNERS puts this file
//             behind the owner (docs/DEPT-TOOLS.md §3, §8).
//   keywords  extra search terms for the launcher (Thai + English + acronyms).
//             The visible name is searched too, so do not repeat it here.
//   cats      launcher filter chips, space-separated ('public', 'pr', 'vs')
//   launcher  set false to keep a tool off the launcher (default: shown)
//   home      rank on the HOME page's tool rail (1 = first). Ranked tools lead
//             the rail in rank order; every other launcher tool follows in
//             registry order. The rail is the first thing under the banner,
//             so rank only what most visitors came for.
//   color     the icon square's colour. The glyph on it is white (owner,
//             2026-10-16); on a pale colour it leans on a soft shadow for its
//             edge — see .launcher-tool-icon i in launcher.css.
//   ink       optional glyph colour, for a tool whose mark has its own (the
//             shop's milk-on-espresso). Default white.
//   deptLogo  true = the icon IS the ฝ่าย's own logo (src/data/depts.js `logo`
//             for this entry's `dept`), drawn full-bleed in the square.
//   short     the label under the icon on the home rail (which shows no
//             description). Optional — falls back to `name`. Display only;
//             search still reads `name`.
//
// ORDER IS THE LAUNCHER ORDER. The ฝ่าย pages filter this list, so an entry's
// position also decides where it sits on its ฝ่าย page.
// ============================================================

export const TOOLS = [
  {
    slug: 'pr-form',
    dept: 'digital',
    kind: 'tab',
    tabId: 'pills-pr-tab',
    name: 'PR Form',
    desc: 'ฝากงานประชาสัมพันธ์ลง IG / FB ของคณะ',
    icon: 'bi-megaphone-fill',
    color: '#ff8bbf',
    keywords: 'pr ฝากงาน ประชาสัมพันธ์',
    cats: 'public pr',
    home: 3,
  },
  {
    slug: 'golden-period',
    dept: 'strategy',
    kind: 'path',
    path: '/tools/golden-period',
    name: 'Golden Period',
    desc: 'ดูว่านักศึกษาแต่ละชั้นปีน่าจะว่างช่วงไหน ก่อนเลือกวันจัดโครงการ',
    icon: 'bi-calendar-heart',
    color: '#ffd077',
    keywords: 'gpc ปฏิทิน ช่วงเวลา จัดกิจกรรม จัดโครงการ ว่าง',
    cats: 'public',
    home: 7,
  },
  {
    slug: 'vitalsound',
    dept: 'strategy',
    kind: 'tab',
    tabId: 'pills-vitalsound-tab',
    name: 'VitalSound',
    // The website-bug route has to be READABLE AS ONE wherever this card is
    // drawn (it used to be a footer link, and a footer is where a link goes to
    // not be found) — the launcher and ฝ่าย pages show this desc. The home rail
    // shows no description and labels it VitalSound (owner, 2026-10-16).
    desc: 'ร้องเรียน ข้อเสนอแนะ หรือแจ้งว่าเว็บมีปัญหา / พบบัค',
    icon: 'bi-clipboard2-pulse',
    color: '#588269',
    keywords: 'vs ร้องเรียน ปัญหา ข้อเสนอแนะ',
    cats: 'public vs',
    home: 5,
    short: 'VitalSound',
  },
  {
    slug: 'shop',
    dept: 'admin',
    kind: 'tab',
    tabId: 'pills-shop-tab',
    name: 'ร้านค้า SAMO',
    desc: 'สั่งซื้อเสื้อ ของที่ระลึก และอื่นๆ',
    // The same mark as the banner's shop slide (owner, 2026-10-16): the
    // storefront's espresso square with the filled bag in its milk colour.
    // Values are shop-storefront.css's --sf-espresso / --sf-milk.
    icon: 'bi-bag-heart-fill',
    color: '#4C2B08',
    ink: '#FFF9F0',
    keywords: 'shop สินค้า',
    cats: 'public',
    home: 1,
    short: 'SAMO Shop',
  },
  {
    // Belongs to no single ฝ่าย, so it appears in the launcher only.
    slug: 'room-booking',
    dept: null,
    kind: 'external',
    href: 'https://script.google.com/a/macros/kkumail.com/s/AKfycbyG28fVJFhldajKVJkVUL14m5KImWLtRK6gTNJaH_A7ONGSaJW6cqQFUV-O99PHmptF/exec',
    name: 'ระบบจองห้องสโม',
    desc: 'จองห้องสโมสรนักศึกษาสำหรับกิจกรรม',
    icon: 'bi-calendar-check',
    color: '#bdc96c',
    keywords: 'ห้องสโม จองห้อง booking room reservation',
    cats: 'public',
    home: 2,
    short: 'SAMO Booking',
  },
  {
    // A SEPARATE app at its own base — a full page load here is correct.
    slug: 'passport',
    dept: 'strategy',
    kind: 'external',
    href: '/passport/',
    name: 'SAMO Passport',
    desc: 'เก็บหน่วยกิจกรรมและตรวจสอบสถานะของคุณ',
    icon: 'bi-patch-check',
    color: '#8dc3e1',
    keywords: 'passport activity points หน่วยกิจกรรม กิจกรรม สะสมแต้ม',
    cats: 'public',
    home: 6,
  },
  {
    slug: 'projects-view',
    dept: 'admin',
    kind: 'path',
    path: '/projects-view',
    name: 'หนังสือโครงการ (มุมมองทั่วไป)',
    desc: 'ดูสถานะหนังสือโครงการที่ SAMO ส่งให้เจ้าหน้าที่ — อ่านอย่างเดียว',
    icon: 'bi-folder2',
    color: '#99765e',
    keywords: 'ดู สถานะ ลูกค้า customer view projects bookkeeping',
    cats: 'public',
    home: 4,
    short: 'SAMO Project',
  },
  {
    slug: 'acad-notion',
    dept: 'academic',
    kind: 'external',
    href: 'https://mdkkusamo-acaddatabase.notion.site/MDKKU-SAMO-Academic-Database-222c27821bb280e28e4dfed25056ec14',
    name: 'SAMO Resource Database (Notion)',
    desc: 'ฐานข้อมูลทรัพยากรการเรียนรู้ของฝ่ายวิชาการ',
    icon: 'bi-journals',
    color: '#2f5f9c',
    keywords: 'ฝ่ายวิชาการ การเรียน แหล่งเรียนรู้',
    cats: 'public',
    short: 'Resource Database',
  },
  {
    slug: 'self-exam-bank',
    dept: 'academic',
    kind: 'external',
    href: 'https://mseb.md.kku.ac.th/main',
    name: 'MDKKU Self Exam Bank',
    desc: 'คลังข้อสอบสำหรับฝึกทำด้วยตนเอง',
    icon: 'bi-card-checklist',
    color: '#112957',
    keywords: 'ฝ่ายวิชาการ คลังข้อสอบ ข้อสอบ ฝึกทำ',
    cats: 'public',
    short: 'Self Exam Bank',
  },
  {
    // THE STARTER KIT, and the living proof that the frame works.
    // dept:null + launcher:false means it appears on NO page and in NO search —
    // it exists so `/tools/starter` can be opened by a contributor (and by the
    // guard) to see a real embed rendering under the real chrome. Copy this
    // folder to begin a tool: public/embed/starter/README.md says how.
    slug: 'starter',
    dept: null,
    kind: 'embed',
    launcher: false,
    name: 'ตัวอย่างเครื่องมือฝ่าย (starter)',
    desc: 'ไฟล์ตั้งต้นสำหรับฝ่ายที่จะทำหน้าเครื่องมือของตัวเอง',
    icon: 'bi-box-seam',
    color: 'var(--brand-primary)',
    keywords: 'starter template ตัวอย่าง',
    cats: 'public',
  },
  {
    slug: 'mdi-website',
    dept: 'media',
    kind: 'external',
    href: 'https://ge161892.my.canva.site/mdikku',
    name: 'MDI Website',
    desc: 'เว็บไซต์ของฝ่ายเวชนิทัศน์',
    icon: 'bi-globe2',
    deptLogo: true,
    color: 'var(--dept-media)',
    keywords: 'mdi medical illustration ฝ่ายเวชนิทัศน์ media',
    cats: 'public',
  },
  {
    slug: 'rt-website',
    dept: 'rt',
    kind: 'external',
    href: 'https://rtkkustudent.com/lander',
    name: 'RT Website',
    desc: 'เว็บไซต์ของฝ่ายรังสีเทคนิค',
    icon: 'bi-stars',
    deptLogo: true,
    color: 'var(--dept-rt)',
    keywords: 'rt rangsi รังสีเทคนิค radiology',
    cats: 'public',
  },
];

/** The tools shown on one ฝ่าย's detail page, in registry order. */
export const toolsForDept = (dept) => TOOLS.filter((t) => t.dept === dept);

/** The tools the searchable launcher renders, in registry order. */
export const launcherTools = () => TOOLS.filter((t) => t.launcher !== false);

/** The home page's tool rail: ranked tools first (by `home`), then every
 *  other launcher tool in registry order. Derived from the launcher list so a
 *  tool hidden from the launcher can never surface here by accident. */
export const homeRailTools = () => {
  const all = launcherTools();
  const ranked = all.filter((t) => Number.isFinite(t.home)).sort((a, b) => a.home - b.home);
  return [...ranked, ...all.filter((t) => !Number.isFinite(t.home))];
};

/** The in-app path of a tool that has one, else null.
 *  An embed's path is DERIVED from its slug and never stored: two fields for
 *  one fact is how a route and a folder drift apart (class 6). */
export const toolPath = (t) => (t.kind === 'embed' ? `/tools/${t.slug}` : (t.path || null));

/** Where a tool navigates to — the one place that knows which key holds it. */
export const toolTarget = (t) => t.tabId || toolPath(t) || t.href || '';

/** The ฝ่าย tools that ship as a folder in public/embed/. */
export const embedTools = () => TOOLS.filter((t) => t.kind === 'embed');
