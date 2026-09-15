// js/upload.js — drag-drop file upload to the SAMO Google Drive via a GAS web app.
// The GAS web app runs AS the SAMO account, so uploaded files are owned by SAMO
// and use its 2TB quota. See gas/Upload.gs for the one-time setup.
//
// ⛔ THE ENDPOINT IS CHECKED IN, AND THAT IS THE FIX FOR A REAL OUTAGE.
// It used to come ONLY from `VITE_GAS_UPLOAD_URL`, which lived in the old
// standalone passport repo's gitignored `.env`. The 2026-09-04 monorepo merge
// copied the TRACKED files, so the value did not travel — and the passport build
// pins `root` to passport/, which is also vite's `envDir`, so not even the repo
// root's `.env.local` could have supplied it. `import.meta.env` compiled to `{}`,
// `isUploadConfigured()` went false, and `wireUpload()` returned before creating
// the button: admins lost the ⬆️ Upload control on BOTH badge fields and the
// certificate background, with the only signal a `console.info` nobody reads.
//
// A GAS `/exec` URL is NOT a secret — `.claude/rules/security.md` classifies it
// as a public webhook, samoweb pins its own the same way in `src/js/config.js`,
// and this one shipped in a public bundle for months. Keeping it in env bought
// no secrecy and cost the feature its existence. The env var is kept as an
// OVERRIDE so a one-off build can repoint it; nothing in the repo sets it.
const DEFAULT_GAS_URL = 'https://script.google.com/macros/s/AKfycbwJgkPTcr9GbT75se0j5c7O3S1aBkVgpafA8-OeAG4glzJAO3IpGjYeag94zVeJD_tL6Q/exec';
const GAS_URL = import.meta.env?.VITE_GAS_UPLOAD_URL || DEFAULT_GAS_URL;

export function isUploadConfigured() {
    return !!GAS_URL;
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]); // strip "data:...;base64,"
        r.onerror = () => reject(new Error('Could not read file'));
        r.readAsDataURL(file);
    });
}

/**
 * Upload a file to the SAMO Drive. Returns a public /file/d/<id>/view link
 * (which fixGoogleDriveUrl() normalises for display + canvas use).
 */
export async function uploadToDrive(file, folder = '') {
    if (!GAS_URL) throw new Error('Upload endpoint not configured (VITE_GAS_UPLOAD_URL)');
    if (file.size > 15 * 1024 * 1024) throw new Error('File too large (max 15 MB)');

    const data = await fileToBase64(file);
    const res = await fetch(GAS_URL, {
        method: 'POST',
        // text/plain keeps this a "simple" request (no CORS preflight); the GAS
        // web app can still read the body and its JSON response is readable back.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, folder, data }),
    });
    if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`);

    const json = await res.json();
    if (!json.url) throw new Error(json.error || 'Upload failed');
    return json.url;
}

/** Extract a Google Drive file id from any of the link forms we store/display. */
export function driveFileId(url) {
    if (!url) return null;
    const m = String(url).match(/\/d\/([a-zA-Z0-9_-]+)/) || String(url).match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
}

/**
 * Fire-and-forget delete that survives the page unloading. Uses fetch with
 * `keepalive` (NOT sendBeacon): Apps Script `/exec` URLs always 302-redirect to
 * script.googleusercontent.com, and sendBeacon does not follow redirects, so the
 * request would never arrive. keepalive lets the fetch outlive the page.
 */
export function deleteFromDriveBeacon(url) {
    if (!GAS_URL) return;
    const fileId = driveFileId(url);
    if (!fileId) return;
    try {
        fetch(GAS_URL, {
            method: 'POST',
            keepalive: true,
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'delete', fileId }),
        }).catch(() => {});
    } catch {
        /* best effort */
    }
}

/** Best-effort delete of a previously uploaded Drive file (by its URL). */
export async function deleteFromDrive(url) {
    if (!GAS_URL) return;
    const fileId = driveFileId(url);
    if (!fileId) return;
    try {
        await fetch(GAS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'delete', fileId }),
        });
    } catch {
        /* non-fatal — the activity is still deleted */
    }
}
