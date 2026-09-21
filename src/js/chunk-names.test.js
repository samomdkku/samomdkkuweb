// chunk-names.test.js — no file we ship may look like a tracker by NAME.
//
// Measured 2026-09-21 on production: block the one shared chunk Rollup had
// named `analytics-<hash>.js` and the whole portal never starts (every button
// dead, the boot watchdog's failure bar). Content blockers and userscript
// managers remove files that look like tracking; on another site that costs
// the site its analytics, here it cost the site. tools/chunk-names.mjs renames
// such a chunk `core`; this pins both the rule and that the build USES it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { safeChunkName, TRACKERISH } from '../../tools/chunk-names.mjs';

describe('chunk names', () => {
  it.each(['analytics', 'analytics-dashboard', 'tracking', 'ads', 'stats', 'telemetry', 'pixel', 'banner'])(
    '%s is renamed', (n) => expect(safeChunkName(n)).toBe('core'));
  it.each(['index', 'd3-org-chart', 'esign', 'grapes', 'public', 'admin', 'status', 'address', 'loads'])(
    '%s is kept', (n) => expect(safeChunkName(n)).toBe(n));
  it('the web build routes every chunk name through it', () => {
    const cfg = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8');
    expect(cfg).toMatch(/chunkFileNames:\s*\(chunk\)\s*=>\s*`assets\/\$\{safeChunkName\(chunk\.name\)\}-\[hash\]\.js`/);
  });
  it('CONTROL: the rule does catch the name that broke production', () => {
    expect(TRACKERISH.test('analytics')).toBe(true);
  });
});
