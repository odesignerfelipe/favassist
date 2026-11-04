-- =============================================================================
-- 0200 — Estratégia: diagnóstico, campanhas, atividades, histórico e evidências
-- =============================================================================

-- Diagnóstico estratégico (1:1 com empresa, criado automaticamente) -----------
create table public.company_profiles (
  company_id uuid primary key references public.companies (id) on delete cascade,
  business_description text not null default '',
  target_audience text not null default '',
  products text not null default '',
  services text not null default '',
  differentiators text not null default '',
  positioning text not null default '',
  brand_personality text not null default '',
  tone_of_voice text not null default '',
  business_goals text not null default '',
  marketing_goals text not null default '',
  main_challenges text not null default '',
  business_hours jsonb not null default '[]'::jsonb check (jsonb_typeof(business_hours) = 'array'),
  commercial_dates jsonb not null default '[]'::jsonb check (jsonb_typeof(commercial_dates) = 'array'),
  content_restrictions text not null default '',
  additional_info text not null default '',
  campaign_mix_target numeric(3, 2) not null default 0.30 check (campaign_mix_target between 0 and 1),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger company_profiles_updated_at before update on public.company_profiles
  for each row execute function app.set_updated_at();

create or replace function app.create_company_profile() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.company_profiles (company_id) values (new.id) on conflict do nothing;
  return new;
end
$$;
create trigger companies_create_profile after insert on public.companies
  for each row execute function app.create_company_profile();

-- Campanhas -------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  objectives text not null default '',
  starts_on date not null,
  ends_on date not null,
  products text not null default '',
  offers text not null default '',
  notes text not null default '',
  status text not null default 'ativa' check (status in ('rascunho', 'ativa', 'pausada', 'encerrada')),
  content_share numeric(3, 2) not null default 0.30 check (content_share between 0 and 1),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  unique (company_id, id)
);
create index campaigns_company_period_idx on public.campaigns (company_id, starts_on, ends_on);
create trigger campaigns_updated_at before update on public.campaigns
  for each row execute function app.set_updated_at();

-- Atividades ------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  campaign_id uuid,
  title text not null check (char_length(title) between 2 and 160),
  scheduled_date date not null,
  scheduled_time time,
  pillar text not null check (pillar in (
    'relacionamento', 'bastidores', 'engajamento', 'autoridade', 'prova_social', 'conversao', 'campanha'
  )),
  format text not null default 'stories' check (format in ('stories', 'reels', 'feed', 'carrossel', 'live', 'outro')),
  stories_count smallint not null default 1 check (stories_count between 0 and 30),
  objective text not null default '',
  script text not null default '',
  talking_points text not null default '',
  recording_guidelines text not null default '',
  caption_suggestion text not null default '',
  call_to_action text not null default '',
  assignee_id uuid,
  status text not null default 'planejada' check (status in (
    'planejada', 'pendente_aprovacao', 'aprovada', 'em_andamento', 'concluida', 'impedida', 'cancelada'
  )),
  notes text not null default '',
  ai_generated boolean not null default false,
  ai_generation_id uuid,
  completed_at timestamptz,
  completed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  -- FKs compostas: campanha e responsável precisam ser da MESMA empresa
  foreign key (company_id, campaign_id)
    references public.campaigns (company_id, id) on delete set null (campaign_id),
  foreign key (company_id, assignee_id)
    references public.company_members (company_id, user_id) on delete set null (assignee_id)
);
create index activities_company_date_idx on public.activities (company_id, scheduled_date);
create index activities_assignee_date_idx on public.activities (assignee_id, scheduled_date);
create trigger activities_updated_at before update on public.activities
  for each row execute function app.set_updated_at();

