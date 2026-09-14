// Tests for the "บ้านของฉัน" card.
//
// THE BUG THESE EXIST FOR. Reported as "the แก้ไขข้อมูล of ระบบบ้าน — i need to
// click many times and sometime it will appear, also the เพื่อนร่วมบ้าน".
// renderMyHouse() runs on every auth event, and it used to add a DELEGATED
// listener to `host` — a node that SURVIVES the re-render — whose handler did
// `classList.toggle('d-none')`. Two paints meant two listeners, so one click
// toggled twice and the panel stayed shut; three paints meant it opened again.
// It looked intermittent, which is exactly why nobody could pin it down.
//
// A DOM-level test would be the direct proof, but this repo's test setup has no
// jsdom and the renderer's contract is deliberately "anything with .innerHTML
// and .hidden". So the shape is pinned at the SOURCE, the way delete-guard.test.js
// pins the DELETE convention: the module must never attach a listener to the
// host it re-renders, and must never derive panel visibility from the panel's
// own current class.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../db.js', () => ({ dbRest: vi.fn() }));
vi.mock('../uploads.js', () => ({ convertDriveUrl: (u) => u }));

const { renderMyHouse, HOUSE_DETAIL_FIELDS, REQUESTABLE_FIELDS } = await import('./my-house.js');
const SRC = readFileSync(new URL('./my-house.js', import.meta.url), 'utf8');
// Comment lines stripped: the header explains the traps by NAME, and a test
// that greps for a hazard must not fire on the sentence describing it.
const CODE = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

/** Minimal element stand-in: renderMyHouse only sets .hidden / .innerHTML, and
 *  wiring is skipped when there is no querySelector. */
const host = () => ({ hidden: false, innerHTML: '' });

const recWith = (over = {}) => ({
  kkumail: 'somebody@kkumail.com',
  student_id: '659999999-9',
  full_name: 'สมชาย ใจดี',
  nickname: 'ชาย',
  major: 'MD',
  cohort_year: 2565,
  sai: '017',
  house_id: 7,
  house_name: 'บ้านทดสอบ',
  house_color: '#105922',
  // No `title` key since 0128 — คำนำหน้า is part of the name, exactly as it is
  // for ทีม SAMO since 0113, and the RPC no longer returns the field.
  advisors: [{
    name: 'ผศ.นพ. ก ข', dept: 'ภาควิชาอายุรศาสตร์', email: 'kor@kku.ac.th',
  }],
  house_advisors: [
    { name: 'ผศ.นพ. ก ข', dept: 'ภาควิชาอายุรศาสตร์', email: 'kor@kku.ac.th', sai: '017' },
    { name: 'พญ. ค ง', dept: 'ภาควิชากุมารเวชศาสตร์', email: 'kor2@kku.ac.th', sai: '027' },
  ],
  ...over,
});

