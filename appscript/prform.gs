// ============================================================
// prform.gs — Drive file upload + projects email only
//
// Post-Supabase-migration, GAS serves these actions:
//   - uploadPRFile         : upload an image to Drive `PR/`
//                            (chosen over Supabase Storage for the 2 TB quota)
//   - uploadShopFile       : upload a file to a nested Drive folder path
//                            (e.g. 'Shop/Slips/2026-05'). Used by the
//                            shop module for slips, product photos, QR images.
//                            Folders are created lazily as needed.
//   - uploadProjectFile    : same shape as uploadShopFile but allow-listed to
//                            `Projects/...`. Used by the project-tracking
//                            module for หนังสือโครงการ attachments.
//   - notifyProjectEmail   : send an email via MailApp to the receiver
//                            (free, no SMTP needed) when a document is
//                            sent or a file is replaced.
//
// Discord notifications (PR / Vital Sound / หนังสือโครงการ) moved OFF GAS to
// the Cloudflare Pages Function `/notify` (functions/notify.js). Everything
// else (PR submit, tracking, staff dashboard, announcements, agents) is
// handled directly by Supabase from the frontend.
//
// EVERY folder this script touches lives under `My Drive / IT Database`
// (see APP_ROOT_FOLDER_NAME below) — the frontend passes root-relative logical
// paths like `Shop/Slips/2026-05`, and the resolution happens here so no
// client needs to know where the tree is mounted. Legacy spellings
// (`SAMO_Shop`, `SAMO_Team`, `PR_Submissions`) are still accepted; see
// TOP_FOLDER_CANON.
// ============================================================

// ============================================================
// App root — `My Drive / IT Database`
//
// Historically every top-level folder was created directly in My Drive root,
// which made the SAMO Drive unbrowsable. They now live under one container.
//
// Two migrations are folded into a single resolver, both lazy + self-healing:
//   1. LOCATION — a folder still at My Drive root is MOVED in.
//   2. NAME     — the `SAMO_` prefixes existed only to namespace folders that
//                 sat loose in root. `IT Database` does that now, so they are
//                 redundant, and the casing was inconsistent
//                 (PR_Submissions / SAMO_Shop / Projects). A folder found
//                 under a legacy name is RENAMED in place.
//
// Both operations preserve the folder id and every file id inside it, so all
// URLs already stored in Postgres keep resolving — nothing to backfill.
// Creating a fresh folder instead would orphan every existing file (the same
// trap the by-code project folder walker below exists to avoid), which is why
// this resolver only ever moves/renames and only creates as a last resort.
// ============================================================

var APP_ROOT_FOLDER_NAME = 'IT Database';

/**
 * Legacy logical name -> canonical physical folder name.
 *
 * This is BOTH the rename map and the transition allow-list: callers may pass
 * either spelling, so an old frontend bundle held in a browser tab keeps
 * uploading successfully after the rename ships. Entries mapping a name to
 * itself are what make the new spelling legal. Do not delete a legacy key
 * until no deployed bundle can still send it.
 */
var TOP_FOLDER_CANON = {
  'PR_Submissions': 'PR',
  'PR':             'PR',
  'Projects':       'Projects',
  'SAMO_Shop':      'Shop',
  'Shop':           'Shop',
  'SAMO_Team':      'Team',
  'Team':           'Team'
};

/** The canonical top-level folders this script owns. */
var APP_TOP_FOLDERS = ['PR', 'Projects', 'Shop', 'Team'];

/** Canonical physical name for a logical folder name (identity if unmapped). */
function canonTopFolder_(name) {
  return TOP_FOLDER_CANON[name] || name;
}

/** Legacy spellings of a canonical name, excluding the canonical itself. */
function legacyAliases_(canonical) {
  var out = [];
  for (var k in TOP_FOLDER_CANON) {
    if (TOP_FOLDER_CANON[k] === canonical && k !== canonical) out.push(k);
  }
  return out;
}

/** First path segment of a logical folder path. */
function firstSegment_(path) {
  var parts = String(path || '').split('/').filter(function (p) { return p && p.length; });
  return parts.length ? parts[0] : '';
}

/** Get-or-create `My Drive / IT Database`. */
function getAppRoot_() {
  var myDrive = DriveApp.getRootFolder();
  var iter = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  return iter.hasNext() ? iter.next() : myDrive.createFolder(APP_ROOT_FOLDER_NAME);
}

/**
 * Resolve a top-level app folder from EITHER spelling, adopting whatever
 * pre-migration state it is in. Search order — most-migrated first, and the
 * first hit wins so a later step can never shadow an earlier one:
 *
 *   1. app root, canonical name  → done
 *   2. app root, legacy name     → rename
 *   3. My Drive root, canonical  → move in
 *   4. My Drive root, legacy     → move in + rename
 *   5. nothing found             → create (only here)
 */
function getOrCreateTopFolder_(name) {
  var canonical = canonTopFolder_(name);
  var aliases = legacyAliases_(canonical);
  var root = getAppRoot_();
  var myDrive = DriveApp.getRootFolder();
  var i, iter;

  // 1 — already where it belongs.
  iter = root.getFoldersByName(canonical);
  if (iter.hasNext()) {
    var found = iter.next();
    warnIfSplit_(canonical, aliases, root, myDrive, found);
    return found;
  }

  // 2 — right place, old name.
  for (i = 0; i < aliases.length; i++) {
    iter = root.getFoldersByName(aliases[i]);
    if (iter.hasNext()) {
      var renamed = iter.next();
      renamed.setName(canonical);   // id preserved → stored URLs unaffected
      return renamed;
    }
  }

  // 3 / 4 — still at My Drive root, under either spelling.
  var names = [canonical].concat(aliases);
  for (i = 0; i < names.length; i++) {
    iter = myDrive.getFoldersByName(names[i]);
    if (iter.hasNext()) {
      var moved = iter.next();
      moved.moveTo(root);           // id preserved
      if (moved.getName() !== canonical) moved.setName(canonical);
      return moved;
    }
  }

  // 5 — genuinely new.
  return root.createFolder(canonical);
}

/**
 * SPLIT check: another folder for the same logical name exists elsewhere,
 * so older files live where no future upload will look. NEVER merge on a
 * user's upload path — just make the state loud and let inspectDriveLayout /
 * migrateDriveLayout resolve it deliberately.
 */
function warnIfSplit_(canonical, aliases, root, myDrive, keeping) {
  // This runs on the UPLOAD PATH, and each getFoldersByName is a Drive
  // round-trip (~200ms). Measured: the three probes below were half the total
  // folder-resolution time of an upload. The migration is done, so a split is
  // now a rare manual event — cache a clean result and re-check every 6h
  // instead of paying for it on every single upload. inspectDriveLayout /
  // migrateDriveLayout remain the definitive, uncached check.
  var cache = null;
  var key = 'splitclean:' + canonical;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  if (cache && cache.get(key)) return;

  var others = [];
  var i, it;
  for (i = 0; i < aliases.length; i++) {
    it = root.getFoldersByName(aliases[i]);
    if (it.hasNext()) others.push(APP_ROOT_FOLDER_NAME + '/' + aliases[i]);
  }
  var names = [canonical].concat(aliases);
  for (i = 0; i < names.length; i++) {
    it = myDrive.getFoldersByName(names[i]);
    if (it.hasNext()) others.push('My Drive/' + names[i]);
  }
  if (others.length) {
    console.warn('Drive layout SPLIT: using ' + APP_ROOT_FOLDER_NAME + '/' + canonical +
                 ' (' + keeping.getId() + ') but these also exist: ' + others.join(', ') +
                 '. Run inspectDriveLayout().');
    return;   // never cache a DIRTY result — keep warning until it is fixed
  }
  if (cache) {
    try { cache.put(key, '1', 21600); } catch (e) { /* cache is best-effort */ }
  }
}

