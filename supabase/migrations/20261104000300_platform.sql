-- =============================================================================
-- 0300 — Plataforma: configurações, IA, WhatsApp, métricas, gamificação, auditoria
-- =============================================================================

-- Configurações globais (singleton) -------------------------------------------
create table public.platform_settings (
  id smallint primary key default 1 check (id = 1),
  ai_enabled boolean not null default true,
  ai_default_campaign_mix numeric(3, 2) not null default 0.30 check (ai_default_campaign_mix between 0 and 1),
  ai_history_days smallint not null default 60 check (ai_history_days between 7 and 365),
  ai_guidelines text not null default '' check (char_length(ai_guidelines) <= 4000),
  messaging_enabled boolean not null default true,
  messaging_default_send_time time not null default '08:00',
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (1);
create trigger platform_settings_updated_at before update on public.platform_settings
  for each row execute function app.set_updated_at();

-- Gerações de IA (memória estratégica) ----------------------------------------
create table public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null default auth.uid(),
  kind text not null check (kind in ('plano_semanal', 'plano_mensal', 'alternativa')),
  period_start date not null,
  period_end date not null,
  instructions text not null default '' check (char_length(instructions) <= 2000),
  source_activity_id uuid,
  status text not null default 'pendente'
    check (status in ('pendente', 'processando', 'concluida', 'falhou', 'aplicada')),
  provider text,
  model text,
  context_snapshot jsonb,
  output jsonb,
  warnings jsonb not null default '[]'::jsonb,
  error text,
  usage jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  applied_at timestamptz,
  check (period_end >= period_start and period_end - period_start <= 31),
  unique (company_id, id)
);
create index ai_generations_company_idx on public.ai_generations (company_id, created_at desc);

alter table public.activities
  add foreign key (company_id, ai_generation_id)
  references public.ai_generations (company_id, id) on delete set null (ai_generation_id);

-- WhatsApp: grupos e mensagens ------------------------------------------------
create table public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  provider text not null default 'simulator' check (provider in ('simulator')),
  external_id text not null check (char_length(external_id) between 3 and 120),
  name text not null check (char_length(name) between 2 and 120),
  active boolean not null default true,
  paused boolean not null default false,
  daily_send_time time not null default '08:00',
  send_weekdays smallint[] not null default '{1,2,3,4,5,6}'
    check (send_weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- um grupo pertence a uma única empresa
  unique (provider, external_id),
  unique (company_id, id)
);
create trigger whatsapp_groups_updated_at before update on public.whatsapp_groups
  for each row execute function app.set_updated_at();

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  group_id uuid,
  direction text not null check (direction in ('saida', 'entrada')),
  kind text not null check (kind in ('cronograma_diario', 'manual', 'resposta', 'recebida')),
  body text not null check (char_length(body) between 1 and 4096),
  status text not null check (status in ('pendente', 'enviada', 'falhou', 'ignorada', 'recebida')),
  dedupe_key text unique,
  provider text not null,
  provider_message_id text,
  reference_date date,
  attempts smallint not null default 0,
  last_error text,
  sender_name text,
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  foreign key (company_id, group_id) references public.whatsapp_groups (company_id, id) on delete set null (group_id)
);
create index whatsapp_messages_company_idx on public.whatsapp_messages (company_id, created_at desc);
create index whatsapp_messages_status_idx on public.whatsapp_messages (status, created_at);
create trigger whatsapp_messages_updated_at before update on public.whatsapp_messages
  for each row execute function app.set_updated_at();

-- Métricas de redes sociais (somente de integrações autorizadas) --------------
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  platform text not null check (platform in ('instagram', 'facebook', 'google_business')),
  handle text not null default '',
  external_id text,
  status text not null default 'nao_conectada' check (status in ('nao_conectada', 'conectada', 'erro', 'expirada')),
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, platform),
  unique (company_id, id)
);
create trigger social_accounts_updated_at before update on public.social_accounts
  for each row execute function app.set_updated_at();

create table public.social_metrics (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  account_id uuid not null,
  metric text not null check (metric in (
    'alcance', 'visualizacoes', 'interacoes', 'seguidores', 'engajamento', 'cliques', 'conversoes'
  )),
  value numeric not null,
  period_start date not null,
  period_end date not null,
  content_ref text,
  source text not null,
  collected_at timestamptz not null default now(),
  foreign key (company_id, account_id) references public.social_accounts (company_id, id) on delete cascade,
  unique nulls not distinct (account_id, metric, period_start, period_end, content_ref)
);
create index social_metrics_company_idx on public.social_metrics (company_id, period_start);

-- Gamificação -----------------------------------------------------------------
create table public.point_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  activity_id uuid references public.activities (id) on delete set null,
  reason text not null check (reason in ('conclusao', 'evidencia', 'conquista')),
  points integer not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (activity_id, user_id, reason)
);
create index point_events_company_idx on public.point_events (company_id, created_at);
create index point_events_user_idx on public.point_events (user_id, created_at);

