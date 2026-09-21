---
title: Camada odonto — configuração replicável por clínica
parent: ../prd/07-prd-odonto-saas.md
version: 1.0
status: pronto para executar
date: 2026-09-10
owner: Flavio Santiago
---

# Camada odonto — configuração replicável por clínica

> A Fase 2 do PRD entrega isto: **um roteiro de configuração que a segunda clínica consome em horas, não em
> dias.** Zero código. Tudo o que está aqui é campo de tela, chamada de API ou SQL nomeado.
>
> O que é específico da instalação (VPS, Supabase, WhatsApp) está no
> [`03-runbook-piloto.md`](03-runbook-piloto.md). Aqui é só o que se repete a cada clínica nova.

---

## 1. Campos personalizados do paciente

### O que são, e o limite que precisa ser respeitado

Definidos em `crm_pipelines.settings.fields[]`, editados em `/app/settings/tenant/pipelines`, e gravados em
`contacts.custom_fields` (JSONB). Dez tipos disponíveis: `text`, `textarea`, `number`, `date`, `select`,
`multiselect`, `boolean`, `email`, `phone`, `url`.

> 🔴 **A regra que não pode ser quebrada: campo personalizado não é prontuário.**
>
> O escopo do PRD é comercial. Um campo "queixa" com texto livre vira, na prática, anamnese sem nenhuma das
> garantias que anamnese exige. A régua para decidir se um campo entra:
>
> **"Isso a recepcionista precisa saber para agendar e orçar, ou é o dentista que precisa para tratar?"**
>
> Se for a segunda, o lugar é o Clinicorp.

A favor: a anonimização de LGPD **limpa os campos personalizados em cascata**, pelo trigger
`trg_contacts_anonimizado_limpa_custom_fields`. O produto trata esse dado com o mesmo cuidado do resto.

### O conjunto recomendado

| Campo | Chave | Tipo | Para quê |
|---|---|---|---|
| Como conheceu a clínica | `origem` | `select` | atribuição de marketing |
| Convênio | `convenio` | `select` | qualificação — a clínica atende? |
| Primeira vez | `primeira_vez` | `boolean` | muda a duração da consulta e o roteiro da IA |
| Procedimento de interesse | `procedimento_interesse` | `multiselect` | direciona a oferta e o orçamento |
| Faixa de orçamento aceita | `faixa_orcamento` | `select` | prioriza o retorno da recepção |
| Preferência de horário | `preferencia_horario` | `select` | manhã, tarde, sábado |
| Data da última consulta | `ultima_consulta` | `date` | **motor do recall de profilaxia** |
| Autoriza contato por WhatsApp | `consente_whatsapp` | `boolean` | trilha de consentimento LGPD |

**Valores sugeridos para os `select`:**

- `origem`: Indicação, Google, Instagram, Fachada, Convênio, Já era paciente
- `convenio`: Particular, Amil Dental, Bradesco Dental, SulAmérica, Odontoprev, Outro
- `procedimento_interesse`: Limpeza, Clareamento, Ortodontia, Implante, Prótese, Endodontia, Urgência
- `faixa_orcamento`: até R$ 500, R$ 500–2.000, R$ 2.000–10.000, acima de R$ 10.000
- `preferencia_horario`: Manhã, Tarde, Sábado, Qualquer

### Usar em condição de automação

Funciona, **mas só pelo modo avançado**, com o caminho completo. A lista curada da tela não inclui campos
personalizados.

```
contact.custom_fields.convenio      eq        Particular
contact.custom_fields.primeira_vez  eq        true
```

Operadores disponíveis: `eq`, `neq`, `contains`. Combinação apenas por **E** — não existe OU.
Campo ausente é avaliado como falso, nunca como erro.

---

## 2. Taxonomia de tags

Tags são o que dispara automação (`lead.tag_added`, `contact.tag_added`), então valem mais como gatilho do
que como etiqueta. Mantenha poucas e com prefixo, senão viram lixo em três meses.

| Tag | Quem aplica | O que dispara |
|---|---|---|
| `urgencia` | IA por palavra-chave, ou recepção | handoff imediato + prioridade |
| `orcamento-enviado` | recepção | inicia o fluxo de acompanhamento de orçamento |
| `orcamento-aceito` | recepção | encerra acompanhamento |
| `nao-atendemos-convenio` | recepção | encerra o lead com motivo registrado |
| `recall-6m` | n8n | entra na fila de profilaxia semestral |
| `faltou` | recepção | dispara recuperação de falta |
| `vip` | manual | prioridade na fila |

---

## 3. Automações

### O limite, dito antes de você desenhar

São **cinco gatilhos**, e nenhum é de agendamento:

`lead.created` · `lead.stage_changed` · `message.received` · `lead.tag_added` · `contact.tag_added`