/** Non-creating twin of getOrCreateTopFolder_, for delete paths — never
 *  materialise a folder just to find out it isn't there. Same search order,
 *  minus the move/rename/create. Returns null when nothing matches. */
function findTopFolder_(name) {
  var canonical = canonTopFolder_(name);
  var names = [canonical].concat(legacyAliases_(canonical));
  var myDrive = DriveApp.getRootFolder();
  var i, iter;

  var rootIter = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  if (rootIter.hasNext()) {
    var root = rootIter.next();
    for (i = 0; i < names.length; i++) {
      iter = root.getFoldersByName(names[i]);
      if (iter.hasNext()) return iter.next();
    }
  }
  for (i = 0; i < names.length; i++) {
    iter = myDrive.getFoldersByName(names[i]);
    if (iter.hasNext()) return iter.next();
  }
  return null;
}

/** Immediate child counts — cheap fingerprint used to prove a move changed
 *  nothing but the parent. Not recursive: `Projects/` has one subfolder per
 *  โครงการ, and a deep walk would blow the 6-minute execution cap. */
function folderFingerprint_(folder) {
  var files = 0, folders = 0;
  var fi = folder.getFiles();    while (fi.hasNext())  { fi.next();  files++; }
  var fo = folder.getFolders();  while (fo.hasNext())  { fo.next();  folders++; }
  return { id: folder.getId(), files: files, folders: folders };
}

/** Every place a top-level folder could be, newest layout first. Returns
 *  [{where, name, folder}] for each candidate that actually exists. */
function locateTopFolder_(canonical, appRoot, myDrive) {
  var names = [canonical].concat(legacyAliases_(canonical));
  var hits = [], i, it;
  if (appRoot) {
    for (i = 0; i < names.length; i++) {
      it = appRoot.getFoldersByName(names[i]);
      if (it.hasNext()) hits.push({ where: APP_ROOT_FOLDER_NAME, name: names[i], folder: it.next() });
    }
  }
  for (i = 0; i < names.length; i++) {
    it = myDrive.getFoldersByName(names[i]);
    if (it.hasNext()) hits.push({ where: 'My Drive', name: names[i], folder: it.next() });
  }
  return hits;
}

/**
 * READ-ONLY inventory. Run this FIRST from the Apps Script editor
 * (Run ▸ inspectDriveLayout) — it touches nothing and tells you exactly what
 * migrateDriveLayout would do, including any SPLIT (the same logical folder
 * existing in more than one place/spelling), which is the one case that needs
 * a human decision.
 */
function inspectDriveLayout() {
  var myDrive = DriveApp.getRootFolder();
  var rootIter = myDrive.getFoldersByName(APP_ROOT_FOLDER_NAME);
  var appRoot = rootIter.hasNext() ? rootIter.next() : null;
  var lines = [APP_ROOT_FOLDER_NAME + ': ' + (appRoot ? 'exists (' + appRoot.getId() + ')' : 'does not exist yet')];

  for (var i = 0; i < APP_TOP_FOLDERS.length; i++) {
    var canonical = APP_TOP_FOLDERS[i];
    var hits = locateTopFolder_(canonical, appRoot, myDrive);

    if (hits.length === 0) {
      lines.push('   ' + canonical + ': not found anywhere — nothing to do (will NOT be created)');
      continue;
    }
    if (hits.length > 1) {
      var desc = hits.map(function (h) {
        return h.where + '/' + h.name + ' ' + JSON.stringify(folderFingerprint_(h.folder));
      });
      lines.push('!! ' + canonical + ': SPLIT across ' + hits.length + ' folders — ' + desc.join('  |  ') +
                 '. migrateDriveLayout will REFUSE. Merge them by hand in Drive, then re-run.');
      continue;
    }
    var hit = hits[0];
    var fp = JSON.stringify(folderFingerprint_(hit.folder));
    var needsMove = hit.where !== APP_ROOT_FOLDER_NAME;
    var needsRename = hit.name !== canonical;
    if (!needsMove && !needsRename) {
      lines.push('   ' + canonical + ': already in place ' + fp);
    } else {
      var todo = [];
      if (needsMove)   todo.push('MOVED into ' + APP_ROOT_FOLDER_NAME);
      if (needsRename) todo.push('RENAMED ' + hit.name + ' -> ' + canonical);
      lines.push('-> ' + canonical + ': at ' + hit.where + '/' + hit.name + ' ' + fp +
                 ' — will be ' + todo.join(' + ') + ' (same id, same contents)');
    }
  }
  var out = lines.join('\n');
  console.log(out);
  return out;
}

/**
 * ONE-SHOT tidy-up: put every top-level folder in its final place and name
 * now, instead of waiting for each one's next upload to adopt it.
 *
 * Run it by hand from the Apps Script editor (Run ▸ migrateDriveLayout)
 * after `inspectDriveLayout`. Not reachable over HTTP — doPost has no route
 * to it.
 *
 * CANNOT LOSE DATA, by construction:
 *   - It only ever calls Folder.moveTo() and Folder.setName(). Nothing is
 *     created, copied, trashed or deleted — both operations preserve the
 *     folder id and every file id inside it, so URLs already stored in
 *     Postgres keep resolving with no backfill.
 *   - It verifies the child counts are identical before and after and
 *     reports a mismatch rather than reporting success.
 *   - A logical folder found in MORE THAN ONE place/spelling is a SPLIT: it
 *     refuses and asks for a manual merge, because silently picking one would
 *     strand the other's files where no future upload would look.
 *   - A folder that exists nowhere is skipped, not created.
 * Idempotent: re-running after a successful pass reports "already in place".
 */
function migrateDriveLayout() {
  var myDrive = DriveApp.getRootFolder();
  var root = getAppRoot_();
  var report = [];

  for (var i = 0; i < APP_TOP_FOLDERS.length; i++) {
    var canonical = APP_TOP_FOLDERS[i];
    var hits = locateTopFolder_(canonical, root, myDrive);

    if (hits.length === 0) { report.push('   ' + canonical + ': not found (nothing to do)'); continue; }
    if (hits.length > 1) {
      report.push('!! ' + canonical + ': REFUSED — exists in ' + hits.length +
                  ' places (' + hits.map(function (h) { return h.where + '/' + h.name; }).join(', ') +
                  '). Merge by hand, then re-run.');
      continue;
    }

    var hit = hits[0];
    var needsMove = hit.where !== APP_ROOT_FOLDER_NAME;
    var needsRename = hit.name !== canonical;
    if (!needsMove && !needsRename) { report.push('   ' + canonical + ': already in place'); continue; }

    var before = folderFingerprint_(hit.folder);
    var did = [];
    if (needsMove)   { hit.folder.moveTo(root);        did.push('MOVED into ' + APP_ROOT_FOLDER_NAME); }
    if (needsRename) { hit.folder.setName(canonical);  did.push('RENAMED ' + hit.name + ' -> ' + canonical); }
    var after = folderFingerprint_(hit.folder);
    var intact = before.id === after.id && before.files === after.files && before.folders === after.folders;
    report.push((intact ? '-> ' : '!! ') + canonical + ': ' + did.join(' + ') + ' — ' +
                (intact ? 'verified intact ' : 'COUNT MISMATCH ') +
                JSON.stringify(before) + ' -> ' + JSON.stringify(after));
  }
  var out = report.join('\n');
  console.log(out);
  return out;
}

