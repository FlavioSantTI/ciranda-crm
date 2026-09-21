---
title: Mapa de configuração — onde cada requisito odonto se resolve
parent: ../prd/07-prd-odonto-saas.md
version: 1.0
status: medido
date: 2026-09-10
owner: Flavio Santiago
medido_em: origin/main @ 6aee6564
---

# Mapa de configuração — onde cada requisito se resolve

> Resultado do estudo dirigido dos cinco módulos que sustentam o caso odontológico:
> `lib/agenda`, `lib/followup`, `lib/leads` (radar), `lib/agent-engine` e `lib/automation`.
>
> Cada linha aponta o mecanismo real, com caminho de arquivo. Onde algo **não existe**, está escrito.

---

## 1. Veredito em uma tela

Dos 8 requisitos funcionais do PRD, **6 se resolvem por configuração pura**, 1 por integração externa,
e **1 não tem mecanismo no produto**.

| RF | Requisito | Degrau | Situação |
|---|---|---|---|
| RF-01 | Funil odontológico | 1 — configurar | ✅ pacote `clinica` pronto |
| RF-02 | Vocabulário do nicho | 1 — configurar | ✅ por pipeline |
| RF-03 | Agenda por profissional | 1 — configurar | ✅ com uma ressalva (§4.3) |
| RF-04 | Agente de recepção | 1 — configurar | ✅ inclui skill `agendamento` de fábrica |
| **RF-05** | **Confirmação automática D-1** | **2 — integrar** | 🔴 **não existe disparador (§5)** |
| RF-06 | Recall e reativação | 1 — configurar | ✅ com aprovação humana obrigatória |
| RF-07 | Captação | 1 — configurar | ✅ |
| RF-08 | Espelho no Clinicorp | 2 — integrar | ✅ via n8n |

---

## 2. RF-01 e RF-02 — funil e vocabulário

**Pacote pronto:** `lib/onboarding/pacotes-de-funil.ts`, `id: "clinica"`.

**Etapas configuráveis pela tela:** `/app/settings/tenant/pipelines`
(`app/app/settings/tenant/pipelines/_stages.tsx`).

**Campos personalizados** definidos em `crm_pipelines.settings.fields[]`, com 10 tipos disponíveis:
`text`, `textarea`, `number`, `date`, `select`, `multiselect`, `boolean`, `email`, `phone`, `url`
(`lib/schemas/settings.ts`, editor em `components/contacts/CustomFieldsEditor.tsx`).

Valores gravados em `contacts.custom_fields` (JSONB, migration `0211`), com trigger de limpeza na
anonimização — `trg_contacts_anonimizado_limpa_custom_fields`. **Isso importa para LGPD:** campo
personalizado é apagado junto quando o titular exerce o direito.

> ⚠️ **`expected_duration_hours` de cada etapa não tem tela.** A coluna existe em `crm_stages` e é ela que
> alimenta o Radar de risco (§6). Hoje só se configura por SQL. Sem ajustar, todo estágio usa o fallback de
> **24h para "em risco" e 72h para "crítico"** (`lib/leads/risk-radar.ts`). Para odontologia isso é curto
> demais em etapas de decisão de tratamento caro.

---

## 3. RF-04 — agente de recepção

**Editor:** `/app/ai/agents/[id]` (`AgentForm.tsx`) — prompt, modelo, credencial, canal, tools, gatilhos de
handoff, bases de RAG, funis, operador, segurança e publicação.

### RAG — como sobe o conhecimento da clínica

Tela `/app/ai/knowledge/sources`. Tipos aceitos (`lib/ai/rag/tipos-de-fonte.ts`):

| Tipo | Como |
|---|---|
| `faq` | texto colado no formato `## Pergunta:` / `## Resposta:` |
| `documento` | upload de PDF, `.md` ou `.txt`, ou texto colado |
| `conversas` | automático — conversas resolvidas viram conhecimento |
| `catalogo` | automático — só Nuvemshop |

