create extension if not exists pg_trgm;

create table if not exists public.people (
  id text primary key,
  name text not null default 'Unknown',
  phone text,
  email text,
  instagram text,
  instagram_followers integer not null default 0 check (instagram_followers >= 0),
  company text,
  role text,
  where_met text,
  summary text,
  importance integer not null default 0,
  importance_reason text,
  last_contact timestamptz,
  affinity_override integer check (affinity_override between 0 and 100),
  computed_affinity integer not null default 0 check (computed_affinity between 0 and 100),
  affinity_confidence integer not null default 0 check (affinity_confidence between 0 and 100),
  affinity_reasons jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memories (
  id text primary key,
  person_id text not null references public.people(id) on delete cascade,
  raw_note text not null,
  topics text[] not null default '{}',
  event text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.interest_evidence (
  id text primary key,
  person_id text not null references public.people(id) on delete cascade,
  memory_id text references public.memories(id) on delete set null,
  topic text not null,
  polarity smallint not null default 1 check (polarity in (-1, 1)),
  enthusiasm integer not null default 0 check (enthusiasm between 0 and 100),
  behavior integer not null default 0 check (behavior between 0 and 100),
  specificity integer not null default 0 check (specificity between 0 and 100),
  certainty integer not null default 0 check (certainty between 0 and 100),
  recency_weight numeric(5,4) not null default 1,
  score integer not null default 0 check (score between 0 and 100),
  confidence integer not null default 0 check (confidence between 0 and 100),
  evidence_type text not null,
  quote text not null,
  is_correction boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.topic_scores (
  person_id text not null references public.people(id) on delete cascade,
  topic text not null,
  score integer not null default 0 check (score between 0 and 100),
  confidence integer not null default 0 check (confidence between 0 and 100),
  evidence_count integer not null default 0,
  explanation jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (person_id, topic)
);

create table if not exists public.connections (
  id text primary key,
  person_a_id text not null references public.people(id) on delete cascade,
  person_b_id text not null references public.people(id) on delete cascade,
  relationship text,
  strength integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  check (person_a_id <> person_b_id)
);

create table if not exists public.lists (
  id text primary key,
  name text not null,
  topic text,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.list_members (
  id text primary key,
  list_id text not null references public.lists(id) on delete cascade,
  person_id text not null references public.people(id) on delete cascade,
  status text not null default 'candidate',
  notes text,
  created_at timestamptz not null default now(),
  unique (list_id, person_id)
);

create table if not exists public.events (
  id text primary key,
  name text not null,
  topic text,
  event_date timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_feedback (
  id text primary key,
  event_id text not null references public.events(id) on delete cascade,
  person_id text not null references public.people(id) on delete cascade,
  interest_score integer not null default 0,
  fit_score integer not null default 0,
  energy_score integer not null default 0,
  reliability_score integer not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists people_affinity_idx on public.people (computed_affinity desc);
create index if not exists people_name_trgm_idx on public.people using gin (name gin_trgm_ops);
create index if not exists people_company_trgm_idx on public.people using gin (company gin_trgm_ops);
create index if not exists people_role_trgm_idx on public.people using gin (role gin_trgm_ops);
create index if not exists memories_person_created_idx on public.memories (person_id, created_at desc);
create index if not exists memories_note_trgm_idx on public.memories using gin (raw_note gin_trgm_ops);
create index if not exists evidence_person_topic_idx on public.interest_evidence (person_id, topic);
create index if not exists topic_scores_topic_rank_idx on public.topic_scores (topic, score desc, confidence desc);
create index if not exists list_members_list_idx on public.list_members (list_id);
create index if not exists list_members_person_idx on public.list_members (person_id);
create index if not exists feedback_person_idx on public.event_feedback (person_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists people_touch_updated_at on public.people;
create trigger people_touch_updated_at
before update on public.people
for each row execute function public.touch_updated_at();

alter table public.people enable row level security;
alter table public.memories enable row level security;
alter table public.interest_evidence enable row level security;
alter table public.topic_scores enable row level security;
alter table public.connections enable row level security;
alter table public.lists enable row level security;
alter table public.list_members enable row level security;
alter table public.events enable row level security;
alter table public.event_feedback enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

create or replace function public.search_people(
  search_topic text default null,
  search_text text default null,
  result_limit integer default 100
)
returns table (
  id text,
  name text,
  phone text,
  email text,
  instagram text,
  instagram_followers integer,
  company text,
  role text,
  summary text,
  computed_affinity integer,
  affinity_confidence integer,
  topic_score integer,
  topic_confidence integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.name,
    p.phone,
    p.email,
    p.instagram,
    p.instagram_followers,
    p.company,
    p.role,
    p.summary,
    coalesce(p.affinity_override, p.computed_affinity) as computed_affinity,
    p.affinity_confidence,
    coalesce(ts.score, 0) as topic_score,
    coalesce(ts.confidence, 0) as topic_confidence
  from public.people p
  left join public.topic_scores ts
    on ts.person_id = p.id
   and ts.topic = lower(trim(coalesce(search_topic, '')))
  where
    coalesce(trim(search_text), '') = ''
    or p.name ilike '%' || search_text || '%'
    or p.company ilike '%' || search_text || '%'
    or p.role ilike '%' || search_text || '%'
    or p.summary ilike '%' || search_text || '%'
    or exists (
      select 1 from public.memories m
      where m.person_id = p.id and m.raw_note ilike '%' || search_text || '%'
    )
    or coalesce(ts.score, 0) > 0
  order by
    case when coalesce(trim(search_topic), '') <> '' then coalesce(ts.score, 0) else 0 end desc,
    coalesce(p.affinity_override, p.computed_affinity) desc,
    p.name asc
  limit greatest(1, least(result_limit, 500));
$$;

revoke all on function public.search_people(text, text, integer) from public;
