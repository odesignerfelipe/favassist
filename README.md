# FAV Assist

**Plataforma de inteligência estratégica de marketing — by FAVIS Design Studio.**

O FAV Assist automatiza o trabalho operacional de planejamento de conteúdo (principalmente Stories) dos clientes da FAVIS, mantendo a personalização estratégica e o acompanhamento da execução: diagnóstico de cada empresa, campanhas, calendário estratégico, checklists da equipe, dashboard com dados reais, planejamento por IA e envio dos cronogramas pelo WhatsApp (simulado nesta etapa).

| Documento | Conteúdo |
|---|---|
| [`PROGRESSO.md`](PROGRESSO.md) | Estado atual, testes, limitações e próximo passo — **leia primeiro ao retomar** |
| [`ARQUITETURA.md`](ARQUITETURA.md) | Serviços, autenticação, permissões, isolamento, IA, notificações, decisões |
| [`ROADMAP.md`](ROADMAP.md) | Etapas, prioridades, dependências e critérios de conclusão |
| [`CLAUDE.md`](CLAUDE.md) | Protocolo de continuidade para sessões do Claude Code |
| `/api/docs` | Documentação OpenAPI interativa da API (com a API rodando) |

## Tecnologias

- **Front-end:** React 19, TypeScript, Vite 8, Tailwind CSS 4, componentes no padrão shadcn/ui (Radix), Lucide, TanStack Query, React Hook Form + Zod, PWA (vite-plugin-pwa).
- **Back-end:** Node.js 22, Fastify 5, Zod (validação + OpenAPI), `pg`, `jose` (JWT).
- **Banco:** PostgreSQL 16 / Supabase, Row Level Security, migrações SQL versionadas.
- **Autenticação:** Supabase Auth (produção) ou provedor local compatível (desenvolvimento/VPS).
- **Filas:** Redis + BullMQ (worker separado).
- **IA:** Anthropic (Claude) via SDK oficial com saída estruturada; provedor plugável.
- **Infra:** Docker, Docker Compose, nginx.
- **Testes:** Vitest (unitários e integração com Postgres real) e Playwright (E2E).

## Estrutura

```
fav-assist/
├── apps/
│   ├── api/                 # Fastify: rotas, auth, serviços, worker BullMQ, scripts
│   │   ├── src/
│   │   │   ├── auth/        # provedores local e Supabase, hash de senha
│   │   │   ├── db/          # acesso ao banco (claims JWT por transação) e migrador
│   │   │   ├── routes/      # endpoints REST por módulo
│   │   │   ├── services/    # orquestração de IA e mensageria
│   │   │   ├── queue/       # BullMQ / fila inline
│   │   │   ├── scripts/     # seed do admin e dados de demonstração
│   │   │   ├── server.ts    # entrada da API
│   │   │   └── worker.ts    # entrada do worker
│   │   └── test/            # testes de RLS e de integração (Marco 1, IA, WhatsApp)
│   └── web/                 # PWA React
│       ├── public/brand/    # identidade PROVISÓRIA (substituir pelos arquivos FAVIS)
│       └── src/
│           ├── components/  # ui (design system), layout, activity
│           ├── lib/         # cliente da API, autenticação, tipos, utilitários
│           ├── pages/       # admin/, company/, checklist, conta, login
│           └── styles/      # brand.css (tokens de marca) e globals.css
├── packages/
│   ├── shared/              # enums, permissões, máquina de estados, schemas Zod
│   ├── ai-engine/           # motor de planejamento: prompts, provedores, salvaguardas
│   └── messaging/           # camada abstrata do WhatsApp + simulador
├── supabase/migrations/     # migrações versionadas (compatíveis com Supabase CLI)
├── db/local/                # compatibilidade Supabase e auth local (Postgres puro)
├── deploy/nginx.conf        # servidor da PWA + proxy /api
├── e2e/                     # teste E2E do Marco 1 no navegador
├── Dockerfile               # alvos "api" e "web"
└── docker-compose.yml
```

## Requisitos

- Node.js **22+** e pnpm **10+** (`corepack enable`)
- PostgreSQL **16+** (local, Docker ou Supabase)
- Redis **7+** (opcional em desenvolvimento; necessário para o envio diário automático)
- Docker + Docker Compose (para executar tudo em contêineres)

## Instalação (desenvolvimento)

```bash
pnpm install
```

```bash
cp .env.example .env
```

Edite o `.env`: defina `DATABASE_URL`, `TEST_DATABASE_URL` e gere `AUTH_JWT_SECRET` com:

```bash
openssl rand -base64 48
```

Crie os bancos (se usar Postgres local) e aplique as migrações:

```bash
createdb fav_assist && createdb fav_assist_test
```

```bash
pnpm db:migrate
```

Crie o primeiro Administrador FAVIS (defina `SEED_ADMIN_EMAIL` e `SEED_ADMIN_PASSWORD` no `.env`):

```bash
pnpm db:seed:admin
```

Opcional — empresa de demonstração claramente identificada (bloqueado em produção):

```bash
pnpm db:seed:demo
```

## Comandos de desenvolvimento