Para a clínica: tabela de procedimentos e preços, convênios aceitos, endereço e estacionamento,
horários, política de remarcação e de falta. **A indexação exige credencial de OpenAI configurada.**

### Skills de fábrica

Migration `0069_seed_platform_skills` traz **duas**, e uma delas é nossa:

- `objecao-preco` — playbook de objeção de preço no WhatsApp.
- **`agendamento` — playbook de marcar e remarcar horário, escrito para clínicas e serviços.**

Não há editor inline de skill: instala-se do catálogo ou importa-se um `.zip`
(`POST /api/v1/ai/skills/import`).

### Tools de agenda que o agente opera

Pacote `vender`, em `lib/mcp/tools/agendamento.ts`:

`crm_list_event_types` · `crm_find_free_slots` · `crm_list_appointments` · `crm_book_appointment` ·
`crm_reschedule_appointment` · `crm_confirm_appointment` · `crm_set_appointment_outcome` ·
`crm_cancel_appointment`

> `crm_cancel_appointment` é classificada como risco **crítico** e **não vem ligada** por pacote.
> Para odontologia, mantenha assim: cancelar consulta é decisão da recepção.

### Handoff IA → humano

O que é configurável **pela tela**, no `AgentForm`: palavras-chave de pedido de humano
(`HandoffKeywordsInput`) e o toggle da tool de handoff.

O que **não tem tela**: limiar de sentimento (`sentiment_threshold`), limiar de confiança
(`confidence_threshold`) e `crm_stages.requires_human` — todos existem no banco, configuráveis por SQL.

Gatilhos fixos, não configuráveis: menção jurídica e menção a reembolso (`lib/ai/handoff/triggers.ts`).

**Para odontologia, o handoff obrigatório é por palavra-chave:** dor, sangramento, inchaço, urgência,
quebrou, caiu. Configure na primeira semana.

### Teto de gasto

`/app/ai/usage` → `BudgetCard`. Tabela `ai_budgets`, em **centavos de dólar**, não em reais.

Três modos: `off`, `avisar`, `bloquear`. No modo `bloquear`, ao estourar, a IA para e as conversas vão para
fila humana com handoff `orcamento_de_ia` — **e a IA não retoma sozinha**, exige clique de "Devolver ao
automático" por conversa (`lib/escalacao/retomada.ts`).

> Para SaaS: `avisar` no piloto, `bloquear` quando houver mais de uma clínica. Uma clínica que estoure o
> teto não pode consumir a margem das outras.

---

## 4. RF-03 — a agenda, em detalhe

### 4.1 O modelo

Tabela `calendar_appointments` (migration `0177`). Campos que importam para a clínica:
`starts_at`/`ends_at`, `status`, `owner_user_id` (o dentista), `contact_id`, `event_type_id`,
`location_kind`, `created_by_kind` e `source`.

**Não há coluna `lead_id`.** O vínculo com o negócio é polimórfico, em `crm_lead_links` com
`target_kind = 'appointment'`.

### 4.2 Procedimento = tipo de agendamento

`calendar_event_types` é onde cada procedimento vira um molde com duração própria:

| Coluna | Uso odontológico |
|---|---|
| `duration_minutes` | 30 para avaliação, 60 para restauração, 90 para endodontia… |
| `buffer_before_minutes` / `buffer_after_minutes` | **tempo de esterilização e limpeza entre pacientes** |
| `minimum_notice_minutes` | antecedência mínima para marcar |
| `booking_window_days` | quanto tempo à frente a agenda abre |
| `slot_interval_minutes` | granularidade da grade |
| `category` | `consulta`, `procedimento`, `retorno`, `orcamento` |

> ⚠️ **A tela só expõe `name`, `category`, `duration_minutes`, `location_kind` e o dono padrão.**
> Buffers, antecedência e janela existem na API (`app/api/v1/agenda/tipos/route.ts`) mas **não na tela de
> configuração**. Configure-os por `PATCH` na API.
>
> Para odontologia o buffer não é detalhe: sem ele a agenda marca pacientes colados e a clínica atrasa o dia
> inteiro a partir das 10h.

