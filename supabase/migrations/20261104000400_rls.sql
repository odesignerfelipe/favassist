-- =============================================================================
-- 0400 — Row Level Security, permissões de papéis e políticas
-- Toda tabela de dados tem RLS. O papel "anon" não acessa nada.
-- =============================================================================

grant usage on schema public, app to authenticated;
grant execute on all functions in schema app to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke all on all functions in schema app from anon, public;
grant execute on all functions in schema app to authenticated;

-- Tabelas escritas apenas por triggers/sistema
revoke insert, update, delete on public.audit_logs, public.point_events, public.user_achievements,
  public.achievements from authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'companies', 'company_members', 'company_profiles', 'campaigns', 'activities',
    'activity_updates', 'activity_evidences', 'platform_settings', 'ai_generations',
    'whatsapp_groups', 'whatsapp_messages', 'social_accounts', 'social_metrics',
    'point_events', 'achievements', 'user_achievements', 'audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end
$$;

-- profiles --------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_favis_admin() or app.shares_company_with(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or app.is_favis_admin())
  with check (id = auth.uid() or app.is_favis_admin());
create policy profiles_admin_write on public.profiles for insert to authenticated
  with check (app.is_favis_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (app.is_favis_admin());

-- companies -------------------------------------------------------------------
create policy companies_select on public.companies for select to authenticated
  using (app.can_view_company(id));
create policy companies_insert on public.companies for insert to authenticated
  with check (app.is_favis_admin());
create policy companies_update on public.companies for update to authenticated
  using (app.is_favis_admin()) with check (app.is_favis_admin());
create policy companies_delete on public.companies for delete to authenticated
  using (app.is_favis_admin());

-- company_members -------------------------------------------------------------
-- Admin: tudo. Proprietário: qualquer papel exceto proprietário. Gerente: só colaboradores.
create or replace function app.can_manage_member_role(p_company uuid, p_role text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_favis_admin()
    or (app.member_role(p_company) = 'owner' and p_role <> 'owner')
    or (app.member_role(p_company) = 'manager' and p_role = 'collaborator')
$$;
grant execute on function app.can_manage_member_role(uuid, text) to authenticated;

create policy members_select on public.company_members for select to authenticated
  using (app.can_view_company(company_id));
create policy members_insert on public.company_members for insert to authenticated
  with check (app.can_manage_member_role(company_id, role));
create policy members_update on public.company_members for update to authenticated
  using (app.can_manage_member_role(company_id, role))
  with check (app.can_manage_member_role(company_id, role));
create policy members_delete on public.company_members for delete to authenticated
  using (app.can_manage_member_role(company_id, role));

-- company_profiles ------------------------------------------------------------
create policy company_profiles_select on public.company_profiles for select to authenticated
  using (app.can_view_company(company_id));
create policy company_profiles_write on public.company_profiles for insert to authenticated
  with check (app.can_manage_company(company_id));
create policy company_profiles_update on public.company_profiles for update to authenticated
  using (app.can_manage_company(company_id)) with check (app.can_manage_company(company_id));

-- campaigns -------------------------------------------------------------------
create policy campaigns_select on public.campaigns for select to authenticated
  using (app.can_view_company(company_id));
create policy campaigns_insert on public.campaigns for insert to authenticated
  with check (app.can_manage_company(company_id));
create policy campaigns_update on public.campaigns for update to authenticated
  using (app.can_manage_company(company_id)) with check (app.can_manage_company(company_id));
create policy campaigns_delete on public.campaigns for delete to authenticated
  using (app.can_manage_company(company_id));

-- activities ------------------------------------------------------------------
-- Colaborador vê apenas as atividades atribuídas a ele.
create policy activities_select on public.activities for select to authenticated
  using (
    app.can_manage_company(company_id)
    or (assignee_id = auth.uid() and app.member_role(company_id) is not null)
  );
create policy activities_insert on public.activities for insert to authenticated
  with check (app.can_manage_company(company_id));
create policy activities_update on public.activities for update to authenticated
  using (
    app.can_manage_company(company_id)
    or (assignee_id = auth.uid() and app.member_role(company_id) is not null)
  )
  with check (
    app.can_manage_company(company_id)
    or (assignee_id = auth.uid() and app.member_role(company_id) is not null)
  );
create policy activities_delete on public.activities for delete to authenticated
  using (app.can_manage_company(company_id));

-- activity_updates / activity_evidences ---------------------------------------
-- Visíveis a quem enxerga a atividade (a subconsulta respeita a RLS de activities).
create policy activity_updates_select on public.activity_updates for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_updates.activity_id));
create policy activity_updates_insert on public.activity_updates for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.activities a
      where a.id = activity_updates.activity_id and a.company_id = activity_updates.company_id
    )
  );

create policy activity_evidences_select on public.activity_evidences for select to authenticated
  using (exists (select 1 from public.activities a where a.id = activity_evidences.activity_id));
create policy activity_evidences_insert on public.activity_evidences for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.activities a
      where a.id = activity_evidences.activity_id and a.company_id = activity_evidences.company_id
    )
  );
create policy activity_evidences_delete on public.activity_evidences for delete to authenticated
  using (created_by = auth.uid() or app.can_manage_company(company_id));

-- platform_settings -----------------------------------------------------------
create policy platform_settings_select on public.platform_settings for select to authenticated
  using (true);
create policy platform_settings_update on public.platform_settings for update to authenticated
  using (app.is_favis_admin()) with check (app.is_favis_admin());

-- ai_generations --------------------------------------------------------------
create policy ai_generations_select on public.ai_generations for select to authenticated
  using (app.can_manage_company(company_id));
create policy ai_generations_insert on public.ai_generations for insert to authenticated
  with check (app.can_manage_company(company_id));
create policy ai_generations_update on public.ai_generations for update to authenticated
  using (app.can_manage_company(company_id)) with check (app.can_manage_company(company_id));

-- WhatsApp --------------------------------------------------------------------
create policy whatsapp_groups_select on public.whatsapp_groups for select to authenticated
  using (app.can_manage_company(company_id));
create policy whatsapp_groups_write on public.whatsapp_groups for all to authenticated
  using (app.is_favis_admin()) with check (app.is_favis_admin());

create policy whatsapp_messages_select on public.whatsapp_messages for select to authenticated
  using (app.can_manage_company(company_id));
create policy whatsapp_messages_write on public.whatsapp_messages for all to authenticated
  using (app.is_favis_admin()) with check (app.is_favis_admin());

-- Métricas --------------------------------------------------------------------
create policy social_accounts_select on public.social_accounts for select to authenticated
  using (app.can_view_company(company_id));
create policy social_accounts_write on public.social_accounts for all to authenticated
  using (app.is_favis_admin()) with check (app.is_favis_admin());
create policy social_metrics_select on public.social_metrics for select to authenticated
  using (app.can_view_company(company_id));

-- Gamificação -----------------------------------------------------------------
create policy point_events_select on public.point_events for select to authenticated
  using (app.can_view_company(company_id));
create policy achievements_select on public.achievements for select to authenticated
  using (true);
create policy user_achievements_select on public.user_achievements for select to authenticated
  using (app.can_view_company(company_id));

-- Auditoria -------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.is_favis_admin() or app.has_company_role(company_id, array['owner']));
