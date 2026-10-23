// js/samo.js — SamoYear (วาระสโม) / Season helpers.
// "Current" = the single open row where ended_at IS NULL. These degrade to null
// if the tables don't exist yet (migration db/0006 not run), so the app keeps
// working and scans just land in the "unassigned" bucket until a year is declared.
import { supabase } from './app.js';

/**
 * passport.season_status() (0245): applies a quarter boundary that has passed
 * but not been rolled yet, then says where Passport stands — the open วาระ and
 * season, the schedule, and which quarters a NEW activity may be credited to.
 * Asked before every "what is current" read, so a page that only READS still
 * shows the right quarter on the morning after a boundary. null when signed
 * out or on any error: callers fall back to the plain table reads below.
 */
export async function getSeasonStatus(client = supabase) {
    try {
        const { data, error } = await client.rpc('season_status');
        if (error) return null;
        return data || null;
    } catch {
        return null;
    }
}

export async function getCurrentYear() {
    const { data, error } = await supabase
        .from('samo_years').select('*')
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1);
    if (error) return null;
    return (data && data[0]) || null;
}

export async function getCurrentSeason(yearId) {
    let q = supabase.from('samo_seasons').select('*')
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1);
    if (yearId) q = q.eq('samo_year_id', yearId);
    const { data, error } = await q;
    if (error) return null;
    return (data && data[0]) || null;
}

export async function getCurrentContext() {
    await getSeasonStatus();   // roll a due quarter FIRST, then read what is open
    const year = await getCurrentYear();
    const season = year ? await getCurrentSeason(year.id) : null;
    return { year, season };
}

const TH_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
export const TH_MONTH_NAMES = TH_MONTHS;

/** "1 ธ.ค. 2569" in Thai time — the same day the schedule means, whatever the
 *  browser's own zone. */
export function thaiDate(iso, { withTime = false } = {}) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const bkk = new Date(d.getTime() + 7 * 3600 * 1000);   // Asia/Bangkok has no DST
    const day = `${bkk.getUTCDate()} ${TH_MONTHS[bkk.getUTCMonth()]} ${bkk.getUTCFullYear() + 543}`;
    if (!withTime) return day;
    const hh = String(bkk.getUTCHours()).padStart(2, '0');
    const mm = String(bkk.getUTCMinutes()).padStart(2, '0');
    return `${day} ${hh}:${mm} น.`;
}

/** The day BEFORE an exclusive end instant — a quarter "ends_at 1 ธ.ค. 00:00"
 *  reads as "ถึง 30 พ.ย.". */
export function thaiDayBefore(iso) {
    if (!iso) return '';
    return thaiDate(new Date(new Date(iso).getTime() - 1).toISOString());
}

/** One label per quarter choice, used by both activity forms. */
export function quarterChoiceLabel(c, currentQuarter) {
    const span = `${thaiDate(c.starts_at)} – ${thaiDayBefore(c.ends_at)}`;
    const now = c.open && c.quarter === currentQuarter ? ' (ตอนนี้)' : (!c.open ? ' (ยังไม่เปิด)' : '');
    return `${c.label} · ${span}${now}`;
}