describe('the re-render trap', () => {
  it('never attaches a listener to the host it re-renders', () => {
    // `host.addEventListener(...)` accumulates one handler per paint. Listeners
    // must go on nodes created by THIS paint, which the next `innerHTML =`
    // discards along with them.
    expect(CODE).not.toMatch(/host\.addEventListener/);
  });

  it('never toggles panel visibility off the panel\'s own class', () => {
    // `classList.toggle('d-none')` answers "was it open?" from the DOM, so a
    // handler that fires twice ends where it started. State is held in one
    // variable and every panel is set explicitly from it.
    expect(CODE).not.toMatch(/classList\.toggle\(\s*['"]d-none['"]/);
  });

  it('does not use native prompt()/alert()/confirm()', () => {
    // Chrome's "Prevent this page from creating additional dialogs" makes them
    // return null with no error and no trace — the shape that made the ทีม SAMO
    // delete button look dead. The report flow is an in-card form instead.
    expect(CODE).not.toMatch(/\b(prompt|alert|confirm)\(/);
  });
});

describe('renderMyHouse', () => {
  it('renders nothing at all for a student who is not in the table', () => {
    const el = host();
    renderMyHouse(el, null);
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });

  it('shows the record as label → value, like ตำแหน่งของฉันในทีม SAMO', () => {
    const el = host();
    renderMyHouse(el, recWith());
    for (const label of ['ชื่อ-สกุล', 'ชื่อเล่น', 'รหัสนักศึกษา', 'รุ่น', 'สาขา',
      'สายรหัส', 'บ้าน', 'KKU Mail']) {
      expect(el.innerHTML).toContain(label);
    }
    expect(el.innerHTML).toContain('659999999-9');
    expect(el.innerHTML).toContain('somebody@kkumail.com');
  });

  it('shows รุ่น and ชั้นปี as SEPARATE facts, never one relabelled as the other', () => {
    // This test used to assert ชั้นปี was absent entirely (0123 removed it
    // because a STORED ชั้นปี rots). 0131 brings it back as a DERIVED value, at
    // the owner's request — "it's easier to visualized by like ปี 4 than MDxx".
    // The two are different facts and the ลาพัก case is what separates them:
    // someone who paused a year is still MD50 and is now studying ปี 4.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('MD50');       // รุ่น — cohort identity
    expect(el.innerHTML).toContain('ชั้นปี');      // ชั้นปี — derived, this year
  });

  it('never puts a ชั้นปี NUMBER in the save patch — only the difference', () => {
    // The invariant the old "no ชั้นปี" test was really protecting. A stored
    // ชั้นปี is right for one August and silently wrong every August after; what
    // travels is `year_offset`, the gap, which needs no yearly maintenance.
    const patch = CODE.match(/const patch = \{[\s\S]*?\n\s*\};/);
    expect(patch[0]).not.toMatch(/year:/);
    expect(patch[0]).not.toMatch(/study_year:/);
    expect(CODE).toMatch(/patch\.year_offset\s*=/);
    // …and the gap is measured with the shared rule, not re-derived inline.
    expect(CODE).toMatch(/offsetForPickedYear\(/);
  });

  it('disables the ชั้นปี chooser when there is no ปีที่เข้า to count from', () => {
    // A shared department account or a row whose รหัส is not filled in yet.
    // Letting them pick an absolute year here would recreate `year_override`,
    // the exact column 0129 deleted.
    const el = host();
    renderMyHouse(el, recWith({ student_id: null, cohort_year: null }));
    expect(el.innerHTML).not.toContain('name="study_year"');
    expect(el.innerHTML).toContain('กรอกรหัสนักศึกษาก่อน');
  });

  it('offers the ชั้นปี chooser, defaulting to "ตามที่ระบบคำนวณ"', () => {
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('name="study_year"');
    expect(el.innerHTML).toMatch(/<option value=""\s+selected>ตามที่ระบบคำนวณ/);
  });

  it('offers NO ยืนยันข้อมูล — it is not data we collect', () => {
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).not.toContain('ยืนยัน');
    expect(CODE).not.toMatch(/verif/i);
  });

  it('names an unnamed house "บ้าน N" rather than hiding it', () => {
    const el = host();
    renderMyHouse(el, recWith({ house_name: null, house_id: 3 }));
    expect(el.innerHTML).toContain('บ้าน 3');
  });

  it('says so plainly when there is no สายรหัส yet', () => {
    const el = host();
    renderMyHouse(el, recWith({ house_id: null, house_name: null, sai: null }));
    expect(el.innerHTML).toContain('ยังไม่ได้กำหนดสายรหัส');
  });

  it('names NO other student, ever — อาจารย์ only', () => {
    // ระบบบ้าน publishes อาจารย์ in their staff capacity and nobody else.
    // เพื่อนร่วมบ้าน and the RPC behind it were removed in 0124; a button here
    // would be the first step back toward publishing a 1,800-name directory.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).not.toContain('เพื่อนร่วมบ้าน');
    expect(el.innerHTML).not.toContain('data-house-act="roster"');
    expect(CODE).not.toMatch(/roster/i);
  });

  it('lists the อาจารย์ of the whole house, tagged with their สาย', () => {
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('อาจารย์ที่ปรึกษาสายของฉัน');
    expect(el.innerHTML).toContain('อาจารย์ในบ้านเดียวกัน');
    expect(el.innerHTML).toContain('สาย 027');
    // …and does not name the student's OWN สาย advisor twice.
    expect(el.innerHTML.match(/ผศ\.นพ\. ก ข/g)).toHaveLength(1);
  });

  it('NEVER offers สายรหัส as an editable field — it decides the house', () => {
    // The one field with an incentive to abuse: editing it moves you between
    // houses. Read-only here, refused by update_my_student_record (0125), and
    // the only route is a request an admin approves.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('readonly');
    expect(el.innerHTML).not.toContain('name="sai"');
    expect(CODE).not.toMatch(/sai_editable/);     // no "sometimes" about it
    // Scoped to the SAVE PATCH rather than to the whole file. The bare grep for
    // `sai_code:` used to stand in for this, and it started failing on a
    // field-LABEL map (`{ sai_code: 'สายรหัส' }`) that sends nothing anywhere —
    // a guard that fires on the word instead of the thing eventually gets
    // deleted by whoever is trying to ship. What must never happen is
    // `sai_code` appearing in the object handed to saveMyStudentRecord.
    const patch = CODE.match(/const patch = \{[\s\S]*?\n\s*\};/);
    expect(patch).not.toBeNull();
    expect(patch[0]).not.toMatch(/sai/);
  });

  it('offers the five fields a person can fix about themselves', () => {
    const el = host();
    renderMyHouse(el, recWith());
    for (const name of ['first_name_th', 'last_name_th', 'nickname',
      'student_id', 'major']) {
      expect(el.innerHTML).toContain(`name="${name}"`);
    }
    // สาขา is a CHOOSER, never free text — free text is what produced MD/md/M.D.
    expect(el.innerHTML).toMatch(/<select name="major"/);
  });

  it('opens the สาขา chooser on the CURRENT value, not on an empty placeholder', () => {
    // The form is submittable the instant it appears. If the select started as
    // a bare <option value=""> while the vocabulary loaded, a fast submit would
    // send major:"" — written as NULL, and self_edited then makes that loss
    // permanent against every future import. The list arriving later only
    // REPLACES options; it must never be what stops the value being right.
    const el = host();
    renderMyHouse(el, recWith({ major: 'MDI' }));
    const select = el.innerHTML.match(/<select name="major"[^>]*>([\s\S]*?)<\/select>/);
    expect(select).not.toBeNull();
    expect(select[1]).toMatch(/value="MDI" selected/);
    expect(select[1]).not.toContain('กำลังโหลด');
  });

  it('shows the อาจารย์ address and ภาควิชา, not just a name', () => {
    // A card that names the person you need and withholds how to reach them
    // moves the work rather than doing it.
    const el = host();
    renderMyHouse(el, recWith());
    expect(el.innerHTML).toContain('mailto:kor@kku.ac.th');
    expect(el.innerHTML).toContain('ภาควิชาอายุรศาสตร์');
  });

  it('renders nothing extra for an อาจารย์ with no address on file', () => {
    const el = host();
    renderMyHouse(el, recWith({
      advisors: [{ name: 'ก ข' }], house_advisors: [],
    }));
    expect(el.innerHTML).not.toContain('mailto:');
    expect(el.innerHTML).toContain('ก ข');
  });

  describe('อาจารย์ — one list open, one folded', () => {
    // "อาจารย์ในบ้านเดียวกัน should collapsable". It is ~18 people the student
    // is not looking for today, and open it is the longest thing on the card.
    it('leaves the student\'s OWN สาย expanded — that is the question they came with', () => {
      const el = host();
      renderMyHouse(el, recWith());
      const [beforeFold] = el.innerHTML.split('<details');
      expect(beforeFold).toContain('อาจารย์ที่ปรึกษาสายของฉัน');
      expect(beforeFold).toContain('kor@kku.ac.th');
    });

    it('folds the house-wide list and keeps the count on the summary', () => {
      const el = host();
      // NOTE the student's OWN สาย (017) is filtered out of the house-wide list
      // so nobody is named twice on one card — the count is 2, not 3.
      renderMyHouse(el, recWith({
        house_advisors: [
          { name: 'ผศ.นพ. ก ข', email: 'kor@kku.ac.th', sai: '017' },
          { name: 'พญ. ค ง', email: 'kor2@kku.ac.th', sai: '027' },
          { name: 'อ. จ ฉ', email: 'kor3@kku.ac.th', sai: '037' },
        ],
      }));
      expect(el.innerHTML).toContain('อาจารย์ในบ้านเดียวกัน');
      expect(el.innerHTML).toContain('2 ท่าน');
      // A <details> with no `open` attribute — a fold that renders expanded is
      // not a fold, and this card has shipped a toggle that only worked on
      // odd-numbered paints, so the collapsed state is asserted, not assumed.
      const fold = el.innerHTML.slice(el.innerHTML.indexOf('อาจารย์ในบ้านเดียวกัน') - 400);
      expect(fold).not.toMatch(/<details[^>]*\sopen/);
    });

    it('shows no fold when the house has no other อาจารย์', () => {
      const el = host();
      renderMyHouse(el, recWith({ house_advisors: [] }));
      expect(el.innerHTML).toContain('อาจารย์ที่ปรึกษาสายของฉัน');
      expect(el.innerHTML).not.toContain('อาจารย์ในบ้านเดียวกัน');
    });
  });

  describe('คำขอแก้ไขของฉัน — the answer has to come back', () => {
    // REPORTED: "the reason admin type doesn't get shown for the user, also the
    // status that admin reject or accept doesn't get shown to the user". There
    // was no read path at all: student_change_requests is admin-only under RLS,
    // so the admin was typing into a column nobody on the other side could see.
    it('is absent entirely when the student has never filed one', () => {
      const el = host();
      renderMyHouse(el, recWith());
      expect(el.innerHTML).not.toContain('คำขอแก้ไขของฉัน');
    });

    it('shows a pending request as waiting, with no verdict implied', () => {
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{ field: 'sai_code', requested_value: '027', status: 'pending' }],
      }));
      expect(el.innerHTML).toContain('คำขอแก้ไขของฉัน');
      expect(el.innerHTML).toContain('กำลังรอผู้ดูแลตรวจสอบ');
      expect(el.innerHTML).toContain('027');
    });

    it('shows the admin\'s note on both an approval and a rejection', () => {
      for (const status of ['approved', 'rejected']) {
        const el = host();
        renderMyHouse(el, recWith({
          my_requests: [{
            field: 'sai_code', requested_value: '027', status,
            decision_note: 'ตรวจกับทะเบียนแล้ว',
          }],
        }));
        expect(el.innerHTML).toContain('ตรวจกับทะเบียนแล้ว');
      }
    });

    it('says so when the admin saved something OTHER than what was asked', () => {
      // An admin may correct the value on approval (0128). "อนุมัติแล้ว" beside
      // a card showing a third สาย is the confusion this line exists to stop.
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{
          field: 'sai_code', requested_value: '027', applied_value: '037',
          status: 'approved',
        }],
      }));
      expect(el.innerHTML).toContain('037');
      expect(el.innerHTML).toContain('ผู้ดูแลบันทึกให้เป็น');
    });

    // ── folding, reported as "it took space" ────────────────────────────
    //
    // "i think คำขอแก้ไขของฉัน shows many on main web, it took space, i think
    // it should be collapsable, or like show the recent one and history".
    // The rule: an OPEN loop is never folded, a decided one always is except
    // the newest, and the count stays visible on the summary.
    const req = (over) => ({
      field: 'sai_code', requested_value: '027', status: 'approved',
      created_at: '2026-01-01T00:00:00Z', ...over,
    });

    it('never folds a PENDING request, however much history there is', () => {
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [
          req({ status: 'pending', requested_value: '099', created_at: '2026-05-01T00:00:00Z' }),
          req({ requested_value: '011', created_at: '2026-02-01T00:00:00Z' }),
          req({ requested_value: '012', created_at: '2026-03-01T00:00:00Z' }),
        ],
      }));
      // The open one is outside the fold…
      const [beforeFold] = el.innerHTML.split('<details');
      expect(beforeFold).toContain('099');
      expect(beforeFold).toContain('กำลังรอผู้ดูแลตรวจสอบ');
      // …and BOTH decided ones are inside it, counted on the summary.
      expect(el.innerHTML).toContain('คำขอก่อนหน้านี้');
      expect(el.innerHTML).toContain('>2</span>');
    });

    it('keeps the NEWEST decision visible when nothing is pending', () => {
      // An answer arriving is itself news. Folding it would mean the reply to
      // the student's question appeared with no visible change on the card.
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [
          req({ requested_value: '011', created_at: '2026-02-01T00:00:00Z' }),
          req({ requested_value: '077', created_at: '2026-09-01T00:00:00Z' }),
        ],
      }));
      const [beforeFold] = el.innerHTML.split('<details');
      expect(beforeFold).toContain('077');
      expect(beforeFold).not.toContain('011');
      expect(el.innerHTML).toContain('คำขอก่อนหน้านี้');
    });

    it('grows no fold at all for a single request', () => {
      const el = host();
      renderMyHouse(el, recWith({ my_requests: [req({})] }));
      expect(el.innerHTML).toContain('คำขอแก้ไขของฉัน');
      expect(el.innerHTML).not.toContain('คำขอก่อนหน้านี้');
    });

    it('does not repeat the value back when it was approved as asked', () => {
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{
          field: 'sai_code', requested_value: '027', applied_value: '027',
          status: 'approved',
        }],
      }));
      expect(el.innerHTML).not.toContain('ผู้ดูแลบันทึกให้เป็น');
    });

    it('escapes the admin\'s note — it is free text typed into an admin form', () => {
      const el = host();
      renderMyHouse(el, recWith({
        my_requests: [{
          field: 'sai_code', requested_value: '027', status: 'rejected',
          decision_note: '<img src=x onerror=alert(1)>',
        }],
      }));
      expect(el.innerHTML).not.toContain('<img src=x');
    });
  });

  it('escapes every user-typed field — it all lands in innerHTML', () => {
    const el = host();
    renderMyHouse(el, recWith({
      full_name: '<img src=x onerror=alert(1)>',
      nickname: '"><script>bad()</script>',
      house_name: '<b>x</b>',
    }));
    expect(el.innerHTML).not.toContain('<img src=x');
    expect(el.innerHTML).not.toContain('<script>');
    expect(el.innerHTML).not.toContain('<b>x</b>');
  });
});