| Comando | O que faz |
|---|---|
| `pnpm dev` | API (http://localhost:3333) + web (http://localhost:5173, proxy de `/api`) |
| `pnpm dev:worker` | Worker BullMQ (IA e envio diário do WhatsApp) — requer `REDIS_URL` |
| `pnpm db:migrate` | Aplica migrações pendentes |
| `pnpm typecheck` | Verificação de tipos em todos os pacotes |
| `pnpm test` | Testes unitários e de integração (usa `TEST_DATABASE_URL`, que é **apagado**) |
| `pnpm check` | `typecheck` + `test` |
| `pnpm build` | Build de produção de todos os pacotes |
| `pnpm test:e2e` | E2E do Marco 1 no navegador (API e web rodando; ver abaixo) |

E2E: instale o Playwright uma vez e rode com as credenciais do admin:

```bash
pnpm add -Dw playwright && pnpm exec playwright install chromium
```

```bash
E2E_ADMIN_EMAIL=admin@favis.com.br E2E_ADMIN_PASSWORD=sua-senha pnpm test:e2e
```

## Configuração de ambiente

Todas as variáveis estão documentadas em [`.env.example`](.env.example). Pontos principais:

- **`AUTH_PROVIDER`** — `local` (a API emite os tokens) ou `supabase` (Supabase Auth; exige `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).
- **`AI_PROVIDER`** — `none` (IA desativada; o app funciona normalmente) ou `anthropic` com `AI_API_KEY`. Modelo padrão: `claude-opus-5-5` (altere com `AI_MODEL`).
- **`REDIS_URL`** — vazio = sem filas: a IA roda dentro da API e o cronograma diário só é enviado manualmente.
- **`COOKIE_SECURE`** — `true` em produção (HTTPS). Use `false` apenas em testes locais sem HTTPS.
- Chaves e segredos **somente** em variáveis de ambiente do servidor. Nada sensível é enviado ao navegador; o `.env` nunca deve ser versionado.

## Produção

### Opção A — Docker Compose em VPS Linux

```bash
cp .env.example .env
```

No `.env`: troque `POSTGRES_PASSWORD`, `AUTH_JWT_SECRET`, defina `PUBLIC_URL` (domínio com HTTPS) e `COOKIE_SECURE=true`. Depois:

```bash
docker compose up -d --build
```

```bash
docker compose run --rm -e SEED_ADMIN_EMAIL=admin@favis.com.br -e SEED_ADMIN_PASSWORD='senha-forte' api node dist/scripts/seed-admin.js
```

Coloque um proxy com TLS (Caddy, Traefik ou nginx + Let's Encrypt) na frente da porta `WEB_PORT`. O serviço `migrate` aplica as migrações a cada deploy antes de a API subir.

### Opção B — Supabase (banco + Auth) + API/worker/web em contêineres

1. Crie o projeto no Supabase e aplique as migrações com o Supabase CLI:

```bash
supabase link --project-ref SEU_PROJETO
```

```bash
supabase db push
```

2. Configure `AUTH_PROVIDER=supabase`, `SUPABASE_*` e `DATABASE_URL` (conexão direta, porta 5432, `DATABASE_SSL=true`).
3. Suba `api`, `worker` e `web` (mesmas imagens do Dockerfile) com Redis gerenciado ou próprio.
4. Crie o primeiro admin com o script `seed-admin` (ele cria o usuário via Admin API do Supabase).

### Backups (produção)

- **Supabase:** backups diários automáticos (planos pagos) + Point-in-Time Recovery recomendado.
- **Postgres próprio:** `pg_dump` diário com retenção e cópia externa, por exemplo via cron na VPS:

```bash
docker compose exec -T postgres pg_dump -U fav -Fc fav_assist > /backups/fav_assist_$(date +%F).dump
```

- Teste a restauração periodicamente (`pg_restore -d <banco_vazio> arquivo.dump`).
- Redis guarda apenas filas (AOF ligado); não é fonte de verdade — todo estado de negócio está no Postgres.

## Banco de dados

- Migrações em `supabase/migrations/` (ordem por nome), aplicadas uma única vez e registradas em `fav_meta.migrations`.
- Em Postgres puro, `db/local/000_supabase_compat.sql` recria `auth.users`, `auth.uid()` e os papéis `anon`/`authenticated`/`service_role` — as mesmas migrações rodam no Supabase e localmente.
- **RLS em todas as tabelas.** Cada requisição da API roda numa transação com `SET LOCAL ROLE authenticated` e as claims do JWT; o isolamento entre empresas é garantido pelo banco mesmo se houver erro na API.
- Auditoria automática por trigger em `audit_logs`; gamificação por trigger em `point_events`.
- Modelo completo: [`ARQUITETURA.md`](ARQUITETURA.md) §5.

## Identidade visual

A identidade atual é **provisória e neutra**. Para aplicar a marca oficial da FAVIS, veja [`apps/web/public/brand/README.md`](apps/web/public/brand/README.md): basta trocar os arquivos em `public/brand/` e os tokens em `apps/web/src/styles/brand.css`.
