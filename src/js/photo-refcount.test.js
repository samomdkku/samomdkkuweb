// ==============================================
// EVERY TABLE THAT HOLDS A photo_url MUST BE COUNTED BEFORE THE FILE IS DELETED.
//
// THE BUG THIS EXISTS FOR. `deleteTeamPhotoIfUnused` counted `team_members` and
// `team_archive_members`, which was the complete list until migration 0132 gave
// `people` a `photo_url` and its mirror copied the same URL down to
// `students.photo_url`. Nobody updated the count, so:
//
//   delete a ทีม SAMO member whose portrait had mirrored
//     → the count says 0 references
//     → the Drive file is deleted
//     → `people` and `students` still point at it
//     → the person's own card and ระบบบ้าน show a broken image, permanently.
//
// Measured on a rollback transaction before the fix. The failure mode is DATA
// DESTRUCTION performed by a cleanup that believed it was safe, and nothing
// about the code looked wrong — the count was correct for the world it was
// written in.
//
// So the list is a test now: any table that grows a `photo_url` has to appear in
// the refcount, or this fails. A guard test is the only thing that survives
// somebody adding a fifth holder in eighteen months.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const API = new URL('./team/api.js', import.meta.url);

/**
 * Tables RENAMED since the DDL that created them. The scan reads every
 * migration ever written, so it finds the name a column was born under —
 * `team_people` became `public.people` in 0132 and the row it names is the same
 * row. Without this the test would demand a query against a table that no
 * longer exists.
 */
const RENAMED = { team_people: 'people' };

/**
 * EVERY `*_url` COLUMN IN THE SCHEMA, and a decision about each one.
 *
 * ⚠️ THE SCAN USED TO LOOK FOR THE LITERAL NAME `photo_url`, AND THAT IS WHY IT
 * PASSED OVER A REAL HOLE FOR THREE DAYS. `houses.icon_url` — the house crest:
 * same uploader, same `photoToRetire` rule, same `deleteTeamPhotoIfUnused` — was
 * invisible to it. The refcount did not count it, so the count answered 0 for
 * every crest, and 0 is the answer that authorises an irreversible delete. A
 * guard that cannot SEE the hazard reports the hazard as absent (mistakes class
 * 7, on the instrument rather than on the query). Fixed in 0146.
 *
 * So the scan is now exhaustive and the test FORCES A DECISION: every `*_url`
 * column in the migration tree must either be COUNTED by
 * `photo_reference_count`, or appear in `NOT_A_PORTRAIT` with a reason. Adding a
 * new one to the schema fails the build until somebody chooses — which is the
 * only mechanism that survives a column being added in eighteen months by
 * somebody who has never read this file.
 */
const NOT_A_PORTRAIT = new Map([
  // A FOLDER, not a file. Nothing trashes it, and it can never be the argument.
  ['projects.drive_folder_url', 'a Drive folder, not a file'],
  // An arbitrary destination somebody typed — not an upload this app owns.
  ['shop_banners.link_url', 'an external link, not an uploaded file'],
  // ── Drive files, but a DIFFERENT cleanup and a different URL vocabulary ────
  // These are real Drive files, and they are deliberately NOT counted here.
  // `photo_reference_count` compares URL STRINGS, and one Drive file has many
  // spellings (`=w1200`, `=w600`, `/view`, lh3 vs drive.google.com). Portraits
  // are all written by one uploader in one spelling, so string equality is
  // sound for them; announcement covers are not, which is exactly why
  // `filesToRetire` in announcements.js diffs FILE IDS instead. Counting these
  // by string would return 0 for a file that IS referenced under another
  // spelling — a fail-open that destroys the file. Widening the refcount to the
  // whole schema means normalising to file ids first; tracked in docs/NEXT.md.
  ['announcements.thumbnail_url', 'covers are cleaned by filesToRetire (file IDS, not URL strings)'],
  ['pr_tickets.file_url', 'PR attachments are cleaned by deletePRFile'],
  ['project_files.drive_view_url', 'project files are cleaned by the projects flow'],
  // Corrected 2026-09-21: "no cleanup path" was stale — the product editor
  // trashes a replaced image after the save, skipping one another product
  // still shows. A shop admin reads every shop row, so that check is complete
  // for the caller, which is what a client-side refcount needs.
  ['shop_products.image_url', 'cleaned by the product editor, which checks every other product first'],
  ['shop_banners.image_url', 'as shop_products.image_url'],
  // 0201. Each is its OWN upload into Shop/Batches, made and replaced only by
  // the announcement editor, which checks other announcements and products
  // before trashing. It is never a portrait, never passed to this function.
  ['shop_pickup_batches.image_url', 'cleaned by the announcement editor, which checks announcements + products first'],
  ['shop_orders.slip_url', 'a payment slip — never passed to this function'],
  ['shop_promptpay_qrs.qr_url', 'a QR image — never passed to this function'],
  ['shop_settings.promptpay_qr_url', 'as shop_promptpay_qrs.qr_url'],
]);

