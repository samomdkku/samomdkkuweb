// ==============================================
// EVERY UPLOAD IS ANSWERABLE FOR THE FILE IT REPLACES.
//
// REPORTED: "when i เปลี่ยนรูป it changes the picture but when i look in the
// drive there is still the old picture of me". There was. `my-seat.js` — the
// card EVERY ordinary member uses — uploaded a new portrait, repointed the row,
// and walked away. The admin editor had cleaned up since 0143; this surface
// never had. One rule, two writers, and only one of them knew it.
//
// The file left behind is shared "anyone with the link" forever, so this is a
// privacy defect before it is a storage one: somebody who replaces or removes
// their portrait reasonably believes the old one is gone.
//
// WHY THIS IS A REGISTRY AND NOT A PATTERN MATCH. Two obvious rules both fail:
// "the uploading module must also delete" is wrong (shop/checkout.js uploads a
// slip that shop/api.js deletes, correctly), and "never upload in a change
// handler" is wrong too (the QR, banner and slip pickers upload and PERSIST in
// the same handler, so nothing is ever orphaned). What is actually true is that
// each upload site has an answer to "what happens to the file this replaces",
// and the answer has to be written down — so the table below IS the audit, and
// the test's job is to keep it matching the code.
//
// Adding an upload call site fails this test until you add its row.
// ==============================================
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = new URL('.', import.meta.url);

function jsFiles(dir = SRC, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
    if (e.isDirectory()) jsFiles(u, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(u);
  }
  return out;
}