create table public.achievements (
  code text primary key,
  name text not null,
  description text not null,
  points integer not null default 0
);
insert into public.achievements (code, name, description, points) values
  ('primeira_tarefa', 'Primeiro passo', 'Concluiu a primeira tarefa do planejamento.', 5),
  ('dez_no_prazo', 'Pontualidade', 'Concluiu 10 tarefas dentro do prazo.', 20),
  ('cinco_evidencias', 'Registro caprichado', 'Registrou evidências em 5 tarefas concluídas.', 15);

create table public.user_achievements (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null references public.achievements (code),
  earned_at timestamptz not null default now(),
  unique (company_id, user_id, code)
);

create or replace function app.grant_achievement(p_company uuid, p_user uuid, p_code text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_inserted int;
begin
  insert into public.user_achievements (company_id, user_id, code)
  values (p_company, p_user, p_code)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted > 0 then
    insert into public.point_events (company_id, user_id, reason, points, metadata)
    select p_company, p_user, 'conquista', a.points, jsonb_build_object('code', a.code)
    from public.achievements a where a.code = p_code and a.points > 0;
  end if;
end
$$;

-- Pontos na conclusão (no prazo vale mais) e por evidência --------------------
create or replace function app.award_activity_points() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := coalesce(new.assignee_id, new.completed_by);
  v_tz text;
  v_on_time boolean;
  v_count int;
begin
  if v_user is null or new.status <> 'concluida' or old.status = 'concluida' then
    return null;
  end if;
  select timezone into v_tz from public.companies where id = new.company_id;
  v_on_time := (now() at time zone coalesce(v_tz, 'America/Sao_Paulo'))::date <= new.scheduled_date;

  insert into public.point_events (company_id, user_id, activity_id, reason, points, metadata)
  values (new.company_id, v_user, new.id, 'conclusao', case when v_on_time then 10 else 4 end,
          jsonb_build_object('no_prazo', v_on_time))
  on conflict do nothing;

  if exists (select 1 from public.activity_evidences e where e.activity_id = new.id) then
    insert into public.point_events (company_id, user_id, activity_id, reason, points)
    values (new.company_id, v_user, new.id, 'evidencia', 3)
    on conflict do nothing;
  end if;

  perform app.grant_achievement(new.company_id, v_user, 'primeira_tarefa');

  select count(*) into v_count from public.point_events
  where user_id = v_user and company_id = new.company_id and reason = 'conclusao'
    and (metadata ->> 'no_prazo')::boolean;
  if v_count >= 10 then
    perform app.grant_achievement(new.company_id, v_user, 'dez_no_prazo');
  end if;
  return null;
end
$$;
create trigger activities_award_points after update of status on public.activities
  for each row execute function app.award_activity_points();

create or replace function app.award_evidence_points() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_activity record;
  v_user uuid;
  v_count int;
begin
  select * into v_activity from public.activities where id = new.activity_id;
  v_user := coalesce(v_activity.assignee_id, v_activity.completed_by);
  if v_activity.status = 'concluida' and v_user is not null then
    insert into public.point_events (company_id, user_id, activity_id, reason, points)
    values (v_activity.company_id, v_user, v_activity.id, 'evidencia', 3)
    on conflict do nothing;
    select count(*) into v_count from public.point_events
    where user_id = v_user and company_id = v_activity.company_id and reason = 'evidencia';
    if v_count >= 5 then
      perform app.grant_achievement(v_activity.company_id, v_user, 'cinco_evidencias');
    end if;
  end if;
  return null;
end
$$;
create trigger activity_evidences_award_points after insert on public.activity_evidences
  for each row execute function app.award_evidence_points();

-- Auditoria -------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid,
  actor_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  entity text not null,
  entity_id text,
  changes jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_company_idx on public.audit_logs (company_id, created_at desc);
create index audit_logs_created_idx on public.audit_logs (created_at desc);

create or replace function app.audit() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_changes jsonb;
  v_company uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new); end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(n.key, jsonb_build_object('de', v_old -> n.key, 'para', n.value))
      into v_changes
    from jsonb_each(v_new) n
    where n.key <> 'updated_at' and (v_old -> n.key) is distinct from n.value;
    if v_changes is null then
      return null;
    end if;
  else
    v_changes := v_row;
  end if;

  v_company := case
    when tg_table_name = 'companies' then (v_row ->> 'id')::uuid
    else (v_row ->> 'company_id')::uuid
  end;

  insert into public.audit_logs (company_id, actor_id, action, entity, entity_id, changes)
  values (v_company, auth.uid(), lower(tg_op), tg_table_name,
          coalesce(v_row ->> 'id', v_row ->> 'company_id'), v_changes);
  return null;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'companies', 'company_members', 'company_profiles', 'campaigns',
    'activities', 'activity_evidences', 'platform_settings', 'whatsapp_groups', 'social_accounts'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function app.audit()',
      t || '_audit', t
    );
  end loop;
end
$$;
