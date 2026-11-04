# Progresso — FAV Assist

> Registro oficial do andamento. Leia este arquivo primeiro ao retomar o desenvolvimento.

## Estado atual

**Etapa:** 1 — Primeira versão funcional (em andamento)

### Concluído
- Monorepo pnpm (`apps/api`, `apps/web`, `packages/shared`, `packages/ai-engine`, `packages/messaging`).
- Banco: 4 migrações versionadas, RLS em todas as tabelas, auditoria por trigger, gamificação por trigger.
- API Fastify com OpenAPI (`/api/docs`): autenticação (local/Supabase), empresas, equipe, usuários, diagnóstico, campanhas, atividades, checklist, dashboards, gamificação, auditoria, configurações, métricas (estrutura), IA, WhatsApp (simulador).
- Motor de IA (`packages/ai-engine`): provedor Anthropic com saída estruturada, validação e salvaguardas contra informações inventadas.
- Mensageria (`packages/messaging`): interface abstrata, simulador, composição de mensagens, respostas por regras.
- Worker BullMQ: gerações de IA e verificação a cada minuto dos envios diários.

### Em andamento
- Front-end (apps/web).

### Pendente nesta etapa
- Front-end completo, Docker, teste E2E no navegador, documentação final.

## Continuidade
- Última tarefa: API + IA + mensageria + worker, com 61 testes automatizados passando.
- Próximo passo: front-end React (design system, layout, telas do Marco 1).
