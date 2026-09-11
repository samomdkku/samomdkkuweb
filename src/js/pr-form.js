// ==============================================
// PR FORM — Submission Logic, Visibility, Dates
// ==============================================

import { GAS_API_URL } from './config.js';
import { postGAS } from './gas-post.js';
import { getIsPrAccountVerified } from './pr-auth.js';
import { db } from './db.js';
import { getUser as authGetUser } from './auth.js';
import { sendNotify } from './notify.js';

// Ticket ID generator lives in ./ticket-ids.js so the format contract
// is shared with vs-form and unit-testable in isolation.
import { generatePRTicketId } from './ticket-ids.js';
import { restErrorMessage } from './rest-error.js';
import { escHtml } from './utils.js';
import { fillPrDeptSelect } from './pr-depts.js';

// ----------------------------------------------------
// Idempotent PR insert via raw fetch.
//
// We bypass supabase-js for the insert because the client has been
// getting into a state where the second-and-subsequent insert hangs
// for 30+ seconds — see the long debugging thread that led here.
// Raw fetch against PostgREST is a known-good escape hatch; the
// behavior is identical from the server's perspective, just without
// supabase-js's request queue / refresh machinery in the middle.
//
// Two attempts, 12s timeout each. PostgREST returns 409 on PK
// collision; on a retry that means attempt 1 actually succeeded.
// ----------------------------------------------------
async function insertPRTicketIdempotent(row) {
  const TIMEOUT_MS = 12000;
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Pull the current access token from Supabase's storage. Falling back
  // to the anon key keeps inserts working for unauthenticated guest
  // submissions (RLS policy allows insert by any role).
  let accessToken = ANON_KEY;
  try {
    const projectRef = (SUPABASE_URL || '').match(/\/\/([^.]+)\./)?.[1];
    const stored = projectRef ? localStorage.getItem(`sb-${projectRef}-auth-token`) : null;
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.access_token) accessToken = parsed.access_token;
    }
  } catch { /* ignore — use anon */ }

  const headers = {
    apikey: ANON_KEY,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  const url = `${SUPABASE_URL}/rest/v1/pr_tickets`;
  const bodyText = JSON.stringify(row);

  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: bodyText,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) return; // 201 Created (Prefer:return=minimal)
      // 409 on retry = first attempt actually succeeded.
      if (attempt > 1 && res.status === 409) {
        console.warn('[pr] retry detected first attempt succeeded; ticket exists');
        return;
      }
      const errText = await res.text().catch(() => '');
      // The body is JSON. Interpolating it whole put
      // {"code":"…","details":null,…} on the page of a student filling in
      // this form — see rest-error.js. `raw` is kept on the error so the
      // console still has everything.
      const err = new Error(restErrorMessage(res.status, errText));
      err.raw = errText.substring(0, 300);
      err.status = res.status;
      throw err;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt === 2) break;
      // The console keeps the RAW body: restErrorMessage narrowed what the
      // PAGE shows, and narrowing the debugging surface with it is how a
      // readable error becomes an undiagnosable one.
      const why = e.name === 'AbortError' ? 'timeout' : (e.message || e);
      console.warn(`[pr] insert attempt ${attempt} failed (${why}); retrying`, e.raw || '');
    }
  }
  const msg = (lastErr && lastErr.message) || String(lastErr);
  if (/timeout|abort/i.test(msg) || lastErr?.name === 'AbortError') {
    throw new Error('การส่งใช้เวลานานเกินไป กรุณาลองอีกครั้งหรือเช็คการเชื่อมต่อ');
  }
  throw lastErr;
}

let lastJobType = '';

// --------------------------------------------------
// Form Visibility & Conditional Fields
// --------------------------------------------------

