// What the account dashboard (0211) says about a row. The checks were measured
// against production before they were written; these pin that each one fires
// on the broken shape AND stays silent on the healthy ones — "a warning that
// fires on the healthy case is worse than no warning".
import { describe, it, expect } from 'vitest';
import {
  domainOf, signinOf, realMethod, systemsOf, recencyOf, summarize, runChecks,
  issuesById, filterAccounts, sortAccounts, activity, weekStart, ACCOUNT_CHECKS,
  SIGNIN, DOMAINS, RECENCY, FILTERS, SORTS, HEADER_SORTS, DEFAULT_SORT,
} from './checks.js';

const NOW = '2026-10-12T12:00:00Z';
const nowMs = Date.parse(NOW);
const daysAgo = (n) => new Date(nowMs - n * 86400000).toISOString();

/** The three healthy shapes production actually holds. */
const google = (o = {}) => ({ id: 'g1', e: 'a@kkumail.com', n: 'A', c: daysAgo(40), s: daysAgo(2), cf: true,
  pr: 'google', pv: ['google'], pw: false, m: 'google', hp: false, p: { id: 'p1', n: 'A', sid: '6xx' }, hs: true, ...o });
const userpass = (o = {}) => ({ id: 'u1', e: 'bob@samomdkku.app', u: 'bob', n: 'bob', c: daysAgo(100), s: daysAgo(50), cf: true,
  pr: 'email', pv: ['email'], pw: true, m: 'password', hp: true, ...o });
const both = (o = {}) => ({ id: 'b1', e: 'c@kkumail.com', u: 'cee', n: 'C', c: daysAgo(10), s: daysAgo(0.5), cf: true,
  pr: 'google', pv: ['google'], pw: true, m: 'google', hp: true, p: { id: 'p3', n: 'C' }, ...o });
const dash = (accounts, extra = {}) => ({ now: NOW, accounts, passport_orphans: [], migrations: [], roster: [], ...extra });

const hits = (d, id) => runChecks(d).find((c) => c.id === id);

describe('classification', () => {
  it('names the email group, with username accounts as their own group', () => {
    expect(domainOf('x@KKUMAIL.com')).toBe('kkumail');
    expect(domainOf('x@kku.ac.th')).toBe('kku');
    expect(domainOf('x@gmail.com')).toBe('gmail');
    expect(domainOf('x@samomdkku.app')).toBe('synthetic');
    expect(domainOf('x@hotmail.com')).toBe('other');
  });
  it('tells Google, password, both and neither apart', () => {
    expect(signinOf(google())).toBe('google');
    expect(signinOf(userpass())).toBe('password');
    expect(signinOf(both())).toBe('both');
    expect(signinOf({ pv: [], pw: false })).toBe('none');
  });
  it('reads the real method from what auth recorded, not the stored copy', () => {
    expect(realMethod({ pr: 'google', m: 'password' })).toBe('google');
    expect(realMethod({ pr: 'email' })).toBe('password');
  });
  it('does not count the implicit `team` view rung as back-office power', () => {
    expect(systemsOf(google({ mp: ['team'] })).grants).toBe(false);
    expect(systemsOf(google({ mp: ['team', 'pr'] })).grants).toBe(true);
    expect(systemsOf(google({ mp: ['master'] })).master).toBe(true);
  });
  it('puts every account in exactly one recency bucket', () => {
    expect(recencyOf(google({ s: daysAgo(0.2) }), nowMs)).toBe('d1');
    expect(recencyOf(google({ s: daysAgo(3) }), nowMs)).toBe('d7');
    expect(recencyOf(google({ s: daysAgo(400) }), nowMs)).toBe('older');
    expect(recencyOf(google({ s: undefined }), nowMs)).toBe('never');
  });
});

