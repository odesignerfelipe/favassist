# Arquitetura — FAV Assist

> Documento técnico de referência. Atualize sempre que uma decisão estrutural mudar.
> Estado de implementação de cada parte: veja `PROGRESSO.md`.

## 1. Visão geral dos serviços

```
┌───────────────────────┐      HTTPS (REST /api)      ┌───────────────────────────┐
│  apps/web (PWA)       │ ──────────────────────────▶ │  apps/api (Fastify)       │
│  React + Vite + TW    │  Bearer access token        │  - autenticação           │
│  shadcn/ui + Lucide   │  refresh em cookie httpOnly │  - autorização (RBAC)     │
└───────────────────────┘                             │  - regras de negócio      │
                                                      │  - OpenAPI em /api/docs   │
                                                      └─────┬───────────┬─────────┘
                                                            │           │ enfileira
                                         SQL com claims JWT │           ▼
                                         (RLS aplicada)     │     ┌──────────────┐
                                                            │     │ Redis/BullMQ │
                                                            ▼     └──────┬───────┘
                                      ┌──────────────────────────┐       │ consome
                                      │ PostgreSQL (Supabase)    │◀──────┤
                                      │ RLS + triggers auditoria │  ┌────▼──────────────────┐
                                      └──────────────────────────┘  │ apps/api worker       │
                                                                    │ (src/worker.ts)       │
                                                                    │ - geração IA          │
                                                                    │ - envios diários      │
                                                                    └────┬──────────┬───────┘
                                                                         │          │
                                                          packages/ai-engine   packages/messaging
                                                          (provedores IA)      (WhatsApp: simulador)
```

| Pacote | Responsabilidade | Depende de |
|---|---|---|
| `packages/shared` | Enums, schemas Zod, matriz de permissões, máquina de estados das atividades, regras de gamificação. Usado por web e API. | zod |
| `packages/ai-engine` | Motor de planejamento: contexto, prompts, provedores (Anthropic, compatível OpenAI), validação e salvaguardas. Não conhece HTTP nem banco. | shared, zod |
| `packages/messaging` | Camada abstrata de mensageria (`MessagingProvider`), simulador, composição de mensagens e interpretação de mensagens recebidas. Não conhece banco. | shared |
| `apps/api` | Servidor HTTP, autenticação, autorização, acesso ao banco, orquestração dos pacotes, worker de filas. | todos acima |
| `apps/web` | PWA. Nunca recebe chaves de IA, service role ou credenciais de integrações. | shared |

Regra: **interface ↔ regras de negócio ↔ IA ↔ integrações** ficam em camadas separadas.
A API orquestra; os pacotes `ai-engine` e `messaging` são puros (entrada/saída) e testáveis isoladamente.

## 2. Autenticação

Provedor configurável por `AUTH_PROVIDER`:

| Modo | Uso | Como funciona |
|---|---|---|
| `supabase` | Produção | A API faz *proxy* para o Supabase Auth (GoTrue): `POST /auth/v1/token`. O token de acesso emitido pelo Supabase é verificado pela API (JWKS do projeto ou `SUPABASE_JWT_SECRET`). Criação de usuários via Admin API com a service role key (somente no servidor). |
| `local` | Desenvolvimento, testes, VPS sem Supabase | A própria API emite JWT HS256 com **as mesmas claims do Supabase** (`sub`, `role=authenticated`, `aud=authenticated`, `email`). Senhas com scrypt em `app_private.local_credentials`; refresh tokens com hash SHA-256 e rotação em `app_private.local_refresh_tokens`. |

Fluxo (idêntico para o front-end nos dois modos):

1. `POST /api/auth/login` → `{ accessToken, expiresAt, user }` + cookie `fav_rt` (httpOnly, `SameSite=Strict`, `Path=/api/auth`, `Secure` em produção — ajustável por `COOKIE_SECURE`).
2. O front guarda o access token **apenas em memória** e o envia como `Authorization: Bearer`.
3. Ao carregar a página ou receber 401, chama `POST /api/auth/refresh` (usa o cookie) e repete a requisição.
4. `POST /api/auth/logout` revoga o refresh token e limpa o cookie.

Rate limit específico nas rotas de autenticação.

## 3. Modelo de permissões

Dois níveis:

