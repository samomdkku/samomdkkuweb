-- passport0180-season-gate.sql — a QR scans while its quarter is open, and not after.
--
-- BOTH DIRECTIONS, because a probe that can only print "denied" cannot tell a
-- working guard from a broken connection (.claude/rules/mistakes.md class 7).
--   ALLOW  — season open  → the scan is created
--   DENY   — season ended → SEASON_CLOSED, and NO scan is created
--   DENY   — a quarter not open yet (0245) → SEASON_NOT_OPEN, fails CLOSED
--   CONTROL— the ALLOW case is genuinely reachable, so a green DENY means something
--
-- Everything happens inside a transaction that ROLLS BACK. It creates its own
-- activity and its own season rather than borrowing real ones, so it cannot
-- depend on live geometry that runs out — the two rail proofs that errored for
-- six days did exactly that (tooling-proofs.md).
begin;

-- ⚠️ THE VERDICT MUST START WITH "PASS", AND ROWS NOT NOTICES.
-- Two separate things run-proofs.mjs needs, and this file got both wrong first:
--   * RAISE NOTICE returns nothing through the Management API — `[]`. Every case
--     ran and none could be read.
--   * Then the verdicts said 'ok', and judge() counts a case as passing only if
--     the verdict STARTS WITH "PASS" — so six green cases were reported as
--     "6 failed". Green by hand, red under the runner, same database. That
--     difference is never the subject; it is the instrument.
-- ⚠️ RESULTS ARE ROWS, NOT NOTICES. The first version of this file used
-- RAISE NOTICE and the Management API returned `[]` — every case ran and
-- nothing could be read. tooling-proofs.md: a proof is only as good as its
-- runner's ability to read it.
create temporary table proof_0180 (seq serial, verdict text, detail text) on commit drop;

do $$
declare
  v_uid     uuid;
  v_season  uuid;
  v_act     uuid;
  v_scan    passport.scans;
  v_err     text;
  v_scans_before int;
  v_empty   uuid;
begin
  -- A real kkumail identity: stamp_scan reads auth.uid() and checks the domain.
  select id into v_uid from auth.users
   where lower(email) like '%@kkumail.com' order by created_at limit 1;
  if v_uid is null then
    insert into proof_0180(verdict,detail) values ('FAIL', format('setup: no @kkumail.com user exists to scan as'));
    return;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_uid)::text, true);

  -- Our own season + activity, so nothing depends on what Q2 happens to hold.
  insert into passport.samo_seasons (samo_year_id, name)
       values ((select id from passport.samo_years order by started_at desc limit 1),
               'PROOF-0180')
    returning id into v_season;

  insert into passport.activities (name, base_points_km, static_token, season_id)
       values ('PROOF 0180 activity', 1, 'proof-0180-token', v_season)
    returning id into v_act;

  ---------------------------------------------------------------- ALLOW
  begin
    v_scan := passport.stamp_scan(v_act, 'proof-0180-token');
    if v_scan.id is not null then
      insert into proof_0180(verdict,detail) values ('PASS', format('ALLOW  season OPEN  -> scan created (%s km)', v_scan.points_awarded));
    else
      insert into proof_0180(verdict,detail) values ('FAIL', format('ALLOW season OPEN -> no scan returned'));
    end if;
  exception when others then
    insert into proof_0180(verdict,detail) values ('FAIL', format('ALLOW season OPEN -> refused with %s', sqlerrm));
  end;

  -- undo the scan so the DENY half is not blocked by ALREADY_STAMPED
  delete from passport.scans where user_id = v_uid and activity_id = v_act;

  ---------------------------------------------------------------- DENY (closed)
  update passport.samo_seasons set ended_at = now() where id = v_season;
  select count(*) into v_scans_before from passport.scans
   where user_id = v_uid and activity_id = v_act;
  begin
    v_scan := passport.stamp_scan(v_act, 'proof-0180-token');
    insert into proof_0180(verdict,detail) values ('FAIL', format('DENY season CLOSED -> the scan was ACCEPTED'));
  exception when others then
    v_err := sqlerrm;
    if v_err = 'SEASON_CLOSED' then
      insert into proof_0180(verdict,detail) values ('PASS', format('DENY   season CLOSED -> SEASON_CLOSED'));
    else
      insert into proof_0180(verdict,detail) values ('FAIL', format('DENY season CLOSED -> wrong error: %s', v_err));
    end if;
  end;

  -- a refusal must also not have written anything
  if (select count(*) from passport.scans
       where user_id = v_uid and activity_id = v_act) = v_scans_before then
    insert into proof_0180(verdict,detail) values ('PASS', format('DENY   refused AND wrote no scan row'));
  else
    insert into proof_0180(verdict,detail) values ('FAIL', format('DENY refused but a scan row appeared'));
  end if;

  ---------------------------------------------------------------- DENY (not open yet)
  -- 0245 changed what a NULL season_id MEANS: "a quarter whose season does not
  -- exist yet" (an activity made AHEAD for Q4). It must still fail CLOSED —
  -- with SEASON_NOT_OPEN — and must NOT fall through to whatever quarter is
  -- open, which is the bug 0180 exists to stop wearing a new face. A proof
  -- วาระ with no seasons at all guarantees nothing can resolve.
  insert into passport.samo_years (name) values ('PROOF-0180-empty-year') returning id into v_empty;
  update passport.activities set samo_year_id = v_empty, season_id = null where id = v_act;
  begin
    v_scan := passport.stamp_scan(v_act, 'proof-0180-token');
    insert into proof_0180(verdict,detail) values ('FAIL', format('DENY quarter NOT OPEN -> the scan was ACCEPTED (fails OPEN)'));
  exception when others then
    if sqlerrm like 'SEASON_NOT_OPEN:%' then
      insert into proof_0180(verdict,detail) values ('PASS', format('DENY   quarter NOT OPEN -> %s (fails closed)', sqlerrm));
    else
      insert into proof_0180(verdict,detail) values ('FAIL', format('DENY quarter NOT OPEN -> wrong error: %s', sqlerrm));
    end if;
  end;

  ---------------------------------------------------------------- CONTROL
  -- Re-open the season and scan again. If this cannot pass, every DENY above
  -- proves nothing: they would be green because the call never worked at all.
  update passport.activities set season_id = v_season where id = v_act;
  update passport.samo_seasons set ended_at = null where id = v_season;
  begin
    v_scan := passport.stamp_scan(v_act, 'proof-0180-token');
    insert into proof_0180(verdict,detail) values ('PASS', format('CONTROL re-opened     -> scan created again'));
  exception when others then
    insert into proof_0180(verdict,detail) values ('FAIL', format('CONTROL re-opened -> refused with %s', sqlerrm));
  end;

  ---------------------------------------------------------------- trigger
  -- A new activity must get the open season with nobody setting it.
  declare v_auto uuid; v_auto_season uuid;
  begin
    insert into passport.activities (name, base_points_km, static_token)
         values ('PROOF 0180 trigger', 1, 'proof-0180-trigger')
      returning id, season_id into v_auto, v_auto_season;
    if v_auto_season is not null then
      insert into proof_0180(verdict,detail) values ('PASS', format('TRIGGER new activity  -> season filled automatically'));
    else
      insert into proof_0180(verdict,detail) values ('FAIL', format('TRIGGER new activity -> season_id left NULL'));
    end if;
  end;
end $$;

select verdict, detail from proof_0180 order by seq;

rollback;