describe('the field lists', () => {
  it('leaves no field without a route — self-edit, derived, or a request', () => {
    // Every field the card SHOWS must be fixable somehow, or "mine is wrong" is
    // a dead end. Since 0125 the student edits five of them directly; the rest
    // are either derived from one of those, or go through a request.
    const requestable = new Set(REQUESTABLE_FIELDS.map((f) => f.field));
    const route = {
      cohort: 'derived',      // from student_id, which IS self-editable
      sai: 'request',
      house: 'request',       // the house IS the last digit of the สาย
      kkumail: 'identity',    // changing it is an admin/auth job, not a request
    };
    for (const f of HOUSE_DETAIL_FIELDS.filter((x) => !x.self)) {
      expect(route[f.key]).toBeDefined();
      if (route[f.key] === 'request') expect(requestable.has('sai_code')).toBe(true);
    }
    // …and the five self-editable ones are exactly what the form offers.
    expect(HOUSE_DETAIL_FIELDS.filter((f) => f.self).map((f) => f.key))
      .toEqual(['full_name', 'nickname', 'student_id', 'study_year', 'major']);
  });

  it('asks for nothing request_my_change would reject', () => {
    // The allow-list in migration 0116. A field outside it raises
    // 'ไม่รองรับการขอแก้ไขช่องนี้', i.e. a button that always fails.
    const allowed = new Set(['sai_code', 'student_id', 'first_name_th',
      'last_name_th', 'major', 'cohort_year']);
    for (const f of REQUESTABLE_FIELDS) expect(allowed.has(f.field)).toBe(true);
  });
});