- **Plataforma** — `profiles.platform_role = 'favis_admin'` → Administrador FAVIS (acesso global).
- **Empresa** — `company_members.role ∈ {owner, manager, collaborator}` + `permissions` (jsonb) para gerentes.

Permissões granulares (`packages/shared/src/permissions.ts`):

| Permissão | Admin FAVIS | Proprietário | Gerente (padrão) | Colaborador |
|---|---|---|---|---|
| `company.view` | ✔ | ✔ | ✔ | ✔ |
| `profile.edit` (diagnóstico) | ✔ | ✔ | configurável (não) | ✘ |
| `members.manage` | ✔ | ✔ (exceto criar proprietários) | configurável (não; só colaboradores) | ✘ |
| `campaigns.manage` | ✔ | ✔ | configurável (sim) | ✘ |
| `activities.manage` | ✔ | ✔ | configurável (sim) | ✘ |
| `activities.approve` | ✔ | ✔ | configurável (não) | ✘ |
| `activities.view_all` | ✔ | ✔ | ✔ | ✘ (só as atribuídas) |
| `activities.execute` (status, evidências, dificuldades das próprias) | ✔ | ✔ | ✔ | ✔ |
| `ai.use` | ✔ | ✔ | configurável (sim) | ✘ |
| `messaging.manage` (grupos, envios) | ✔ | ✘ (visualiza) | ✘ | ✘ |
| `messaging.view` | ✔ | ✔ | ✔ | ✘ |
| `audit.view` | ✔ | ✔ (da empresa) | ✘ | ✘ |

A verificação acontece **no back-end** (`requirePermission`) e é reforçada no banco (RLS + triggers).

## 4. Isolamento entre empresas (multi-tenant)

Defesa em profundidade, em três camadas:

1. **API** — toda rota com `:companyId` resolve a associação do usuário e checa a permissão.
2. **Sessão SQL com identidade do usuário** — cada requisição autenticada roda numa transação com
   `SET LOCAL ROLE authenticated` e `request.jwt.claims` = claims do token (exatamente o mecanismo do Supabase/PostgREST). Assim `auth.uid()` funciona e **a RLS é aplicada mesmo que a API tenha um bug de autorização**.
3. **Banco** — RLS em todas as tabelas de dados; funções auxiliares `SECURITY DEFINER` em `app` (`app.is_favis_admin()`, `app.member_role(company)`, `app.has_company_role(company, roles[])`); chaves estrangeiras compostas `(company_id, id)` impedem associar uma campanha, um responsável ou um grupo de outra empresa.

Operações de sistema (worker, seed, criação de usuários) usam a conexão de serviço, sem trocar de papel, e são explicitamente restritas ao código do servidor.

Restrições extra no banco:
- Trigger `activities_guard` valida transições de status e impede que colaboradores alterem campos além de status/observações das próprias tarefas.
- Trigger `profiles_guard` impede autoelevação para `favis_admin`.

## 5. Modelo de dados (resumo)

Migrações versionadas em `supabase/migrations/` (formato do Supabase CLI). Detalhes em cada arquivo SQL.

| Tabela | Finalidade |
|---|---|
| `profiles` | Perfil do usuário (1:1 com `auth.users`), `platform_role`. |
| `companies` | Empresas clientes (tenant). |
| `company_members` | Vínculo usuário ↔ empresa com papel e permissões. |
| `company_profiles` | Diagnóstico estratégico (1:1 com empresa). |
| `campaigns` | Campanhas comerciais com participação-alvo no planejamento. |
| `activities` | Tarefas do calendário (roteiro, falas, CTA, responsável, status...). |
| `activity_updates` | Histórico: mudanças de status, comentários, dificuldades. |
| `activity_evidences` | Evidências (links, textos; arquivos na etapa de storage). |
| `platform_settings` | Configuração global (IA, pausa geral de automações). Singleton. |
| `ai_generations` | Pedidos/resultados de planejamento por IA (memória estratégica). |
| `whatsapp_groups` | Grupos vinculados (1 grupo → 1 empresa), horários, pausa. |
| `whatsapp_messages` | Histórico de mensagens com `dedupe_key` única, tentativas e erros. |
| `social_accounts`, `social_metrics` | Estrutura para métricas de integrações autorizadas (vazias até integrar). |
| `point_events`, `achievements`, `user_achievements` | Gamificação. |
| `audit_logs` | Auditoria automática por trigger (quem, o quê, antes/depois). |

