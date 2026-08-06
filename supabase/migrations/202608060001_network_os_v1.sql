create table if not exists public.activities (
  id text primary key,
  person_id text not null references public.people(id) on delete cascade,
  activity_type text not null,
  title text not null,
  detail text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.smart_groups (
  id text primary key,
  name text not null,
  description text,
  rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_invites (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  person_id text not null references public.people(id) on delete cascade,
  status text not null default 'candidate' check (status in ('candidate','invited','confirmed','declined','attended','no_show')),
  fit_score integer not null default 0 check (fit_score between 0 and 100),
  reasons jsonb not null default '[]'::jsonb,
  invited_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id, person_id)
);

create table if not exists public.outreach (
  id text primary key,
  person_id text not null references public.people(id) on delete cascade,
  event_id text references public.events(id) on delete set null,
  channel text not null default 'dm',
  message text not null,
  status text not null default 'draft' check (status in ('draft','sent','replied','closed')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.extracted_facts (
  id text primary key,
  person_id text not null references public.people(id) on delete cascade,
  memory_id text references public.memories(id) on delete cascade,
  fact_type text not null,
  fact_key text not null,
  fact_value text not null,
  confidence integer not null default 50 check (confidence between 0 and 100),
  source_quote text,
  created_at timestamptz not null default now(),
  unique(person_id, memory_id, fact_type, fact_key, fact_value)
);

create table if not exists public.duplicate_decisions (
  id text primary key,
  person_a_id text not null references public.people(id) on delete cascade,
  person_b_id text not null references public.people(id) on delete cascade,
  decision text not null check (decision in ('merged','not_duplicate')),
  created_at timestamptz not null default now(),
  unique(person_a_id, person_b_id)
);

create index if not exists activities_person_time_idx on public.activities(person_id, occurred_at desc);
create index if not exists smart_groups_updated_idx on public.smart_groups(updated_at desc);
create index if not exists event_invites_event_status_idx on public.event_invites(event_id, status);
create index if not exists event_invites_person_idx on public.event_invites(person_id);
create index if not exists outreach_person_time_idx on public.outreach(person_id, created_at desc);
create index if not exists facts_person_type_idx on public.extracted_facts(person_id, fact_type);

alter table public.activities enable row level security;
alter table public.smart_groups enable row level security;
alter table public.event_invites enable row level security;
alter table public.outreach enable row level security;
alter table public.extracted_facts enable row level security;
alter table public.duplicate_decisions enable row level security;

revoke all on public.activities, public.smart_groups, public.event_invites, public.outreach, public.extracted_facts, public.duplicate_decisions from anon, authenticated;

drop trigger if exists smart_groups_touch_updated_at on public.smart_groups;
create trigger smart_groups_touch_updated_at before update on public.smart_groups for each row execute function public.touch_updated_at();
drop trigger if exists event_invites_touch_updated_at on public.event_invites;
create trigger event_invites_touch_updated_at before update on public.event_invites for each row execute function public.touch_updated_at();
