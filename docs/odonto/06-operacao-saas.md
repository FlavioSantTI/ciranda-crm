---
title: Operação SaaS — cobrança, LGPD, backup e incidente
parent: ../prd/07-prd-odonto-saas.md
version: 1.0
status: pronto para executar
date: 2026-09-10
owner: Flavio Santiago
---

# Operação SaaS — o que o produto não faz por você

> O DeskcommCRM foi desenhado para **self-host de dono único**. No modelo SaaS, o dono da instalação e o
> dono do negócio são pessoas diferentes — e cinco responsabilidades passam a ser suas, não do software.
>
> Nada aqui é opcional antes da segunda clínica.

---

## 1. Cobrança

### O que existe, e o que não existe

`app/app/settings/billing/page.tsx` é um **placeholder**: renderiza *"Em breve — Fase 2"* e *"Billing entra
na Fase 2 do roadmap"*. É admin-only e tem porta de primeira classe no menu. Não há assinatura, fatura,
plano nem gateway.

**O que existe, e é o que importa:** suspensão de organização como capacidade de primeira classe.

| Rota | O que faz |
|---|---|
| `POST /api/v1/admin/tenants/{id}/suspend` | `status='suspended'`, com `suspended_at`, `suspended_reason` e `suspended_by`. Exige admin de plataforma **com MFA AAL2**. Grava auditoria e evento de domínio. 409 se já suspensa. |
| `POST /api/v1/admin/tenants/{id}/reactivate` | volta ao ar |
| `GET /api/v1/admin/tenants/{id}/health` | saúde da organização |
| `GET /api/v1/admin/usage` | consumo por organização |

Telas correspondentes em `/admin/tenants`, `/admin/usage`, `/admin/dashboard`.

### A decisão

**Cobrança fora do produto. Asaas ou Iugu, com boleto e Pix, que é como clínica brasileira paga.**

Não construa billing no core. É o degrau 4 mais caro possível, o upstream já o tem no próprio roadmap, e
uma tela de fatura mal-feita não convence ninguém — enquanto o Asaas já resolve nota fiscal, régua de
cobrança e conciliação.

### O ciclo

```
Contrato assinado
  → cria a assinatura no Asaas (mensal, Pix ou boleto)
  → cria a organização no CRM
  → onboarding (checklist do documento 04)

Inadimplência
  → D+3   lembrete automático do Asaas
  → D+7   contato humano — sempre. Clínica que atrasou geralmente esqueceu.
  → D+15  aviso formal de suspensão, por escrito, com data
  → D+20  POST /suspend, com o motivo escrito no campo `reason`
  → pagou → POST /reactivate
```

> ⚠️ **Suspender é operação com consequência clínica.** A clínica perde o WhatsApp de atendimento; paciente
> com dor manda mensagem e ninguém vê. **Nunca suspenda sem aviso escrito com data.** Preencha o `reason` —
> ele fica na auditoria e é o que responde "por que fizeram isso comigo" seis meses depois.

### Preço: use o dado, não o palpite

O teto de gasto de IA por organização já existe (`ai_budgets`), e `/admin/usage` mostra o consumo real.
Rode o piloto em modo `avisar` por 30 dias, meça, e só então feche o preço.

Os componentes de custo por clínica:

| Componente | Como medir |
|---|---|
| IA | `/admin/usage`, em **centavos de dólar** |
| Fatia da VPS | custo da VPS ÷ nº de clínicas |
| Supabase | quando passar do plano grátis |
| WhatsApp | **zero** — WAHA Core é gratuito desde 2026.6.1 |
| Seu tempo de suporte | o maior de todos, e o único que ninguém mede |

---

## 2. LGPD — você virou operador

### A mudança de papel

| Papel | Quem | O quê |
|---|---|---|
| **Controladora** | cada clínica | decide por que e como tratar o dado do paciente |
| **Operador** | **você** | trata o dado por conta dela |

Isso não é formalidade. Como operador, você responde solidariamente quando descumpre a lei ou as instruções
da controladora (art. 42 da LGPD).

**E o dado é sensível.** "Quero avaliar um implante" é dado referente à saúde, categoria especial do art. 11
— mesmo no escopo comercial. Tratar como se fosse só dado de vendas é o erro que este parágrafo existe para
impedir.

### O que o produto já resolve

Export e redact por workers, anonimização em cascata (inclusive dos campos personalizados), consentimento
auditado, audit log append-only com retenção de 5 anos, cron `lgpd-sla-watcher`, RLS em toda tabela
tenant-aware com teste de isolamento como gate de CI, e as telas `/admin/lgpd` e `/admin/incidents`.

### O que é seu, e não do software

**1. DPA com cada clínica, assinado antes da instalação.** Precisa nomear:

- a finalidade do tratamento (jornada comercial — **não** prontuário)
- as categorias de dado, dizendo com todas as letras que há dado de saúde
- os subprocessadores: **Supabase**, o provedor da **VPS**, o provedor de **IA**, a **Resend** e o **n8n**
- as medidas de segurança
- o que acontece no fim do contrato: prazo de devolução e de eliminação
- o dever de notificar incidente, e em quanto tempo

