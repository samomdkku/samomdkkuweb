// ==============================================
// TEAM IDENTITY RULES — pure, shared, no DOM and no network.
//
// A person is stored once per ตำแหน่ง, so ~404 rows describe ~285 humans and
// each copy carries its own ชื่อเล่น / ชั้นปี / รูป / kkumail with nothing keeping
// them in step. These functions are the single definition of "who is one
// person, and what is unresolved about them".
//
// WHY IT LIVES IN ITS OWN FILE. It has THREE consumers now:
//   • the ตรวจสอบข้อมูล admin pane (./health.js),
//   • the ตำแหน่งของฉัน card on the PUBLIC site (../my-seat.js), which tells a
//     member what is wrong with their own record so they can fix it,
//   • tools/team-identity-dryrun.mjs, which re-states the same rule in SQL.
// health.js imports ../utils.js and ./api.js, so the public card importing it
// would have pulled the admin module and a database client into the public
// bundle — and re-deriving the rules in the card would have been a THIRD
// implementation of a rule health.js's own header already warns is implemented
// twice. One definition, imported by both.
//
// THE RESOLUTION RULE:
//   1. rows sharing a valid kkumail                 → one person
//   2. a row with NO kkumail joins the email-person holding its รหัส, when
//      EXACTLY ONE such person exists                → one person
//   3. rows with NO kkumail sharing a รหัส          → one person
//   4. anything else                                 → its own person
// Keep it in step with tools/team-identity-dryrun.mjs; if they disagree, the
// tool is the reference because it sees every row with no client in between.
//
// ⚠️ RULE 2 IS A SECOND PASS, and it has to be. It was written as part of a
// single-pass key (`em ? 'e:'+em : sid ? 's:'+sid : 'r:'+id`), which quietly
// made it apply only to no-email rows joining EACH OTHER — a no-email row could
// never reach the email-keyed person holding the same รหัส. Reported live:
//
//   "รหัส 663070019-9 2 คน … ชญาภา เลาหะตานนท์ chayapa.l@kkumail.com …
//    ชญาภา เลาหะตานนท์ ไม่มีอีเมล … this person is the same person but it
//    detects wrong because no email"
//
// Exactly right, and it is the fail-open shape (mistakes class 2): a row with
// no address has no ASSERTED identity, and treating "unknown" as "a different
// human" is the unsafe reading. The safe one is that it resolves to the one
// person who claims that รหัส, or to nobody.
//
// AND IT STILL CANNOT MERGE TWO REAL PEOPLE. 0108's case — `673070332-6`, one
// mistyped รหัส worn by two humans — has an email on BOTH rows, so both are
// email-keyed and rule 2 never looks at them. Where a no-email row's รหัส is
// claimed by TWO email-people, the row stays separate: that ambiguity is the
// finding, not something to guess through.
// ==============================================

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
/** Something sign-in could ever match: one `@`, a dot in the domain, and no
 *  space or comma anywhere. ANY domain — gmail, hotmail, kku.ac.th — signs in
 *  (0272), so the rule is about SHAPE, never about kkumail.
 *
 *  It used to be "has an `@`". One live row literally held `-` (which split
 *  ชญาภา into two people), and another held `…@kku,ail.com` — a comma for the
 *  m — which passed that test, so ตรวจสอบข้อมูล called it fine while the person
 *  could never be matched at sign-in (fixed by hand 2026-11-01). */
export function isEmailAddress(v) {
  return /^[^\s@,]+@[^\s@,]+\.[^\s@,.][^\s@,]*$/.test(String(v ?? '').trim());
}
const email = (v) => {
  const s = clean(v);
  return s && isEmailAddress(s) ? s.toLowerCase() : null;
};

/** Fields a person can only have one of. `photo_url` is included: two rows for
 *  one human showing different portraits is the same bug, just more visible. */
export const IDENTITY_FIELDS = [
  { key: 'full_name', label: 'ชื่อ-สกุล' },
  // คำนำหน้า was here until 0113 dropped the column. It was also the field that
  // produced the least actionable `drift` findings — two rows reading นาย and
  // นางสาว for one human is a typo nobody had to resolve to use the app.
  { key: 'nickname', label: 'ชื่อเล่น' },
  // ชั้นปี was here until 0145 made it DERIVED. Two postings for one human can
  // no longer disagree about it — they compute it from the same registry
  // ingredients — so the check could only ever fire on the dead
  // `team_members.year` column, i.e. report a drift that no longer affects
  // anything a reader sees. A drift check on a value nothing reads is worse than
  // no check: it costs an admin a decision. The รหัสนักศึกษา it derives FROM is
  // still checked, by rule 2 and by `sid_drift`.
  { key: 'major', label: 'สาขา' },
  { key: 'photo_url', label: 'รูป' },
];

