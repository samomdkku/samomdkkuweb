// ==============================================
// A NAME THAT NOTHING DECLARES IS A DEAD BUTTON.
//
// THE BUG THIS EXISTS FOR: 0141 deleted "ดึงจากระบบบ้าน" from `team/index.js`
// and took the 95 lines sitting directly under it — the 0137 person picker's
// module-scope state plus `renderPersonResults` / `pickPerson` — with it. The
// five names stayed in the CALL sites. `npm run build` was green, 552 tests
// were green, and the deployed page did this:
//
//   - `fillMemberModal` hit `personSearchToken += 1` → ReferenceError, thrown
//     while PREPARING the dialog, so เพิ่มสมาชิก opened nothing and said
//     nothing, on every device;
//   - the search box's input handler hit `personSearchTimer` on the first
//     keystroke, so ค้นหาคนจากระบบ never showed a suggestion.
//
// Two symptoms, one over-deletion, and NOTHING in this repo could see it: Vite
// does not resolve free identifiers, and there is no linter. A comment saying
// "check the neighbours when you delete a block" is exactly the kind of note
// this repo has already proved nobody reads.
//
// So: parse every module and fail the build on any identifier that is READ but
// bound NOWHERE in its file and is not a global.
//
// The binding scan is deliberately WHOLE-FILE and over-approximate — a name
// declared in any scope counts as declared everywhere. That makes shadowing and
// hoisting non-issues and means this test cannot cry wolf; it costs the ability
// to catch "declared in the wrong scope", which is not the shape that has ever
// shipped here. Zero false positives is what keeps a guard test alive
// (docs/mistakes/tooling-proofs.md: a proof that fails for a correct reason
// gets ignored, and then it protects nothing).
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rollup/parseAst';

const SRC = new URL('.', import.meta.url);

function jsFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) jsFiles(u, out);
    else if (e.name.endsWith('.js')) out.push(u);
  }
  return out;
}

/** Browser + tooling globals a module may legitimately reach for. Node's own
 *  `globalThis` covers the language and the web-standard half (fetch, URL,
 *  crypto, TextEncoder…); the DOM half is not there when the tests run, so it
 *  is listed. Add to this list only for a REAL global — a missing entry shows
 *  up here as a failure naming the file, which is the point. */
const BROWSER_GLOBALS = new Set([
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'localStorage', 'sessionStorage', 'alert', 'confirm', 'prompt',
  'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle',
  'matchMedia', 'scrollTo', 'open', 'close', 'focus', 'blur', 'print',
  'Image', 'Audio', 'FileReader', 'FormData', 'Blob', 'File', 'Headers',
  'Request', 'Response', 'IntersectionObserver', 'MutationObserver',
  'ResizeObserver', 'CustomEvent', 'Event', 'Element', 'HTMLElement',
  'Node', 'NodeFilter', 'DOMParser', 'XMLHttpRequest', 'Worker',
  'MediaRecorder', 'Notification', 'ClipboardItem', 'CSS', 'Option',
  'IDBKeyRange', 'indexedDB', 'caches', 'devicePixelRatio',
  'HTMLCanvasElement', 'HTMLImageElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'Range',
  'getSelection', 'visualViewport', 'beforeunload',
  // `createImageBitmap` is a real browser global that Node does not expose; the
  // one call site already feature-detects it.
  'createImageBitmap',
  // Vendor globals from <script> tags in index.html — not imports, so nothing
  // in a module declares them. Most of this repo says `window.bootstrap` (and
  // should, so a missing script degrades instead of throwing); a handful of
  // older call sites use the bare name and are correct at runtime.
  'bootstrap', 'Quill',
]);

const GLOBALS = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  ...BROWSER_GLOBALS,
  'globalThis', 'undefined', 'arguments', 'NaN', 'Infinity',
]);

/** Every name a pattern binds. */
function patternNames(node, out) {
  if (!node || typeof node !== 'object') return out;
  switch (node.type) {
    case 'Identifier': out.add(node.name); break;
    case 'ObjectPattern':
      for (const p of node.properties) {
        patternNames(p.type === 'RestElement' ? p.argument : p.value, out);
      }
      break;
    case 'ArrayPattern':
      for (const el of node.elements) patternNames(el, out);
      break;
    case 'AssignmentPattern': patternNames(node.left, out); break;
    case 'RestElement': patternNames(node.argument, out); break;
    default: break;
  }
  return out;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return; }
  if (typeof node.type !== 'string') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    walk(node[key], visit);
  }
}

/** Names bound anywhere in the module — imports, declarations, parameters,
 *  catch bindings, labels. Over-approximate on purpose (see the header). */
function boundNames(ast) {
  const out = new Set();
  walk(ast, (n) => {
    switch (n.type) {
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
        out.add(n.local.name); break;
      case 'VariableDeclarator': patternNames(n.id, out); break;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        if (n.id) out.add(n.id.name);
        for (const p of n.params) patternNames(p, out);
        break;
      case 'ClassDeclaration':
      case 'ClassExpression':
        if (n.id) out.add(n.id.name); break;
      case 'CatchClause': if (n.param) patternNames(n.param, out); break;
      case 'LabeledStatement': out.add(n.label.name); break;
      default: break;
    }
  });
  return out;
}

/** Identifiers READ as values — i.e. not property keys, not labels, not the
 *  imported/exported half of a specifier, not the name half of a declaration. */
function referencedNames(ast) {
  const hits = new Map();   // name -> first line
  const skip = new Set();   // node objects reached in a non-reference position

  walk(ast, (n) => {
    switch (n.type) {
      case 'MemberExpression': if (!n.computed) skip.add(n.property); break;
      case 'Property':
      case 'PropertyDefinition':
      case 'MethodDefinition':
        if (!n.computed && n.key) skip.add(n.key);
        break;
      case 'ImportSpecifier': skip.add(n.imported); break;
      case 'ExportSpecifier': skip.add(n.local); skip.add(n.exported); break;
      case 'ImportAttribute': skip.add(n.key); break;
      case 'LabeledStatement': skip.add(n.label); break;
      case 'BreakStatement':
      case 'ContinueStatement':
        if (n.label) skip.add(n.label); break;
      case 'MetaProperty': skip.add(n.meta); skip.add(n.property); break;
      default: break;
    }
  });

  const lineOf = (offset, code) => code.slice(0, offset).split('\n').length;
  return { hits, skip, lineOf };
}

describe('every identifier a module uses is one it can reach', () => {
  it('has no free identifier that is neither declared, imported, nor a global', () => {
    const offenders = [];

    for (const f of jsFiles()) {
      const path = fileURLToPath(f);
      const code = readFileSync(f, 'utf8');
      const ast = parseAst(code, { allowReturnOutsideFunction: false });

      const bound = boundNames(ast);
      const { skip, lineOf } = referencedNames(ast);

      const seen = new Set();
      walk(ast, (n) => {
        if (n.type !== 'Identifier' || skip.has(n)) return;
        const name = n.name;
        if (bound.has(name) || GLOBALS.has(name) || seen.has(name)) return;
        seen.add(name);
        offenders.push(
          `${path.replace(/.*\/src\//, 'src/')}:${lineOf(n.start, code)} — ${name}`,
        );
      });
    }

    expect(offenders, `identifier used but never declared:\n${offenders.join('\n')}`)
      .toEqual([]);
  });
});