const rel = (u) => fileURLToPath(u).replace(/.*\/src\/js\//, '');
const UPLOADERS = ['uploadTeamPhoto', 'uploadShopFile', 'uploadProjectFile', 'uploadImageToDrive'];

/**
 * THE AUDIT. One row per module that uploads to Drive.
 *
 *   cleanup  — a regex that must appear in `where` (the module responsible for
 *              trashing the replaced file). Null means nothing cleans up.
 *   why      — required when cleanup is null. It is a statement of known debt,
 *              not an excuse, and it must say what would be needed to close it.
 */
const AUDIT = [
  {
    file: 'team/index.js',
    what: 'ทีม SAMO admin member portrait',
    cleanup: /deleteTeamPhotoIfUnused/, where: 'team/index.js',
  },
  {
    file: 'dept-page-admin.js',
    what: 'หน้าฝ่าย card cover image / looping video (0179)',
    // Both columns are counted by photo_reference_count() — migration 0178 added
    // dept_content.cover_url and .video_url the day ฝ่าย covers shipped — so the
    // shared cleanup answers correctly here with no change of its own.
    cleanup: /deleteTeamPhotoIfUnused/, where: 'dept-page-admin.js',
  },
  {
    file: 'my-seat.js',
    what: 'ข้อมูลของฉัน self-service portrait (เปลี่ยนรูป / นำรูปออก)',
    cleanup: /deleteTeamPhotoIfUnused/, where: 'my-seat.js',
  },
  {
    file: 'team/terms.js',
    what: 'published-year archive portrait',
    cleanup: /deleteTeamPhotoIfUnused/, where: 'team/terms.js',
  },
  {
    file: 'house/index.js',
    what: 'ระบบบ้าน house crest',
    cleanup: /deleteTeamPhotoIfUnused/, where: 'house/index.js',
  },
  {
    file: 'shop/admin-batches.js',
    what: 'batch (pickup-round announcement) picture',
    cleanup: /deleteShopFile/, where: 'shop/admin-batches.js',
  },
  {
    file: 'shop/admin-products.js',
    what: 'product picture',
    cleanup: /deleteShopFile/, where: 'shop/admin-products.js',
  },
  {
    file: 'shop/admin-catalog.js',
    what: 'PromptPay QR picture',
    cleanup: /deleteShopFile/, where: 'shop/admin-catalog.js',
  },
  {
    file: 'shop/admin-banners.js',
    what: 'banner picture',
    // Banner upload has no immediate failure-path delete of its own; the
    // replaced/removed picture is trashed by the shared cleanup helper.
    cleanup: /deleteShopFile/, where: 'shop/admin-image-cleanup.js',
  },
  {
    file: 'shop/checkout.js',
    what: 'payment slip at checkout',
    // The slip is attached to the order in the same flow; it is trashed when
    // the order or the slip is removed, which is shop/api.js's job.
    cleanup: /deleteShopFile/, where: 'shop/api.js',
  },
  {
    file: 'shop/orders.js',
    what: 'payment slip added to an existing order',
    cleanup: /deleteShopFile/, where: 'shop/api.js',
  },
  {
    file: 'projects/send.js',
    what: 'หนังสือโครงการ document at send time',
    cleanup: /deleteProjectFile|deleteProjectFolder/, where: 'projects/inbox.js',
  },
  {
    file: 'projects/inbox.js',
    what: 'หนังสือโครงการ replacement document / signed copy',
    cleanup: /deleteProjectFile/, where: 'projects/inbox.js',
  },
  {
    file: 'main.js',
    what: 'Quill inline images in the VitalSound report form',
    cleanup: null,
    why: 'a VS report body is written ONCE at submit and has no edit path, so '
       + 'nothing is ever replaced. What does leak: an image pasted into the '
       + 'editor by someone who then abandons the form — Quill uploads on '
       + 'insert, so the file exists before any row does and nothing can ever '
       + 'reference it. Closing that needs the draft to hold the pending file '
       + 'until submit, the same upload-on-SAVE change made for portraits.',
  },
  {
    file: 'admin-main.js',
    what: 'announcement cover cropper + Quill inline images',
    // announcements.js owns the diff: on an edit it retires the cover and any
    // body image the new version no longer points at; on a delete it retires
    // everything the article used. See filesToRetire().
    cleanup: /deletePRFile/, where: 'announcements.js',
  },
  {
    file: 'pr-form.js',
    what: 'PR request attachments',
    cleanup: null,
    why: 'DELIBERATE, not debt. file_url is written once by the requester and '
       + 'staff never replace it, so there is no orphan-on-replace. And the '
       + 'staff delete is soft_delete_pr_ticket — RECOVERABLE — so trashing '
       + 'the attachments there would destroy the evidence of a ticket an '
       + 'admin can still restore. Revisit only if a hard delete is added.',
  },
];

describe('every Drive upload site is accounted for', () => {
  const files = jsFiles().map((u) => ({ name: rel(u), code: readFileSync(u, 'utf8') }));
  const codeOf = (name) => files.find((f) => f.name === name)?.code ?? null;

  /** Modules that actually call an uploader (excluding the helpers' own defs). */
  const uploaders = files.filter(({ name, code }) => {
    if (name === 'uploads.js' || name.endsWith('/uploads.js')) return false;
    // pr-form.js does not go through a helper — it POSTs the GAS action itself,
    // which is exactly the kind of call site a helper-name-only scan misses.
    if (/action:\s*'upload\w+File'/.test(code)) return true;
    return UPLOADERS.some((u) => new RegExp(`await\\s+${u}\\s*\\(`).test(code));
  }).map((f) => f.name).sort();

  it('has an audit row for every module that uploads', () => {
    const listed = new Set(AUDIT.map((a) => a.file));
    const missing = uploaders.filter((f) => !listed.has(f));
    expect(missing, `new upload site with no answer for the file it replaces — add a row to AUDIT:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('has no audit row for a module that no longer uploads', () => {
    const stale = AUDIT.map((a) => a.file).filter((f) => !uploaders.includes(f));
    expect(stale, `no longer uploads — remove from AUDIT:\n${stale.join('\n')}`).toEqual([]);
  });

  it('every row that claims a cleanup actually has one', () => {
    const broken = [];
    for (const row of AUDIT) {
      if (!row.cleanup) continue;
      const code = codeOf(row.where);
      if (code == null) { broken.push(`${row.file}: cleanup module ${row.where} does not exist`); continue; }
      if (!row.cleanup.test(code)) {
        broken.push(`${row.file} (${row.what}): ${row.where} no longer calls ${row.cleanup.source}`);
      }
    }
    expect(broken, `an upload whose cleanup vanished leaves a public Drive file forever:\n${broken.join('\n')}`)
      .toEqual([]);
  });

  it('makes every uncleaned upload state why, and keeps that list shrinking', () => {
    for (const row of AUDIT.filter((r) => !r.cleanup)) {
      expect(row.why, `${row.file} uploads with no cleanup and no reason given`).toBeTruthy();
      // A module that gained a cleanup must be promoted out of the debt list.
      const code = codeOf(row.file) || '';
      expect(
        /deleteTeamPhotoIfUnused|deleteShopFile|deleteProjectFile|deletePRFile/.test(code),
        `${row.file} now has a cleanup call — give its AUDIT row a cleanup regex`,
      ).toBe(false);
    }
  });
});
