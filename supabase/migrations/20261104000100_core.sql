-- =============================================================================
-- 0100 — Núcleo multiempresa: perfis, empresas, membros e funções de acesso
-- =============================================================================

create schema if not exists app;

-- updated_at automático -------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

-- Perfis (1:1 com auth.users) -------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '' check (char_length(full_name) <= 120),
  platform_role text check (platform_role in ('favis_admin')),
  active boolean not null default true,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_email_idx on public.profiles (lower(email));
create trigger profiles_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

-- Cria o perfil quando um usuário é criado no Auth
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();

-- Empresas (tenants) ----------------------------------------------------------
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  segment text not null default '' check (char_length(segment) <= 120),
  status text not null default 'ativa' check (status in ('ativa', 'inativa')),
  timezone text not null default 'America/Sao_Paulo',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger companies_updated_at before update on public.companies
  for each row execute function app.set_updated_at();

-- Membros ---------------------------------------------------------------------
create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'collaborator')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions) = 'object'),
  job_title text not null default '' check (char_length(job_title) <= 80),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);
create index company_members_user_idx on public.company_members (user_id);
create trigger company_members_updated_at before update on public.company_members
  for each row execute function app.set_updated_at();

-- Funções de acesso (SECURITY DEFINER: evitam recursão de RLS) ----------------
create or replace function app.is_favis_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.platform_role = 'favis_admin' and p.active
  )
$$;

-- Papel do usuário atual na empresa (null se não for membro ativo de empresa ativa)
create or replace function app.member_role(p_company uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select m.role
  from public.company_members m
  join public.profiles p on p.id = m.user_id
  join public.companies c on c.id = m.company_id
  where m.company_id = p_company
    and m.user_id = auth.uid()
    and m.active and p.active and c.status = 'ativa'
$$;

create or replace function app.has_company_role(p_company uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(app.member_role(p_company) = any (p_roles), false)
$$;

create or replace function app.can_view_company(p_company uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_favis_admin() or app.member_role(p_company) is not null
$$;

-- Admin FAVIS, proprietário ou gerente
create or replace function app.can_manage_company(p_company uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select app.is_favis_admin() or app.has_company_role(p_company, array['owner', 'manager'])
$$;

-- O usuário atual compartilha alguma empresa com p_user?
create or replace function app.shares_company_with(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members mine
    join public.company_members other on other.company_id = mine.company_id
    where mine.user_id = auth.uid() and mine.active and other.user_id = p_user
  )
$$;

-- Proteção de perfis: só admin (ou sistema) altera papel de plataforma, status e e-mail
create or replace function app.profiles_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and not app.is_favis_admin() then
    if new.platform_role is distinct from old.platform_role
       or new.active is distinct from old.active
       or new.email is distinct from old.email then
      raise exception 'Sem permissão para alterar estes campos do perfil'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
create trigger profiles_guard before update on public.profiles
  for each row execute function app.profiles_guard();