// ============================================================
// Caller identity on destructive actions — STAGED, NOT ACTIVE
//
// A `requireSupabaseUser_` gate was written and deployed here: it verified the
// caller's Supabase access token against /auth/v1/user before allowing a
// delete. The logic works, but it is reverted because verifying a token needs
// an external HTTP call, and adding one changes this script's auto-derived
// OAuth scopes (`script.external_request`). This web app runs as its OWNER, so
// until the owner re-consents EVERY execution throws an authorization error —
// which broke all three delete actions in production until this revert.
//
// Re-enabling is deliberately a two-step, IN THIS ORDER:
//   1. the owner opens the script and runs any function, accepting the NEW
//      consent screen (it will now ask to "connect to an external service");
//   2. only then restore the gate and redeploy.
// The reverse order breaks deletes again. The frontend ALREADY sends
// `accessToken` on all three delete actions, so step 2 is the only code change
// needed — the git history has the exact block.
//
// Until then the deletes are protected by folder scoping alone, as they were
// before — see docs/CONTEXT.md.
// ============================================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    console.log('doPost: action=' + (data && data.action ? data.action : '(unknown)'));

    if (data.action === 'uploadPRFile')      return handleUploadPRFile(data);
    if (data.action === 'deletePRFile')      return handleDeletePRFile(data);
    if (data.action === 'uploadShopFile')    return handleUploadShopFile(data);
    if (data.action === 'uploadTeamFile')    return handleUploadTeamFile(data);
    if (data.action === 'deleteShopFile')    return handleDeleteShopFile(data);
    if (data.action === 'deleteTeamFile')    return handleDeleteTeamFile(data);
    if (data.action === 'uploadProjectFile')   return handleUploadProjectFile(data);
    if (data.action === 'deleteProjectFile')   return handleDeleteProjectFile(data);
    if (data.action === 'deleteProjectFolder') return handleDeleteProjectFolder(data);
    if (data.action === 'getProjectFolderInfo') return handleGetProjectFolderInfo(data);
    if (data.action === 'getProjectFileData')   return handleGetProjectFileData(data);
    if (data.action === 'statProjectFiles')     return handleStatProjectFiles(data);
    if (data.action === 'listProjectFolderFiles') return handleListProjectFolderFiles(data);

    if (data.action === 'notifyProjectEmail') {
      try { sendProjectEmail(data); }
      catch (err) {
        console.error('notifyProjectEmail: ' + err);
        return createResponse({ success: false, message: String(err) });
      }
      return createResponse({ success: true });
    }

    // NOTE: Discord notifications (notifyPROnly / notifyProjectDiscord /
    // the Vital Sound actions) moved to the Cloudflare Pages Function
    // `/notify` — see functions/notify.js + skills/cloudflare-notify-function.md.
    // GAS now only does Drive uploads + the projects email.

    return createResponse({ success: false, message: 'Unknown action: ' + data.action });
  } catch (error) {
    console.error('doPost error: ' + error.toString());
    return createResponse({ success: false, message: 'Server error: ' + error.toString() });
  }
}

// ============================================================
// uploadPRFile — accept a base64-encoded image and write to Drive
// ============================================================