describe('the checks', () => {
  it('raise NOTHING above "info" on the healthy shapes', () => {
    const d = dash([google(), userpass(), both()]);
    const loud = runChecks(d).filter((c) => (c.sev === 'bug' || c.sev === 'review') && c.count > 0);
    expect(loud.map((c) => c.id)).toEqual([]);
  });

  const broken = {
    no_profile: google({ nou: true, m: undefined, hp: undefined }),
    locked_out: google({ pv: [], pw: false }),
    no_username: userpass({ u: undefined }),
    method_drift: google({ m: 'password' }),
    password_drift: userpass({ hp: false }),
    email_drift: google({ emd: true }),
    link_conflict: google({ lc: true }),
    passport_email_drift: google({ pp: { km: 1, sc: 1, emd: true } }),
    manual_grant: google({ pm: ['claude'] }),
    outsider_grant: google({ e: 'x@gmail.com', mp: ['pr'] }),
    unknown_perm: google({ mp: ['no_such_key'] }),
    never_signed_in: google({ s: undefined }),
    kkumail_not_registry: google({ p: undefined }),
    banned: google({ b: true }),
    unconfirmed: google({ cf: false }),
  };
  for (const [id, row] of Object.entries(broken)) {
    it(`${id} fires on its broken shape`, () => {
      expect(hits(dash([row, userpass({ id: 'other' })]), id).ids).toEqual([row.id]);
    });
  }
  it('every per-account check has a broken-shape case above', () => {
    const covered = new Set([...Object.keys(broken), 'same_name', 'moved_old_left']);
    expect(ACCOUNT_CHECKS.map((c) => c.id).filter((id) => !covered.has(id))).toEqual([]);
  });

  it('same_name pairs accounts by name, ignoring case and spacing', () => {
    const d = dash([google({ id: 'a', n: 'Jane  Doe' }), google({ id: 'b', n: 'jane doe' }), google({ id: 'c', n: 'Other' })]);
    expect(hits(d, 'same_name').ids.sort()).toEqual(['a', 'b']);
  });
  it('moved_old_left flags the OLD account only when both still exist', () => {
    const old = google({ id: 'old', e: 'Me@gmail.com', p: undefined });
    const d = dash([old, google({ id: 'new', e: 'me@kkumail.com' })], {
      migrations: [{ from: 'me@gmail.com', to: 'me@kkumail.com', from_exists: true, to_exists: true },
                   { from: 'gone@gmail.com', to: 'x@kkumail.com', from_exists: false, to_exists: false }],
    });
    expect(hits(d, 'moved_old_left').ids).toEqual(['old']);
    expect(hits(d, 'migration_target_missing').count).toBe(1);
  });
  it('carried passport profiles are EXPECTED, never an issue on an account', () => {
    const d = dash([google()], { passport_orphans: [{ e: 'x@kkumail.com', km: 5, sc: 2 }] });
    const c = hits(d, 'passport_orphans');
    expect(c.sev).toBe('expected');
    expect(c.count).toBe(1);
    expect(issuesById(runChecks(d)).size).toBe(0);
  });
  it('bugs sort first', () => {
    const order = runChecks(dash([google({ m: 'password', s: undefined })])).map((c) => c.sev);
    expect(order.indexOf('bug')).toBeLessThan(order.indexOf('info'));
  });
});

describe('the overview', () => {
  const d = dash([google(), userpass(), both(), google({ id: 'g2', e: 'z@gmail.com', s: undefined, c: daysAgo(3) })]);
  const s = summarize(d);
  it('each breakdown adds up to the total — no account is dropped or counted twice', () => {
    const sumOf = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    expect(s.total).toBe(4);
    expect(sumOf(s.signin)).toBe(4);
    expect(sumOf(s.domain)).toBe(4);
    expect(sumOf(s.recency)).toBe(4);
    expect(s.signups.reduce((n, w) => n + w.n, 0)).toBe(4);
    expect(Object.keys(s.signin)).toEqual(SIGNIN.map((x) => x.key));
    expect(Object.keys(s.domain)).toEqual(DOMAINS.map((x) => x.key));
    expect(Object.keys(s.recency)).toEqual(RECENCY.map((x) => x.key));
  });
  it('keeps empty weeks, so a quiet week shows as a gap rather than vanishing', () => {
    const weeks = s.signups.map((w) => w.w);
    for (let i = 1; i < weeks.length; i += 1) {
      expect(weekStart(weeks[i - 1] + 8 * 86400000)).toBe(weeks[i]);
    }
    expect(s.signups.some((w) => w.n === 0)).toBe(true);
  });
  it('the feed does not list a first sign-in as a second event', () => {
    const a = google({ c: daysAgo(1), s: daysAgo(1) });
    expect(activity(dash([a])).map((e) => e.kind)).toEqual(['signup']);
  });
});

