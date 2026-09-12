-- 0186_my_discord_link.sql
--
-- The two things a person needs about their OWN Discord link: see it, and undo
-- it. 0183 §2 deliberately shipped discord_links with NO self-read branch and
-- said to "add it WITH the screen that needs it" rather than invent an
-- auth.uid()→people mapping for a screen that did not exist. The screen exists
-- now (เชื่อมบัญชี Discord), so this is that addition.
--
-- ⛔ RPCs, NOT A WIDER POLICY ON THE TABLE. A `using (person_id = my_person_id())`
-- branch beside the admin one would be permissive-OR'd and would expose the
-- whole ROW — including `linked_by`, which records who vouched for a link, and
-- which is nobody's business but an admin's. Two narrow functions expose two
-- values. Mistakes class 1: a row policy is not a column policy.

-- ------------------------------------------------------------
-- §1 — read my own link
--
-- Returns nothing at all when the caller has no registry row, which is the same
-- answer as "not linked". That is deliberate and correct for THIS screen: both
-- mean "there is no link to show you", and the button's own error path — from
-- issue_discord_link_code(), which names the cause — is where the difference is
-- explained. A reader that tried to distinguish them here would be reporting
-- registry membership to anyone who asked.
-- ------------------------------------------------------------
create or replace function public.my_discord_link()
returns table (discord_user_id text, linked_at timestamptz)
language sql stable security definer set search_path = public as $$
  select d.discord_user_id, d.linked_at
    from public.discord_links d
   where d.person_id = public.my_person_id();
$$;

revoke all on function public.my_discord_link() from public, anon;
grant execute on function public.my_discord_link() to authenticated;

comment on function public.my_discord_link() is
  'The caller''s own Discord link, or no rows. An RPC rather than an RLS branch '
  'so a person sees the id and the date and NOT linked_by (0186).';

-- ------------------------------------------------------------
-- §2 — unlink myself
--
-- ⛔ EVERY DELETE NEEDS TO REPORT WHETHER IT DELETED. A PostgREST DELETE that
-- matches zero rows answers 204, not an error, and this repo has paid for that
-- more than once (`delete-guard.test.js`). So this returns a boolean instead of
-- being a bare DELETE the client cannot check.
--
-- It also removes any unspent code, or "unlink" would leave a live bearer token
-- that re-links the account it was just detached from.
-- ------------------------------------------------------------
create or replace function public.unlink_my_discord()
returns boolean
language plpgsql security definer set search_path = public as $$
declare p uuid := public.my_person_id(); n int;
begin
  if p is null then return false; end if;
  delete from public.discord_links where person_id = p;
  get diagnostics n = row_count;
  delete from public.discord_link_codes where person_id = p and used_at is null;
  return n > 0;
end $$;

revoke all on function public.unlink_my_discord() from public, anon;
grant execute on function public.unlink_my_discord() to authenticated;

comment on function public.unlink_my_discord() is
  'Detach the caller''s own Discord account. Returns whether a row was actually '
  'removed — a DELETE that matched nothing answers 204 and looks identical to '
  'success. Also spends any unused link code, so unlinking cannot leave a live '
  'token that re-links what was just detached (0186).';