/**
 * Group rows into people and list every unresolved ambiguity.
 *
 * Pure — takes plain arrays, returns plain data, touches no DOM and no network,
 * so the rule above is unit-testable rather than eyeballed against production.
 */
export function findIssues(members, nodeName = () => '') {
  const rows = members.map((m) => ({
    id: m.id,
    node_id: m.node_id,
    node: nodeName(m.node_id),
    full_name: clean(m.full_name),
    nickname: clean(m.nickname),
    major: clean(m.major),
    photo_url: clean(m.photo_url),
    sid: clean(m.student_id),
    em: email(m.kkumail),
    rawMail: clean(m.kkumail),
  }));

  // PASS 1 — which รหัส does each EMAIL-person claim. Built before any grouping
  // so rule 2 can ask "who claims this รหัส" without depending on iteration
  // order, and so a รหัส claimed by two email-people is visible as such.
  const sidToEmails = new Map();
  for (const r of rows) {
    if (!r.em || !r.sid) continue;
    if (!sidToEmails.has(r.sid)) sidToEmails.set(r.sid, new Set());
    sidToEmails.get(r.sid).add(r.em);
  }

  // PASS 2 — the key. The prefixes keep the key spaces disjoint so a
  // รหัสนักศึกษา can never collide with an email.
  const keyOf = (r) => {
    if (r.em) return `e:${r.em}`;
    if (r.sid) {
      // Rule 2. Exactly one claimant, or nothing — two claimants is a real
      // ambiguity and guessing between them would put a posting on the wrong
      // human, which is worse than the finding it would have silenced.
      const claimants = sidToEmails.get(r.sid);
      if (claimants && claimants.size === 1) return `e:${[...claimants][0]}`;
      return `s:${r.sid}`;
    }
    return `r:${r.id}`;
  };
  const people = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!people.has(k)) people.set(k, { key: k, rows: [], email: r.em, sids: new Set() });
    const p = people.get(k);
    p.rows.push(r);
    if (r.sid) p.sids.add(r.sid);
    if (!p.email && r.em) p.email = r.em;
  }
  for (const p of people.values()) {
    p.name = p.rows.find((r) => r.full_name)?.full_name || '(ไม่มีชื่อ)';
    p.sids = [...p.sids];
  }

  const issues = [];

  // 1. A kkumail that is not an address. Mechanical — no knowledge needed.
  for (const r of rows) {
    if (r.rawMail && !r.em) {
      issues.push({
        kind: 'invalid_email', id: `mail:${r.id}`, memberId: r.id,
        name: r.full_name, node: r.node, value: r.rawMail,
      });
    }
  }

  // 2. One person, two answers. The admin usually cannot know which is right —
  // so both are offered and neither is preselected.
  for (const p of people.values()) {
    if (p.rows.length < 2) continue;
    for (const f of IDENTITY_FIELDS) {
      const seen = new Map();
      for (const r of p.rows) {
        if (r[f.key] == null) continue;
        if (!seen.has(r[f.key])) seen.set(r[f.key], []);
        seen.get(r[f.key]).push(r.id);
      }
      if (seen.size > 1) {
        issues.push({
          kind: 'drift', id: `drift:${p.key}:${f.key}`, personKey: p.key,
          name: p.name, field: f.key, fieldLabel: f.label,
          memberIds: p.rows.map((r) => r.id),
          values: [...seen].map(([value, ids]) => ({ value, ids })),
        });
      }
    }
  }

  // 3. Rows with no key at all. These people can never be matched to a login,
  // so they are invisible to every self-service flow until one is filled in.
  // A same-name person WITH a key is offered as a suggestion — clicked, never
  // applied, because a name is not evidence.
  const byName = new Map();
  for (const p of people.values()) {
    if (!p.email && !p.sids.length) continue;
    for (const r of p.rows) {
      if (!r.full_name) continue;
      if (!byName.has(r.full_name)) byName.set(r.full_name, new Set());
      byName.get(r.full_name).add(p.key);
    }
  }
  for (const p of people.values()) {
    if (p.email || p.sids.length) continue;
    for (const r of p.rows) {
      const matches = [...(byName.get(r.full_name) || [])]
        .map((k) => people.get(k))
        .filter(Boolean);
      issues.push({
        kind: 'no_key', id: `nokey:${r.id}`, memberId: r.id,
        name: r.full_name, node: r.node,
        suggestions: matches.map((m) => ({
          key: m.key, name: m.name, email: m.email, sid: m.sids[0] || null,
          nodes: m.rows.map((x) => x.node).filter(Boolean),
        })),
      });
    }
  }

  // 3b. A posting with NO kkumail belonging to a person who HAS one.
  //
  // Rule 2 now resolves these to the right human, so they stopped being a
  // (wrong) sid_clash — and would otherwise have become silence, which is not
  // an improvement. The row is still broken in a way that matters: every
  // resolver in this app joins `team_members.kkumail`, so this posting is
  // invisible to the person's own ตำแหน่งของฉัน card and to every permission
  // lookup. Unlike most findings here it has ONE obviously correct answer —
  // the address the person's other rows already carry — so it is the rare
  // mechanical fix.
  for (const p of people.values()) {
    if (!p.email) continue;
    for (const r of p.rows) {
      if (r.em) continue;
      // A row holding a NON-address (the live '-') already has its own
      // invalid_email finding, with a box to fix it. Reporting both puts two
      // items about one cell in front of the admin, and the second one says
      // nothing the first did not.
      if (r.rawMail) continue;
      issues.push({
        kind: 'mail_gap', id: `mailgap:${r.id}`, memberId: r.id,
        name: r.full_name || p.name, node: r.node, value: p.email,
      });
    }
  }

  // 4. One รหัสนักศึกษา under two people. NOT a merge candidate — it is a typo
  // on one of them, and the two are correctly separate.
  const sidOwners = new Map();
  for (const p of people.values()) {
    for (const s of p.sids) {
      if (!sidOwners.has(s)) sidOwners.set(s, []);
      sidOwners.get(s).push(p);
    }
  }
  for (const [sid, owners] of sidOwners) {
    if (owners.length < 2) continue;
    issues.push({
      kind: 'sid_clash', id: `sid:${sid}`, sid,
      people: owners.map((p) => ({
        key: p.key, name: p.name, email: p.email,
        memberIds: p.rows.map((r) => r.id),
        nodes: p.rows.map((r) => r.node).filter(Boolean),
      })),
    });
  }

  // 5. One person carrying two different รหัสนักศึกษา (same email, so the same
  // human — one of the two was mistyped).
  for (const p of people.values()) {
    if (p.sids.length > 1) {
      issues.push({
        kind: 'sid_drift', id: `siddrift:${p.key}`, personKey: p.key,
        name: p.name, values: p.sids,
        memberIds: p.rows.map((r) => r.id),
      });
    }
  }

  return { people: [...people.values()], issues };
}

