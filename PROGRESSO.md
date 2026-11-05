# Progresso — FAV Assist

> Registro oficial do andamento. **Leia este arquivo primeiro ao retomar o desenvolvimento.**
> Última atualização: 2026-11-04 — branch `feat/primeira-entrega`.

## Estado atual

**Etapa:** 2 — Operação real (em andamento). Etapa 1 concluída: **Marco 1 validado** (API, banco e navegador).

### Etapa 2 — andamento
| Item | Situação |
|---|---|
| Identidade visual oficial FAVIS | ✅ Aplicada (cores, ícone FAV, logotipos, ícones do PWA) |
| Supabase (projeto `mbctlwobwwpgzsusnovg`) | ✅ API compatível com as chaves novas (`sb_publishable_`/`sb_secret_`) e JWKS ES256 — testado contra o projeto real (login e verificação de token). ⏳ Migrações ainda não aplicadas (precisam da string de conexão, digitada na VPS). |
| Implantação na VPS Hostinger | ✅ **No ar em https://assistente.favisdesign.com.br** (05/11/2026) via serviço Compose do Easypanel (`docker-compose.easypanel.yml`), sem interferir em `gestao.caicosabores.com`. Verificado em produção: página e PWA, `/api/health` (Supabase + Redis/BullMQ), login inválido recusado via Supabase Auth, migrações aplicadas (tabelas existem e o papel `anon` não tem acesso). Lição: no domínio do Easypanel o destino deve ser Protocolo HTTP, porta 80, Serviço Compose `web`. |
| Domínio | ✅ `assistente.favisdesign.com.br` → A `187.127.63.111` (ALIAS antigo da hospedagem removido); certificado Let's Encrypt emitido pelo Easypanel |
| Evidências em foto e vídeo | ✅ Envio pelo app (com progresso), validação de tipo pelo conteúdo, Supabase Storage em produção (bucket privado `evidencias`, links temporários de 1 h), disco local em dev; remoção apaga o arquivo; pontos de evidência valem para arquivos. Migração 0500. Testado: 10 testes de API + envio real pelo navegador (celular). ⏳ Em produção, validar o primeiro envio após o próximo deploy. |
| Atualização do app e acesso ao envio de fotos | ✅ O PWA detecta versão nova e recarrega sozinho (verifica a cada hora e ao voltar para o app) — antes, quem já tinha aberto o app via a versão antiga. Atalho "Foto" em cada tarefa do checklist e botão "Enviar foto ou vídeo" no topo do painel da tarefa. Testado no navegador (atualização automática e envio pelo atalho). |
| Fila de aprovações | ✅ Quadro "Aguardando aprovação" na visão geral da empresa (aprovar uma a uma ou todas), essencial para revisar os planejamentos da IA. Testado no navegador. |
| Implantação automática | ✅ Workflow `deploy.yml`: após o CI verde no `main`, aciona o gatilho do Easypanel (segredo `EASYPANEL_DEPLOY_URL`). ⏳ Segredo a cadastrar no GitHub. |
| Ajustes de segurança no Supabase | ✅ Concluídos em 05/11/2026: cadastro público desligado, Data API desativada (verificado: o endpoint REST não serve mais tabelas) e Site URL `https://assistente.favisdesign.com.br`. |
| Limite de tentativas de login | 🔧 Corrigido no branch `fix/limite-login` (aguardando aprovação para publicar). Falha encontrada na auditoria 2.0: com `trustProxy: true`, o cliente forjava o IP pelo `X-Forwarded-For` e contornava o limite de 10 tentativas/min. Agora a API confia só em `TRUST_PROXY_HOPS` proxies (Easypanel = 2) e há bloqueio de 15 min por e-mail após `LOGIN_MAX_FAILURES_PER_EMAIL` (10) falhas, vindas de qualquer IP. 4 testes novos. |

### Funcionalidades concluídas (com comportamento real e persistência)