export function updateFormVisibility() {
  const departmentSelect = document.getElementById('department');
  const igPostCheckbox = document.getElementById('plat1');
  const igStoryCheckbox = document.getElementById('plat2');
  const contactInput = document.getElementById('contactInput');
  const contactReqStar = document.getElementById('contactReqStar');
  const contactOptionalText = document.getElementById('contactOptionalText');
  const jobType1 = document.getElementById('jobType1');
  const labelJobType1 = document.getElementById('labelJobType1');
  const jobType2 = document.getElementById('jobType2');
  const regularPostingChannel = document.getElementById('regularPostingChannel');
  const projectDepartmentSection = document.getElementById('projectDepartmentSection');
  const projectPostingFormat = document.getElementById('projectPostingFormat');
  const copostWithSection = document.getElementById('copostWithSection');

  const isProject = departmentSelect.value === 'โครงการอื่นๆ';
  const isIgSelected = igPostCheckbox.checked || igStoryCheckbox.checked;

  if (isProject) {
    contactInput.setAttribute('required', 'required');
    contactReqStar.classList.remove('d-none');
    contactOptionalText.classList.add('d-none');
    jobType2.checked = true;
    jobType1.disabled = true;
    labelJobType1.classList.add('disabled');
  } else {
    contactInput.removeAttribute('required');
    contactReqStar.classList.add('d-none');
    contactOptionalText.classList.remove('d-none');
    jobType1.disabled = false;
    labelJobType1.classList.remove('disabled');
  }

  if (isProject) {
    regularPostingChannel.classList.add('d-none');
    document.getElementsByName('postingChannel').forEach((el) => el.removeAttribute('required'));
    projectDepartmentSection.classList.remove('d-none');
    document.getElementById('projectAccount').setAttribute('required', 'required');
    if (isIgSelected) {
      projectPostingFormat.classList.remove('d-none');
    } else {
      projectPostingFormat.classList.add('d-none');
      document.getElementsByName('projectFormat').forEach((el) => { el.checked = false; });
      copostWithSection.classList.add('d-none');
      document.getElementById('copostWith').removeAttribute('required');
    }
  } else {
    projectDepartmentSection.classList.add('d-none');
    document.getElementById('projectAccount').removeAttribute('required');
    document.getElementsByName('projectFormat').forEach((el) => el.removeAttribute('required'));
    document.getElementById('copostWith').removeAttribute('required');
    if (isIgSelected) {
      regularPostingChannel.classList.remove('d-none');
      document.getElementsByName('postingChannel').forEach((el) => el.setAttribute('required', 'required'));
    } else {
      regularPostingChannel.classList.add('d-none');
      document.getElementsByName('postingChannel').forEach((el) => { el.removeAttribute('required'); el.checked = false; });
    }
  }
  applyDateRules();
}

export function toggleProjectFormatCopost() {
  const copostInput = document.getElementById('copostWith');
  const copostChecked = document.getElementById('projFormat3').checked;
  const copostWithSection = document.getElementById('copostWithSection');
  if (copostChecked) {
    copostWithSection.classList.remove('d-none');
    copostInput.setAttribute('required', 'required');
  } else {
    copostWithSection.classList.add('d-none');
    copostInput.removeAttribute('required');
    copostInput.value = '';
  }
}

export function toggleOtherPlatformReason() {
  const anyChecked = document.querySelectorAll('input[name="otherPlatform"]:checked').length > 0;
  const section = document.getElementById('otherPlatformReasonSection');
  const textarea = document.getElementById('otherPlatformReason');
  if (anyChecked) {
    section.classList.remove('d-none');
    textarea.setAttribute('required', 'required');
  } else {
    section.classList.add('d-none');
    textarea.removeAttribute('required');
    textarea.value = '';
  }
}

export function togglePrMode() {
  const isSubmit = document.getElementById('prModeSubmit').checked;
  const isTrack = document.getElementById('prModeTrack').checked;
  document.getElementById('prSubmitSection').classList.toggle('d-none', !isSubmit);
  document.getElementById('prTrackSection').classList.toggle('d-none', !isTrack);
}

// --------------------------------------------------
// Date/Time Helpers
// --------------------------------------------------

const publishDatePart = () => document.getElementById('publishDatePart');
const publishTimePart = () => document.getElementById('publishTimePart');
const publishDateHidden = () => document.getElementById('publishDate');

export function syncPublishDate() {
  const dp = publishDatePart();
  const tp = publishTimePart();
  const hid = publishDateHidden();
  if (dp.value && tp.value) {
    hid.value = dp.value + 'T' + tp.value;
  } else {
    hid.value = '';
  }
}

function clampTimeToAllowed(d) {
  const h = d.getHours();
  const m = d.getMinutes();
  if (h < 8) { d.setHours(8, 0, 0, 0); }
  else if (h > 22 || (h === 22 && m > 0)) {
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
  }
  return d;
}

function setDateTimeInputs(date) {
  const pad = (n) => n.toString().padStart(2, '0');
  publishDatePart().value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  publishTimePart().value = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  syncPublishDate();
}

