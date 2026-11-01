// ==============================================
// TEAM REALTIME — live multi-editor sync via Supabase Realtime
//
// Subscribes to postgres_changes on team_nodes + team_members (and, on its own
// channel, team_standing_groups — 0273) so another editor's
// edits land without a refresh (last-write-wins; not character-level OT).
// Realtime re-applies RLS, so only vp_admin/dev sessions receive events.
//
// (No presence indicator: this SPA keeps the channel open across admin
// sections, so a presence count would include people who've already navigated
// away — misleading rather than useful. The data sync below is the value.)
// ==============================================

import { db, currentAccessToken } from '../db.js';

let channel = null;
let standingChannel = null;
let reauthTimer = null;

/** @param {(table: string, payload: object) => void} onChange  row change handler */
export function subscribeTeam(onChange) {
  if (channel) return channel;
  // Make sure the realtime socket authenticates as the signed-in user (our
  // db client disables autoRefresh, so set the token explicitly).
  try { db.realtime.setAuth(currentAccessToken()); } catch (_) {}

  channel = db.channel('team-collab')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_nodes' },
      (p) => { try { onChange('team_nodes', p); } catch (e) { console.warn('[team] rt nodes', e); } })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_members' },
      (p) => { try { onChange('team_members', p); } catch (e) { console.warn('[team] rt members', e); } })
    .subscribe();

  // The ถาวร list (0273), on a channel OF ITS OWN. Without it a tab kept
  // drawing a group someone else had just marked ถาวร under ประจำปี — and
  // acting on it there. Separate because Realtime refuses a WHOLE channel when
  // one of its tables is missing from the publication: measured on samo-dev
  // before 0273, the shared channel delivered no tree change at all. Apart, a
  // database without 0273 loses only this, and index.js re-asks the list after
  // every new top-level group anyway.
  standingChannel = db.channel('team-standing')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'team_standing_groups' },
      (p) => { try { onChange('team_standing_groups', p); } catch (e) { console.warn('[team] rt standing', e); } })
    .subscribe();

  // Our db client has autoRefreshToken disabled, so the socket's JWT would go
  // stale (~1h) and reconnects would silently lose RLS-gated events. Re-push
  // the current token every 20 min (dbRest keeps it fresh on writes).
  clearInterval(reauthTimer);
  reauthTimer = setInterval(() => {
    try { db.realtime.setAuth(currentAccessToken()); } catch (_) {}
  }, 20 * 60 * 1000);

  return channel;
}

export function unsubscribeTeam() {
  clearInterval(reauthTimer);
  reauthTimer = null;
  if (standingChannel) { try { db.removeChannel(standingChannel); } catch (_) {} standingChannel = null; }
  if (!channel) return;
  try { db.removeChannel(channel); } catch (_) {}
  channel = null;
}