### 4.3 🔴 A ressalva: não existe cadeira nem sala

**`NÃO EXISTE` entidade de recurso.** Não há tabela `calendar_resources`, e o conflito de horário é
calculado **por `owner_user_id`** — ou seja, por profissional.

`lib/agenda/locais.ts` trata `location_kind` (presencial, telefone, vídeo…) e um texto livre
`location_details` do tipo `"Presencial · Consultório 3"`. **É rótulo, não alocação com conflito.**

Consequências práticas:

- Clínica onde cada dentista tem sua cadeira fixa: **funciona sem ajuste**, porque profissional e cadeira
  são a mesma restrição.
- Clínica com mais dentistas do que cadeiras: **a agenda vai permitir overbooking de cadeira.** O produto
  não sabe que duas consultas simultâneas de dentistas diferentes disputam o mesmo equipamento.

**Recomendação:** trate como critério de qualificação comercial. Clínica com cadeira compartilhada não é o
perfil do piloto. Se virar exigência recorrente, é candidata a contribuição upstream — e não a gambiarra de
cadastrar cadeira como membro da equipe, que quebraria RBAC, métricas por atendente e fila de atendimento.

### 4.4 Jornada de trabalho

**Por profissional, não por organização.** Coluna `attendant_availability.schedule` (JSONB com `timezone` e
`windows[{dow, start, end}]`), configurada em **Equipe** (`app/app/team/_components/AttendantsClient.tsx`)
— não na tela de agenda.

Exceções por data (feriado, sábado excepcional) em `calendar_availability_exceptions`.

> ⚠️ **Armadilha medida:** para o roteamento de atendimento, `windows` vazio significa 24/7. Para a agenda,
> `windows` vazio significa **zero horários livres**. Um dentista cadastrado sem jornada simplesmente não
> aparece com horário nenhum, e a tela não explica isso.

### 4.5 O que conta como horário ocupado

`lib/agenda/ocupados.ts`:

- Agendamentos com status **fora** de `cancelled` e `no_show` — ou seja, `pending`, `confirmed` e
  `completed` ocupam.
- Eventos externos do Google com `transparency = 'opaque'`.
- Exceções de indisponibilidade.
- **Regra fina, e correta:** um Google Calendar com token expirado **continua contando como ocupado**. Só
  para de contar quando um humano desconecta. O comentário do código explica: fonte que não responde é pior
  que fonte nenhuma — não contar ofereceria um horário que na verdade está tomado.

### 4.6 Não existe auto-agendamento público

O vocabulário `ORIGENS_DO_AGENDAMENTO` inclui `public_page`, e o CHECK do banco o aceita. **Mas não existe
rota pública.** A própria migration `0177` registra: "auto-agendamento ficou fora do escopo".

Para a clínica isso não é bloqueio — o canal é o WhatsApp, e o agente de IA marca. Mas **não prometa link
de agendamento no site**.

---

## 5. 🔴 RF-05 — a lacuna real: não existe lembrete de consulta

**Este é o achado mais importante do estudo, e ele contraria o que o PRD assumia.**

### O que foi medido

1. `calendar_event_types` tem `reminder_enabled` e `reminder_minutes_before`.
2. **Ambas têm zero leitores** fora de `database.types.ts`.
3. **Não existe cron de lembrete.** Os 15 crons do `docker/scheduler/entrypoint.sh` são: `agent-dispatcher`,
   `followup-flow-worker`, `event-log-drain`, `routing-worker`, `recover-stuck-messages`,
   `storage-redaction`, `snooze-watcher`, `attendant-heartbeat`, `webhook-log-retention`, `channel-health`,
   `contact-avatars`, `agenda-google-refresh`, `agenda-google-sync`, `agenda-google-push` e `risk-watcher`.
   **Nenhum é de lembrete.**
