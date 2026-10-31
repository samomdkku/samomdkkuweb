// hand-built-years.test.js — a ทีม SAMO year built by hand (0270).
//
// What it protects: (1) the year ahead reads "ทีมปี 2570" like every other
// year; (2) NO screen can publish a year without going through the dialog
// that asks before a hand-built list is replaced — publish_team_term DELETES
// the year's list and rebuilds it from the live tree; (3) the editor's tree
// order and its "what a delete / move covers" agree with the database.
// The database half is tools/team0270-hand-built-years.sql.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '../strip-comments.js';
import { walkNodes, subtreeIds } from './archive-tree.js';

const SRC = join(import.meta.dirname, '..');

const dbRest = vi.fn();
vi.mock('../db.js', () => ({ dbRest: (...a) => dbRest(...a), currentAccessToken: () => null }));
const askConfirm = vi.fn();
vi.mock('../confirm-modal.js', () => ({ askConfirm: (...a) => askConfirm(...a), askDelete: vi.fn() }));

describe('the year button on เกี่ยวกับเรา', () => {
  it('reads "ทีมปี <year>" for every year, the one ahead included; a typed label wins', async () => {
    const { yearChipLabel } = await import('../org-chart.js');
    expect(yearChipLabel({ year: 2570, label: null })).toBe('ทีมปี 2570');
    expect(yearChipLabel({ year: 2569, label: '  ' })).toBe('ทีมปี 2569');
    expect(yearChipLabel({ year: 2567, label: 'SAMO 67' })).toBe('SAMO 67');
  });
});

describe('publish only through publishTermAsking', () => {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js') && !p.endsWith('.test.js')) files.push(p);
    }
  };
  walk(SRC);

  it('no module but api.js (the definition) and term-dialogs.js calls publishTerm(', () => {
    const callers = files
      .filter((p) => /\bpublishTerm\s*\(/.test(stripComments(readFileSync(p, 'utf8'))))
      .map((p) => relative(SRC, p).split('\\').join('/'))
      .sort();
    expect(callers).toEqual(['team/api.js', 'team/term-dialogs.js']);
  });

  it('both publish buttons use it (the control: the sweep above would pass if neither published at all)', () => {
    for (const f of ['team/terms.js', 'samo-year-admin.js']) {
      expect(stripComments(readFileSync(join(SRC, f), 'utf8')), f).toMatch(/publishTermAsking\(/);
    }
  });
});

describe('publishTermAsking — refusal, second question, replace', () => {
  beforeEach(() => { dbRest.mockReset(); askConfirm.mockReset(); });

  it('a hand-edited refusal asks again; yes calls with replace, and only then', async () => {
    const { publishTermAsking } = await import('./term-dialogs.js');
    askConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
    dbRest
      .mockResolvedValueOnce({ data: null, error: { message: 'TEAM_YEAR_HAND_EDITED:37' } })
      .mockResolvedValueOnce({ data: { nodes: 5, members: 40 }, error: null });
    const res = await publishTermAsking(2570, true);
    expect(res).toEqual({ nodes: 5, members: 40 });
    expect(dbRest).toHaveBeenCalledTimes(2);
    expect(dbRest.mock.calls[0][1].body).toEqual({ p_year: 2570 });
    expect(dbRest.mock.calls[1][1].body).toEqual({ p_year: 2570, p_replace_hand_edits: true });
    expect(askConfirm.mock.calls[1][0].body).toContain('37 คน');
  });

  it('declining the second question replaces nothing', async () => {
    const { publishTermAsking } = await import('./term-dialogs.js');
    askConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    dbRest.mockResolvedValueOnce({ data: null, error: { message: 'TEAM_YEAR_HAND_EDITED:3' } });
    expect(await publishTermAsking(2570, true)).toBeNull();
    expect(dbRest).toHaveBeenCalledTimes(1);
  });

  it('any other error is thrown, not turned into a question', async () => {
    const { publishTermAsking } = await import('./term-dialogs.js');
    askConfirm.mockResolvedValueOnce(true);
    dbRest.mockResolvedValueOnce({ data: null, error: { message: 'publish_team_term: not authorized' } });
    await expect(publishTermAsking(2569, false)).rejects.toThrow(/not authorized/);
    expect(askConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('archive-tree — the editor agrees with the database', () => {
  const N = (id, parent_id, position = 0, name = id) => ({ id, parent_id, position, name });
  const nodes = [N('b', null, 1), N('a', null, 0), N('a2', 'a', 1), N('a1', 'a', 0), N('a1x', 'a1', 0), N('empty', 'b', 0)];

  it('walks depth-first in position order, empty ตำแหน่ง included (a hand-built year starts empty)', () => {
    expect(walkNodes(nodes).map((w) => w.node.id)).toEqual(['a', 'a1', 'a1x', 'a2', 'b', 'empty']);
    expect(walkNodes(nodes).find((w) => w.node.id === 'a1x').path).toBe('a › a1 › a1x');
  });

  it('a subtree is the node and every descendant — what a delete takes and where it may not move', () => {
    expect([...subtreeIds(nodes, 'a')].sort()).toEqual(['a', 'a1', 'a1x', 'a2']);
    expect([...subtreeIds(nodes, 'a1x')]).toEqual(['a1x']);
  });

  it('a node orphaned by a missing parent is not walked — the editor lists it nowhere, so the DB must make it impossible (0270 same-year keys)', () => {
    expect(walkNodes([N('x', 'gone')]).length).toBe(0);
  });
});