function getDateTimeFromInputs() {
  const dp = publishDatePart();
  const tp = publishTimePart();
  if (!dp.value || !tp.value) return null;
  return new Date(dp.value + 'T' + tp.value);
}

export function applyDateRules() {
  const now = new Date();
  const deadlineRush = document.getElementById('deadlineRush');
  const prReviewSection = document.getElementById('prReviewSection');
  const rushReason = document.getElementById('rushReason');
  const dateHelper = document.getElementById('dateHelper');
  const isRush = deadlineRush.checked;
  const checkedJobType = document.querySelector('input[name="jobType"]:checked');
  const currentJobType = checkedJobType ? checkedJobType.value : '';
  const jobTypeChanged = currentJobType !== lastJobType && lastJobType !== '';
  lastJobType = currentJobType;

  let defaultDate = new Date(now);
  let normalMinDate = new Date(now);

  if (currentJobType === 'New content') {
    defaultDate.setDate(defaultDate.getDate() + 15);
    normalMinDate.setDate(normalMinDate.getDate() + 15);
  } else if (currentJobType === 'Ready to post') {
    defaultDate.setDate(defaultDate.getDate() + 1);
    normalMinDate.setDate(normalMinDate.getDate() + 1);
  }

  clampTimeToAllowed(defaultDate);
  let actualMinDate = new Date(now);
  const pad = (n) => n.toString().padStart(2, '0');

  if (isRush) {
    prReviewSection.classList.remove('d-none');
    rushReason.setAttribute('required', 'required');
    actualMinDate = new Date(now);
    publishDatePart().min = `${actualMinDate.getFullYear()}-${pad(actualMinDate.getMonth() + 1)}-${pad(actualMinDate.getDate())}`;
    dateHelper.innerHTML = "<i class='bi bi-rocket-takeoff me-1'></i> Submit for PR Review: เลือกระบุวันที่ต้องการได้เลย <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
    dateHelper.className = 'text-danger mt-2 d-block fw-bold';
  } else {
    prReviewSection.classList.add('d-none');
    rushReason.removeAttribute('required');
    rushReason.value = '';
    rushReason.style.height = 'auto';
    actualMinDate = new Date(normalMinDate);
    publishDatePart().min = `${actualMinDate.getFullYear()}-${pad(actualMinDate.getMonth() + 1)}-${pad(actualMinDate.getDate())}`;

    if (currentJobType === 'New content') {
      dateHelper.innerHTML = "<i class='bi bi-info-circle me-1'></i> เกณฑ์ปกติ: +15 วันจากวันนี้ (สามารถแก้ไขเลือกวันหลังจากนี้ได้) <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
      dateHelper.className = 'text-pink-custom mt-2 d-block fw-bold';
    } else if (currentJobType === 'Ready to post') {
      dateHelper.innerHTML = "<i class='bi bi-info-circle me-1'></i> เกณฑ์ปกติ: +1 วันจากวันนี้ (สามารถแก้ไขเลือกวันหลังจากนี้ได้) <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
      dateHelper.className = 'text-pink-custom mt-2 d-block fw-bold';
    } else {
      dateHelper.innerHTML = "<i class='bi bi-info-circle me-1'></i> กรุณาเลือกรูปแบบงานก่อน <span class='fw-normal text-muted'>(เลือกเวลาได้เฉพาะ 08:00-22:00)</span>";
      dateHelper.className = 'text-muted mt-2 d-block';
    }
  }

  if (checkedJobType) {
    const currentVal = getDateTimeFromInputs();
    if (jobTypeChanged || !currentVal || currentVal < actualMinDate) {
      setDateTimeInputs(defaultDate);
    }
  } else {
    publishDatePart().value = '';
    publishTimePart().value = '';
    publishDateHidden().value = '';
  }
}

// --------------------------------------------------
// Wire up event listeners (called from main.js)
// --------------------------------------------------

