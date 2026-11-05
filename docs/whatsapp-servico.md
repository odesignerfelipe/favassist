# Planejamento — Serviço WhatsApp (FAV Assist 2.0)

> Status: **planejamento aprovado para desenvolvimento e testes em simulação.**
> Nenhum envio real, conexão com grupos de clientes ou automação ativa sem autorização específica.
> O primeiro teste real será num grupo controlado da FAVIS, com autorização.

## 1. Objetivos e limites

- O serviço é **independente**, num container próprio. Se falhar, travar ou consumir memória demais, a API, o app e o worker continuam funcionando.
- Usa um número dedicado da FAVIS, conectado por QR code (WhatsApp Web). **Não é uma solução oficial da Meta.** O número pode ser bloqueado pelo WhatsApp, e esse risco foi aceito pelo responsável.
- **Fora do escopo:** disparos em massa, contornar limites ou bloqueios do WhatsApp e mensagens para contatos individuais. O serviço fala só com grupos autorizados.

## 2. Arquitetura

```
             (rede interna do Compose, sem portas publicadas)
 ┌────────┐   fila BullMQ (Redis)   ┌──────────┐   HTTP interno assinado   ┌────────────┐
 │  API   │ ──────────────────────▶ │  worker  │ ────────────────────────▶ │  whatsapp  │──▶ WhatsApp Web
 │        │ ◀────────────────────── │          │ ◀──────────────────────── │ (Chromium) │◀── (QR, sessão)
 └────────┘  eventos (webhook       └──────────┘   status / mensagens      └────────────┘
             interno assinado)                     recebidas                      │
                                                                         volume: whatsapp-session
```

- **Ponto de integração:** a interface `MessagingProvider` (`packages/messaging/src/index.ts`), que já existe. Haverá um novo `WhatsAppWebProvider` ao lado do `SimulatorProvider`, escolhido por `MESSAGING_PROVIDER`. O `MessagingService` não muda: as regras de agenda, dedupe e tentativas continuam as mesmas.
- **Biblioteca:** whatsapp-web.js 1.34.x (estável; usa o Chromium via Puppeteer). A alternativa Baileys ainda está em release candidate. A biblioteca fica isolada dentro do container `whatsapp`, então trocá-la depois não afeta o restante.
- **Comunicação interna:**
  - HTTP só dentro da rede do Compose (alias `fav-assist-whatsapp`).
  - Cada requisição leva uma assinatura HMAC-SHA256 com `WHATSAPP_INTERNAL_SECRET`, data/hora e um identificador único.
  - Requisições com mais de 5 minutos ou com identificador repetido são recusadas.
  - Nenhuma rota é publicada no domínio.
- **Sessão:**
  - Fica num volume próprio (`whatsapp-session`) e sobrevive a reinícios e reimplantações.
  - Nunca entra em log, backup do Git ou resposta da API.
- **QR code:**
  - Gerado sob demanda e entregue apenas ao administrador FAVIS, pela tela *Admin → WhatsApp* (via API autenticada).
  - Expira em 60 segundos e nunca é gravado em log.

## 3. Envio: controle de ritmo, fila e dedupe

| Proteção | Regra inicial (configurável) |
|---|---|
| Fila | BullMQ (já em uso); um envio por vez (`concurrency: 1`) |
| Ritmo | No máximo 1 mensagem a cada 10–20 s (intervalo aleatório) e 30 mensagens por hora no total |
| Por grupo | No máximo 6 mensagens por dia por grupo |
| Dedupe | `dedupe_key` (já existe: `daily:{grupo}:{data}`); a mesma chave nunca é enviada duas vezes |
| Tentativas | Até 3 (`MESSAGING_MAX_ATTEMPTS`), com espera crescente. Se a sessão cair, a fila pausa e não descarta nada |
| Chave geral | Envios desligados por padrão em `platform_settings`; o administrador liga e desliga no painel |
| Lista de grupos | Só grupos cadastrados e liberados por empresa. No modo `controlado`, só o grupo de teste da FAVIS |

Modos (`WHATSAPP_MODE`):
- `simulador`: o padrão de hoje; nada sai.
- `controlado`: só o grupo de teste da FAVIS.
- `ativo`: grupos liberados. Só depois de autorização.

## 4. Recebimento: assistente "FAV …"