**Tudo que dependa de data de consulta — lembrete, confirmação, recall por tempo — sai do n8n, não daqui.**

Ações disponíveis: `create_or_move_lead`, `send_whatsapp_message`, `send_ai_message`, `add_tag`,
`assign_owner`, `call_webhook`, `start_message_flow`.

> Toda automação **nasce pausada**. Revise e ligue de propósito.

### As cinco que toda clínica usa

**A-01 · Lead do site entra no funil**
QUANDO `lead.created` · SE `lead.source_metadata.utm_source` contém `site`
ENTÃO `create_or_move_lead` para "Novo contato" + `assign_owner` para a fila da recepção.

**A-02 · Urgência não espera**
QUANDO `contact.tag_added` · SE `event.added_tags` contém `urgencia`
ENTÃO `assign_owner` para a recepção + `send_whatsapp_message` avisando que um humano já vai atender.

**A-03 · Convênio não atendido, resposta honesta e rápida**
QUANDO `lead.created` · SE `contact.custom_fields.convenio` igual a um que a clínica não aceita
ENTÃO `add_tag: nao-atendemos-convenio` + `send_ai_message` explicando e oferecendo o particular.

Melhor dizer não em 2 minutos do que sumir. E o lead fica registrado com motivo.

**A-04 · Orçamento enviado inicia acompanhamento**
QUANDO `lead.tag_added` · SE `event.added_tags` contém `orcamento-enviado`
ENTÃO `start_message_flow` apontando para o fluxo F-01 (§4).

**A-05 · Espelho no Clinicorp**
QUANDO `lead.stage_changed` · SE `event.to_stage_id` = etapa "Consulta marcada"
ENTÃO `call_webhook` para o n8n.

O payload traz `event`, `occurred_at` e `data` com lead e contato projetados em campos públicos — sem
`organization_id` e sem PII sensível. Configure o `secret` para receber `X-Deskcomm-Signature`
(HMAC-SHA256) e **valide no n8n**. Três tentativas automáticas, com 1s e 5s de intervalo, e guarda
anti-SSRF no destino.

---

## 4. Fluxos de follow-up

Builder visual em `/app/ai/followups/[id]`. Nós: `wait`, `condition`, `ai_classify`, `match_reply`,
`repeat`, `action`, `end`.

Em todo fluxo, marque `cancel_on_reply` — o paciente que respondeu não deve receber a próxima cobrança.
E lembre que **nenhum destes envia para quem tem consulta marcada**: a proteção de agenda bloqueia antes.

### F-01 · Orçamento parado

Gatilho `stage_change` na etapa "Orçamento enviado", ou `webhook` vindo da automação A-04.

```
[trigger]
  → [wait  smart  min 24h  max 48h]
      guidance: "Retomar em horário comercial, evitar segunda de manhã"
  → [action ai_message] "Retomar o orçamento sem pressionar; oferecer tirar dúvida"
  → [match_reply] respondeu? → [end converted]
  → [wait  smart  min 3d  max 5d]
  → [action ai_message] "Perguntar se houve dúvida sobre valor ou parcelamento"
  → [match_reply] respondeu? → [end converted]
  → [wait fixed 7d]
  → [action text] "Última mensagem, deixando a porta aberta"
  → [end exhausted]
```

O `wait` em modo `smart` deixa a IA escolher a hora dentro do intervalo que você definiu. A escolha é sempre
limitada ao `min`/`max`; se o plano falhar, cai no `max` — nunca em envio imediato.

### F-02 · Recuperação de falta

Gatilho `appointment_no_show`. Dispara **depois** que a recepção marca a falta — não automaticamente.
Pode filtrar por `event_type_ids` para tratar falta em avaliação diferente de falta em procedimento.

```
[trigger]
  → [wait fixed 2h]
  → [action ai_message] "Sentimos sua falta hoje; quer remarcar?"
  → [match_reply] quer remarcar? → [action] passa para a IA marcar → [end converted]
  → [wait fixed 3d]
  → [action text] "Oferecer dois horários concretos"
  → [end exhausted]
```

Falta em procedimento caro merece ligação da recepção, não mensagem. Use `condition` no
`event_type_id` para separar.

### F-03 · Recall de profilaxia semestral

Gatilho `manual` ou `webhook`. **A data vem do n8n**, porque o produto não tem gatilho por data.

```
[trigger]
  → [action ai_message] "Faz seis meses desde a última limpeza; quer agendar?"
  → [match_reply] quer? → IA marca → [end converted]
  → [wait fixed 15d]
  → [action text] "Segunda tentativa, com horário sugerido"
  → [end exhausted]
```

**Este é o fluxo que mais paga o CRM numa clínica.** Base de pacientes inativos é o ativo mais desperdiçado
do setor, e o motor já existe pronto.