-- Máquina de estados (espelho de packages/shared/src/activity-status.ts) ------
create or replace function app.activity_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable
as $$
  select p_from = p_to or (p_from, p_to) in (values
    ('planejada', 'pendente_aprovacao'), ('planejada', 'aprovada'), ('planejada', 'em_andamento'),
    ('planejada', 'concluida'), ('planejada', 'impedida'), ('planejada', 'cancelada'),
    ('pendente_aprovacao', 'aprovada'), ('pendente_aprovacao', 'planejada'), ('pendente_aprovacao', 'cancelada'),
    ('aprovada', 'em_andamento'), ('aprovada', 'concluida'), ('aprovada', 'impedida'),
    ('aprovada', 'cancelada'), ('aprovada', 'planejada'),
    ('em_andamento', 'concluida'), ('em_andamento', 'impedida'), ('em_andamento', 'cancelada'), ('em_andamento', 'aprovada'),
    ('impedida', 'em_andamento'), ('impedida', 'planejada'), ('impedida', 'concluida'), ('impedida', 'cancelada'),
    ('concluida', 'em_andamento'),
    ('cancelada', 'planejada')
  )
$$;

-- Regras de colaborador (espelho de COLLABORATOR_FROM/TO em shared)
create or replace function app.collaborator_transition_allowed(p_from text, p_to text) returns boolean
language sql immutable
as $$
  select p_from = p_to or (
    p_from in ('planejada', 'aprovada', 'em_andamento', 'impedida')
    and p_to in ('em_andamento', 'concluida', 'impedida')
  )
$$;

create or replace function app.activities_guard() returns trigger
language plpgsql set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_editable constant text[] := array['status', 'notes', 'completed_at', 'completed_by', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    if new.status = 'concluida' then
      new.completed_at := now();
      new.completed_by := v_uid;
    end if;
    return new;
  end if;

  if new.company_id <> old.company_id then
    raise exception 'A empresa de uma atividade não pode ser alterada' using errcode = '42501';
  end if;

  if new.status <> old.status then
    if not app.activity_transition_allowed(old.status, new.status) then
      raise exception 'Transição de status inválida: % → %', old.status, new.status using errcode = '22023';
    end if;
    if new.status = 'concluida' then
      new.completed_at := now();
      new.completed_by := v_uid;
    elsif old.status = 'concluida' then
      new.completed_at := null;
      new.completed_by := null;
    end if;
  end if;

  -- Colaboradores: só as próprias tarefas, só status/observações, transições limitadas
  if v_uid is not null and not app.is_favis_admin() then
    v_role := app.member_role(new.company_id);
    if v_role is null or v_role = 'collaborator' then
      if old.assignee_id is distinct from v_uid then
        raise exception 'Sem permissão para alterar esta atividade' using errcode = '42501';
      end if;
      if (to_jsonb(new) - v_editable) <> (to_jsonb(old) - v_editable) then
        raise exception 'Colaboradores só podem alterar status e observações' using errcode = '42501';
      end if;
      if not app.collaborator_transition_allowed(old.status, new.status) then
        raise exception 'Colaboradores não podem mudar o status de % para %', old.status, new.status
          using errcode = '42501';
      end if;
    end if;
  end if;

  return new;
end
$$;
create trigger activities_guard before insert or update on public.activities
  for each row execute function app.activities_guard();

-- Histórico da atividade (status, comentários, dificuldades) ------------------
create table public.activity_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  activity_id uuid not null,
  user_id uuid references public.profiles (id) on delete set null default auth.uid(),
  kind text not null check (kind in ('status', 'comentario', 'dificuldade')),
  from_status text,
  to_status text,
  message text not null default '' check (char_length(message) <= 2000),
  created_at timestamptz not null default now(),
  foreign key (company_id, activity_id) references public.activities (company_id, id) on delete cascade
);
create index activity_updates_activity_idx on public.activity_updates (activity_id, created_at);
create index activity_updates_company_idx on public.activity_updates (company_id, created_at desc);

-- Evidências ------------------------------------------------------------------
create table public.activity_evidences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  activity_id uuid not null,
  kind text not null check (kind in ('link', 'texto', 'arquivo')),
  url text check (url is null or url ~* '^https?://'),
  storage_path text,
  description text not null default '' check (char_length(description) <= 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (company_id, activity_id) references public.activities (company_id, id) on delete cascade,
  check (
    (kind = 'link' and url is not null)
    or (kind = 'texto' and char_length(description) > 0)
    or (kind = 'arquivo' and storage_path is not null)
  )
);
create index activity_evidences_activity_idx on public.activity_evidences (activity_id);
