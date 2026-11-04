-- =============================================================================
-- Autenticação local (AUTH_PROVIDER=local). Não usado com Supabase Auth.
-- Schema app_private: inacessível aos papéis anon/authenticated.
-- =============================================================================

create schema if not exists app_private;
revoke all on schema app_private from public;
revoke all on schema app_private from anon, authenticated;

create table if not exists app_private.local_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists app_private.local_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists local_refresh_tokens_user_idx on app_private.local_refresh_tokens (user_id);