/** Every id a finding concerns — the same three shapes issuesByMember walks.
 *  Exported because the focus filter and the flag map must agree: if this
 *  missed a shape, clicking a flag would open a pane saying that person has
 *  nothing wrong with them. */
export function idsOf(is) {
  const out = [];
  if (is.memberId) out.push(is.memberId);
  if (Array.isArray(is.memberIds)) out.push(...is.memberIds);
  if (Array.isArray(is.people)) is.people.forEach((p) => out.push(...(p.memberIds || [])));
  return out;
}


/** Short reason labels, used by the admin flags and by the public card. */
export const KIND_LABEL = {
  invalid_email: 'อีเมลไม่ถูกต้อง',
  drift: 'ข้อมูลไม่ตรงกันระหว่างตำแหน่ง',
  sid_drift: 'รหัสนักศึกษาไม่ตรงกัน',
  sid_clash: 'รหัสนักศึกษาซ้ำกับคนอื่น',
  no_key: 'ไม่มีอีเมลและรหัสนักศึกษา',
  mail_gap: 'ตำแหน่งนี้ยังไม่มีอีเมล',
};

/**
 * memberId → the reasons that row needs attention.
 *
 * The count on the mode button says HOW MANY; this is what says WHO, so the
 * flag can sit on the person in จัดการทีม instead of only in a separate pane an
 * admin has to think to open. Every finding shape contributes: `memberId` for
 * the single-row kinds, `memberIds` for the per-person ones, and the nested
 * `people[].memberIds` for a รหัสนักศึกษา clash, which spans two people.
 *
 * Returns a Map so the caller can render without a second pass, and so the same
 * computation feeds both the flags and the count.
 */
export function issuesByMember(members, nodeName) {
  const { issues } = findIssues(members, nodeName);
  const map = new Map();
  const add = (id, kind) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(KIND_LABEL[kind] || kind);
  };
  for (const is of issues) {
    if (is.memberId) add(is.memberId, is.kind);
    if (Array.isArray(is.memberIds)) is.memberIds.forEach((id) => add(id, is.kind));
    if (Array.isArray(is.people)) {
      is.people.forEach((p) => (p.memberIds || []).forEach((id) => add(id, is.kind)));
    }
  }
  return { map, total: issues.length };
}

/** For the badge on the mode button, so an admin sees there is something to do
 *  without having to open the pane and look. */
export function issueCount(members, nodeName) {
  return findIssues(members, nodeName).issues.length;
}
