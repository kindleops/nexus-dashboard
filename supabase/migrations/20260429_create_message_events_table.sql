-- Message events table for storing SMS/message history
-- This table is populated from an external service and serves as the source for inbox threading

create table if not exists public.message_events (
  id uuid primary key default gen_random_uuid(),
  event_timestamp timestamptz not null default now(),
  created_at timestamptz not null default now(),
  message_body text not null,
  from_phone_number text,
  to_phone_number text,
  direction text not null default 'inbound',
  source_app text not null default 'textgrid',
  delivery_status text default 'delivered',
  provider_delivery_status text,
  delivered_at timestamptz,
  master_owner_id text,
  prospect_id text,
  property_id text,
  market text,
  metadata jsonb default '{}'::jsonb,
  -- Additional fields for inbox grouping
  seller_phone text,
  canonical_e164 text,
  our_number text
);

-- Create indexes for common queries
create index if not exists idx_message_events_created_at
  on public.message_events (created_at desc);

create index if not exists idx_message_events_event_timestamp
  on public.message_events (event_timestamp desc);

create index if not exists idx_message_events_phone_numbers
  on public.message_events (from_phone_number, to_phone_number);

create index if not exists idx_message_events_canonical_e164
  on public.message_events (canonical_e164);

create index if not exists idx_message_events_owner
  on public.message_events (master_owner_id);

create index if not exists idx_message_events_property
  on public.message_events (property_id);

-- Enable RLS
alter table public.message_events enable row level security;

-- Create RLS policy to allow anonymous read access (needed for anon key)
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'message_events'
      and policyname = 'message_events_select'
  ) then
    create policy message_events_select
      on public.message_events
      for select
      using (true);
  end if;
end $$;

-- Insert sample data for testing
-- This can be removed once real data is populated from your message service
insert into public.message_events (
  event_timestamp,
  message_body,
  from_phone_number,
  to_phone_number,
  direction,
  master_owner_id,
  prospect_id,
  property_id,
  canonical_e164,
  our_number
) values
  (now() - interval '1 day', 'Hi, I am interested in the property at 123 Main St', '+14155552671', '+14155551234', 'inbound', 'owner-1', 'prospect-1', 'prop-1', '+14155552671', '+14155551234'),
  (now() - interval '1 day' + interval '5 minutes', 'Great! I can show it to you tomorrow at 2 PM', '+14155551234', '+14155552671', 'outbound', 'owner-1', 'prospect-1', 'prop-1', '+14155552671', '+14155551234'),
  (now() - interval '12 hours', 'What is the asking price?', '+14155552671', '+14155551234', 'inbound', 'owner-1', 'prospect-1', 'prop-1', '+14155552671', '+14155551234'),
  (now() - interval '12 hours' + interval '10 minutes', 'The asking price is $450,000', '+14155551234', '+14155552671', 'outbound', 'owner-1', 'prospect-1', 'prop-1', '+14155552671', '+14155551234'),
  (now() - interval '6 hours', 'Can you tell me more about the neighborhood?', '+14155553333', '+14155551234', 'inbound', 'owner-2', 'prospect-2', 'prop-2', '+14155553333', '+14155551234'),
  (now() - interval '6 hours' + interval '3 minutes', 'Sure! It''s a great area with good schools and low crime', '+14155551234', '+14155553333', 'outbound', 'owner-2', 'prospect-2', 'prop-2', '+14155553333', '+14155551234'),
  (now() - interval '2 hours', 'I''m very interested, can we schedule a viewing?', '+14155554444', '+14155551234', 'inbound', 'owner-3', 'prospect-3', 'prop-3', '+14155554444', '+14155551234'),
  (now() - interval '2 hours' + interval '2 minutes', 'Absolutely! How does Friday at 4 PM work for you?', '+14155551234', '+14155554444', 'outbound', 'owner-3', 'prospect-3', 'prop-3', '+14155554444', '+14155551234')
on conflict do nothing;