export function initPrForm() {
  const departmentSelect = document.getElementById('department');
  // Single source of truth for the ฝ่าย list (src/js/pr-depts.js).
  fillPrDeptSelect(departmentSelect, { placeholder: 'เลือกฝ่ายของคุณ' });
  const igPostCheckbox = document.getElementById('plat1');
  const igStoryCheckbox = document.getElementById('plat2');
  const deadlineNormal = document.getElementById('deadlineNormal');
  const deadlineRush = document.getElementById('deadlineRush');
  const jobTypeRadios = document.querySelectorAll('.job-type-radio');

  departmentSelect.addEventListener('change', updateFormVisibility);
  igPostCheckbox.addEventListener('change', updateFormVisibility);
  igStoryCheckbox.addEventListener('change', updateFormVisibility);
  deadlineNormal.addEventListener('change', applyDateRules);
  deadlineRush.addEventListener('change', applyDateRules);
  jobTypeRadios.forEach((radio) => radio.addEventListener('change', applyDateRules));

  // Auto-resize textareas
  document.querySelectorAll('textarea').forEach((textarea) => {
    textarea.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });
  });

  // Publish date sync
  document.getElementById('publishDatePart').addEventListener('change', syncPublishDate);
  document.getElementById('publishTimePart').addEventListener('change', function () {
    if (this.value) {
      const parts = this.value.split(':');
      const h = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      if (h < 8) this.value = '08:00';
      else if (h > 22 || (h === 22 && m > 0)) this.value = '22:00';
    }
    syncPublishDate();
  });

  // PR form submit
  document.getElementById('prForm').addEventListener('submit', handlePrFormSubmit);

  // Success-card copy + dismiss (matches the VS form pattern).
  document.getElementById('prSuccessCopy')?.addEventListener('click', copyPrTicket);
  document.getElementById('prSuccessDismiss')?.addEventListener('click', () => {
    document.getElementById('prSuccessCard')?.classList.add('d-none');
  });

  // Initialize form state
  updateFormVisibility();
}

// Persistent success card — shown after a ticket is created. Replaces
// the inline alert + native alert() that easily dismissed on mobile
// before users could memorize the id.
function showPrSuccessCard(ticketId, isGuest) {
  const card = document.getElementById('prSuccessCard');
  const input = document.getElementById('prSuccessTicket');
  const hint = document.getElementById('prSuccessHint');
  if (!card || !input) return;
  input.value = ticketId;
  if (hint) {
    hint.textContent = isGuest
      ? 'โปรดบันทึก Ticket ID ไว้ติดตามสถานะ — หากลืมจะไม่สามารถกลับมาดูสถานะได้'
      : 'ระบบบันทึกงานของคุณเรียบร้อยแล้ว — เก็บหมายเลขไว้สำหรับติดตามได้สะดวก';
  }
  card.classList.remove('d-none');
  // Card sits AFTER the form, right under the submit button. block:
  // 'nearest' only scrolls if needed — for most submitters the card
  // is already in view, so the page stays still.
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const lbl = document.getElementById('prSuccessCopyLabel');
  if (lbl) lbl.textContent = 'คัดลอก Ticket ID';
}

async function copyPrTicket() {
  const input = document.getElementById('prSuccessTicket');
  const lbl = document.getElementById('prSuccessCopyLabel');
  if (!input) return;
  const value = input.value;
  let ok = false;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch { /* fall through to execCommand */ }
  if (!ok) {
    try {
      input.removeAttribute('readonly');
      input.select();
      ok = document.execCommand('copy');
      input.setAttribute('readonly', '');
      input.blur();
    } catch { /* still false */ }
  }
  if (lbl) {
    lbl.textContent = ok ? 'คัดลอกแล้ว ✓' : 'คัดลอกไม่สำเร็จ';
    setTimeout(() => { lbl.textContent = 'คัดลอก Ticket ID'; }, 2000);
  }
}

// --------------------------------------------------
// Form Submit Handler
// --------------------------------------------------

