-- ============================================================
-- 0192 — tell the student their report exists.
--
-- A CORRECTION FIRST, because it was mine and it is in three files. 0191's
-- header, its commit message and docs/HOUSE-DATA-REPAIR.md §6 all say ระบบบ้าน
-- was committing a "category error" by sending data problems to VitalSound,
-- because VitalSound "is the confidential service desk". **That is wrong.** Read
-- off `vs_categories` on production, 2026-09-14: nine active categories, two
-- confidential (`personal`, one custom). The other seven are ordinary and
-- publicly eligible, and one of them is `it — IT / เครือข่าย`, which is exactly
-- where a website problem belongs. The owner said so and the table agrees.
--
-- The rule stated too broadly. What is true is narrower and survives:
-- **a student should not have to re-type facts the system already holds.** A
-- failed claim already carries their Google-verified kkumail and the รหัส and
-- ชื่อ they typed; asking them to describe all of it again in free text loses
-- structure, loses the candidate matching, and costs them the effort. That is an
-- argument about DUPLICATED EFFORT, not about which desk is allowed to help.
--
-- WHAT WAS ACTUALLY MISSING, and it is the thing VitalSound would have provided:
-- **the student cannot see that anything happened.** They type, read "ระบบได้แจ้ง
-- ผู้ดูแลให้แล้ว", and then the card looks identical for ever. No date, no state,
-- no way to tell a report that landed from a sentence that was just being
-- polite. A VitalSound ticket has a number and a status; this had neither, and
-- an invisible queue is indistinguishable from being ignored.
--
-- So: one reader, returning the caller's OWN open report and nothing else. It is
-- not a ticket system — there is no thread and no reply — it is the receipt.
-- Anyone who wants a conversation still has VitalSound, and after this the card
-- says so as the FOLLOW-UP rather than as the front door.
-- ============================================================

create or replace function public.my_house_help_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  r       public.house_help_requests%rowtype;
begin
  if v_uid is null then return null; end if;
  select lower(btrim(email)) into v_email from public.users where id = v_uid;
  if v_email is null or length(v_email) = 0 then return null; end if;

  -- The caller's OWN row, addressed by their own verified email. There is no
  -- parameter, so there is nothing to point at somebody else's report — the same
  -- reason request_my_change takes no id.
  select * into r from public.house_help_requests
   where kkumail = v_email and resolved_at is null;
  if not found then return null; end if;

  -- Deliberately NOT returned: `candidates`, and anything about the held list.
  -- The admin's view computes near misses so a human can match them; handing the
  -- same thing to the student would say "somebody with your ชื่อ exists, with a
  -- different รหัส", which is the membership oracle the neutral message exists to
  -- prevent. The receipt says THAT they were heard and WHEN, never what we found.
  return jsonb_build_object(
    'kind',       r.kind,
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'attempts',   r.attempts,
    'waiting_days', extract(day from now() - r.created_at)::int);
end;
$$;

revoke all on function public.my_house_help_status() from public, anon;
grant execute on function public.my_house_help_status() to authenticated;
