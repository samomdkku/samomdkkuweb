// The CI check handoff:check runs (tools/ci-status.mjs). Pinned on the exact
// shape that hid a red workflow for a session on 2026-10-12: the `migrations`
// workflow failed on one push, and every later push ran only OTHER workflows,
// all green — so "the latest run" looked clean while one workflow was red.
import { describe, it, expect } from 'vitest';
import { ciVerdict } from '../../tools/ci-status.mjs';

const run = (conclusion, sha, status = 'completed') => ({ status, conclusion, headSha: sha, url: `u/${sha}` });

describe('ciVerdict — each workflow answers for itself', () => {
  it('finds a red workflow hidden behind newer green runs of OTHER workflows', () => {
    const v = ciVerdict({
      'build.yml': [run('success', 'e'), run('success', 'd'), run('success', 'a')],
      'migrations.yml': [run('failure', 'a')],     // only ran on `a`
      'docs.yml': [run('success', 'e')],
    });
    expect(v.red.map((r) => r.wf)).toEqual(['migrations.yml']);
    expect(v.green.map((r) => r.wf).sort()).toEqual(['build.yml', 'docs.yml']);
  });
  it('a later green run of the SAME workflow clears it', () => {
    expect(ciVerdict({ 'migrations.yml': [run('success', 'f'), run('failure', 'a')] }).red).toEqual([]);
  });
  it('judges the newest COMPLETED run, not one still in progress', () => {
    const v = ciVerdict({ 'migrations.yml': [run(null, 'f', 'in_progress'), run('failure', 'a')] });
    expect(v.red.map((r) => r.wf)).toEqual(['migrations.yml']);
  });
  it('cancelled and timed out count as red; skipped does not', () => {
    expect(ciVerdict({ a: [run('cancelled', 'x')], b: [run('timed_out', 'x')], c: [run('skipped', 'x')] }).red
      .map((r) => r.wf)).toEqual(['a', 'b']);
  });
  it('a workflow with no completed run on main is neither red nor green', () => {
    const v = ciVerdict({ 'new.yml': [], 'pending.yml': [run(null, 'x', 'queued')] });
    expect(v.none.map((r) => r.wf)).toEqual(['new.yml', 'pending.yml']);
    expect(v.red).toEqual([]);
  });
});