4. Os gatilhos de automação são apenas cinco, e **nenhum é de agendamento**:
   `lead.created`, `lead.stage_changed`, `message.received`, `lead.tag_added`, `contact.tag_added`
   (`lib/schemas/webhooks.ts`, `TRIGGER_EVENTS`).

A migration `0194_lembrete_nasce_desligado` confirma, com todas as letras: *"o `scheduler` do compose não
tem cron de lembrete nenhum"*. Ela existe justamente para desligar o default antes que um disparador nasça
e inscreva todo o histórico sem ninguém ter escolhido.

### Por que isso é grave para odontologia

Confirmação em D-1 é **o principal redutor de falta** numa clínica. Era o RF-05 do PRD e não tem mecanismo.

### As duas saídas

**Agora, para o piloto — degrau 2, fora do core:**
n8n com agendamento diário, lendo `GET /api/v1/agenda/agendamentos` (a rota existe) por token de API, e
enviando a confirmação pelo próprio CRM. Zero divergência de código, funciona na semana 1.

**Depois — degrau 3, contribuição upstream:**
O schema já está pronto e esperando o disparador; a migration `0194` praticamente convida quem escrever o
cron. É a contribuição de maior valor que este projeto pode fazer ao upstream, porque serve todo o vertical
de clínicas — que é justamente o público que a comunidade trouxe.

### O que existe, e é vizinho mas não substitui

Migration `0224_presenca_e_recuperacao` trouxe `confirmation_next_at` e a config
`organizations.settings.agenda` com `confirmation_delay_minutes` e `unknown_protection_minutes`, ajustáveis
em `/app/settings/tenant/agenda`. **Isso trata do DEPOIS da consulta** — confirmar se o paciente compareceu.
Não é o lembrete de antes.

E existe o gatilho de follow-up `appointment_no_show`, que dispara **após** a equipe marcar a falta. Ou seja:
o produto sabe recuperar quem faltou, mas não sabe evitar que falte.

---

## 6. RF-06 — recall e reativação

### O Radar de risco

`lib/leads/risk-radar.ts`, função `classifyRisk()`. Quatro estados:

| Bucket | Quando |
|---|---|
| `em_dia` | silêncio abaixo da janela do estágio |
| `em_voo` | há follow-up agendado **ou** a agenda está protegendo (tem consulta marcada) |
| `em_risco` | silêncio ≥ `expected_duration_hours` do estágio (fallback 24h) |
| `critico` | silêncio ≥ 3× a janela (fallback 72h), ou presença vencida sem confirmação |

Persistido em `crm_lead_risk_states` pelo cron `risk-watcher`, a cada 15 minutos.
Tela em `/app/radar`, com ação de assumir a conversa.

### A reativação exige clique humano — por desenho

O worker cria uma proposta em `crm_lead_reactivations` com `status='pending'`. Ela aparece no Kanban
(`components/kanban/ReactivationSlot.tsx`) com **Retomar** ou **Encerrar**. Só ao aceitar é que um
`followup_turn` é agendado. Se ninguém decidir até `expires_at`, vira item na central de avisos.

**`NÃO EXISTE` envio de reativação sem aprovação humana.** Para uma clínica isso é vantagem, não limitação:
mensagem automática para paciente que sumiu é exatamente o tipo de disparo que precisa de olho humano.

### Follow-up: os gatilhos que servem ao recall

`lib/followup/api-schemas.ts`, `triggerConfigSchema`:

| Gatilho | Uso odontológico |
|---|---|
| `silence` | orçamento enviado e paciente sumiu (`threshold_minutes`, 5 a 10080) |
| `stage_change` | entrou em "Orçamento enviado" → sequência de acompanhamento |
| `appointment_no_show` | **recuperação de falta** — pode filtrar por `event_type_ids` |
| `case_opened` | quando o agente pede ajuda humana |
| `manual` | recall de profilaxia disparado pela recepção |
| `webhook` | recall semestral disparado pelo n8n |

Builder visual em `/app/ai/followups/[id]`. Nós disponíveis: `wait`, `condition`, `ai_classify`,
`match_reply`, `repeat`, `action`, `end`.