async function handlePrFormSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');
  const btnLoading = document.getElementById('btnLoading');
  const alertBox = document.getElementById('alertBox');
  const accMode = document.querySelector('input[name="prAccountMode"]:checked')
    ? document.querySelector('input[name="prAccountMode"]:checked').value
    : 'guest';

  if (accMode === 'google' && !getIsPrAccountVerified()) {
    alertBox.innerHTML = '<i class="bi bi-exclamation-circle-fill me-1"></i> กรุณาเข้าสู่ระบบด้วย Google Account ก่อนยืนยันส่งงาน';
    alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  // Validate project format if visible
  const projFormatSection = document.getElementById('projectPostingFormat');
  if (projFormatSection && !projFormatSection.classList.contains('d-none')) {
    const checkedFormats = document.querySelectorAll('input[name="projectFormat"]:checked');
    if (checkedFormats.length === 0) {
      alertBox.innerHTML = '<i class="bi bi-exclamation-circle-fill me-1"></i> กรุณาเลือกรูปแบบการลงสื่ออย่างน้อย 1 ช่อง';
      alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  }

  syncPublishDate();

  // Validate publish time 08:00-22:00
  const pubDateVal = document.getElementById('publishDate').value;
  if (pubDateVal) {
    const pubDate = new Date(pubDateVal);
    const pubH = pubDate.getHours();
    const pubM = pubDate.getMinutes();
    if (pubH < 8 || pubH > 22 || (pubH === 22 && pubM > 0)) {
      alertBox.innerHTML = '<i class="bi bi-clock-fill me-1"></i> เวลาที่เลือกต้องอยู่ระหว่าง 08:00-22:00 เท่านั้น';
      alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
  }

  const fileInput = document.getElementById('fileUpload');
  btn.disabled = true; btnText.classList.add('d-none'); btnLoading.classList.remove('d-none');
  alertBox.className = 'alert d-none shadow-sm';

  // Check file sizes
  if (fileInput.files.length > 0) {
    for (let i = 0; i < fileInput.files.length; i++) {
      if (fileInput.files[i].size > 35 * 1024 * 1024) {
        alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
        alertBox.innerHTML = `<i class="bi bi-exclamation-triangle-fill me-2"></i> รูปที่ ${i + 1} ขนาดเกิน 35MB กรุณาใช้ลิงก์ G-Drive แนบแทน`;
        btn.disabled = false; btnText.classList.remove('d-none'); btnLoading.classList.add('d-none');
        return;
      }
    }
  }

  const targetUrl = GAS_API_URL;
  let uploadedUrls = [];

  // Sequential file upload
  if (fileInput.files.length > 0) {
    for (let i = 0; i < fileInput.files.length; i++) {
      const file = fileInput.files[i];
      btnLoading.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> กำลังอัปโหลดรูปที่ ${i + 1}/${fileInput.files.length}...`;
      try {
        const base64 = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target.result);
          reader.readAsDataURL(file);
        });
        // postGAS retries the one failure that is safe to retry: Google
        // answering with an HTML page instead of running the script. This is
        // the PUBLIC form, so the person hitting it is often a guest with no
        // account and no way to ask anyone what went wrong.
        const uploadResult = await postGAS(targetUrl, {
          action: 'uploadPRFile', fileName: file.name, mimeType: file.type, fileData: base64,
        });
        if (uploadResult.success) {
          uploadedUrls.push(uploadResult.fileUrl);
        } else {
          throw new Error(uploadResult.message);
        }
      } catch (err) {
        alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
        // Tell the user which files already uploaded so they know what's
        // orphaned on Drive if they retry (and don't double-upload).
        const okMsg = uploadedUrls.length > 0
          ? ` (รูปที่ 1–${uploadedUrls.length} ขึ้น Drive แล้ว — กรุณาลบไฟล์ซ้ำหากต้องลองใหม่)`
          : '';
        alertBox.innerHTML = `<i class="bi bi-x-circle-fill me-2 fs-5"></i> การอัปโหลดรูปที่ ${i + 1} ล้มเหลว${okMsg}`;
        btn.disabled = false; btnText.classList.remove('d-none'); btnLoading.classList.add('d-none');
        return;
      }
    }
  }

  // Submit form data with uploaded URLs
  btnLoading.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span> กำลังสร้าง Ticket งาน...';

  const formData = new FormData(e.target);
  const submitter = authGetUser();
  const submitterLabel = document.getElementById('prGoogleUserEmail').value || 'Guest';

  // Build pr_tickets row. Multi-value form fields come back as arrays.
  // Posting channel: for "project" departments, the user picks a multi-
  // select called projectFormat instead of the single postingChannel radio.
  const projectFormat = formData.getAll('projectFormat');
  const postingChannel = formData.get('postingChannel')
    || (projectFormat.length ? projectFormat.join(', ') : null);

  const ticketId = generatePRTicketId();
  const fileUrlText = [
    ...uploadedUrls,
    formData.get('largeFileLink') ? `ลิงก์เสริม: ${formData.get('largeFileLink')}` : null,
  ].filter(Boolean).join('\n') || null;

  const publishDateRaw = formData.get('publishDate');
  let publishDateIso = null;
  if (publishDateRaw) {
    const d = new Date(publishDateRaw);
    if (!isNaN(d.getTime())) publishDateIso = d.toISOString();
  }

  const row = {
    id: ticketId,
    department: formData.get('department') || 'โครงการอื่นๆ',
    contact: formData.get('contact') || null,
    content_name: formData.get('content') || '(ไม่ระบุชื่องาน)',
    job_type: formData.get('jobType') || null,
    platforms: formData.getAll('platform'),
    posting_channel: postingChannel,
    publish_date: publishDateIso,
    deadline_status: formData.get('deadlineMode') === 'Rush PR Review' ? 'ด่วน (PR Review)' : 'ปกติ',
    rush_reason: formData.get('rushReason') || null,
    brief: formData.get('brief') || null,
    caption: formData.get('caption') || null,
    file_url: fileUrlText,
    silent_notify: document.getElementById('silentNotify')?.checked === true,
    project_account: formData.get('projectAccount') || null,
    copost_with: formData.get('copostWith') || null,
    submitter_id: submitter?.id || null,
    submitter_label: submitterLabel,
    status: 'รอ PR รับเรื่อง',
    remarks: [],
    assignees: [],
    other_platforms: formData.getAll('otherPlatform'),
    other_platform_reason: formData.get('otherPlatformReason') || null,
  };

  const skipDiscord = document.getElementById('skipDiscord')?.checked === true;

  try {
    // Insert with a 12s-per-attempt timeout and one retry. supabase-js
    // sometimes stalls on background token refresh, leaving requests
    // pending until they hit our timeout. The retry forces a fresh
    // session token; idempotency comes from the client-generated id —
    // if attempt 1 actually succeeded but appeared hung, attempt 2 hits
    // the PK unique-violation (Postgres code 23505) and we treat it as
    // success.
    await insertPRTicketIdempotent(row);

    // Fire-and-forget Discord notification via the unified helper.
    // sendNotify uses fetch + keepalive (not sendBeacon — sendBeacon
    // can't follow GAS's 302 redirect to script.googleusercontent.com).
    if (!skipDiscord) {
      sendNotify('pr', {
        ticketId,
        department: row.department,
        content: row.content_name,
        contact: row.contact,
        jobType: row.job_type,
        deadlineMode: formData.get('deadlineMode'),
        uploadedUrls,
        largeFileLink: formData.get('largeFileLink'),
        otherPlatform: row.other_platforms,
        otherPlatformReason: row.other_platform_reason,
        silentNotify: row.silent_notify,
      });
    }

    // Hide the inline alert (used for in-progress / error states) and
    // show the persistent success card so the user can copy the id on
    // any device. Replaces the native alert() popup that was easy to
    // dismiss before reading the id on phones.
    alertBox.classList.add('d-none');
    alertBox.classList.remove('alert-success');
    showPrSuccessCard(ticketId, accMode === 'guest');
    document.getElementById('prForm').reset();
    // form.reset() doesn't always clear a file input's `.files` collection
    // in every browser — explicit `.value = ''` guarantees the next submit
    // doesn't accidentally re-upload the previous file set (mistakes.md).
    fileInput.value = '';
    // form.reset() clears the hidden submitter inputs; re-populate from
    // the current auth state so the *next* submission has the identifier
    // baked in.
    const u = authGetUser();
    if (u) {
      const identifier = u.email || (u.username ? `@${u.username}` : '');
      const nameField = document.getElementById('prGoogleUserName');
      const emailField = document.getElementById('prGoogleUserEmail');
      if (emailField) emailField.value = identifier;
      if (nameField) nameField.value = u.name || u.username || identifier;
    }
    updateFormVisibility();
    toggleOtherPlatformReason();
  } catch (error) {
    alertBox.classList.remove('d-none'); alertBox.classList.add('alert-danger');
    // See vs-form.js: the message can contain server-composed text derived
    // from the submission, and this is innerHTML.
    alertBox.innerHTML = `<i class="bi bi-wifi-off me-2 fs-5"></i> บันทึกไม่สำเร็จ: ${escHtml(String(error?.message || error || ''))}`;
    // Error visibility — scroll up to the alert. Success path stays
    // put (showPrSuccessCard surfaces the card right under the submit
    // button so the user doesn't have to look up).
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } finally {
    btn.disabled = false; btnText.classList.remove('d-none'); btnLoading.classList.add('d-none');
  }
}
