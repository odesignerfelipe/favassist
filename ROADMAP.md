# Roadmap — FAV Assist

Prioridade: **P0** = primeira entrega, **P1** = próxima etapa, **P2** = seguinte, **P3** = futuro/SaaS.
Estado atual de cada item: `PROGRESSO.md`.

## Etapa 1 — Primeira versão funcional (P0)

| Item | Critério de conclusão |
|---|---|
| Estrutura do monorepo, Git e documentação | `pnpm install && pnpm check` passa; README/PROGRESSO/ARQUITETURA/ROADMAP presentes |
| Banco com migrações, RLS e auditoria | Migrações aplicam do zero; testes provam isolamento entre empresas |
| Autenticação (local e Supabase) | Login/refresh/logout; tokens verificados no back-end |
| Multiempresas e permissões | Matriz de permissões testada na API e no banco |
| Painel administrativo FAVIS | Empresas, usuários, configurações de IA e automações |
| Cadastro de clientes e diagnóstico | CRUD persistido, validado e auditado |
| Campanhas | CRUD com período, ofertas e participação-alvo |
| Calendário (dia/semana/mês) e atividades | Criar, editar, atribuir, mudar status com regras |
| Checklist do colaborador | Ver tarefas do dia, concluir, registrar dificuldade e evidência |
| Dashboard operacional | Indicadores calculados de dados reais |
| Estrutura de IA | Provedores configuráveis, validação, salvaguardas, histórico |
| Simulador de WhatsApp | Envio diário com dedupe, pausa, histórico, respostas simuladas |
| Gamificação (estrutura) | Pontos por trigger, nível, sequência, rankings |
| Docker | `docker compose up` sobe Postgres, Redis, API, worker e web |

**Marco 1 (aceite):** admin acessa → cadastra empresa → diagnóstico → campanha → atividades no calendário → atribui → colaborador vê e conclui → dashboard reflete → simula envio pelo WhatsApp. Coberto por teste automatizado de API e E2E.

## Etapa 2 — Operação real (P1)

| Item | Dependências | Critério |
|---|---|---|
| Projeto Supabase de produção + deploy na VPS | Credenciais Supabase, VPS Hostinger, domínio `asistente.favisdesign.com.br` | Migrações aplicadas (serviço `migrate`); HTTPS ativo; login via Supabase Auth em produção |
| Upload de evidências (imagem/vídeo) | Supabase Storage (bucket privado + políticas) | Arquivo enviado, visível só para a empresa |
| Chave do provedor de IA e calibração de prompts | Chave API, empresas reais | Planejamentos revisados pela FAVIS com taxa de aceite registrada |
| Notificações no app (in-app + Web Push no PWA) | VAPID keys | Colaborador recebe lembrete da tarefa do dia |
| Recuperação de senha e convite por e-mail | SMTP / Supabase Auth | Fluxo completo de convite |
| Relatórios estratégicos (PDF/Web) | Dados de execução | Relatório mensal por empresa |
| Backups automatizados | VPS/Supabase | Rotina testada de restauração (ver README) |

## Etapa 3 — Integrações (P2)

| Item | Riscos / observações |
|---|---|
| WhatsApp — conexão real do número FAVIS | Grupos convencionais só via soluções **não oficiais** (WhatsApp Web), sujeitas a banimento e desconexão. Alternativa oficial: WhatsApp Business Platform (não suporta grupos convencionais da mesma forma). Decisão de negócio necessária. Implementar como novo `MessagingProvider` com monitoramento de sessão. |
| Instagram / Facebook (Graph API) | App Meta aprovado, permissões `instagram_basic`, `instagram_manage_insights`; tokens cifrados |
| Perfil da Empresa no Google | Projeto Google Cloud + OAuth + aprovação de acesso à API |
| Aprendizado com métricas reais | Depende das integrações acima; ajuste automático do mix de pilares |
| Tendências verificáveis | Fonte confiável com citação; nunca inventar |

## Etapa 4 — IA avançada (P2)

- Assistente conversacional no app (contexto da empresa, histórico).
- Análise de vídeos/imagens das evidências (clareza, áudio, enquadramento, aderência ao roteiro, CTA, marca) — conforme capacidades multimodais do provedor configurado.
- Rotinas: planejamento semanal automático, verificação diária de oportunidades, redução de repetição.
- Alternativas para tarefas impedidas.

## Etapa 5 — SaaS (P3)

- Planos, cobrança e limites por empresa.
- Agências (multi-agência acima de empresas).
- White-label (tokens de marca por agência).
- Onboarding autoatendido.
- Observabilidade (OpenTelemetry), SLOs.
