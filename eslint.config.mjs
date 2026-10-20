// ESLint — CORRECTNESS rules only. No style, no formatting, no auto-fix
// sweep. The point is to catch the bug class undefined-refs.test.js already
// guards for (a reference to a name nothing declares) over the files that
// test does not cover, plus a short list of other "this can only be a bug"
// rules: unreachable code, duplicate keys, a `switch` that falls through
// unmarked, a condition that can never change, etc.
//
// GLOBALS: this repo mixes browser modules (src/, passport/js/) with Node
// scripts (tools/, server/*.mjs, functions/) and gives each no consistent
// marker (extension, directory depth) a config could key on perfectly — see
// src/js/undefined-refs.test.js, which solved this by unioning Node's own
// REAL globalThis (this file runs under Node, so `process`, `console`,
// `fetch`, `URL`, `Buffer`, … are already on it) with a short explicit list
// of browser/DOM/vendor globals that only exist in a page. Reusing that same
// union here — rather than ESLint's `env: { browser, node }` pair — means a
// name allowed by the proven zero-false-positive guard is allowed here too,
// instead of two guards quietly drifting apart (class 6: two implementations
// of one rule).
const BROWSER_GLOBALS = [
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'matchMedia', 'open', 'close', 'focus', 'blur', 'print',
  'Image', 'Audio', 'FileReader', 'FormData', 'Blob', 'File', 'Headers',
  'Request', 'Response', 'IntersectionObserver', 'MutationObserver',
  'ResizeObserver', 'CustomEvent', 'Event', 'Element', 'HTMLElement',
  'Node', 'NodeFilter', 'DOMParser', 'XMLHttpRequest', 'Worker',
  'MediaRecorder', 'Notification', 'ClipboardItem', 'CSS', 'Option',
  'IDBKeyRange', 'indexedDB', 'caches', 'devicePixelRatio',
  'HTMLCanvasElement', 'HTMLImageElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'Range', 'getSelection', 'visualViewport',
  'beforeunload', 'createImageBitmap',
  // Vendor globals from <script> tags in index.html — not imports.
  'bootstrap', 'Quill',
];

const globals = Object.fromEntries(
  [...Object.getOwnPropertyNames(globalThis), ...BROWSER_GLOBALS,
   'globalThis', 'undefined', 'arguments', 'NaN', 'Infinity'].map((n) => [n, 'readonly']),
);

// CORRECTNESS ONLY — each rule here flags something that can only be a bug,
// never a style choice. No formatting rule, no `eslint:recommended` bundle
// (several of its rules are stylistic, e.g. no-empty, no-extra-semi).
const correctnessRules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-self-assign': 'error',
  'no-fallthrough': 'error',
  'no-constant-condition': 'error',
  'no-unsafe-finally': 'error',
  'no-cond-assign': 'error',
  'no-dupe-else-if': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-unsafe-optional-chaining': 'error',
  // OFF on purpose: flags any mutation of a variable across an `await`, which
  // this codebase does deliberately and safely all over its Supabase/fetch
  // call sites (read-modify-write across a network await, with no concurrent
  // caller to race) — it is a style/caution rule, not a correctness one, and
  // enabling it would be pure noise over real code.
  'require-atomic-updates': 'off',
};

export default [
  {
    ignores: ['node_modules/**', 'dist/**', '**/dist/**'],
  },
  {
    files: [
      'src/**/*.js',
      'passport/js/**/*.js',
      'functions/**/*.js',
      'server/**/*.mjs',
      'tools/**/*.mjs',
      'tools/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals,
    },
    rules: correctnessRules,
  },
];