- O serviço só processa mensagens de **grupos liberados** que **começam com "FAV"**. As outras são descartadas na hora, sem gravar.
- Comandos previstos: consultar as tarefas do dia, pedir orientação sobre uma tarefa e informar a conclusão.
- **Conclusão de tarefa sempre com confirmação:** o assistente responde "Confirma a conclusão de *X*? Responda FAV SIM". A mudança de status passa pela mesma regra da API (`changeActivityStatus`, máquina de estados e permissões), em nome do usuário vinculado ao número de quem escreveu.
- Respostas da IA seguem as mesmas proteções de hoje: não inventam preços, promoções nem resultados, e respeitam o teto de custo por empresa.

## 5. Recursos da VPS (Hostinger KVM 2: 2 vCPU, 8 GB, 100 GB NVMe)

> Os números abaixo são uma proposta inicial. **Antes de dimensionar, é preciso confirmar o uso real** (ver comando no fim desta seção).

| Serviço | Memória (limite) | CPU (limite) | Observação |
|---|---|---|---|
| whatsapp (Chromium) | **1 GB** (`WHATSAPP_MEM_LIMIT`) | **1.0** (`WHATSAPP_CPUS`) | Consumo típico de 400–700 MB; `shm_size: 512m` |
| api | sem limite hoje (≈ 150–300 MB) | — | Limite proposto numa etapa futura, com autorização |
| worker | sem limite hoje (≈ 150–250 MB) | — | Idem |
| redis + web (nginx) | ≈ 60 MB | — | — |
| Easypanel + Traefik + outro projeto (`gestao.caicosabores.com`) | a medir | — | Não alterar |

Garantias para não comprometer a aplicação principal:
- `mem_limit` e `cpus` no container `whatsapp`: ele nunca usa mais de 1 GB nem mais da metade da CPU.
- `oom_score_adj: 500`: se a VPS ficar sem memória, o sistema encerra o WhatsApp antes da API.
- `pids_limit: 512`, `restart: unless-stopped` e um *healthcheck* que reinicia o Chromium travado.
- `profiles: ["whatsapp"]`: o serviço **nem sobe** enquanto `COMPOSE_PROFILES=whatsapp` não estiver definido no Easypanel. Publicar o código não liga nada.

Esboço para o `docker-compose.easypanel.yml`. **Ainda não aplicado:** entra junto com o serviço, com autorização.

```yaml
  whatsapp:
    profiles: ['whatsapp']
    build: { context: ., target: whatsapp }
    restart: unless-stopped
    env_file: .env
    environment:
      WHATSAPP_MODE: ${WHATSAPP_MODE:-simulador}
    mem_limit: ${WHATSAPP_MEM_LIMIT:-1g}
    memswap_limit: ${WHATSAPP_MEM_LIMIT:-1g}
    cpus: ${WHATSAPP_CPUS:-1.0}
    pids_limit: 512
    shm_size: 512m
    oom_score_adj: 500
    volumes:
      - whatsapp-session:/app/.wwebjs_auth
    networks:
      default:
        aliases: [fav-assist-whatsapp]
```

Para confirmar os recursos reais, rode no terminal da VPS (Hostinger → VPS → Terminal do navegador). O comando só lê, não altera nada:

```bash
nproc; free -h; df -h /; docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"
```

## 6. Etapas e aprovações

1. **Simulação (aprovada):**
   - serviço, fila, assinatura interna e tela do QR em ambiente de desenvolvimento;
   - testes automatizados com um WhatsApp falso;
   - nenhuma conexão real.
2. **Publicação desligada (precisa de autorização):** o código vai para produção com `profiles` desativado, sem nenhum efeito.
3. **Grupo controlado da FAVIS (precisa de autorização):**
   - liga `COMPOSE_PROFILES=whatsapp` e `WHATSAPP_MODE=controlado`;
   - lê o QR com o número dedicado;
   - testa envio e comandos só nesse grupo.
4. **Clientes (precisa de autorização):** um grupo por vez, depois da mensagem de comunicação aos clientes.

## 7. Futuro: fotos e vídeos no Google Drive (segunda etapa)

O caminho já está preparado e não exige retrabalho:
- Os arquivos já são gravados como `{empresa}/{tarefa}/{arquivo}` (`apps/api/src/routes/activities.ts`), atrás da interface `FileStorage`. A cópia para o Drive mantém essa mesma árvore, com uma pasta por empresa.
- Proposta: uma tarefa agendada no worker (fila BullMQ que já existe), `storage-mirror`, que:
  - copia para o Drive só os arquivos novos;
  - usa uma conta de serviço do Google, com credencial apenas nas variáveis do Easypanel;
  - registra o que já foi copiado, para continuar de onde parou.
- Nenhuma mudança no banco ou nas telas é necessária agora.