describe('the list', () => {
  const rows = [
    google({ id: 'g1', n: 'Beta', c: daysAgo(40), s: daysAgo(2), p: { id: 'p1', n: 'Beta', co: 2568 }, pp: { km: 5, sc: 1 } }),
    userpass({ id: 'u1', n: 'alpha', c: daysAgo(100), s: daysAgo(50) }),
    both({ id: 'b1', m: 'password', n: 'Gamma', c: daysAgo(10), s: daysAgo(0.5), p: { id: 'p3', n: 'Gamma', co: 2569 }, mp: ['master'], pp: { km: 40, sc: 3 } }),
    google({ id: 'n1', n: 'Never', e: 'z@gmail.com', c: daysAgo(5), s: undefined, p: undefined }),
  ];
  const d = dash(rows);
  const checks = runChecks(d);
  const ids = (list) => list.map((a) => a.id);
  const f = (filters) => ids(filterAccounts(rows, filters, checks, nowMs));

  it('filters combine (AND) and a check filter keeps only its hits', () => {
    expect(f({ domain: 'kkumail' })).toEqual(['g1', 'b1']);
    expect(f({ domain: 'kkumail', signin: 'both' })).toEqual(['b1']);
    expect(f({ check: 'method_drift' })).toEqual(['b1']);
    expect(f({ q: 'BOB' })).toEqual(['u1']);
  });
  it('a system can be filtered IN and OUT', () => {
    expect(f({ system: 'passport' })).toEqual(['g1', 'b1']);
    expect(f({ system: '!passport' })).toEqual(['u1', 'n1']);
  });
  it('"สมัครภายใน 30 วัน" holds exactly what the tile counts', () => {
    expect(f({ joined: 'd30' }).length).toBe(summarize(d).new30);
    expect(f({ joined: 'd30' }).sort()).toEqual(['b1', 'n1']);
  });
  it('รุ่น, grants and "any problem" filters', () => {
    expect(f({ cohort: '2569' })).toEqual(['b1']);
    expect(f({ cohort: 'none' })).toEqual(['u1', 'n1']);
    expect(f({ grant: 'master' })).toEqual(['b1']);
    expect(f({ grant: 'none' })).toEqual(['g1', 'u1', 'n1']);
    expect(f({ check: '*' })).toContain('b1');
  });
  it('each exclusive filter splits the accounts exactly — no row lost, none counted twice', () => {
    const ctx = { accounts: rows, checks, cohortLabel: String };
    for (const key of ['signin', 'domain', 'recency', 'cohort']) {
      const def = FILTERS.find((x) => x.key === key);
      const counted = def.options(ctx).reduce((n, o) => n + f({ [key]: o.value }).length, 0);
      expect([key, counted]).toEqual([key, rows.length]);
    }
  });
  it('every filter offers options and every option is a distinct value', () => {
    const ctx = { accounts: rows, checks, cohortLabel: String };
    for (const def of FILTERS) {
      const vals = def.options(ctx).map((o) => o.value);
      expect(vals.length).toBeGreaterThan(0);
      expect(new Set(vals).size).toBe(vals.length);
    }
  });

  it('oldest and newest, both ways, with a never-signed-in account LAST either way', () => {
    expect(ids(sortAccounts(rows, 'signin_desc', new Map()))).toEqual(['b1', 'g1', 'u1', 'n1']);
    expect(ids(sortAccounts(rows, 'signin_asc', new Map()))).toEqual(['u1', 'g1', 'b1', 'n1']);
    expect(ids(sortAccounts(rows, 'created_asc', new Map()))).toEqual(['u1', 'g1', 'b1', 'n1']);
    expect(ids(sortAccounts(rows, 'created_desc', new Map()))).toEqual(['n1', 'b1', 'g1', 'u1']);
  });
  it('by name, method, รุ่น, km and grants', () => {
    expect(ids(sortAccounts(rows, 'name_asc', new Map()))).toEqual(['u1', 'g1', 'b1', 'n1']);
    expect(ids(sortAccounts(rows, 'method', new Map()))[0]).toMatch(/g1|n1/);
    expect(ids(sortAccounts(rows, 'cohort_asc', new Map())).slice(0, 2)).toEqual(['g1', 'b1']);
    expect(ids(sortAccounts(rows, 'km_desc', new Map())).slice(0, 2)).toEqual(['b1', 'g1']);
    expect(ids(sortAccounts(rows, 'grants_desc', new Map()))[0]).toBe('b1');
  });
  it('"ปัญหามากสุด" puts the account with a bug first', () => {
    expect(sortAccounts(rows, 'issues', issuesById(checks))[0].id).toBe('b1');
  });
  it('every sort is labelled, the default exists, and each header names real sorts', () => {
    for (const [k, s] of Object.entries(SORTS)) expect([k, typeof s.label]).toEqual([k, 'string']);
    expect(SORTS[DEFAULT_SORT]).toBeTruthy();
    for (const pair of Object.values(HEADER_SORTS)) for (const k of pair) expect(SORTS[k]).toBeTruthy();
  });
  it('every sort is total: same rows in, same rows out, in a stable order', () => {
    for (const k of Object.keys(SORTS)) {
      const a = ids(sortAccounts(rows, k, issuesById(checks)));
      expect([...a].sort()).toEqual(ids(rows).sort());
      expect(ids(sortAccounts([...rows].reverse(), k, issuesById(checks)))).toEqual(a);
    }
  });
});
