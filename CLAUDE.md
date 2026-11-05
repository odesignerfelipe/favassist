# FAV Assist — instruções para o Claude Code

Plataforma SaaS de planejamento estratégico de marketing da FAVIS Design Studio. Idioma do produto, da documentação e dos commits: **português do Brasil**.

## Protocolo de continuidade (obrigatório)

Ao iniciar uma sessão:
1. Leia `PROGRESSO.md` (estado oficial), depois `ARQUITETURA.md` e `ROADMAP.md`.
2. Rode `git status` e `git log --oneline -10`; verifique alterações não registradas.
3. Retome a partir de "Próximo passo recomendado" em `PROGRESSO.md`. **Não reinicie** módulos concluídos.

Ao concluir uma etapa:
1. `pnpm check` (typecheck + testes) — precisa passar.
2. Atualize `PROGRESSO.md` (e `ARQUITETURA.md`/`ROADMAP.md` se algo estrutural mudou).
3. Commit organizado em português e push para o GitHub.

## Regras do projeto

- Toda funcionalidade precisa de comportamento real e persistido; nada de interface "de fachada".
- Nunca simular integrações como operacionais. WhatsApp = simulador até a etapa de integração real; métricas só de integrações autorizadas; IA nunca inventa preços, promoções ou resultados.
- Isolamento entre empresas: autorização na API (`assertCompanyPermission`) **e** RLS no banco. Consultas de usuário sempre via `withUser(req, …)`; `db.asService` só para rotinas de sistema.
- Permissões: matriz única em `packages/shared/src/permissions.ts`. Máquina de estados das atividades em `packages/shared/src/activity-status.ts` **espelhada** em SQL (há teste comparando).
- Mudança de banco = nova migração em `supabase/migrations/` (nunca editar migração já aplicada).
- Nunca comitar `.env` ou credenciais.
- Identidade visual oficial FAVIS (marrom `#2D1500`, laranja `#FF8801`): tokens em `apps/web/src/styles/brand.css`, arquivos em `apps/web/public/brand/`. Laranja só em preenchimentos; texto usa `accent-ink`.
- Produção: Supabase (banco + Auth) + VPS Hostinger com **Easypanel** (serviço Compose com `docker-compose.easypanel.yml`; a VPS hospeda outros sites — nunca publicar portas nem ocupar 80/443), domínio `assistente.favisdesign.com.br`.

## Comandos

- `pnpm dev` (API + web), `pnpm dev:worker`, `pnpm db:migrate`, `pnpm db:seed:admin`
- `pnpm check` — typecheck + testes (requer `TEST_DATABASE_URL`, banco que é apagado nos testes)
- `pnpm test:e2e` — Marco 1 no navegador (API e web rodando)
