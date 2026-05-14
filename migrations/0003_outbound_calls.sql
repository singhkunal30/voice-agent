-- Outbound call audit log.
--
-- The voice-agent writes one row per outbound dial request. The
-- idempotency_key UNIQUE constraint dedupes retries across replicas;
-- without Supabase configured, the service still dials but cannot
-- enforce idempotency across processes.

create table if not exists outbound_calls (
    id               uuid        primary key default gen_random_uuid(),
    -- Populated after Vapi accepts the call. Nullable so we can insert
    -- the audit row before issuing the API request if we ever choose
    -- to; today we insert after, so this is effectively NOT NULL on
    -- successful rows.
    vapi_call_id     text        unique,
    to_number        text        not null,
    -- Free-form caller-supplied label, e.g. 'appointment_reminder'.
    reason           text,
    -- Variables passed to the assistant for {{template}} substitution.
    variables        jsonb       not null default '{}'::jsonb,
    first_message    text,
    -- Caller-provided dedup key. NULL means "no idempotency requested";
    -- partial unique below allows many NULLs without conflict.
    idempotency_key  text,
    -- Snapshot of the call's last-known state from our side.
    status           text        not null default 'queued',
    error            text,
    created_at       timestamptz not null default now()
);

create unique index if not exists outbound_calls_idempotency_unique
    on outbound_calls (idempotency_key)
    where idempotency_key is not null;
