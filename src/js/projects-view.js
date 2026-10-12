// ==============================================
// PROJECTS-VIEW — public, read-only customer mirror
//
// Lazy-loads on first tab show. Delegates to projects/index.js's
// mountCustomerProjects(), which configures the existing projects
// module in role='customer' mode (no actions, no notifications,
// no markDocSeen mutations).
//
// ฝ่ายสโม tags (projects.samo_depts, migration 0212) ride along for free:
// mountCustomerProjects() reuses projects/inbox.js's renderers, so the same
// ฝ่าย filter dropdown and read-only chips the admin inbox shows also render
// here — nothing customer-specific to wire. Tagging itself is vpa-desk-only
// and stays gated out of this read-only mode.
// ==============================================

import { mountCustomerProjects } from './projects/index.js';

let initialised = false;

async function bootIfNeeded() {
  if (initialised) return;
  initialised = true;
  const grid = document.getElementById('projectsGrid');
  if (grid && grid.childElementCount === 0) {
    grid.innerHTML = '<div class="text-center text-muted py-5">'
      + '<div class="spinner-border spinner-border-sm me-2"></div>กำลังโหลด…</div>';
  }
  try {
    await mountCustomerProjects();
  } catch (e) {
    console.error('[projects-view] mount failed:', e);
    if (grid) {
      grid.innerHTML = '<div class="text-center text-danger py-5">'
        + 'โหลดหนังสือโครงการไม่สำเร็จ — กรุณารีเฟรชหน้านี้</div>';
    }
  }
}

export function initProjectsView() {
  // Boot when the tab is first shown.
  document.addEventListener('shown.bs.tab', (e) => {
    if (e.target?.id === 'pills-projects-view-tab') bootIfNeeded();
  });

  // Also boot if the page lands directly on /projects-view (the
  // path router activates the tab before this listener gets the
  // shown.bs.tab event — defensive queueMicrotask covers that
  // ordering edge case).
  queueMicrotask(() => {
    if (document.getElementById('pills-projects-view')?.classList.contains('active')) {
      bootIfNeeded();
    }
  });
}
