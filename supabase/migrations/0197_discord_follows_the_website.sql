-- 0197_discord_follows_the_website.sql
--
-- "WHEN SOMEONE CHANGES A ROLE ON THE WEB, IT SHOULD SYNC ON DISCORD" (owner,
-- 2026-09-19) — including renames, deletes, removals, moves, adding and
-- removing people.
--
-- Until now every Discord change was an operator running a tool on the VM.
-- This adds the half that NOTICES: one queue table, filled by triggers on the
-- three tables that decide a Discord key, drained by the samo-discord-sync
-- service (server/discord-sync.mjs). The DECISION stays where it was —
-- discord_role_targets() (0184, 0196) — so the service computes nothing the
-- report, the apply tool and the readiness check do not also compute.
--
-- WHAT ENQUEUES WHAT
--   team_members  insert / delete / move (node_id) / re-point (person_id)
--                 → 'person' for the old AND the new person
--   discord_links insert / delete / re-link to another account
--                 → 'structure' (a withdrawn account has no person row left to
--                    point at, so only a full pass can see it — 0187)
--   team_nodes    insert / delete / move (parent_id) / kind / tick /
--                 mapping change → 'structure' (every descendant's ancestry)
--                 rename of a MAPPED node → 'rename' (the Discord role follows)
-- Sibling ORDER (position) enqueues nothing: it does not change who holds what,
-- and Discord role order is a hierarchy with permission consequences (a head
-- with Manage Roles can only assign roles BELOW their own) — it is not mirrored.
--
-- ⛔ A TRIGGER BELONGS TO THE TABLE (mistakes class 6): these fire for the admin
-- editor, the importers, the registry merge and a psql session alike, which is
-- the point. They only INSERT into the queue — they never block the write they
-- observe, so a queue problem can never stop someone editing ทีม SAMO.
--
-- The queue is readable by NOBODY but the service role: RLS on, no policy,
-- grants revoked. A row carries ids only.
-- Proof: tools/team0197-sync-queue.sql.

create table if not exists public.discord_sync_queue (
  id          bigserial primary key,
  kind        text not null check (kind in ('person', 'structure', 'rename')),
  person_id   uuid,
  node_id     uuid,
  reason      text not null,
  created_at  timestamptz not null default now()
);
alter table public.discord_sync_queue enable row level security;
revoke all on public.discord_sync_queue from anon, authenticated;
revoke all on sequence public.discord_sync_queue_id_seq from anon, authenticated;

comment on table public.discord_sync_queue is
  'Work for the samo-discord-sync service: which people / what structure changed '
  'since it last looked. Filled by triggers (0197), drained by the service. '
  'Service role only.';

-- ── team_members ───────────────────────────────────────────────────────────
create or replace function public.discord_enqueue_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.person_id is not null then
    insert into public.discord_sync_queue (kind, person_id, reason)
    values ('person', old.person_id, 'team_members ' || lower(tg_op));
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.person_id is not null
     and (tg_op = 'INSERT' or new.person_id is distinct from old.person_id) then
    insert into public.discord_sync_queue (kind, person_id, reason)
    values ('person', new.person_id, 'team_members ' || lower(tg_op));
  end if;
  return null;
end $$;

drop trigger if exists discord_enqueue_member on public.team_members;
create trigger discord_enqueue_member
  after insert or delete or update of node_id, person_id on public.team_members
  for each row execute function public.discord_enqueue_member();

-- ── discord_links ──────────────────────────────────────────────────────────
create or replace function public.discord_enqueue_link()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.discord_user_id is not distinct from old.discord_user_id then
    return null;   -- a link_source / timestamp touch changes no key
  end if;
  insert into public.discord_sync_queue (kind, person_id, reason)
  values ('structure', coalesce(new.person_id, old.person_id), 'discord_links ' || lower(tg_op));
  return null;
end $$;

drop trigger if exists discord_enqueue_link on public.discord_links;
create trigger discord_enqueue_link
  after insert or delete or update on public.discord_links
  for each row execute function public.discord_enqueue_link();

-- ── team_nodes ─────────────────────────────────────────────────────────────
create or replace function public.discord_enqueue_node()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.name is distinct from old.name and new.discord_role_id is not null then
      insert into public.discord_sync_queue (kind, node_id, reason)
      values ('rename', new.id, 'team_nodes rename');
    end if;
    if new.parent_id is not distinct from old.parent_id
       and new.kind is not distinct from old.kind
       and new.discord_role is not distinct from old.discord_role
       and new.discord_role_id is not distinct from old.discord_role_id then
      return null;
    end if;
  end if;
  insert into public.discord_sync_queue (kind, node_id, reason)
  values ('structure', coalesce(new.id, old.id), 'team_nodes ' || lower(tg_op));
  return null;
end $$;

drop trigger if exists discord_enqueue_node on public.team_nodes;
create trigger discord_enqueue_node
  after insert or delete or update of name, parent_id, kind, discord_role, discord_role_id
  on public.team_nodes
  for each row execute function public.discord_enqueue_node();

revoke execute on function public.discord_enqueue_member() from public, anon, authenticated;
revoke execute on function public.discord_enqueue_link() from public, anon, authenticated;
revoke execute on function public.discord_enqueue_node() from public, anon, authenticated;