Schemas: `public` (dados), `app` (funções auxiliares), `app_private` (credenciais locais — inexistente no Supabase), `auth` (Supabase; emulado localmente por `db/local/000_supabase_compat.sql`).

## 6. Atividades — máquina de estados

```
planejada ──▶ pendente_aprovacao ──▶ aprovada ──▶ em_andamento ──▶ concluida
    │                 │                  │              │
    └──────────┬──────┴──────────────────┴──────────────┘
               ▼
        impedida / cancelada
```

Definida em `packages/shared/src/activity-status.ts` e replicada em `app.activity_transition_allowed()` no banco.
Colaborador: pode mover suas tarefas de {planejada, aprovada, em_andamento, impedida} para {em_andamento, concluida, impedida}.
Ao concluir: `completed_at`/`completed_by` são preenchidos por trigger, pontos de gamificação são lançados e os indicadores do dashboard (calculados a partir das atividades) se atualizam.

## 7. Inteligência artificial

```
API (rota /ai/plans) ─▶ cria ai_generations(status=pendente) ─▶ fila "ai" (ou execução imediata sem Redis)
   worker ─▶ monta CompanyContext (diagnóstico, campanhas ativas, histórico 60 dias,
             datas comerciais, métricas disponíveis, mix-alvo)
          ─▶ ai-engine.generatePlan(provider, ctx)
               1. prompt estruturado (pt-BR, regras de não invenção)
               2. provedor configurado → JSON
               3. validação Zod + salvaguardas:
                  • datas dentro do período • campanha precisa existir e estar ativa
                  • preços/descontos/resultados não presentes nas fontes → item marcado "verificar"
                  • repetição vs histórico (similaridade de títulos)
                  • desvio do mix campanha/pilares (referência 30/70, ajustável)
               4. uma nova tentativa com os erros de validação, se necessário
          ─▶ grava resultado + avisos ─▶ usuário revisa ─▶ "aplicar" cria atividades (ai_generated=true, pendente_aprovacao)
```

- Provedor configurável por `AI_PROVIDER` (`anthropic` | `none`) + `AI_MODEL` (padrão `claude-opus-5-5`). Novos provedores entram implementando a interface `AIProvider` (`packages/ai-engine/src/types.ts`) — sem mudar regras de negócio. Chaves **somente** em variáveis de ambiente do servidor.
- Provedor Anthropic: SDK oficial, saída estruturada por schema (`output_config.format`), pensamento adaptativo com esforço `high`, streaming para respostas longas, *fallback* do lado do servidor (`fallbacks: "default"`) quando o classificador de segurança recusa a solicitação, e tratamento tipado de erros (limite de uso, autenticação, tempo esgotado, indisponibilidade).
- Itens aplicados ao calendário entram como **pendente de aprovação**, com os pontos a verificar nas observações: a IA propõe, a equipe decide.
- Sem provedor configurado, a interface informa claramente que a IA está desativada — não há geração simulada.
- Tendências: só entram no contexto quando houver fonte verificável integrada (ainda não há; o prompt proíbe inventar).

## 8. Notificações e WhatsApp

```
packages/messaging
 ├─ MessagingProvider (interface): send(), status()
 ├─ SimulatorProvider            ← única implementação ativa (nenhum número real conectado)
 ├─ composeDailySchedule()       ← mensagem humanizada, identificada como assistente virtual da FAVIS
 └─ interpretInbound()           ← respostas a mensagens recebidas (comandos simples)

apps/api
 ├─ services/messaging.ts  ← dispatcher: grupos ativos e não pausados cujo horário chegou
 │                           dedupe_key = daily:{grupo}:{data} (índice único) → sem duplicidade
 │                           até 3 tentativas com registro de erro
 └─ worker.ts              ← job BullMQ repetível a cada minuto
```

- Pausa: por grupo (`paused`) e global (`platform_settings.messaging_enabled`).
- O app não depende do WhatsApp: cronogramas ficam sempre no app; falhas de envio só geram registros.
- A conexão real (provedor não oficial ou API oficial do WhatsApp Business) entra como nova implementação de `MessagingProvider`, sem alterar regras de negócio. Riscos documentados em `ROADMAP.md`.