### O Radar e a reativação

O cron `risk-watcher` roda a cada 15 minutos e classifica cada negócio aberto em `em_dia`, `em_voo`,
`em_risco` ou `critico`. A tela `/app/radar` mostra a fila para a recepção.

Quando um lead esfria, o sistema cria uma **proposta de reativação** que aparece no Kanban com "Retomar" ou
"Encerrar". **Nada é enviado sem clique humano** — e isso é desenho, não limitação. Para paciente que sumiu,
mensagem automática sem revisão é o caminho mais curto para o bloqueio no WhatsApp.

Ajuste as janelas por etapa via SQL (`crm_stages.expected_duration_hours`), conforme
[`03-runbook-piloto.md`](03-runbook-piloto.md) §4.5. Sem ajustar, tudo esfria em 24h.

---

## 5. Prompt do agente de recepção

Ponto de partida para colar em `/app/ai/agents/[id]`. Ajuste o nome e o tom com a clínica.

```
Você é o atendimento da {NOME_DA_CLINICA}, uma clínica odontológica em {CIDADE}.
Fala por WhatsApp, em português do Brasil, com tom acolhedor e direto. Frases curtas.

O QUE VOCÊ FAZ
- Responde dúvidas sobre procedimentos, preços, convênios, endereço e horários,
  SEMPRE consultando a base de conhecimento. Nunca invente valor.
- Entende o que a pessoa precisa e oferece horários reais da agenda.
- Marca, confirma e remarca consultas.

O QUE VOCÊ NUNCA FAZ
- Não dá diagnóstico, não indica tratamento, não avalia caso clínico.
  Se perguntarem "será que preciso de canal?", responda que só o dentista
  avalia, e ofereça a consulta de avaliação.
- Não promete resultado de tratamento.
- Não negocia desconto. Encaminhe para a recepção.
- Não cancela consulta. Encaminhe para a recepção.

PASSE PARA UM HUMANO IMEDIATAMENTE
- Qualquer menção a dor, sangramento, inchaço, trauma, queda ou acidente.
- Reclamação, insatisfação com tratamento, menção a advogado ou processo.
- Pedido explícito de falar com uma pessoa.
Nesses casos, diga que já vai chamar alguém da equipe e pare de responder.

COMO AGENDAR
1. Pergunte o que a pessoa precisa e se é a primeira vez na clínica.
2. Escolha o tipo de agendamento certo — primeira vez é sempre "Avaliação inicial".
3. Consulte horários livres e ofereça no máximo três opções.
4. Confirme nome completo e o horário escolhido antes de marcar.
5. Depois de marcar, informe endereço, o que trazer e a política de remarcação.

SE NÃO SOUBER
Diga que vai confirmar com a equipe e passe para um humano.
Nunca preencha lacuna com suposição — em saúde, chute é dano.
```

---

## 6. Checklist de onboarding de uma clínica nova

Roteiro de conferência. A instalação já existe; isto é só a organização nova.

**Organização**
- [ ] Organização criada, com **razão social correta** *(sai no relatório de LGPD, e nasce igual ao nome fantasia)*
- [ ] Marca da clínica em `/app/settings/marca`
- [ ] Encarregado (DPO) da clínica registrado
- [ ] DPA assinado

**Funil e campos**
- [ ] Pacote `clinica` instanciado e etapas renomeadas
- [ ] Motivos de perda cadastrados
- [ ] Campos personalizados do §1 criados
- [ ] `expected_duration_hours` ajustado por etapa (SQL)

**Agenda**
- [ ] Dentistas cadastrados **com jornada** — sem ela, zero horários
- [ ] Exceções: feriados e sábados
- [ ] Tipos de agendamento criados com duração real
- [ ] Buffers e antecedência configurados via API
- [ ] Google Calendar conectado, se a clínica usa

**IA**
- [ ] Base de conhecimento com procedimentos, preços, convênios, endereço e políticas
- [ ] Skill `agendamento` instalada
- [ ] Tools de agenda ligadas, **`crm_cancel_appointment` desligada**
- [ ] Palavras-chave de handoff cadastradas
- [ ] Prompt do §5 adaptado
- [ ] Teto de gasto configurado *(em centavos de dólar)*

**Automação**
- [ ] A-01 a A-05 criadas e **ligadas** — nascem pausadas
- [ ] F-01, F-02 e F-03 publicados
- [ ] Fluxo de confirmação D-1 no n8n ativo

**Canal**
- [ ] Número pareado por QR
- [ ] **Medição do WAHA feita e abaixo de 60% do teto**
- [ ] Os 8 passos do ensaio do piloto refeitos nesta clínica

**Operação**
- [ ] Recepção treinada em Inbox, Agenda e Radar
- [ ] Combinado quem responde o handoff, e em quanto tempo