| Módulo | O que funciona |
|---|---|
| Autenticação | Login, sessão em memória + refresh rotativo em cookie httpOnly, detecção de reuso de token, logout, troca de senha. Provedores `local` e `supabase` (mesma interface). |
| Multiempresas e permissões | 4 perfis (Admin FAVIS, Proprietário, Gerente com permissões configuráveis, Colaborador). Checagem na API + RLS em todas as tabelas + FKs compostas por empresa. |
| Painel FAVIS | Visão geral (execução por empresa, alertas), empresas (cadastro, ativar/desativar), usuários (criar, admin, desativar, senha), monitor do WhatsApp, auditoria, configurações (IA e automações). |
| Diagnóstico estratégico | Todos os campos do briefing, horários de funcionamento, datas comerciais, restrições, participação-alvo de campanhas, % de preenchimento. |
| Campanhas | CRUD com período, produtos, ofertas confirmadas, status e participação-alvo; progresso de execução. |
| Calendário | Visões dia/semana/mês, filtros, criação/edição/exclusão, todos os campos da tarefa (roteiro, falas, gravação, legenda, CTA, responsável, Stories…). |
| Atividades | Máquina de estados (7 status) validada na API e no banco; histórico, comentários, dificuldades, evidências (links). |
| Checklist | Tarefas do dia, atrasadas e próximas; conclusão em um toque; detalhes com roteiro. |
| Dashboard operacional | Taxa de execução, planejadas/concluídas/atrasadas, Stories, equilíbrio de pilares × campanha, equipe, impedimentos, movimentações (atualiza a cada 30 s). |
| IA (estrutura) | Motor com contexto da empresa (diagnóstico, campanhas, histórico, datas, métricas), saída estruturada, salvaguardas contra preços/promoções/resultados inventados, repetição e desequilíbrio; revisão e aplicação ao calendário como "pendente de aprovação"; alternativa para tarefa impedida. |
| WhatsApp (simulador) | Grupos por empresa, horário/dias de envio, pausa por grupo e global, envio diário automático (worker) e manual sem duplicidade, tentativas e erros, respostas por regras/IA, histórico e monitoramento. |
| Gamificação (estrutura) | Pontos por trigger (no prazo/atrasada/evidência), conquistas, níveis, sequência de dias, ranking por consistência (semana/mês/ano) e ranking de empresas (API). |
| Métricas (estrutura) | Tabelas e API; telas com estado vazio e orientação — nenhum dado fictício. |
| Auditoria | Trigger em todas as tabelas de negócio (quem, o quê, antes/depois). |
| PWA | Manifest, ícones provisórios, service worker (sem cache da API), layout responsivo. |
| Infra | Dockerfile (alvos api/web), docker-compose completo, nginx, CI no GitHub Actions. |

### Parcialmente implementado
- **IA:** o provedor Anthropic está implementado e com tipos verificados, mas **não foi chamado de verdade** (não há chave de API nesta sessão). O fluxo completo foi testado com um provedor roteirizado de testes.
- **Gamificação:** ranking de empresas existe na API, sem tela própria ainda.

### Pendente (próximas etapas — ver ROADMAP.md)
- Recuperação de senha/convite por e-mail; notificações no app e Web Push.
- Upload de evidências e análise de vídeos/imagens por IA.
- Assistente conversacional no app; relatórios estratégicos.
- Integrações reais: WhatsApp, Instagram/Facebook, Perfil da Empresa no Google.
- Rotinas automáticas de IA (planejamento semanal automático, oportunidades diárias, tendências com fonte).

## Arquitetura