**Tempo adaptativo:** um nó `wait` com `mode: 'smart'` deixa a IA escolher a hora do próximo contato, dentro
de um `min_ms`/`max_ms` que você define — e a escolha é sempre clampada ao intervalo
(`lib/followup/timing-plan.ts`). Plano ausente ou inválido cai no `max_ms`, nunca em envio imediato.

> `conversation_end` aparece no schema mas **não tem produtor** — é recusado na publicação. Não conte com ele.

### A proteção que evita o pior erro

`lib/agenda/protecao-followup.ts` — nenhuma mensagem de cobrança sai para quem tem consulta `pending` ou
`confirmed`. A proteção opera **por `contact_id`**, e é consumida por todos os caminhos de envio proativo:
sweep de silêncio, motor de follow-up, automações de WhatsApp, radar de risco e o agent worker.

Se a leitura falhar, o sistema **adia** em vez de enviar. Falha fechada, do lado certo.

---

## 7. RF-07 — captação

`POST /api/v1/webhooks/in/<token>`, aceitando JSON ou `application/x-www-form-urlencoded`.
Assinatura HMAC-SHA256 opcional no header `X-Deskcomm-Signature`.

Reconhece aliases em português: `nome`, `telefone`, `whatsapp`, `email`. Telefone é normalizado para E.164
brasileiro. Chaves desconhecidas vão para `custom_fields`; `utm_*` vai para `source_metadata`.
`external_id` dá idempotência.

Gestão em `/app/webhooks`, aba "Receber dados".

### As automações que sobem em cima

**Condições** são simples e vale saber o limite: `{ field, op, value }` com `op` em `eq`, `neq`, `contains`,
combinadas apenas por **AND** (`lib/automation/conditions.ts`). Campo ausente é falso, nunca erro.

Campos personalizados **funcionam em condição**, mas só pelo modo avançado, com o caminho completo:
`contact.custom_fields.convenio`.

**Ações** disponíveis: `create_or_move_lead`, `send_whatsapp_message`, `send_ai_message`, `add_tag`,
`assign_owner`, `call_webhook`, `start_message_flow`.

`call_webhook` é a saída para o Clinicorp: POST com `X-Deskcomm-Event`, HMAC opcional, 3 tentativas
(1s e 5s), com guarda anti-SSRF. O payload projeta apenas campos públicos de lead e contato — não vaza
`organization_id` nem PII sensível.

---

## 8. Configurações que só existem por SQL

Registro consolidado do que **não tem tela** e precisa entrar no runbook de onboarding de clínica:

| O quê | Onde | Por que importa na odontologia |
|---|---|---|
| `crm_stages.expected_duration_hours` | SQL | define o Radar; 24h padrão é curto para decisão de tratamento |
| `crm_stages.requires_human` | SQL | força handoff em etapa sensível |
| `calendar_event_types.buffer_*` | API `PATCH /api/v1/agenda/tipos` | esterilização entre pacientes |
| `calendar_event_types.minimum_notice_minutes` | API | evita marcação para daqui a 10 minutos |
| `calendar_event_types.booking_window_days` | API | limita a agenda futura |
| `ai_agents.config.sentiment_threshold` | SQL | handoff por paciente irritado |

---

## 9. Consequências para o PRD

1. **RF-05 muda de degrau 1 para degrau 2.** O lembrete de consulta não é configuração: é integração via
   n8n no piloto, e candidata a contribuição upstream depois. Foi o único requisito que o estudo derrubou.
2. **Cadeira compartilhada vira critério de qualificação comercial** (§4.3), não requisito de produto.
3. **O runbook de onboarding precisa de uma seção de SQL** (§8), porque seis ajustes relevantes não têm tela.
4. **Duas armadilhas entram no runbook:** dentista sem jornada não gera horário nenhum (§4.4), e copiar o
   `.env.example` quebra a suíte de testes (ver `00-estado-do-ambiente.md` §3).