/** Every `table.column` in the migration tree whose name ends in `_url`. */
function urlColumns() {
  const found = new Map();          // table.col -> table
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(new URL(name, MIGRATIONS), 'utf8');

    // `alter table <t> ... add column [if not exists] <x>_url`
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      for (const add of m[2].matchAll(
        /add\s+column\s+(?:if\s+not\s+exists\s+)?(\w*_url)\b/gi)) {
        const table = RENAMED[m[1]] || m[1];
        found.set(`${table}.${add[1]}`, table);
      }
    }

    // `create table <t> ( ... <x>_url ... )`
    for (const m of sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\);/gi)) {
      for (const col of m[2].matchAll(/^\s*(\w*_url)\s/gim)) {
        const table = RENAMED[m[1]] || m[1];
        found.set(`${table}.${col[1]}`, table);
      }
    }
  }
  // Columns a later migration DROPPED are not in the live schema and must not
  // be demanded of the count.
  for (const name of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql'))) {
    const sql = readFileSync(new URL(name, MIGRATIONS), 'utf8');
    for (const m of sql.matchAll(
      /alter\s+table\s+(?:if\s+exists\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi)) {
      for (const drop of m[2].matchAll(
        /drop\s+column\s+(?:if\s+exists\s+)?(\w*_url)\b/gi)) {
        found.delete(`${RENAMED[m[1]] || m[1]}.${drop[1]}`);
      }
    }
  }
  return found;
}

/** The tables the refcount is expected to count. */
function tablesWithPhotoUrl() {
  const out = new Set();
  for (const [key, table] of urlColumns()) {
    if (!NOT_A_PORTRAIT.has(key)) out.add(table);
  }
  return out;
}

/** The LIVE body of photo_reference_count — from the latest migration that
 *  defines it, never the one that first did (docs/mistakes/postgres-schema.md). */
function refcountSql() {
  const defining = readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql'))
    .filter((n) => readFileSync(new URL(n, MIGRATIONS), 'utf8')
      .includes('function public.photo_reference_count'))
    .sort();
  expect(defining.length, 'no migration defines photo_reference_count')
    .toBeGreaterThan(0);
  const sql = readFileSync(new URL(defining[defining.length - 1], MIGRATIONS), 'utf8');
  const from = sql.lastIndexOf('create or replace function public.photo_reference_count');
  return sql.slice(from, sql.indexOf('$$;', from));
}

describe('the portrait refcount knows every table that references a portrait', () => {
  it('counts every table the schema gives a photo_url', () => {
    // The count lives in SQL (0143), not in the client: `students` and
    // `advisors` need `house`, the caller deleting a member holds `team_edit`,
    // and RLS answers that with zero rows rather than an error — so a
    // client-side count reports "unreferenced" for the very caller that
    // triggers the delete.
    const counted = refcountSql();
    const tables = tablesWithPhotoUrl();
    // Sanity FIRST: a sweep that finds nothing would pass this test forever.
    // "Make it find something you know is there" — mistakes class 7.
    expect(tables.size, 'the DDL scan found no Drive-URL columns at all')
      .toBeGreaterThan(1);
    expect(tables.has('team_members')).toBe(true);
    // THE CONTROL THAT MUST FIND SOMETHING. `houses.icon_url` is the column this
    // scan was blind to for three days, and the whole reason the test was
    // widened. If the scan stops finding it, the widening has been undone and
    // every crest is one drag-and-drop away from destroying another house's.
    expect(tables.has('houses'),
      'the scan lost sight of houses.icon_url — see 0146; a guard that cannot '
      + 'see the hazard reports the hazard as absent').toBe(true);

    const missing = [...tables].filter((t) => !counted.includes(`public.${t}`));
    expect(missing,
      `photo_reference_count does not count: ${missing.join(', ')} — `
      + 'a table holding a photo_url that the count does not know about makes '
      + 'the count report 0 for a file that is still in use, and the cleanup '
      + 'then destroys it')
      .toEqual([]);
  });

  it('runs as a DEFINER, or the caller who deletes cannot see what it counts', () => {
    expect(refcountSql()).toMatch(/security\s+definer/i);
  });

  it('answers a blank URL with a reference, never with zero', () => {
    // Nonsense input must not read as "nothing uses this" — the caller's next
    // move on a 0 is an irreversible delete.
    expect(refcountSql()).toMatch(/then\s+1\b/);
  });

  it('the client keeps the file unless the answer is a definite zero', () => {
    // The fail-open direction here destroys somebody's portrait. An error, a
    // null, or a shape change all mean "I could not check".
    const body = readFileSync(API, 'utf8');
    const fn = body.slice(body.indexOf('export async function deleteTeamPhotoIfUnused'));
    const client = fn.slice(0, fn.indexOf('\n}'));
    expect(client).toMatch(/if\s*\(error\)\s*\{[\s\S]*?return false/);
    expect(client).toMatch(/Number\.isFinite/);
    expect(client).toMatch(/refs\s*!==\s*0/);
  });
});
