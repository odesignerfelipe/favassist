-- =============================================================================
-- Controle de consumo de IA por empresa (FAV Assist 2.0)
-- Somente ADITIVA: novas colunas com valor padrão e novas tabelas. Nada é apagado.
--   * Teto mensal de referência por empresa (padrão da plataforma: US$ 10).
--   * Registro de cada chamada à IA com tokens e custo ESTIMADO (tabela de preços pública).
--   * Alertas ao atingir o percentual configurado (padrão 80%) e o teto (100%).
--   * Ao atingir o teto, chamadas AUTOMÁTICAS são bloqueadas (as manuais seguem com aviso).
-- O teto é uma referência interna: não altera limites da conta na Anthropic.
-- =============================================================================

alter table public.platform_settings
  add column ai_default_monthly_budget_usd numeric(8, 2) not null default 10.00
    check (ai_default_monthly_budget_usd between 0 and 10000),
  add column ai_budget_alert_pct smallint not null default 80
    check (ai_budget_alert_pct between 10 and 99);

-- null = usa o padrão da plataforma
alter table public.companies
  add column ai_monthly_budget_usd numeric(8, 2)
    check (ai_monthly_budget_usd is null or ai_monthly_budget_usd between 0 and 10000);

-- Origem da geração: pedida por uma pessoa ou disparada pelo sistema (autonomia/rotinas)
alter table public.ai_generations
  add column origin text not null default 'manual' check (origin in ('manual', 'automatico'));

-- Uma linha por chamada ao provedor (inclui tentativas que falharam mas consumiram tokens)
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  generation_id uuid,
  feature text not null check (feature in ('planejamento', 'alternativa', 'assistente_whatsapp')),
  origin text not null check (origin in ('manual', 'automatico')),
  provider text not null check (char_length(provider) <= 40),
  model text not null check (char_length(model) <= 80),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  cost_usd numeric(12, 6) not null check (cost_usd >= 0),
  -- false = modelo fora da tabela de preços; custo estimado pelo maior preço conhecido
  price_known boolean not null default true,
  succeeded boolean not null,
  created_at timestamptz not null default now(),
  foreign key (company_id, generation_id)
    references public.ai_generations (company_id, id) on delete set null (generation_id)
);
create index ai_usage_events_company_idx on public.ai_usage_events (company_id, created_at desc);

-- Alertas de consumo (um por empresa, mês e nível)
create table public.ai_budget_alerts (
  company_id uuid not null references public.companies (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  level text not null check (level in ('alerta', 'limite')),
  spent_usd numeric(12, 6) not null,
  budget_usd numeric(8, 2) not null,
  created_at timestamptz not null default now(),
  primary key (company_id, month, level)
);

-- RLS: leitura para administradores FAVIS e gestores da empresa; escrita só pelo sistema
alter table public.ai_usage_events enable row level security;
alter table public.ai_budget_alerts enable row level security;
revoke all on public.ai_usage_events, public.ai_budget_alerts from anon, authenticated;
grant select on public.ai_usage_events, public.ai_budget_alerts to authenticated;

create policy ai_usage_events_select on public.ai_usage_events for select to authenticated
  using (app.can_manage_company(company_id));
create policy ai_budget_alerts_select on public.ai_budget_alerts for select to authenticated
  using (app.can_manage_company(company_id));