describe('one identity, one place — the paired card', () => {
  // REPORTED: "ตำแหน่งของฉันในทีม SAMO and บ้านของฉัน show similar information
  // two times". Both cards rendered ชื่อ, ชื่อเล่น, รหัสนักศึกษา, ชั้นปี and สาขา,
  // each with its own edit form writing its own table. 0132 made those one row
  // in the database; this is the screen half.
  it('drops the identity rows when the seat card above already shows them', () => {
    const el = host();
    renderMyHouse(el, recWith(), { identityShownAbove: true });
    // Asserted on the DETAIL ROWS (`<dt>x</dt>`), not on the whole card: the
    // signpost note deliberately NAMES these fields to say where they went, so
    // a bare "does not contain ชื่อเล่น" would fail on the very sentence that
    // makes the removal navigable.
    for (const gone of ['ชื่อ-สกุล', 'ชื่อเล่น', 'รหัสนักศึกษา', 'สาขา', 'KKU Mail']) {
      expect(el.innerHTML).not.toContain(`<dt>${gone}</dt>`);
    }
    // …and keeps what is genuinely house-specific.
    for (const kept of ['รุ่น', 'สายรหัส', 'บ้าน']) {
      expect(el.innerHTML).toContain(`<dt>${kept}</dt>`);
    }
  });

  it('offers ONE edit form, not two — the seat card owns identity', () => {
    const el = host();
    renderMyHouse(el, recWith(), { identityShownAbove: true });
    expect(el.innerHTML).not.toContain('data-house-act="edit"');
    // The "where did the edit go" note is gone with it: in section mode the
    // edit button is a few rows up in the SAME card, so a signpost pointing at
    // it would be pointing at itself.
    expect(el.innerHTML).not.toContain('data-house-form="edit"');
  });

  it('drops its own card shell in section mode — one card, not two', () => {
    // Reported: "it look worse, i thought it would be like one card". Two
    // sibling cards meant two eyebrows, two portraits and two identity blocks
    // for one person.
    const el = host();
    renderMyHouse(el, recWith(), { mode: 'section' });
    expect(el.innerHTML).not.toContain('myseat-card');
    expect(el.innerHTML).not.toContain('myseat-eyebrow');
    expect(el.innerHTML).toContain('myprofile-section');
    // …and still shows the house itself.
    expect(el.innerHTML).toContain('บ้านทดสอบ');
    expect(el.innerHTML).toContain('myhouse-crest');
  });

  it('still offers แจ้งสายรหัสไม่ถูกต้อง — that is house-only and has no twin', () => {
    const el = host();
    renderMyHouse(el, recWith(), { identityShownAbove: true });
    expect(el.innerHTML).toContain('data-house-act="report"');
  });

  it('carries EVERYTHING when there is no seat card — the common student case', () => {
    // ~1,800 students hold no ทีม SAMO posting. For them this card is the only
    // one on screen and must not have been hollowed out.
    const el = host();
    renderMyHouse(el, recWith());
    for (const kept of ['ชื่อ-สกุล', 'ชื่อเล่น', 'รหัสนักศึกษา', 'สาขา', 'KKU Mail']) {
      expect(el.innerHTML).toContain(`<dt>${kept}</dt>`);
    }
    expect(el.innerHTML).toContain('data-house-act="edit"');
  });

  it('renders nothing for a person in neither system', () => {
    const el = host();
    renderMyHouse(el, null, { identityShownAbove: true });
    expect(el.hidden).toBe(true);
    expect(el.innerHTML).toBe('');
  });
});

