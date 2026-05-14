-- Voice agent schema (v1).
--
-- Run in the Supabase SQL editor (or via `supabase db push`) once per
-- project. The voice-agent service connects with the service-role key
-- so RLS is bypassed; we don't define policies here. If you also serve
-- other clients from the same project, add restrictive RLS.

create extension if not exists "pgcrypto";

create table if not exists orders (
    order_id    text        primary key,
    status      text        not null
                check (status in ('processing', 'shipped', 'delivered', 'cancelled')),
    eta         date,
    items       text[]      not null default '{}',
    created_at  timestamptz not null default now()
);

create table if not exists appointments (
    id               uuid        primary key default gen_random_uuid(),
    confirmation_id  text        not null unique,
    -- Naive local time. Business hours are defined in the business's
    -- local timezone; storing TZ here would require us to pick one and
    -- convert. Add a tz column later if you serve multiple regions.
    starts_at        timestamp   not null,
    customer_name    text        not null,
    contact          text        not null,
    idempotency_key  text        not null unique,
    created_at       timestamptz not null default now()
);

-- Two uniqueness invariants the booking flow relies on:
--   * idempotency_key  -> a retried tool call returns the same booking.
--   * starts_at        -> two callers cannot grab the same slot.
create unique index if not exists appointments_starts_at_unique
    on appointments (starts_at);
