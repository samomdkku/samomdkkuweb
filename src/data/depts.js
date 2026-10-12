// ============================================================
// depts.js — WHO THE ฝ่าย ARE. One list, read by three places.
//
// This is identity, not content: the name, the icon and the colour of a ฝ่าย
// page. It cannot change without a deploy and that is correct — a ฝ่าย renaming
// itself is a rare, org-level event, unlike the CONTENT of its page, which is
// rows in public.dept_content that the ฝ่าย edits itself (migration 0177).
//
// ⚠️ IT LIVES HERE, NOT IN src/js/departments.js, BECAUSE THREE ENTRIES NEED IT
// and only one of them is the public app: the ฝ่าย page renders it, the admin
// editor lists it to choose which page you are editing, and the ทีม SAMO perms
// modal lists it to grant one. A copy in the admin would be the same fact in
// two files — the drift this repo pays for most often (class 6), and exactly
// what src/data/tools.js was created to end for the tool list.
//
// The KEY is the identifier: it is `dept_content.dept`, `team_nodes.dept_page`,
// and the `data-dept-open` attribute in tab-departments.html. Never reuse one.
// ============================================================

export const DEPT_DEFS = {
  office: {
    eyebrow: 'Department',
    title: 'สำนักนายกฯ',
    icon: 'bi-building',
    colorVar: '--dept-office',
  },
  admin: {
    eyebrow: 'Department',
    title: 'ฝ่ายบริหารองค์กร',
    icon: 'bi-shield',
    colorVar: '--dept-admin',
  },
  digital: {
    eyebrow: 'Department',
    title: 'ฝ่ายดิจิทัลและสื่อสารองค์กร',
    icon: 'bi-megaphone',
    colorVar: '--dept-digital',
  },
  internal: {
    eyebrow: 'Department',
    title: 'ฝ่ายกิจการภายใน',
    icon: 'bi-people',
    colorVar: '--dept-internal',
  },
  external: {
    eyebrow: 'Department',
    title: 'ฝ่ายกิจการภายนอก',
    icon: 'bi-globe',
    colorVar: '--dept-external',
  },
  university: {
    eyebrow: 'Department',
    title: 'ฝ่ายกิจการมหาวิทยาลัย',
    icon: 'bi-buildings',
    colorVar: '--dept-university',
  },
  academic: {
    eyebrow: 'Department',
    title: 'ฝ่ายวิชาการ',
    icon: 'bi-book',
    colorVar: '--dept-academic',
  },
  strategy: {
    eyebrow: 'Department',
    title: 'ฝ่ายยุทธศาสตร์และพัฒนาองค์กร',
    icon: 'bi-puzzle',
    colorVar: '--dept-strategy',
  },
  quality: {
    eyebrow: 'Department',
    title: 'ฝ่ายคุณภาพชีวิตและสิ่งแวดล้อม',
    icon: 'bi-hospital',
    colorVar: '--dept-quality',
  },
  rt: {
    eyebrow: 'Department',
    title: 'ฝ่ายรังสีเทคนิค',
    icon: 'bi-stars',
    colorVar: '--dept-projects',
  },
  media: {
    eyebrow: 'Department',
    title: 'ฝ่ายเวชนิทัศน์',
    icon: 'bi-camera',
    colorVar: '--dept-media',
  },
  hospital: {
    eyebrow: 'Department',
    title: 'ฝ่าย รพ. ร่วมผลิต',
    icon: 'bi-heart-pulse',
    colorVar: '--dept-hospital',
  },
};

/** The ฝ่าย keys, in page order. */
export const DEPT_KEYS = Object.keys(DEPT_DEFS);

/** `[{ value, label }]` — the shape the grant pickers and the editor want. */
export const DEPT_OPTIONS = DEPT_KEYS.map((k) => ({ value: k, label: DEPT_DEFS[k].title }));

/** A ฝ่าย's display name, or the raw key if it is not one we know. Never throws:
 *  a key that has been retired must still be readable where it was granted. */
export const deptLabel = (key) => DEPT_DEFS[key]?.title || key || '';