## 8.1 Arquivos de evidência (fotos e vídeos)

```
app (celular) ──multipart──▶ API ── confere permissão (RLS na atividade)
                              ├─ valida tipo pelo cabeçalho E pela assinatura binária (JPG/PNG/WEBP/HEIC, MP4/MOV/WEBM)
                              ├─ grava em <empresa>/<atividade>/<uuid>.<ext>  ← FileStorage
                              └─ registra activity_evidences (kind=arquivo, mime, tamanho)
leitura: API gera link TEMPORÁRIO (1 h) somente para quem enxerga a evidência
```

- `FileStorage` (`apps/api/src/storage`): **Supabase Storage** em produção (bucket privado `evidencias`, criado na subida da API, acesso com a chave secreta só no servidor) ou **disco local** em desenvolvimento/testes (links assinados com HMAC servidos por `GET /api/files/...`).
- O banco impede caminhos fora da pasta da própria empresa/atividade (CHECK na migração 0500).
- Remover a evidência ou a atividade apaga também os arquivos.
- Limite por arquivo: `UPLOAD_MAX_MB` (padrão 50 MB, limite do plano gratuito do Supabase); nginx aceita até 60 MB.
- Base para a etapa de análise de conteúdo por IA (os arquivos já ficam organizados por empresa e atividade).

## 9. Integrações futuras (estrutura)

`social_accounts` (instagram, facebook, google_business) com status de conexão e `social_metrics` (métrica, valor, período, fonte). Dashboards só exibem dados existentes nessas tabelas; sem conexão, mostram estado vazio com orientação. Tokens OAuth deverão ser guardados cifrados (planejado: `app_private.integration_credentials` com criptografia via chave do servidor).

## 10. Gamificação

Regras em `packages/shared/src/gamification.ts`, lançamentos por trigger no banco (`point_events`, idempotentes por atividade+motivo):

| Evento | Pontos |
|---|---|
| Conclusão no prazo (até o dia agendado) | 10 |
| Conclusão atrasada | 4 |
| Evidência na tarefa concluída (1x por tarefa) | 3 |

A qualidade é favorecida (evidência, prazo) e a quantidade pura é limitada: o ranking principal usa **taxa de execução e sequência de dias ativos**, não apenas a soma de pontos. Nível = função dos pontos acumulados.

## 11. Decisões técnicas

| Decisão | Motivo |
|---|---|
| Acesso ao banco por `pg` direto com claims JWT por transação (e não via supabase-js) | RLS aplicada igualmente no Supabase e no Postgres local; transações reais; sem acoplamento ao PostgREST. |
| Modo de autenticação `local` | Permite desenvolver, testar e rodar em VPS sem Supabase, mantendo o mesmo formato de token. |
| `text` + `CHECK` em vez de `ENUM` do Postgres | Migrações de valores mais simples. |
| Auditoria por trigger | Não depende de cada rota lembrar de registrar. |
| Worker no mesmo app da API (entrypoint separado) | Reaproveita acesso a dados; pode escalar como processo/contêiner independente. |
| Redis opcional em desenvolvimento | Sem Redis, IA roda em segundo plano no próprio processo e o envio diário é manual; em produção, usar Redis. |
| Componentes shadcn/ui escritos no repositório | Padrão shadcn (Radix + Tailwind + CVA), sem depender do CLI na build. |
| Identidade visual em tokens (`apps/web/src/styles/brand.css`) | Substituição simples quando os arquivos oficiais da FAVIS forem entregues. |
| Web e API no mesmo domínio (nginx faz proxy de `/api`) | Cookie de refresh `SameSite=Strict` sem CORS; o service worker do PWA nunca guarda respostas da API. |
| Uma imagem Docker com dois alvos (`api`, `web`) | API, worker e migração usam a mesma imagem com comandos diferentes. |

## 12. Implantação

```
               ┌──────────── docker compose ────────────┐
 navegador ──▶ │ web (nginx: PWA + proxy /api) ──▶ api   │
               │                     worker ──▶ redis    │
               │ migrate (one-shot) ──▶ postgres ◀── api │
               └─────────────────────────────────────────┘
```

Produção recomendada: TLS na frente do serviço `web`, `COOKIE_SECURE=true`, Postgres gerenciado (Supabase) ou com backup diário (ver README).
