-- Learner state: one private row per signed-in person.
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query), or
-- with the Supabase CLI: `supabase db push`.
--
-- ---------------------------------------------------------------------------
-- Why Row Level Security is not optional here
-- ---------------------------------------------------------------------------
--
-- The browser holds the anon key, which is public by design — it is compiled
-- into the JavaScript bundle and readable by anyone who loads the page. The
-- anon key carries no authority of its own; the ONLY thing standing between
-- one learner and everybody else's rows is the policy set below.
--
-- So: RLS is enabled, there is no policy for anonymous callers, and every
-- policy is scoped to `auth.uid() = user_id`. A signed-out visitor can reach
-- exactly nothing in this table, and a signed-in one can reach exactly their
-- own row.
--
-- The service-role key bypasses all of this. It must never be given to the
-- frontend. See src/lib/supabase.ts.

create table if not exists public.learner_state (
  -- The primary key IS the owner, so there is exactly one row per person and
  -- no way to write a row that belongs to someone else.
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Course progress: a flag per completed step. Merged as a union client-side
  -- (see src/state/sync.ts), because progress is monotonic — doing work on a
  -- second device can only ever add to it.
  progress jsonb not null default '{}'::jsonb,

  -- The prediction log: what the learner committed to before looking, and how
  -- far off they were. Append-only, capped at 200 entries by the client.
  predictions jsonb not null default '[]'::jsonb,

  -- The working voice prompt, as section → chosen option.
  prompt_selection jsonb not null default '{}'::jsonb,

  -- Saved architectures, capped at 20 by the client.
  saved_architectures jsonb not null default '[]'::jsonb,

  updated_at timestamptz not null default now(),

  -- Guard rails against a runaway client filling someone's database. These are
  -- generous — an ordinary learner's row is a few kilobytes — and they exist so
  -- that a bug is a failed insert rather than an invoice.
  constraint learner_state_progress_is_object check (jsonb_typeof(progress) = 'object'),
  constraint learner_state_predictions_is_array check (jsonb_typeof(predictions) = 'array'),
  constraint learner_state_prompt_is_object check (jsonb_typeof(prompt_selection) = 'object'),
  constraint learner_state_saved_is_array check (jsonb_typeof(saved_architectures) = 'array'),
  constraint learner_state_size check (pg_column_size(saved_architectures) < 2 * 1024 * 1024)
);

comment on table public.learner_state is
  'Per-learner workspace state for the Voice Agent Lab: course progress, prediction record, working prompt and saved designs. One row per user, readable and writable only by that user.';

alter table public.learner_state enable row level security;

-- Each policy is written separately rather than as one `for all`, so that what
-- each verb permits is visible at a glance in the dashboard.

drop policy if exists "learners read their own state" on public.learner_state;
create policy "learners read their own state"
  on public.learner_state
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "learners create their own state" on public.learner_state;
create policy "learners create their own state"
  on public.learner_state
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "learners update their own state" on public.learner_state;
create policy "learners update their own state"
  on public.learner_state
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "learners delete their own state" on public.learner_state;
create policy "learners delete their own state"
  on public.learner_state
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- `updated_at` is set by the client so the merge has a clock it controls, but a
-- trigger stops a client that forgets from leaving the column stale.
create or replace function public.touch_learner_state()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := greatest(coalesce(new.updated_at, now()), now());
  return new;
end;
$$;

drop trigger if exists learner_state_touch on public.learner_state;
create trigger learner_state_touch
  before insert or update on public.learner_state
  for each row execute function public.touch_learner_state();