**2. Confira a razão social de cada organização.** Configurações → Empresa.

> O relatório de LGPD do titular é o único artefato que **deliberadamente não leva marca nenhuma** — ele
> nomeia o controlador, que é a clínica. E a razão social **nasce igual ao nome fantasia**, porque é o que
> o instalador tem para dar. Nome fantasia impresso como razão social num documento jurídico é o erro que
> só aparece quando alguém reclama. Corrija na primeira semana de cada clínica.

**3. Encarregado (DPO) declarado por clínica.** É quem o relatório nomeia. Peça no onboarding.

**4. Transferência internacional.** Se o Supabase, o provedor de IA ou a VPS estiverem fora do Brasil, a
Resolução CD/ANPD nº 19/2024 exige cláusulas-padrão contratuais. **Hospedando tudo no Brasil, a exigência
não incide** — e é essa a diferença que vira argumento de venda.

> ⚠️ **Nunca diga "servidor no Brasil = conformidade com a LGPD".** É falso, e um advogado desmonta na
> primeira pergunta. Conformidade depende de base legal, finalidade, segurança e direitos do titular.
> O argumento defensável é só o de cima: sem transferência internacional, sem o artefato contratual que o
> concorrente com CRM estrangeiro precisa ter.

**5. Base legal do contato.** Paciente que mandou mensagem primeiro é uma coisa. Base importada de planilha
é outra. O campo `consente_whatsapp` existe para isso — **e o recall só sai para quem tem `true`**.

---

## 3. Backup

### O que o produto faz

`backup.sh` e `restore.sh` no kit. O `update.sh` roda backup antes de cada atualização.

### O que ele não faz

**O plano grátis do Supabase não faz backup sozinho.** Se você não agendar, não existe.

### A política

```bash
# Diário, 3h da manhã
0 3 * * * cd /root/clinicCRM && bash hostgator-setup-kit/backup.sh >> /var/log/deskcomm-backup.log 2>&1
```

| Item | Definição |
|---|---|
| Frequência | diária, mais o backup automático de cada atualização |
| Retenção | 30 dias local; 90 dias em destino externo (Backblaze B2 sai por ~R$0,06/GB/mês) |
| Destino externo | **obrigatório.** Backup na mesma VPS não protege contra perder a VPS. |
| **Teste de restore** | **trimestral, em VPS descartável** |
| RPO | 24h |
| RTO | 4h |

> 🔴 **Backup que nunca foi restaurado não é backup, é esperança.** Agende o teste trimestral no calendário
> como compromisso, não como intenção. O primeiro tem de acontecer antes da segunda clínica.

E monitore: um `backup.sh` que falha silenciosamente há três semanas é indistinguível de um que funciona,
até o dia em que você precisa dele.

---

## 4. Plano de incidente

### O fato incômodo

Uma instalação para todas as clínicas significa que **um incidente atinge todas ao mesmo tempo**. Isso
precisa estar no contrato e no seu plano — não ser descoberto por uma clínica no meio do expediente.

### Cenários, e o que fazer

| Cenário | Alcance | Detecção | Ação | Alvo |
|---|---|---|---|---|
| **WAHA caiu (OOM)** | todas | `healthcheck.sh` | sobe sozinho; `WHATSAPP_RESTART_ALL_SESSIONS=True` retoma sem QR | 15 min |
| **`scheduler` parado** | todas, **em silêncio** | `healthcheck.sh` | `docker compose up -d scheduler` | 30 min |
| **App fora do ar** | todas | uptime externo | `docker compose restart app`; se persistir, `restore.sh` | 1h |
| **Supabase indisponível** | todas | health | fora do seu controle: comunique e acompanhe o status deles | — |
| **Número de uma clínica banido** | uma | a clínica avisa | novo número, novo pareamento; **o número é dela, e isso está no contrato** | 4h |
| **Atualização quebrada** | todas | pós-deploy | o agente volta à imagem anterior sozinho e grava no `.env` | 30 min |
| **Vazamento de dado** | conforme | auditoria, denúncia | §4.3 | imediato |

### 4.1 O modo de falha mais perigoso é o silencioso

Sem o `scheduler`, não há drenagem de `event_log`, automação, follow-up, recall nem sincronismo de agenda.
**E não aparece erro nenhum.** A tela só fica velha e a fila não anda. A clínica descobre uma semana depois,
quando percebe que nenhum recall saiu.

```bash
# no cron, a cada 15 min, com alerta em canal que você lê
*/15 * * * * cd /root/clinicCRM && bash hostgator-setup-kit/healthcheck.sh || \
  curl -s -X POST "$WEBHOOK_ALERTA" -d "healthcheck falhou em $(hostname)"
```

Alerta que chega em e-mail que ninguém abre não é alerta.

### 4.2 Comunicação

- **Antes:** janela de manutenção combinada por escrito, para atualização.
- **Durante:** avise em até 30 minutos, mesmo sem ter a solução. Dizer "estamos nisso, retorno em 1h" vale
  mais que silêncio com conserto rápido.