// ============================================================
// ยืนยันตัวตน — the claim form on the empty card (0188)
// ============================================================
//
// 165 rows of the 2026-09-14 handover carry no kkumail, so those students have
// no `students` row and land on the empty card. Before this they read
// "ยังไม่มีข้อมูลของคุณ — แจ้งได้ที่ VitalSound", which is a ticket queue
// standing in for a feature: they are signed in with an address Google has
// already verified, and the only thing missing is the link to their seat.
describe('the empty card offers a way in — to the people it can help', () => {
  const paint = (account) => {
    const h = host();
    renderMyHouse(h, null, { signedIn: true, account });
    return h.innerHTML;
  };

  it('a kkumail account gets the claim form', () => {
    const html = paint('nobody@kkumail.com');
    expect(html).toContain('data-house-form="claim"');
    expect(html).toContain('name="student_id"');
    expect(html).toContain('name="first_name"');
  });

  it('asks for BOTH facts — one of them is enumerable on its own', () => {
    // A รหัสนักศึกษา alone is a ~300-wide space per รุ่น behind a known prefix,
    // and a claimed seat is a place in someone else's บ้าน under someone else's
    // name. The ชื่อ is what makes an attacker have to know who they are
    // targeting. If this ever renders one field, the server gate is the only
    // thing left — and a form that asks for less than the server requires just
    // fails for everyone instead.
    const html = paint('nobody@kkumail.com');
    const fields = [...html.matchAll(/name="(student_id|first_name)"/g)].map((m) => m[1]);
    expect(new Set(fields)).toEqual(new Set(['student_id', 'first_name']));
  });

  it('a NON-kkumail account does not get it — the form cannot help them', () => {
    // ระบบบ้าน matches on kkumail and nothing else, so a claim from a gmail
    // account would write a row its own owner could never read. The server
    // refuses it; offering the form anyway would send someone down a path that
    // ends in an error message, when the actual fix is to sign in again.
    const html = paint('someone@gmail.com');
    expect(html).not.toContain('data-house-form="claim"');
    expect(html).toContain('@kkumail.com');
  });

  it('the claim form is wired to the nodes THIS paint made, never to the host', () => {
    // Same rule the rest of this file pins: `host` survives every render, so a
    // listener on it accumulates one per paint. wireClaim must reach inside.
    const fn = CODE.slice(CODE.indexOf('function wireClaim'),
      CODE.indexOf('export function renderMyHouse'));
    expect(fn).not.toMatch(/host\.addEventListener/);
    expect(fn).toMatch(/form\.addEventListener\(\s*'submit'/);
  });

  it('clears the cache before repainting after a successful claim', () => {
    // The cache holds the "you are nobody" answer this card was painted FROM.
    // Repainting without clearing it shows the empty card again on top of a
    // record that now exists — the stale-instrument shape, and the one that
    // makes a working feature look broken at the exact moment it worked.
    const fn = CODE.slice(CODE.indexOf('function wireClaim'),
      CODE.indexOf('export function renderMyHouse'));
    expect(fn.indexOf('clearMyHouseCache()')).toBeGreaterThan(-1);
    expect(fn.indexOf('clearMyHouseCache()')).toBeLessThan(fn.indexOf('showMyHouse('));
  });
});

// ============================================================
// ระบบบ้าน stops routing data problems to the confidential service desk (0191)
// ============================================================
describe('a student who cannot get in is not sent to VitalSound', () => {
  const paint = (account) => {
    const h = host();
    renderMyHouse(h, null, { signedIn: true, account });
    return h.innerHTML;
  };

  it('the empty card no longer offers VitalSound as the fallback', () => {
    // OWNER: "i dont want everything to overload on vitalsound too much." It is
    // worse than volume — VitalSound is the CONFIDENTIAL SERVICE DESK, and a
    // student who cannot find their house record was being sent to the
    // counselling queue to describe a data-entry problem in free text.
    const html = paint('nobody@kkumail.com');
    expect(html).not.toContain('vssound');
  });

  it('…and says the report happens on its own', () => {
    // The claim form IS the report now (claim_my_student_seat records the miss
    // with their verified address). If this promise disappears from the copy
    // while the behaviour stays, the student is left thinking nobody heard —
    // which is the state this replaced.
    //
    // ASSERTED AS THE PROPERTY, not the sentence. The first version pinned the
    // exact phrase "ไม่ต้อง…แจ้งซ้ำ" and went red on a copy edit that said the
    // same thing better ("กรอกซ้ำ" — the point is not re-TYPING, not that you
    // may not ask elsewhere). A guard that fails on rewording trains people to
    // edit the guard.
    const html = paint('nobody@kkumail.com');
    expect(html, 'the card must promise somebody is told').toMatch(/แจ้งผู้ดูแล/);
    expect(html, 'and that they need not repeat themselves').toMatch(/ไม่ต้อง.*ซ้ำ/);
  });

  it('the NON-kkumail card still just tells them to switch accounts', () => {
    // Control: that branch has a different problem and must not gain a report
    // form — there is nothing to report, they are signed in with the wrong
    // account and the fix is entirely theirs.
    const html = paint('someone@gmail.com');
    expect(html).not.toContain('data-house-form="claim"');
    expect(html).not.toContain('vssound');
  });

  it('the populated card keeps the VitalSound link — for BUGS, which is correct', () => {
    // The rule is not "no VitalSound anywhere". A broken page IS their work.
    const h = host();
    renderMyHouse(h, recWith(), { signedIn: true });
    expect(h.innerHTML).toContain('vssound');
    expect(h.innerHTML).toMatch(/พบบัค|เว็บมีปัญหา/);
  });
});

describe('"ไม่ใช่ข้อมูลของฉัน" — the only path for a record that is not yours', () => {
  const painted = () => {
    const h = host();
    renderMyHouse(h, recWith(), { signedIn: true });
    return h.innerHTML;
  };

  it('the card offers it', () => {
    expect(painted()).toContain('data-house-act="notme"');
    expect(painted()).toContain('data-house-form="notme"');
  });

  it('it warns against editing the card instead', () => {
    // The dangerous thing a person in this state would otherwise do: "fix" the
    // name to their own, overwriting a real student's record on the strength of
    // an address that was mistyped in the handover file.
    expect(painted()).toMatch(/อย่าแก้ข้อมูลในการ์ดนี้เอง/);
  });

  it('its handler files and mutates NOTHING', () => {
    // Someone looking at a stranger's record must not be able to act on it.
    // Pinned at the source, the way this file pins the listener rule: the notme
    // branch may call the report and nothing that writes a student record.
    const fn = CODE.slice(CODE.indexOf("notmeForm?.addEventListener"),
      CODE.indexOf("notmeForm?.addEventListener") + 900);
    expect(fn).toContain('reportNotMyRecord(');
    expect(fn).not.toMatch(/saveMyStudentRecord|requestMyChange|deleteStudent/);
  });

  it('is wired to the form this paint made, never to the host', () => {
    const fn = CODE.slice(CODE.indexOf("notmeForm?.addEventListener"),
      CODE.indexOf("notmeForm?.addEventListener") + 900);
    expect(fn).not.toMatch(/host\.addEventListener/);
  });
});

describe('the receipt — an invisible queue is being ignored (0192)', () => {
  it('the empty card reserves a slot for it, hidden until there is one', () => {
    const h = host();
    renderMyHouse(h, null, { signedIn: true, account: 'nobody@kkumail.com' });
    expect(h.innerHTML).toContain('data-house-receipt');
    // Hidden by default: a student with no report must not see an empty box
    // implying something was filed.
    expect(h.innerHTML).toMatch(/data-house-receipt[^>]*hidden/);
  });

  it('the card does not WAIT on it', () => {
    // A student whose record is missing must not also wait on a second round
    // trip to be told so. renderMyHouse is sync and paints the receipt after.
    const fn = CODE.slice(CODE.indexOf('function paintHelpReceipt'),
      CODE.indexOf('function paintHelpReceipt') + 1200);
    expect(fn).toMatch(/try\s*{\s*st = await fetchMyHelpStatus\(\);/);
    expect(fn, 'a failed receipt must leave the card intact').toMatch(/catch/);
    expect(CODE).toMatch(/paintHelpReceipt\(host\);/);
    expect(CODE, 'awaiting it would block the empty card')
      .not.toMatch(/await paintHelpReceipt/);
  });

  it('VitalSound appears ONLY in the receipt path, never as the first step', () => {
    // The correction: VitalSound is not confidential-only — `it / เครือข่าย` is
    // an ordinary category — so it was never the wrong place, only the wrong
    // FIRST step, because it asks a stuck student to re-type what we hold.
    const fn = CODE.slice(CODE.indexOf('function paintHelpReceipt'),
      CODE.indexOf('function paintHelpReceipt') + 1800);
    expect(fn).toContain('/vssound');
    // …and it is gated on having waited, not shown to everyone who misses once.
    expect(fn).toMatch(/stale\s*\?/);

    const empty = (() => { const h = host();
      renderMyHouse(h, null, { signedIn: true, account: 'nobody@kkumail.com' });
      return h.innerHTML; })();
    expect(empty, 'the FIRST thing they see must not be a link to another team')
      .not.toContain('vssound');
  });
});
