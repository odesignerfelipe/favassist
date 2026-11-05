-- =============================================================================
-- 0600 — Notificações no app
-- Geradas por triggers (não dependem de cada rota lembrar de criá-las).
-- Cada usuário vê e marca como lidas apenas as próprias notificações.
-- =============================================================================

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('tarefa_atribuida', 'tarefa_aprovada', 'tarefa_impedida', 'aprovacao_pendente')),
  title text not null check (char_length(title) <= 200),
  body text not null default '' check (char_length(body) <= 500),
  activity_id uuid references public.activities (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
-- O usuário só pode marcar como lida (nenhuma outra coluna)
grant update (read_at) on public.notifications to authenticated;

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Destinatários: proprietários e gerentes ativos da empresa (exceto quem fez a ação)
create or replace function app.company_leads(p_company uuid, p_except uuid) returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.user_id
    from public.company_members m
    join public.profiles p on p.id = m.user_id
   where m.company_id = p_company and m.active and p.active
     and m.role in ('owner', 'manager')
     and m.user_id is distinct from p_except
$$;

create or replace function app.fmt_date(p date) returns text
language sql immutable
as $$ select to_char(p, 'DD/MM') $$;

-- Atribuição, aprovação e dificuldade (por linha)
create or replace function app.notify_activity_changes() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_msg text;
begin
  -- Nova tarefa atribuída (criação com responsável ou troca de responsável)
  if new.assignee_id is not null
     and new.assignee_id is distinct from v_actor
     and new.status not in ('cancelada', 'pendente_aprovacao', 'concluida')
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    insert into public.notifications (company_id, user_id, kind, title, body, activity_id)
    values (new.company_id, new.assignee_id, 'tarefa_atribuida',
            'Nova tarefa: ' || new.title,
            'Para ' || app.fmt_date(new.scheduled_date) || coalesce(' às ' || to_char(new.scheduled_time, 'HH24:MI'), ''),
            new.id);
  end if;

  -- Nova pendência de aprovação (criada assim ou movida para esse status)
  if new.status = 'pendente_aprovacao' and (tg_op = 'INSERT' or old.status is distinct from 'pendente_aprovacao') then
    perform app.refresh_pending_notice(new.company_id, v_actor);
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- Tarefa aprovada → avisa o responsável (que passa a vê-la como atribuída)
    if new.status = 'aprovada' and old.status = 'pendente_aprovacao'
       and new.assignee_id is not null and new.assignee_id is distinct from v_actor then
      insert into public.notifications (company_id, user_id, kind, title, body, activity_id)
      values (new.company_id, new.assignee_id, 'tarefa_aprovada',
              'Tarefa aprovada: ' || new.title,
              'Para ' || app.fmt_date(new.scheduled_date) || coalesce(' às ' || to_char(new.scheduled_time, 'HH24:MI'), ''),
              new.id);
    end if;

    -- Dificuldade registrada → avisa proprietários e gerentes
    if new.status = 'impedida' then
      select u.message into v_msg
        from public.activity_updates u
       where u.activity_id = new.id and u.message <> ''
       order by u.created_at desc limit 1;
      insert into public.notifications (company_id, user_id, kind, title, body, activity_id)
      select new.company_id, lead, 'tarefa_impedida', 'Dificuldade em: ' || new.title,
             coalesce(left(v_msg, 300), 'Tarefa marcada como impedida'), new.id
        from app.company_leads(new.company_id, v_actor) as lead;
    end if;
  end if;
  return null;
end
$$;

create trigger activities_notify after insert or update of assignee_id, status on public.activities
  for each row execute function app.notify_activity_changes();

-- Pendências de aprovação: um ÚNICO aviso não lido por empresa e destinatário, atualizado
-- com o total pendente (ex.: aplicar um planejamento da IA com 7 itens → "7 atividades…").
create or replace function app.refresh_pending_notice(p_company uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_n int;
  v_lead uuid;
  v_title text;
begin
  select count(*) into v_n from public.activities
   where company_id = p_company and status = 'pendente_aprovacao';
  if v_n = 0 then
    return;
  end if;
  v_title := case when v_n = 1 then '1 atividade aguardando aprovação'
                  else v_n || ' atividades aguardando aprovação' end;
  for v_lead in select * from app.company_leads(p_company, p_actor) loop
    update public.notifications
       set title = v_title, body = 'Revise na visão geral da empresa', created_at = now(), activity_id = null
     where user_id = v_lead and company_id = p_company and kind = 'aprovacao_pendente' and read_at is null;
    if not found then
      insert into public.notifications (company_id, user_id, kind, title, body)
      values (p_company, v_lead, 'aprovacao_pendente', v_title, 'Revise na visão geral da empresa');
    end if;
  end loop;
end
$$;

revoke all on function app.company_leads(uuid, uuid), app.refresh_pending_notice(uuid, uuid) from public, anon;
grant execute on function app.company_leads(uuid, uuid), app.refresh_pending_notice(uuid, uuid) to authenticated;