- **Depois:** o que houve, o que foi feito, o que impede a repetição. Uma página, sem jargão.

### 4.3 Se for vazamento de dado pessoal

1. Conter, e **preservar o log** — a auditoria é append-only, não a toque.
2. Registrar em `/admin/incidents`.
3. **Notificar cada clínica afetada.** Elas são as controladoras; a comunicação à ANPD e aos titulares é
   decisão delas, com seu apoio.
4. Prazo: a ANPD trabalha com **3 dias úteis** para a comunicação da controladora. Seu DPA precisa dar a
   ela tempo hábil — ou seja, você avisa em **24 horas**.
5. Documentar tudo. É o que separa incidente tratado de negligência.

---

## 5. Runbook de onboarding comercial

O onboarding técnico está em [`04-camada-odonto.md`](04-camada-odonto.md) §6. Aqui é o que vem antes.

### Qualificação — perguntas que evitam contrato ruim

| Pergunta | Por que importa |
|---|---|
| Quantos números de WhatsApp? | cada um é ~150 MB no WAHA; dois números dobram a conta |
| Quantos dentistas na agenda? | cada um precisa de jornada cadastrada |
| **Cadeiras compartilhadas entre dentistas?** | **não existe entidade de sala; o conflito é por profissional** — risco de overbooking |
| Qual sistema clínico usam? | define se a integração é Clinicorp ou nenhuma |
| O número é novo ou já em uso? | número novo precisa de aquecimento |
| Volume de mensagens por dia? | dimensiona custo de IA e o teto |
| Quem responde quando a IA passa para humano? | sem isso definido, o handoff cai no vazio |
| Exigem domínio próprio? | **não existe domínio por organização** — vira instalação dedicada, com preço próprio |

### Semana a semana

**Semana 0 — comercial**
Qualificação · proposta com escopo explícito (comercial, não clínico) · contrato · **DPA** · assinatura no
Asaas · coleta de razão social e DPO.

**Semana 1 — configuração**
Organização criada · checklist técnico completo · base de conhecimento com os dados da clínica ·
número pareado · **medição do WAHA**.

**Semana 2 — acompanhamento**
Treinamento da recepção · os 8 passos do ensaio · IA em modo observado, com a recepção revisando ·
ajuste de prompt com base no que apareceu de verdade.

**Semana 3 — soltar**
IA respondendo sozinha fora do horário · automações ligadas · fluxo D-1 ativo · primeira medição de
resultado.

**Semana 4 — mostrar o valor**
Relatório: tempo de primeira resposta, agendamentos feitos pela IA, no-show antes e depois, pacientes
reativados. **Este relatório é o que renova o contrato.**

### O que dizer quando pedirem o que não existe

| Pedido | Resposta |
|---|---|
| "Quero prontuário aqui dentro" | Integramos com o sistema clínico que vocês já usam. Nós trazemos e agendamos o paciente; ele cuida do tratamento. Quem tenta fazer os dois entrega mal os dois. |
| "Quero domínio próprio" | Existe, no plano dedicado — instalação só de vocês, com marca própria até no login. |
| "Quero link de agendamento no site" | Hoje o agendamento é pelo WhatsApp, que é onde o paciente já está. Link público está no roadmap. |
| "Quero controlar as cadeiras" | A agenda controla por profissional. Se vocês compartilham cadeira, precisamos conversar antes de fechar. |
| "Quero emitir guia de convênio" | Isso é do sistema clínico. Nós registramos qual convênio o paciente tem, para qualificar o atendimento. |

---

## 6. Checklist antes da segunda clínica

**Não venda a segunda antes de todos estarem verdes.** A primeira perdoa; a segunda não, porque agora um
erro atinge duas.

**Infra**
- [ ] WAHA medido, abaixo de 60% do teto ([doc 02](02-dimensionamento-waha.md) §4)
- [ ] `healthcheck.sh` no cron, com alerta em canal que você lê de fato
- [ ] Backup diário rodando **e um restore testado de verdade**
- [ ] Backup replicado fora da VPS
- [ ] Monitoramento externo de uptime

**Produto**
- [ ] Piloto com todos os critérios de saída atendidos
- [ ] Fluxo D-1 funcionando com paciente real
- [ ] Runbook de configuração validado — a segunda clínica é o teste dele

**Jurídico**
- [ ] Modelo de DPA revisado por advogado
- [ ] Contrato com janela de manutenção e a falha compartilhada declaradas
- [ ] Razão social e DPO corretos na primeira clínica

**Comercial**
- [ ] Preço fechado com **custo medido**, não estimado
- [ ] Assinatura no Asaas ativa e testada
- [ ] Ciclo de inadimplência escrito e combinado

**Segurança**
- [ ] MFA ligado no seu usuário de admin de plataforma — **`/suspend` exige AAL2**
- [ ] Códigos de recuperação guardados fora da VPS
- [ ] Teto de IA em modo `bloquear` — uma clínica não pode consumir a margem das outras