function handleUploadPRFile(data) {
  try {
    const folder = getOrCreateTopFolder_('PR');
    const base64Data = data.fileData.split(',')[1];
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createResponse({ success: true, fileUrl: file.getUrl() });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

/**
 * deletePRFile — trash one file under `PR` (by any Drive url form).
 *
 * WHY IT EXISTS: `uploadPRFile` is the OLDEST upload path in this project and
 * the only one that never had a counterpart, so every file it ever wrote is
 * still in Drive. Three surfaces feed it and all three replace:
 *
 *   • an announcement cover — re-cropped on any edit, so one file per re-crop;
 *   • images pasted into a Quill body — replaced or deleted with the article;
 *   • PR request attachments — replaced or removed by staff on the ticket.
 *
 * Each of those files is shared "anyone with the link", which makes an
 * uncleaned replacement a privacy problem before a storage one: a cover that
 * was swapped because the first one was wrong is still publicly readable.
 *
 * Scoped exactly like the Shop / Team / Projects deletes: this endpoint is
 * UNAUTHENTICATED (Execute as: Me + Anyone, and the /exec url ships inside the
 * public bundle), so the ancestry check is the ONLY thing between a caller and
 * the owner's whole Drive. A file that is not under `PR` is refused loudly and
 * never reported as deleted.
 *
 * Adds no new Google service — DriveApp is already used throughout this file —
 * so it does NOT widen the auto-derived OAuth scopes and needs no re-consent.
 * That is the trap that took the delete gate down for an hour on 2026-07-31,
 * and it is the reason this handler is a copy of handleDeleteTeamFile rather
 * than anything cleverer.
 */
function handleDeletePRFile(data) {
  try {
    var url = String(data.fileUrl || '').trim();
    if (!url) return createResponse({ success: false, message: 'fileUrl required' });
    var id = extractDriveId_(url);
    if (!id) return createResponse({ success: false, message: 'unable to extract Drive id from url' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) {
      // Already gone (or never existed) — success, so a caller retrying a
      // cleanup does not loop forever on a file that is already absent.
      return createResponse({ success: true, alreadyGone: true });
    }
    if (!fileLivesUnderTop_(file, 'PR')) {
      return createResponse({ success: false, message: 'file is not inside PR' });
    }
    // Trash, not purge: Drive keeps a 30-day undo window, which is the right
    // trade for an irreversible action driven by an anonymous endpoint.
    revokeAndTrash_(file);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// uploadShopFile — accept a base64-encoded file + a nested folder path
//
// The frontend passes a logical path like `Shop/Slips/2026-05`. We
// walk that path under My Drive, creating any missing folders as we go,
// then drop the file in the leaf. This keeps the 2 TB Drive tidy enough
// to browse manually (one folder per month for slips, one per product,
// etc.) and well below Drive's per-folder file cap.
//
// Allow-list the top-level prefix so a misuse can't write to arbitrary
// places. Currently only 'Shop/...' (or its legacy 'SAMO_Shop/...') is permitted.
// ============================================================

function handleUploadShopFile(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (canonTopFolder_(firstSegment_(path)) !== 'Shop') {
      return createResponse({ success: false, message: 'folderPath must start with Shop (or the legacy SAMO_Shop)' });
    }

    var folder = getOrCreateFolderPath_(path);
    var base64Data = data.fileData.split(',')[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createResponse({ success: true, fileUrl: file.getUrl() });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// uploadTeamFile — ทีม SAMO member portraits, filed by ปีการศึกษา
//
// Same shape as uploadShopFile but allow-listed to 'Team/...' so the
// two features cannot write into each other's tree. The frontend builds
//   Team/<ปีการศึกษา>/<ฝ่าย>/<ลำดับ>-<ชื่อ-สกุล>.webp
// which makes the Drive folder browsable by a human looking for "the 2569
// อุปนายก photos" without needing the app.
//
// The FILENAME is for humans only. The app addresses the photo by Drive
// file id (the returned URL), so renaming a file in Drive later — fixing a
// misspelling, say — never breaks the page. Do not build any lookup that
// depends on the name.
// ============================================================

function handleUploadTeamFile(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (canonTopFolder_(firstSegment_(path)) !== 'Team') {
      return createResponse({ success: false, message: 'folderPath must start with Team (or the legacy SAMO_Team)' });
    }

    var folder = getOrCreateFolderPath_(path);
    var base64Data = data.fileData.split(',')[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createResponse({ success: true, fileUrl: file.getUrl() });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

/**
 * Trash a Drive file by URL. Safety-gated to files that live somewhere
 * under "Shop" (formerly "SAMO_Shop") so a stray call can't nuke unrelated
 * Drive content.
 * Used when admin deletes a shop order — the attached slip image should
 * not orphan in Drive after the row is gone.
 *
 * Trash (vs purge): keeps a 30-day undo window in Drive. Good enough.
 */
function handleDeleteShopFile(data) {
  try {
    var url = String(data.fileUrl || '').trim();
    if (!url) return createResponse({ success: false, message: 'fileUrl required' });
    var id = extractDriveId_(url);
    if (!id) return createResponse({ success: false, message: 'unable to extract Drive id from url' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) {
      // File already gone — treat as success so callers don't retry forever.
      return createResponse({ success: true, alreadyGone: true });
    }
    if (!fileLivesUnderSamoShop_(file)) {
      return createResponse({ success: false, message: 'file is not inside Shop' });
    }
    revokeAndTrash_(file);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

/**
 * deleteTeamFile — trash one ทีม SAMO member portrait (by any Drive url form).
 *
 * WHY IT EXISTS: Shop and Projects have had a delete path on both sides for a
 * long time; Team never did. So replacing a photo, clearing one with นำรูปออก,
 * deleting a member, or abandoning the editor after an upload each left a file
 * in Drive shared "anyone with the link", forever. That is unbounded, and it is
 * a privacy problem more than a storage one — someone who removes their portrait
 * expects it to be gone.
 *
 * Scoped the same way as the Shop and Projects deletes: this endpoint is
 * UNAUTHENTICATED (Execute as: Me + Anyone, and the /exec url ships inside the
 * public bundle), so the only thing standing between a caller and the owner's
 * whole Drive is the ancestry check. A file that is not under `Team` is refused,
 * loudly — never silently reported as deleted.
 *
 * Adds no new Google service (DriveApp is used throughout this file already), so
 * it does NOT widen the auto-derived OAuth scopes and needs no re-consent — the
 * trap that took the delete gate down for an hour on 2026-07-31.
 */
function handleDeleteTeamFile(data) {
  try {
    var url = String(data.fileUrl || '').trim();
    if (!url) return createResponse({ success: false, message: 'fileUrl required' });
    var id = extractDriveId_(url);
    if (!id) return createResponse({ success: false, message: 'unable to extract Drive id from url' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) {
      // Already gone (or never existed) — report success so a caller retrying a
      // cleanup does not loop forever on a file that is already absent.
      return createResponse({ success: true, alreadyGone: true });
    }
    if (!fileLivesUnderTop_(file, 'Team')) {
      return createResponse({ success: false, message: 'file is not inside Team' });
    }
    // Trash, not purge: Drive keeps a 30-day undo window, which is the right
    // trade for an irreversible action driven by an anonymous endpoint.
    revokeAndTrash_(file);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

/**
 * Take a file out of circulation, then trash it.
 *
 * `setTrashed(true)` ALONE IS NOT A REMOVAL. Proven live on 2026-08-09: a
 * portrait that had been trashed in Drive still returned HTTP 200 and the real
 * JPEG from `lh3.googleusercontent.com/d/<id>` — which is the URL this app
 * stores and renders. So "I deleted it and it still shows my picture" is not a
 * cache and not a stale row: a trashed file that is shared "anyone with the
 * link" is still served to anyone who has the link, for the whole 30-day undo
 * window, and forever if the trash is never emptied.
 *
 * Revoking the share FIRST closes that immediately while keeping the undo
 * window — the right trade for an irreversible action driven by an anonymous
 * endpoint. Someone who removes their portrait means "nobody can see this any
 * more", not "it is filed under Trash".
 *
 * Best-effort on the revoke: a file whose sharing cannot be changed (an
 * inherited permission, a shared-drive policy) must still be trashed rather
 * than left both visible AND present.
 */
function revokeAndTrash_(file) {
  try {
    file.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (e) {
    console.warn('revokeAndTrash_: could not revoke sharing: ' + e);
  }
  file.setTrashed(true);
}

/** Pull a Drive file id out of a viewer/thumbnail/uc url. */
function extractDriveId_(url) {
  var m;
  m = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  return null;
}

/**
 * Walk the parent chain looking for the app folder whose canonical name is
 * `canonical`. Drive files can have multiple parents (shortcuts); we only
 * need ONE ancestry path that contains it.
 *
 * Ancestor names are canonicalised, so this keeps matching across the rename
 * — a slip under the folder formerly called SAMO_Shop is still recognised
 * once it is called Shop, and vice versa during the transition. These guards
 * gate DELETION: if one silently stopped matching, every slip/file delete
 * would start refusing with "file is not inside ...".
 */
function fileLivesUnderTop_(file, canonical) {
  var stack = [];
  var parents = file.getParents();
  while (parents.hasNext()) stack.push(parents.next());
  var seen = {};
  while (stack.length) {
    var f = stack.pop();
    var fid = f.getId();
    if (seen[fid]) continue;
    seen[fid] = true;
    if (canonTopFolder_(f.getName()) === canonical) return true;
    var ups = f.getParents();
    while (ups.hasNext()) stack.push(ups.next());
  }
  return false;
}

function fileLivesUnderSamoShop_(file) {
  return fileLivesUnderTop_(file, 'Shop');
}

/**
 * Walk a slash-separated folder path under the app root (`IT Database`),
 * creating any missing folders as we go. Returns the leaf folder.
 *
 * The FIRST segment is resolved with getOrCreateTopFolder_ so a legacy
 * My-Drive-root folder is adopted rather than duplicated; deeper segments
 * are plain get-or-create under their parent.
 */
function getOrCreateFolderPath_(path) {
  var parts = path.split('/').filter(function (p) { return p && p.length; });
  if (!parts.length) return getAppRoot_();
  var parent = getOrCreateTopFolder_(parts[0]);
  for (var i = 1; i < parts.length; i++) {
    var name = parts[i];
    var iter = parent.getFoldersByName(name);
    parent = iter.hasNext() ? iter.next() : parent.createFolder(name);
  }
  return parent;
}

// ============================================================
// Project-tree path walking with by-CODE folder matching.
//
// The frontend names project folders `<slug(name)>_PRJ-XXXX` and doc
// folders `<slug(title)>_DOC-XXXXX`. When VPA renames a project or
// หนังสือ in the app, the `<slug(...)>` part of the desired path
// changes, but the existing Drive folder still has the old name.
//
// Exact-name matching (getOrCreateFolderPath_) would miss the old
// folder, create a NEW empty one with the new name, and orphan all
// the existing files. The walker below instead:
//
//   1. Tries an EXACT-NAME match first (fast path, common case).
//   2. Falls back to scanning the parent for any folder whose name
//      contains the PRJ-XXXX / DOC-XXXXX code. If found, RENAMES it
//      to the desired name (self-healing rename) and reuses it.
//   3. Only if neither match exists does it create a fresh folder.
//
// So a rename in the app propagates to Drive transparently on the
// next upload / QR / explicit rename hook — no separate "move files"
// step needed.
// ============================================================

/** Extract the PRJ-/DOC- code from a folder name. Returns '' when no
 *  code is found (legacy folders / handwritten names). */
function extractProjectCode_(name) {
  var s = String(name || '');
  // Match the FIRST PRJ-/DOC- code in the name — handles both
  // `<slug>_PRJ-XXXX` (new) and `PRJ-XXXX_<slug>` (legacy).
  var m = s.match(/(PRJ|DOC)-[A-Z0-9]+/);
  return m ? m[0] : '';
}

/** Find or create a folder under `parent` whose name matches the
 *  desired name; if a folder with the same code already exists with
 *  a different name, RENAME it to the desired name and return it. */
function getOrCreateProjectSubfolderByCode_(parent, desiredName, code) {
  // Fast path: exact name match.
  var exact = parent.getFoldersByName(desiredName);
  if (exact.hasNext()) return exact.next();
  // By-code rename path: scan parent, rename the first folder whose
  // name carries this code. `code` is something like PRJ-K3X7 — long
  // enough that an accidental substring collision is vanishingly
  // unlikely under a Projects/ tree.
  if (code) {
    var iter = parent.getFolders();
    while (iter.hasNext()) {
      var f = iter.next();
      if (f.getName().indexOf(code) !== -1) {
        // Don't rename if Drive has the right name already (catches
        // the case where the user reverted the name in the app).
        if (f.getName() !== desiredName) f.setName(desiredName);
        return f;
      }
    }
  }
  // Not found at all: create with the desired name.
  return parent.createFolder(desiredName);
}

/** Walk a `Projects/<projectFolder>[/<docFolder>]` path. The first
 *  segment after `Projects/` matches by PRJ-code; the second by
 *  DOC-code. Self-renames stale folders to the current desired name. */
function walkProjectsPathByCode_(path) {
  var parts = path.split('/').filter(function (p) { return p && p.length; });
  if (parts.length === 0 || canonTopFolder_(parts[0]) !== 'Projects') {
    throw new Error('walkProjectsPathByCode_ requires a Projects/... path');
  }
  // Top-level "Projects" folder: exact-name match (no code), under the
  // app root, adopting a legacy My-Drive-root folder if that's where it is.
  var parent = getOrCreateTopFolder_('Projects');
  // Walk each remaining segment with by-code matching.
  for (var i = 1; i < parts.length; i++) {
    var name = parts[i];
    var code = extractProjectCode_(name);
    parent = getOrCreateProjectSubfolderByCode_(parent, name, code);
  }
  return parent;
}

// ============================================================
// uploadProjectFile — same lazy-nested-folder pattern as
// uploadShopFile, but allow-listed to `Projects/...`. The
// frontend passes a logical path like
// `Projects/PRJ-2605-0001_<slug>/DOC-260526-1430-XXXX_<type>`
// and we walk/create it under My Drive.
// ============================================================

function handleUploadProjectFile(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (canonTopFolder_(firstSegment_(path)) !== 'Projects') {
      return createResponse({ success: false, message: 'folderPath must start with Projects' });
    }

    // walkProjectsPathByCode_ self-renames stale project/doc folders
    // to the current desiredName from the path — so a file uploaded
    // AFTER a rename lands in the correctly-named folder even if the
    // app skipped firing the explicit rename hook.
    var folder = walkProjectsPathByCode_(path);
    var base64Data = data.fileData.split(',')[1];
    var blob = Utilities.newBlob(Utilities.base64Decode(base64Data), data.mimeType, data.fileName);
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return createResponse({
      success: true,
      fileUrl: file.getUrl(),
      fileId: file.getId(),
      sizeBytes: file.getSize(),
      mimeType: file.getMimeType(),
    });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// deleteProjectFile — trash a single Drive file (by viewer URL)
// that lives under `Projects/`. Used by the project-tracking
// frontend when VPA removes a single file attached to a หนังสือ.
// Mirrors handleDeleteShopFile but allow-listed to the Projects/
// folder tree.
// ============================================================

function handleDeleteProjectFile(data) {
  try {
    var url = String(data.fileUrl || '').trim();
    if (!url) return createResponse({ success: false, message: 'fileUrl required' });
    var id = extractDriveId_(url);
    if (!id) return createResponse({ success: false, message: 'unable to extract Drive id from url' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) {
      return createResponse({ success: true, alreadyGone: true });
    }
    if (!fileLivesUnderProjects_(file)) {
      return createResponse({ success: false, message: 'file is not inside Projects' });
    }
    revokeAndTrash_(file);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// getProjectFileData — return a Drive file's bytes as base64 by id.
// Used by the in-browser e-sign flow: the browser can't fetch the raw
// bytes from a Drive viewer URL (CORS), so it round-trips through GAS.
// Allow-listed to files under `Projects/` only.
// ============================================================
function handleGetProjectFileData(data) {
  try {
    var id = String(data.fileId || '').trim();
    if (!id) return createResponse({ success: false, message: 'fileId required' });
    var file;
    try { file = DriveApp.getFileById(id); }
    catch (e) { return createResponse({ success: false, message: 'file not found' }); }
    if (!fileLivesUnderProjects_(file)) {
      return createResponse({ success: false, message: 'file is not inside Projects' });
    }
    var blob = file.getBlob();
    return createResponse({
      success: true,
      base64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType(),
      fileName: file.getName(),
      sizeBytes: file.getSize(),
    });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

function fileLivesUnderProjects_(file) {
  return fileLivesUnderTop_(file, 'Projects');
}

// ============================================================
// statProjectFiles — metadata for Drive files we ALREADY have ids for.
//
// WHY IT EXISTS. Nothing in this system could ask "is the file behind this row
// still there?". Migration 0181 lost three signed หนังสือโครงการ to a refused
// database row while the PDFs sat in Drive, and the fault hid for six days
// because no screen, query or job could compare the two sides. This is the
// database→Drive half of that comparison.
//
// WHY IT IS SAFE TO ADD TO AN UNAUTHENTICATED ENDPOINT: it is strictly LESS
// disclosure than `getProjectFileData`, which already returns the full BYTES of
// any file under `Projects/` to anyone holding its id. This returns only
// metadata for the same allow-listed set, so it widens nothing.
//
// `trashed` IS THE POINT. `DriveApp.getFileById` succeeds on a trashed file and
// lh3 still serves it (docs/mistakes/integrations.md — "a trashed Drive file is
// still public"), so "deleted in Drive" and "gone" are different states and the
// row-vs-file comparison has to be able to tell them apart. A folder listing
// cannot: Drive omits trashed files from `getFiles()`, which is exactly why the
// two halves of this sweep need two different calls.
// ============================================================
function handleStatProjectFiles(data) {
  try {
    var ids = data.fileIds;
    if (!Array.isArray(ids) || !ids.length) {
      return createResponse({ success: false, message: 'fileIds (array) is required' });
    }
    if (ids.length > 200) {
      return createResponse({ success: false, message: 'at most 200 fileIds per call' });
    }
    var out = [];
    for (var i = 0; i < ids.length; i++) {
      var id = String(ids[i] || '').trim();
      if (!id) continue;
      var file = null;
      try { file = DriveApp.getFileById(id); }
      catch (e) { out.push({ fileId: id, resolves: false, reason: 'not found' }); continue; }
      // The same allow-list as every other project handler. A file that has
      // been MOVED out of Projects/ is reported as such rather than described,
      // because "we cannot see it" and "it is not ours" are different answers.
      if (!fileLivesUnderProjects_(file)) {
        out.push({ fileId: id, resolves: false, reason: 'not inside Projects' });
        continue;
      }
      out.push({
        fileId:    id,
        resolves:  true,
        trashed:   file.isTrashed(),
        fileName:  file.getName(),
        mimeType:  file.getMimeType(),
        sizeBytes: file.getSize(),
        createdAt: file.getDateCreated().toISOString(),
        url:       file.getUrl()
      });
    }
    return createResponse({ success: true, files: out });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// listProjectFolderFiles — what is in a หนังสือ's Drive folder.
//
// The Drive→database half: the question the owner asked on 2026-09-09, "what is
// in Drive that we have no row for?". `createdAt` is the reason it must be a
// listing and not a guess — a repair that re-attaches an orphan should date it
// when the work really happened, and the absence of that field is why the
// 2026-09-09 repair had to fall back to the approval time and say so.
//
// ⛔ IT REQUIRES `knownFileId`, AND THAT IS A SECURITY GATE, NOT A CONVENIENCE.
// This `/exec` URL is public, unauthenticated and printed in the browser bundle,
// and this repository is public. A bare folder listing would let anyone who
// guessed a `Projects/<PRJ-…>/<DOC-…>` path harvest every file id inside it, and
// `getProjectFileData` turns an id into the bytes of a real signed หนังสือ
// carrying student names and a professor's signature. So the caller must first
// name a file it ALREADY knows is in that folder: anyone able to do that could
// already read that file, so the marginal disclosure is nil, while enumeration
// with no prior knowledge is impossible.
//
// The sweep always has one — it derives the folder path from a `project_files`
// row and passes that row's own `drive_file_id`. The case it therefore CANNOT
// examine is a folder in which we hold zero rows; that is stated in the sweep
// and is not the 0181 shape, where the folder held the unsigned original all
// along.
//
// ⚠️ IT MUST NOT CREATE THE FOLDER. `walkProjectsPathByCode_` get-or-CREATES at
// every segment, and also renames and moves; a listing call with a side effect
// is a trap, so this walks with find-only helpers and answers
// `folderFound: false` instead. That flag is also the sweep's control: "the
// folder is empty" and "the folder is not there" must never look the same.
// ============================================================
function handleListProjectFolderFiles(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (canonTopFolder_(firstSegment_(path)) !== 'Projects') {
      return createResponse({ success: false, message: 'folderPath must be under Projects/' });
    }
    var known = String(data.knownFileId || '').trim();
    if (!known) {
      return createResponse({ success: false, message: 'knownFileId is required — see the header of this handler' });
    }

    var folder = findProjectsPathByCode_(path);
    if (!folder) return createResponse({ success: true, folderFound: false, files: [] });

    // The gate: the named file must really be in THIS folder. Checked by
    // walking the folder's own children, so a file that merely exists
    // elsewhere under Projects/ does not unlock an unrelated folder.
    var isKnownHere = false;
    var it = folder.getFiles();
    var files = [];
    while (it.hasNext()) {
      var f = it.next();
      if (f.getId() === known) isKnownHere = true;
      files.push({
        fileId:    f.getId(),
        fileName:  f.getName(),
        mimeType:  f.getMimeType(),
        sizeBytes: f.getSize(),
        createdAt: f.getDateCreated().toISOString(),
        trashed:   false,   // getFiles() omits trashed files — use statProjectFiles
        url:       f.getUrl()
      });
    }
    if (!isKnownHere) {
      return createResponse({ success: false, message: 'knownFileId is not in that folder' });
    }
    return createResponse({ success: true, folderFound: true, files: files });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

/**
 * Find `Projects/<a>/<b>` WITHOUT creating, renaming or moving anything.
 * Returns the Folder or null.
 *
 * The read-only twin of walkProjectsPathByCode_. It is a separate function
 * rather than a flag on that one because this repo's most repeated bug is one
 * rule with two implementations that drift — and here the two want genuinely
 * different answers: the writer's job is to make the path exist, this one's job
 * is to report whether it does. A flag would have made "create" the default for
 * a reader.
 */
function findProjectsPathByCode_(path) {
  var parts = String(path || '').split('/').filter(function (p) { return p && p.length; });
  if (parts.length === 0 || canonTopFolder_(parts[0]) !== 'Projects') return null;
  var parent = findTopFolder_('Projects');
  if (!parent) return null;
  for (var i = 1; i < parts.length; i++) {
    parent = findProjectSubfolderByCode_(parent, parts[i], extractProjectCode_(parts[i]));
    if (!parent) return null;
  }
  return parent;
}

/** Find a top-level app folder in any of the places getOrCreateTopFolder_
 *  would look, in the same order, but never create/rename/move. */
function findTopFolder_(name) {
  var canonical = canonTopFolder_(name);
  var candidates = [canonical].concat(legacyAliases_(canonical));
  var roots = [getAppRootReadOnly_(), DriveApp.getRootFolder()];
  for (var r = 0; r < roots.length; r++) {
    if (!roots[r]) continue;
    for (var c = 0; c < candidates.length; c++) {
      var iter = roots[r].getFoldersByName(candidates[c]);
      if (iter.hasNext()) return iter.next();
    }
  }
  return null;
}

/** `My Drive / IT Database` if it exists — never created. */
function getAppRootReadOnly_() {
  var iter = DriveApp.getRootFolder().getFoldersByName(APP_ROOT_FOLDER_NAME);
  return iter.hasNext() ? iter.next() : null;
}

/** Exact-name then by-code match, with no rename and no create. */
function findProjectSubfolderByCode_(parent, desiredName, code) {
  var exact = parent.getFoldersByName(desiredName);
  if (exact.hasNext()) return exact.next();
  if (code) {
    var iter = parent.getFolders();
    while (iter.hasNext()) {
      var f = iter.next();
      if (f.getName().indexOf(code) !== -1) return f;
    }
  }
  return null;
}

// ============================================================
// deleteProjectFolder — trash a folder (and everything inside)
// under `Projects/...`. Called by the frontend when a โครงการ or
// หนังสือ is deleted, so the Drive side doesn't accumulate orphans.
//
// Allow-listed to paths under `Projects/` only. Trashing (vs purge)
// keeps a 30-day Drive recovery window — same convention as
// deleteShopFile.
// ============================================================

// ============================================================
// getProjectFolderInfo — return the Drive folder id + viewer URL
// for a logical `Projects/...` path, creating any missing folders
// along the way. Used by the per-project QR feature so a user can
// share the whole project folder (containing one subfolder per
// หนังสือ, each with its own files) by scanning a single code.
//
// Sharing: sets ANYONE_WITH_LINK + VIEW on the folder itself, so
// anyone who scans the QR can browse + open files. Individual
// files are already shared the same way at upload time, so the
// only thing folder-sharing changes is making the list of files
// browsable from the link. The action is allow-listed to paths
// under `Projects/` to keep the same blast radius as the other
// project-folder helpers.
//
// Idempotent: re-calling for the same path returns the same id /
// url and re-asserts the sharing setting (no-op if already set).
// ============================================================

function handleGetProjectFolderInfo(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath is required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (path.indexOf('Projects/') !== 0) {
      return createResponse({ success: false, message: 'folderPath must start with Projects/' });
    }
    // Refuse the root — sharing it would expose every project on this
    // Drive. Sub-paths only.
    if (path === 'Projects' || path === 'Projects/') {
      return createResponse({ success: false, message: 'refuse to operate on the root Projects folder' });
    }
    // By-code walk: a rename-hook call after the user edits a project
    // or doc title finds the existing folder via its PRJ-/DOC- code
    // and self-renames it to the new desiredName from the path. No
    // separate "rename" action needed.
    var folder = walkProjectsPathByCode_(path);
    // Sharing is OPT-IN — the QR flow asks for it (so a scan can
    // open the folder), the rename hook doesn't (so we don't quietly
    // make a freshly-renamed folder public on every edit).
    if (data.share === true) {
      folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    }
    return createResponse({
      success: true,
      folderId:  folder.getId(),
      folderUrl: folder.getUrl(),
      folderName: folder.getName(),
    });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

function handleDeleteProjectFolder(data) {
  try {
    var path = String(data.folderPath || '').trim();
    if (!path) return createResponse({ success: false, message: 'folderPath required' });
    if (path.indexOf('..') !== -1) return createResponse({ success: false, message: 'invalid path' });
    if (path !== 'Projects' && path.indexOf('Projects/') !== 0) {
      return createResponse({ success: false, message: 'folderPath must start with Projects/' });
    }
    // Refuse to trash the root Projects/ folder — it's the container for
    // everything; deleting it would nuke every other project on the
    // same Drive. Only allow sub-paths.
    if (path === 'Projects' || path === 'Projects/') {
      return createResponse({ success: false, message: 'refuse to trash the root Projects folder' });
    }
    // Mirror upload's by-code walk so a rename in the app between the
    // last upload and the delete doesn't strand the folder. Each
    // segment under Projects/ matches by PRJ-/DOC- code, not by exact
    // name. If a segment can't be found AND can't be created (e.g.,
    // a non-existent code), bail with alreadyGone:true (idempotent).
    var parts = path.split('/').filter(function (p) { return p && p.length; });
    if (parts.length === 0 || canonTopFolder_(parts[0]) !== 'Projects') {
      return createResponse({ success: false, message: 'folderPath must start with Projects' });
    }
    // Non-creating lookup: a delete must never materialise the tree it is
    // about to trash. Checks IT Database first, then the legacy root spot.
    var parent = findTopFolder_('Projects');
    if (!parent) {
      return createResponse({ success: true, alreadyGone: true });
    }
    for (var i = 1; i < parts.length; i++) {
      var name = parts[i];
      var code = extractProjectCode_(name);
      var found = null;
      var exactIter = parent.getFoldersByName(name);
      if (exactIter.hasNext()) {
        found = exactIter.next();
      } else if (code) {
        var scan = parent.getFolders();
        while (scan.hasNext()) {
          var f = scan.next();
          if (f.getName().indexOf(code) !== -1) { found = f; break; }
        }
      }
      if (!found) return createResponse({ success: true, alreadyGone: true });
      parent = found;
    }
    // Revoke the FILES inside before trashing the folder: a trashed folder's
    // children keep serving on `lh3` exactly as a trashed file does (see
    // revokeAndTrash_), so trashing the folder alone leaves every document in
    // it publicly readable for the whole undo window.
    try {
      var kids = parent.getFiles();
      while (kids.hasNext()) {
        try { kids.next().setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); }
        catch (e2) { console.warn('deleteProjectFolder: could not revoke a child: ' + e2); }
      }
    } catch (e1) { console.warn('deleteProjectFolder: could not list children: ' + e1); }
    parent.setTrashed(true);
    return createResponse({ success: true });
  } catch (e) {
    return createResponse({ success: false, message: e.toString() });
  }
}

// ============================================================
// notifyProjectEmail — MailApp.sendEmail to the receiver.
//
// Free, no SMTP setup, uses the GAS owner's Gmail quota
// (~100 emails/day on consumer accounts — well above our
// project-tracking volume). The frontend passes the recipient
// email (curated in project_settings.uni_staff_email so it's
// editable without a redeploy).
// ============================================================

/**
 * Who `notifyProjectEmail` may send to. An entry with '@' is a whole address;
 * without one it is a domain. Both are matched exactly.
 *
 * Overridable WITHOUT a redeploy via Script Properties (⚙ Project Settings →
 * Script Properties) key `EMAIL_DOMAIN_ALLOWLIST`, comma-separated — so adding
 * a recipient domain never needs a code change.
 */
var EMAIL_DOMAIN_ALLOWLIST_DEFAULT = 'kku.ac.th,kkumail.com,mdstuddata.beta@gmail.com';
var EMAIL_SUBJECT_MAX = 300;
var EMAIL_BODY_MAX = 40000;

function allowedEmailDomains_() {
  var raw;
  try {
    raw = PropertiesService.getScriptProperties().getProperty('EMAIL_DOMAIN_ALLOWLIST');
  } catch (e) {
    raw = null;   // property service unavailable → fall back to the default
  }
  var list = String(raw || EMAIL_DOMAIN_ALLOWLIST_DEFAULT)
    .split(',').map(function (d) { return d.trim().toLowerCase(); })
    .filter(function (d) { return d.length; });
  // Never end up with an EMPTY allow-list: that would read as "allow nothing"
  // here, but a mis-set property should not silently kill notifications.
  return list.length ? list : [EMAIL_DOMAIN_ALLOWLIST_DEFAULT];
}

/** Split a `to` field (comma/semicolon separated) into trimmed addresses. */
function parseRecipients_(to) {
  return String(to || '').split(/[,;]/)
    .map(function (a) { return a.trim(); })
    .filter(function (a) { return a.length; });
}

/**
 * Send the หนังสือโครงการ notification.
 *
 * RECIPIENTS ARE ALLOW-LISTED ON PURPOSE. This web app is deployed
 * ANYONE_ANONYMOUS and its /exec URL ships in the public bundle, so without
 * this check the handler was an open relay: any caller could send arbitrary
 * subject/body to arbitrary addresses, from the SAMO account, under the
 * display name "MDKKU SAMO" — a ready-made phishing channel aimed at the very
 * students and staff who trust that sender. It also let anyone burn the
 * MailApp daily quota, which would silently stop the real notifications.
 *
 * The legitimate recipient is curated in `project_settings.uni_staff_email`
 * (an @kku.ac.th address today) and is still editable without a redeploy; only
 * its DOMAIN is constrained, and that list is itself a Script Property.
 *
 * Rejection throws, so `doPost` returns success:false with the reason and the
 * manage UI's "ทดสอบ" button shows it — a blocked address must never look like
 * a silent success.
 */
function sendProjectEmail(data) {
  var recipients = parseRecipients_(data.to);
  if (!recipients.length) throw new Error('notifyProjectEmail: missing "to"');

  var allowed = allowedEmailDomains_();
  for (var i = 0; i < recipients.length; i++) {
    var addr = recipients[i];
    var lower = addr.toLowerCase();
    var at = lower.lastIndexOf('@');
    var domain = at === -1 ? '' : lower.slice(at + 1);
    // An entry containing '@' is a WHOLE ADDRESS, otherwise it is a domain.
    // That way a single personal mailbox on a public provider can be allowed
    // without opening the relay to every address at that provider — adding
    // `gmail.com` to reach one gmail account would let anyone mail any gmail
    // user from this account.
    // Both comparisons are EXACT: a suffix test would admit `notkku.ac.th`
    // and `kku.ac.th.evil.com`.
    if (!domain || (allowed.indexOf(domain) === -1 && allowed.indexOf(lower) === -1)) {
      throw new Error('notifyProjectEmail: recipient not allowed: ' + addr
        + ' (allowed: ' + allowed.join(', ') + ')');
    }
  }

  MailApp.sendEmail({
    to: recipients.join(','),
    subject: String(data.subject || 'MDKKU SAMO: แจ้งเตือนหนังสือโครงการ').slice(0, EMAIL_SUBJECT_MAX),
    htmlBody: String(data.htmlBody || data.body || '').slice(0, EMAIL_BODY_MAX),
    name: 'MDKKU SAMO',
    noReply: true,
  });
}

// ============================================================
// sendMigrationVerifyEmails — one-off: verify the guessed kkumail
// addresses for the 5 gmail→kkumail passport migrations (migration
// 0064). Each student scanned SAMO Passport with a personal gmail
// before the @kkumail.com-only gate; their data was carried to a
// kkumail address DERIVED from their name (not confirmed). This
// emails each student's KNOWN gmail (guaranteed deliverable) asking
// them to confirm the kkumail is theirs.
//
// Correction channel = reply to the email (replyTo below). Replies
// land in the SAMO Gmail; a wrong address → re-run a corrected 0064.
//
// HOW TO RUN (do NOT wire this into doPost — it's a manual one-off):
//   1. Open the GAS editor, select sendMigrationVerifyEmails, Run.
//      Editor runs are owner-authenticated → MailApp sends AND
//      Logger output appears (public /exec fetches log nothing —
//      see skills/deploy-gas.md).
//   2. DRY_RUN=true (default) sends all 5 to REPLY_TO only, each
//      prefixed [DRY], so you preview the real per-student body.
//   3. When the previews look right, set DRY_RUN=false and Run again
//      to send to the students' gmail for real.
// ============================================================

function sendMigrationVerifyEmails() {
  var DRY_RUN   = true;                              // ← flip to false to send for real
  var REPLY_TO  = 'mdstuddata.beta@gmail.com';       // the GAS owner Gmail; replies + dry-run recipient land here
  var LINK      = 'https://samo.md.kku.ac.th/passport/';

  // From migration 0064. gmail = where they actually scanned (known-good).
  // kkumail = derived from name (UNCONFIRMED — the whole point of this email).
  var MOVES = [
    { gmail: 'wariikung@gmail.com',         kkumail: 'ingwer.s@kkumail.com' },
    { gmail: 'phuri8980@gmail.com',         kkumail: 'phurichaya.bo@kkumail.com' },
    { gmail: 'kenkunchai50@gmail.com',      kkumail: 'kenkunchai.ch@kkumail.com' },
    { gmail: 'sirikanrayamasena@gmail.com', kkumail: 'sirikanraya.m@kkumail.com' },
    { gmail: 'kedsaraporn2007@gmail.com',   kkumail: 'kedsaraporn.t@kkumail.com' },
  ];

  var sent = 0;
  for (var i = 0; i < MOVES.length; i++) {
    var m   = MOVES[i];
    var to  = DRY_RUN ? REPLY_TO : m.gmail;
    var tag = DRY_RUN ? '[DRY → ' + m.gmail + '] ' : '';
    MailApp.sendEmail({
      to: to,
      replyTo: REPLY_TO,
      name: 'MDKKU SAMO',
      subject: tag + '[SAMO Passport] ยืนยันอีเมล @kkumail.com ของคุณ',
      htmlBody: migrationVerifyHtml_(m.gmail, m.kkumail, LINK),
    });
    sent++;
    Logger.log('sent to ' + to + '  (kkumail=' + m.kkumail + ')');
  }
  Logger.log('DONE. DRY_RUN=' + DRY_RUN + '  sent=' + sent);
  return { dryRun: DRY_RUN, sent: sent };
}

function migrationVerifyHtml_(gmail, kkumail, link) {
  return '' +
    '<div style="font-family:system-ui,-apple-system,\'Noto Sans Thai\',Segoe UI,sans-serif;' +
    'max-width:520px;margin:0 auto;color:#1b2733;line-height:1.7;font-size:15px">' +
      '<p>สวัสดีค่ะ/ครับ 🛂</p>' +
      '<p>ก่อนหน้านี้คุณสแกนสะสมคะแนน <b>SAMO Passport</b> ด้วยบัญชี ' +
        '<span style="word-break:break-all">' + gmail + '</span></p>' +
      '<p>ขณะนี้ SAMO Passport รองรับเฉพาะบัญชี <b>@kkumail.com</b> เท่านั้น ' +
        'เราจึงได้ <b>ย้ายคะแนน กิจกรรม แสตมป์ และเกียรติบัตร</b> ของคุณไปยังบัญชี:</p>' +
      '<p style="text-align:center;font-size:17px;font-weight:700;background:#eafaf2;' +
        'border:1px solid #b7e6ce;border-radius:12px;padding:14px;word-break:break-all">' +
        kkumail + '</p>' +
      '<p><b>กรุณาช่วยตรวจสอบ:</b> เข้าสู่ระบบที่ลิงก์ด้านล่างด้วยบัญชี kkumail นี้</p>' +
      '<p style="text-align:center;margin:22px 0">' +
        '<a href="' + link + '" style="display:inline-block;background:#2f9e78;color:#fff;' +
        'text-decoration:none;padding:13px 26px;border-radius:12px;font-weight:600">' +
        'เปิด SAMO Passport</a></p>' +
      '<p style="background:#f4f7f9;border-radius:10px;padding:14px 16px">' +
        '✅ <b>ถ้าเข้าสู่ระบบแล้วเห็นคะแนนของคุณครบ</b> — กรุณาส่งอีเมลมาที่ ' +
        '<b>mdstuddata.beta@gmail.com</b> ว่า <b>&ldquo;เห็นครบแล้ว&rdquo;</b> เพื่อยืนยัน<br><br>' +
        '❌ <b>ถ้า ' + kkumail + ' ไม่ใช่อีเมล @kkumail.com ของคุณ</b> ' +
        'หรือเข้าสู่ระบบแล้วคะแนนไม่ครบ — กรุณาส่งอีเมลมาที่ <b>mdstuddata.beta@gmail.com</b> ' +
        'พร้อมแจ้งอีเมล @kkumail.com ที่ถูกต้องของคุณ แล้วเราจะย้ายข้อมูลให้ใหม่</p>' +
      '<p style="color:#7a8896;font-size:13px;margin-top:24px">— ทีมงาน SAMO MDKKU</p>' +
    '</div>';
}

function createResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