- **Componentes:** `apps/api` (Fastify + worker BullMQ), `apps/web` (PWA React), `packages/shared`, `packages/ai-engine`, `packages/messaging`.
- **Banco:** 4 migrações em `supabase/migrations/` (núcleo, estratégia, plataforma, RLS) + `db/local/` (compatibilidade Supabase e auth local). 18 tabelas com RLS.
- **Integrações existentes:** Anthropic (pronta, aguardando chave), Supabase Auth (pronta, aguardando projeto), WhatsApp (simulador).
- **Dependências importantes:** Fastify 5, fastify-type-provider-zod 7, pg 8, jose 6, BullMQ 6 + ioredis 5, Zod 4, React 19, Vite 8, Tailwind 4, Radix UI, TanStack Query 5, @anthropic-ai/sdk 1.5.

## Validação

| Verificação | Resultado |
|---|---|
| `pnpm typecheck` (5 pacotes) | ✅ sem erros |
| `packages/shared` — 13 testes (estados, permissões, gamificação, schemas) | ✅ |
| `packages/messaging` — 5 testes (simulador, composição, intenções) | ✅ |
| `packages/ai-engine` — 8 testes (salvaguardas, nova tentativa, prompt) | ✅ |
| `apps/api` — 16 testes de banco (isolamento RLS, papéis, auditoria, triggers, SQL ≡ TS) | ✅ |
| `apps/api` — 17 testes de integração HTTP do Marco 1 | ✅ |
| `apps/api` — 2 testes de IA (fila → validação → aplicação) e despacho automático do WhatsApp | ✅ |
| `apps/api` — 3 testes do provedor Supabase (chaves novas/legadas, configuração) | ✅ |
| `apps/api` — 10 testes de evidências em arquivo (envio, link assinado, adulteração, tipo disfarçado, limites, isolamento, remoção, Supabase Storage simulado) | ✅ |
| E2E no navegador (`e2e/milestone.e2e.mjs`) — 9 etapas do Marco 1 | ✅ |
| Build de produção (API tsup, web Vite + PWA) | ✅ |
| Imagem Docker `api`: migração em banco novo, `/api/health`, worker | ✅ |
| Imagem Docker `web` + pilha Easypanel completa (E2E pelo nginx) | ✅ |

**Total: 74 testes automatizados + E2E, todos passando.**

### Limitações conhecidas
- Sem chave de IA, a geração fica desativada (a interface informa claramente). Nenhuma geração é simulada.
- Sem Redis, a API usa fila inline e o envio diário automático não roda (o envio manual funciona).
- Bundle inicial da web ~550 kB minificado (aviso do Vite); otimizar a divisão em chunks numa próxima etapa.
- Fuso horário das datas na interface usa o relógio do navegador; os prazos no banco usam o fuso da empresa (diferença só aparece para usuários fora do Brasil ou perto da meia-noite; o E2E roda com o navegador no fuso de São Paulo).

## Continuidade

- **Última tarefa realizada:** atualização automática do PWA e atalhos de envio de foto (login de administrador confirmado em produção); antes disso, fila de aprovações e implantação automática pelo Easypanel. Evidências em foto/vídeo já publicadas em produção (05/11), aguardando o primeiro envio real para validação final.
- **Próximo passo recomendado:** implantar e validar as evidências em foto/vídeo em produção; mesclar o PR odesignerfelipe/favassist#1 (`feat/primeira-entrega` → `main`) e apontar o Easypanel para `main`; depois, chave da IA + calibração de prompts com clientes reais, upload de evidências (Supabase Storage) e notificações no app.
- **Para retomar:**

```bash
pnpm install
```

```bash
pnpm db:migrate && pnpm check
```

```bash
pnpm dev
```

- **Configurações pendentes (precisam do responsável pela FAVIS):**
  - Após o primeiro login: apagar `SEED_ADMIN_PASSWORD` do Environment do Easypanel e reimplantar.
  - Chave de API da Anthropic (`AI_API_KEY`).
  - Segredos `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` no GitHub para implantação automática.
  - Decisão sobre a integração do WhatsApp (solução não oficial × API oficial do WhatsApp Business) — ver riscos no ROADMAP.
