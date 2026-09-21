---
title: Sub-PRD 07 — Vertical Odontologia em modo SaaS multi-tenant
parent: 00-prd-master.md
depends_on: 01-prd-platform-base.md, 02-prd-customer-360.md, 04-prd-pipeline-attendance.md, 05-prd-ai-rag-handoff.md
version: 0.1
status: em revisão
date: 2026-09-10
owner: Flavio Santiago
fork_de: melgarafael/DeskcommCRM
base_medida: origin/main @ 6aee6564 (2026-09-10), zero commits de divergência do upstream
---

# Sub-PRD 07 — Vertical Odontologia em modo SaaS multi-tenant

> Este sub-PRD **não descreve uma feature nova do DeskcommCRM**. Descreve como operar o produto existente
> como um SaaS de odontologia, com escopo restrito à jornada comercial (captação → agendamento → orçamento
> → recall) e a parte clínica delegada ao sistema de gestão da clínica (Clinicorp / Dental Office).
>
> A pergunta que ele responde não é "o que construir?", e sim **"o que NÃO construir, e por quê"**.

---

## 0. Nota de posicionamento — por que este documento existe

O PRD-Mestre (§0) já registra que o produto deixou de ser "CRM de e-commerce" e virou sistema operacional de
vendas multi-nicho, e que **clínica é um dos verticais que a comunidade trouxe**. O roadmap do `README.md`
lista "templates por nicho (clínica, imobiliária, infoproduto, serviços)" como *próximo, não iniciado*.

Este sub-PRD ocupa exatamente essa lacuna para um caso concreto: **odontologia, operada como SaaS por um
terceiro** — modelo que o PRD-Mestre chama de "opção arquitetural preservada, não o plano comercial corrente".
É uma diferença que importa: quem escreveu o produto o pensou para self-host de um dono; aqui o dono da
instalação e o dono do negócio são pessoas diferentes, e é isso que gera os requisitos das §5 e §8.

---

## 1. Contexto

O repositório `FlavioSantTI/clinicCRM` é um fork de [`melgarafael/DeskcommCRM`](https://github.com/melgarafael/DeskcommCRM)
(MIT, Next.js 16 + Supabase + WAHA). **Medido em 2026-09-10: o fork está em `6aee6564`, zero commits de
divergência do upstream.** Não há uma linha de odontologia no código — busca por `paciente`, `prontuario`,
`odonto`, `anamnese` e `convenio` em toda a árvore de produção retorna zero.

Isso é a notícia boa, não a ruim. Significa que a adequação começa de um fork limpo, e que **cada linha que
divergir daqui em diante é uma escolha, não uma herança**.

### Decisões já tomadas, que fecham o escopo

| Decisão | Valor | Consequência principal |
|---|---|---|
| Modelo de negócio | SaaS multi-tenant próprio: **uma instalação, várias clínicas** | Falha e atualização são compartilhadas (§5) |
| Escopo funcional | **Só jornada comercial.** Clínico fica no Clinicorp | Prontuário e odontograma são não-escopo (§9) |
| Papel LGPD | Você é **operador**; a clínica é **controladora** | DPA por clínica é pré-requisito (§8) |

---

## 2. O princípio arquitetural mestre

> **Configurar e integrar por fora. Nunca forkar o core.**

Esta é a regra que governa todas as outras, e ela é derivada de medição, não de preferência.

`docs/current-state.md` registra **1.014 commits e 71 migrations em ~2 semanas**. As migrations do repositório
vão até `20260907050000_0229` / `0231`, datadas de três dias antes deste documento. O upstream não é um projeto
estável do qual se faz um fork e se esquece: é um alvo em movimento rápido.

Código próprio dentro do core custa duas coisas ao mesmo tempo: você perde o caminho de atualização
(`update.sh` e o botão "Atualizar agora" na tela) e passa a ser mantenedor de um fork de ~4.000 arquivos.
Nenhuma clínica paga por isso.

### A escada de decisão — obrigatória para toda necessidade nova

Suba um degrau só depois de provar que o anterior não resolve.

1. **Configurar.** Pacote de funil `clinica`, vocabulário da agenda, campos personalizados de contato,
   catálogo de procedimentos, skills do agente, automações QUANDO/SE/ENTÃO.
2. **Integrar por fora.** Fontes de captação (`/api/v1/webhooks/in/<token>`), webhooks de saída, o MCP server,
   e n8n como cola — que já está no seu stack.
3. **Contribuir upstream.** "Templates por nicho" já está no roadmap deles. Um PR aceito vira manutenção
   grátis para sempre, e ainda constrói autoridade pública no projeto.
4. **Código próprio isolado.** Último recurso. Sempre com migration versionada **+ apêndice no
   `supabase/baseline.sql`** — sem isso a mudança não chega em quem se auto-hospeda, que é você mesmo.

---

## 3. O que já existe e serve para odontologia

Levantamento feito por leitura de código, não por leitura de README.

### 3.1 O nicho clínica já está semeado no produto

`lib/onboarding/pacotes-de-funil.ts` traz um pacote pronto, e ele é bom:

```
id: "clinica" — "Clínica, consultório ou salão"
Funil "Agendamentos":
  Novo contato → Já respondi → Entendendo o caso → Quer agendar
  → Escolhendo horário → Consulta marcada (won) → Não vai marcar (lost)
```

O cabeçalho do arquivo explica por que os pacotes existem, e a razão vale para nós: eles são a **régua** contra
a qual a sugestão de funil da IA é comparada. Sem isso, "sugira um funil" devolve "Prospecção / MQL / Fundo de
funil" — que não é como o dono de uma clínica chama as coisas.

### 3.2 A agenda já fala odontologia

`lib/agenda/tipos.ts` é a fonte da verdade do vocabulário, espelhada por CHECK no banco:

- **Categorias:** `consulta`, `procedimento`, `retorno`, além de `orcamento` e `outro`.
- **Situações:** `pending`, `confirmed`, `cancelled`, `completed`, **`no_show`**.
- **Locais:** presencial, telefone, WhatsApp, link de vídeo, Google Meet.
- **Regra crítica já implementada:** `SITUACAO_SEGURA_O_LEAD` — um agendamento vivo (`pending` ou `confirmed`)
  **impede o motor de follow-up de cobrar** aquele lead. O comentário do código diz, literalmente, que cobrar
  "ainda tem interesse?" de quem marcou para amanhã "é o tipo de erro que faz desinstalar o produto".

Os comentários do módulo citam explicitamente o caso clínico ("o paciente chega e o médico não está"). O
módulo é recente e denso: migrations `0177` a `0231` cobrem sincronismo bidirecional com Google Calendar,
horários livres, jornada de trabalho, locais, reconciliação, Meet, e um bloco próprio de `mfa_e_lgpd_agenda`.

### 3.3 Mapa de aproveitamento

| Necessidade da clínica | Onde já se resolve | Degrau da escada |
|---|---|---|
| Recepção digital 24/7 | Inbox WhatsApp (WAHA por QR ou canal Meta), multi-número | 1 — configurar |
| Atender e qualificar fora do horário | Agentes com RAG por tenant, skills, handoff auditado IA→humano | 1 |
| Marcar, confirmar e remarcar | `lib/agenda` + Google Calendar + horários livres | 1 |
| Funil comercial do tratamento | Kanban com vocabulário por pipeline | 1 |
| **Recall e reativação de inativo** | Follow-up adaptativo + Radar de risco (`lib/leads/risk-radar.ts`) | 1 |
| Tabela de procedimentos e preços | Catálogo (`0204`) + moeda da org (`0208`) | 1 |
| Dados não-clínicos do paciente | Campos personalizados de contato (`0211`) | 1 |
| Tarefas da recepção | Tarefas do CRM (`0210`) | 1 |
| Captação de landing page e formulário | Fontes de captação + automações | 2 — integrar |
| Marca da clínica dentro do sistema | `/app/settings/marca` — marca por organização | 1 |
| Isolamento entre clínicas | RLS em toda tabela tenant-aware, com teste de isolamento como gate de CI | herdado |

O recall merece destaque comercial: **é o maior ativo desperdiçado numa clínica odontológica**, e o produto já
tem o motor pronto (retomada de conversa esfriada com tempo adaptativo e gatilho por etapa do funil). Não
precisa ser construído — precisa ser configurado e vendido.

---

## 4. Requisitos funcionais do vertical

Todos resolvidos no degrau 1 ou 2 da escada. Nenhum exige código no core.

**RF-01 — Funil odontológico.** Instanciar o pacote `clinica` e renomear as etapas para o vocabulário da
clínica-piloto. Motivos de perda configurados (preço, distância, convênio não atendido, foi em outra clínica).

**RF-02 — Vocabulário do nicho.** `lead` → *Paciente*; `won` → *Consulta marcada*. Configurável por pipeline,
sem código.

**RF-03 — Agenda por profissional.** Uma trilha de cor por dentista, jornada de trabalho por profissional,
categorias `consulta` / `procedimento` / `retorno` ativas, Google Calendar conectado quando a clínica já usa.

**RF-04 — Agente de recepção.** RAG alimentado com procedimentos, preços, convênios aceitos, endereço,
estacionamento e horários. Skills para consultar horário livre e marcar. Handoff obrigatório para humano em
dor aguda, reclamação e negociação de preço acima de um teto.

**RF-05 — Confirmação automática em D-1.** 🔴 **Único requisito sem mecanismo no produto.** Medido: as
colunas `reminder_enabled` e `reminder_minutes_before` existem em `calendar_event_types` e têm **zero
leitores**; não há cron de lembrete entre os 15 do `scheduler`; e nenhum dos 5 gatilhos de automação é de
agendamento. Resolve-se no degrau 2 (n8n lendo `GET /api/v1/agenda/agendamentos`), com contribuição upstream
como alvo depois. Detalhamento em [`../odonto/01-mapa-de-configuracao.md`](../odonto/01-mapa-de-configuracao.md) §5.

**RF-06 — Recall.** Follow-up por etapa: orçamento sem resposta, tratamento interrompido, e retorno periódico
(profilaxia semestral). O Radar de risco alimenta a fila da recepção.

**RF-07 — Captação.** Fonte de captação por clínica recebendo leads de landing page, Google Ads e Instagram,
entrando direto na etapa correta do funil.

**RF-08 — Espelho no Clinicorp.** Paciente e agendamento criados no CRM aparecem no Clinicorp. Detalhado na §7.

### Requisitos não-funcionais

**RNF-01** — Primeira resposta no WhatsApp em menos de 2 minutos, 24/7.
**RNF-02** — Isolamento entre clínicas verificado por CI a cada mudança (herdado: `tests/invariants/rls-isolation.test.ts`).
**RNF-03** — Teto de gasto de IA configurado por clínica antes do primeiro atendimento (herdado: `ai_budgets`).
**RNF-04** — Backup diário do Supabase agendado (o plano grátis **não** faz backup sozinho).

---

## 5. Gaps que são do modelo SaaS, não da odontologia

Esta seção é a mais importante do documento. Nenhum destes itens aparece quando se avalia o produto como
self-host de dono único — e todos aparecem no dia em que a segunda clínica entra.

### 5.1 Billing não existe

`app/app/settings/billing/page.tsx` é literalmente um placeholder: *"Em breve — Fase 2"*. A tela tem porta de
primeira classe no menu e é admin-only.

**Decisão:** cobrança fora do produto (Asaas ou Iugu), com suspensão manual via as rotas de administração de
tenant que já existem (`/api/v1/admin/tenants/[id]`, incluindo `reactivate`). Não construir billing dentro do
core — é o degrau 4 mais caro possível e o upstream já o tem no próprio roadmap.

### 5.2 Domínio por organização não existe

Não há coluna de domínio no schema, e o desvio por host no `proxy.ts` é um **NOOP declarado** — existe como
documentação da topologia pretendida, não como funcionalidade. No Edge não há banco para consultar antes de
decidir a quem aquele host pertence.

**Consequência a comunicar na venda:** uma instalação, um domínio. O login carrega a marca da sua operação; a
marca da clínica aparece depois que a pessoa entra. Clínica que exigir domínio próprio recebe instalação
dedicada, com preço próprio.

### 5.3 WAHA é o teto de escala — item de infra nº 1

Medido em `docker-compose.prod.yml`: `mem_limit: 1280m`, com **pico real de 893 MiB registrado no comentário
do próprio arquivo**. O `docs/white-label.md` mede ~150 MB por sessão de WhatsApp.

Um único container WAHA atendendo todas as clínicas comporta, por essa conta, algo entre **6 e 8 números**
antes de o `mem_limit` matar o serviço — e quando o WAHA cai, o WhatsApp de **todas** as clínicas cai junto.

**Isto precisa ser medido no piloto antes de vender a segunda clínica.** As saídas possíveis, em ordem de
preferência: subir o teto e a VPS; um container WAHA por grupo de clínicas; instalação dedicada para clínicas
de maior volume.

### 5.4 Cron só existe na VPS

Não há `vercel.json` no repositório. Os crons do produto são agendados exclusivamente pelo `crond` do serviço
`scheduler` do compose. Sem ele: sem drenagem de `event_log`, sem automações, sem follow-up, sem recall.

**O modo de falha é o pior possível: não há erro.** A tela apenas fica velha e a fila não anda.
`healthcheck.sh` agendado com alerta é obrigatório, não opcional.

### 5.5 Falha e atualização são compartilhadas

Uma instalação para todos significa que um incidente atinge todas as clínicas e que um `update.sh` atualiza
todas de uma vez. Isso precisa estar no contrato e na janela de manutenção combinada — não descoberto por uma
clínica no meio do expediente.

### 5.6 Fragilidades declaradas pelo próprio projeto

`docs/current-state.md` (auditoria honesta, mantida pelo upstream) registra:

- **Rate limit HTTP em apenas 2 pontos** — webhook de captação e dispatcher de IA. `/login`, `/signup`,
  aceite de convite, crons e o endpoint MCP estão sem.
- **89 de 169 handlers usam service role**, que bypassa RLS. A regra "filtre `organization_id` manualmente" é
  revisão humana, sem gate automático na escrita. Os invariantes de CI mitigam muito; o que falta é o gate que
  impede um handler novo de nascer errado.

Nenhum dos dois é bloqueante para o piloto. Ambos são bloqueantes para operar dezenas de clínicas sem revisão.

---

## 6. Três achados que reduzem custo e risco

**6.1 — WhatsApp não custa licença.** O WAHA Plus foi **fundido no WAHA Core na versão 2026.6.1**: sessões
ilimitadas, mídia, storages e segurança agora são gratuitos e open source, sem imagem separada e sem chave de
Docker. O compose deste repositório já usa `devlikeapro/waha:latest-2026.7.2`, posterior à fusão. **O
comentário no arquivo dizendo "troque para `waha-plus` … (licença paga)" está obsoleto** — vale abrir issue no
upstream, é contribuição barata e visível.

**6.2 — A unit economics é mensurável desde o dia 1.** O teto de gasto de IA por organização já existe
(`ai_budgets`, migrations `0159` e `0160`, com escrita restrita à rota). Dá para precificar por clínica com
dado real em vez de estimativa.

**6.3 — Há um argumento jurídico que fecha venda.** A Resolução CD/ANPD nº 19/2024 tornou obrigatórias as
cláusulas-padrão contratuais para transferência internacional de dados pessoais. Hospedando no Brasil não há
transferência internacional, logo a exigência não incide — enquanto todo concorrente que usa CRM estrangeiro
precisa do artefato contratual.

> ⚠️ **Não venda como "servidor no Brasil = conformidade com a LGPD".** É falso e um advogado desmonta na
> primeira pergunta. Conformidade depende de base legal, finalidade, segurança e direitos do titular. O
> argumento defensável é apenas o de cima.

---

## 7. Integração com o Clinicorp

### 7.1 O que a API oferece

| Item | Valor |
|---|---|
| Base | `https://api.clinicorp.com/rest/v1` |
| Autenticação | HTTP Basic — usuário API + token API |
| Documentação | Swagger em `https://sistema.clinicorp.com/api-docs/` |
| Onde obter as credenciais | Gerenciar Assinatura → Acesso Externo e Integrações |
| Obrigatório também | Subscriber ID e ID da clínica (este último via suporte do Clinicorp) |
| Cobertura | Pacientes, agendamentos, orçamentos, procedimentos, profissionais, financeiro, leads de CRM, analytics |

Existe um node community de n8n (`n8n-nodes-clinicorp`, 17 recursos e ~49 operações, usável como Tool de
agente de IA). **O n8n já está no seu stack** — este é o degrau 2 da escada, e é o caminho mais rápido.

### 7.2 Direção de dados — a decisão que evita o desastre

> **O CRM é dono do comercial. O Clinicorp é dono do clínico e do financeiro. Nenhuma entidade tem dois donos.**

| Entidade | Fonte da verdade | Direção |
|---|---|---|
| Conversa, lead, etapa do funil | CRM | não sai |
| Paciente (cadastro básico) | CRM na criação, Clinicorp depois | CRM → Clinicorp, uma vez |
| Agendamento | CRM na marcação, Clinicorp depois | CRM → Clinicorp; status volta Clinicorp → CRM |
| Orçamento, procedimento executado, financeiro | Clinicorp | Clinicorp → CRM, somente leitura |
| Prontuário | Clinicorp | não entra no CRM |

### 7.3 Limitações conhecidas, e o que fazer com elas

A ação de cadastrar lead no Clinicorp **não deduplica e não move o lead entre etapas** do funil de lá. Duas
consequências operacionais:

1. A deduplicação é responsabilidade do n8n, por telefone normalizado em E.164, com estado próprio.
   Não confiar na API para isso.
2. Escrever no Clinicorp **uma única vez** por paciente no processo. Repetir a ação gera duplicata.

O escopo de acesso do token é negociado na contratação — nem tudo fica exposto por padrão. **Validar o escopo
real antes de prometer qualquer campo à clínica.**

---

## 8. LGPD — o que muda quando você vira operador

O escopo comercial reduz a exposição, mas não a elimina: **"quero avaliar um implante" já é dado referente à
saúde**, categoria especial do art. 11 da LGPD. Tratar o CRM como se só houvesse dado comercial ali é o erro
que este parágrafo existe para impedir.

**O que o produto já resolve:** export e redact via workers, anonimização em cascata, consentimento auditado,
audit log append-only com retenção de 5 anos, e RLS com teste de isolamento no CI.

**O que é responsabilidade sua, e não do software:**

1. **Contrato de operador (DPA) com cada clínica**, assinado antes da instalação. Você trata dado pessoal por
   conta dela; ela é a controladora.
2. **Conferir a Razão social de cada organização** em Configurações → Empresa. O relatório de LGPD do titular
   é o único artefato que deliberadamente **não** leva marca nenhuma: ele nomeia o controlador. E a razão
   social nasce igual ao nome fantasia, porque é o que o instalador tem para dar — um nome fantasia impresso
   como razão social num documento jurídico é o erro que só aparece quando alguém reclama.
3. **Backup.** O plano grátis do Supabase não faz backup sozinho. `backup.sh` no cron diário.
4. **Encarregado (DPO) declarado** por clínica, porque é ele que o relatório nomeia.
5. **Plano de resposta a incidente** que contemple o fato de a instalação ser compartilhada (§5.5).

---

## 9. Não-escopo explícito

Nada disto será construído, em nenhuma fase:

Prontuário eletrônico · odontograma · anamnese · evolução clínica · plano de tratamento por dente e face ·
imagem radiográfica · guias TISS e faturamento de convênio · assinatura ICP-Brasil · controle de estoque de
materiais · prescrição.

**Resposta pronta quando um prospect exigir:** integramos com o sistema clínico que a clínica já usa. O CRM
cuida de trazer e agendar o paciente; o sistema clínico cuida do tratamento. Quem tenta fazer os dois entrega
mal os dois — e assume responsabilidade regulatória de prontuário, que é outra ordem de grandeza.

---

## 10. Métricas de sucesso

Métricas de operação, medidas por clínica:

| Métrica | Meta inicial | Onde se mede |
|---|---|---|
| Tempo até a primeira resposta | < 2 min, 24/7 | Desempenho / métricas por atendente |
| Agendamentos concluídos pela IA sem toque humano | > 40% no 3º mês | Evolução da IA + agenda por autor (`ai`) |
| Taxa de no-show | queda de 30% após confirmação automática | Situação `no_show` na agenda |
| Pacientes inativos reativados por mês | baseline no piloto | Radar de risco + follow-up |
| Horas de recepção economizadas por semana | 8–12h | métrica que a consultoria já vende |

Métricas do negócio SaaS:

| Métrica | Por que importa |
|---|---|
| Custo de IA por clínica ÷ receita por clínica | define o preço do plano; medível via `ai_budgets` |
| Sessões WAHA ativas ÷ teto medido | gatilho de decisão de infra (§5.3) |
| Clínicas por instalação | risco concentrado (§5.5) |

---

## 11. Fases de execução

**Fase 0 — Ambiente e estudo.** Clone com `upstream` configurado, dev local com `baseline.sql` aplicado,
suíte verde, e leitura de `CLAUDE.md`. Entregável: mapa de onde cada RF da §4 se resolve por configuração.

**Fase 1 — Piloto com uma clínica real.** VPS com Docker, `install.sh`, funil `clinica`, agenda, um número de
WhatsApp, agente com RAG de procedimentos e preços. Entregável: um agendamento de verdade, ponta a ponta,
feito pela IA.

**Fase 2 — Camada odonto por configuração.** RF-01 a RF-07. Zero código. Entregável: um runbook de
configuração replicável para a próxima clínica.

**Fase 3 — Integração Clinicorp.** RF-08 via n8n, com a direção de dados da §7.2 e a deduplicação da §7.3.

**Fase 4 — Virar SaaS.** Dimensionamento de WAHA medido, billing externo, runbook de onboarding, DPA,
política de backup, plano de incidente compartilhado.

---

## 12. Riscos e mitigação

| Risco | Severidade | Mitigação |
|---|---|---|
| Divergência do upstream torna o fork inatualizável | 🔴 | A escada da §2, mais `git remote upstream` com merge periódico e divergência medida |
| Teto do WAHA derruba o WhatsApp de todas as clínicas | 🔴 | Medir consumo real por sessão no piloto **antes** da segunda clínica (§5.3) |
| Cron parado silenciosamente mata recall e follow-up | 🟠 | `healthcheck.sh` agendado com alerta; o sintoma nunca é erro (§5.4) |
| Banimento do número de WhatsApp da clínica | 🟠 | Anti-banimento existe (throttle, jitter, janela); o número é da clínica — entra em contrato |
| Clínica exige prontuário no meio do contrato | 🟠 | Não-escopo da §9, com resposta pronta no discurso comercial |
| Clínica com cadeira compartilhada entre dentistas sofre overbooking | 🟠 | Não existe entidade de sala/recurso: o conflito é por profissional. Vira critério de qualificação comercial — ver [mapa de configuração](../odonto/01-mapa-de-configuracao.md) §4.3 |
| Falta de lembrete D-1 mantém o no-show alto e frustra a promessa de venda | 🔴 | RF-05 via n8n desde o piloto; não vender redução de falta antes de o fluxo estar de pé |
| Escopo do token Clinicorp menor que o prometido | 🟡 | Validar escopo real na contratação, antes de prometer campo (§7.3) |
| Dado de saúde tratado como dado comercial | 🔴 | §8 — DPA, DPO declarado, razão social conferida |

---

## 13. Perguntas em aberto

1. Qual é a clínica-piloto, e ela já usa Clinicorp? (define se a Fase 3 entra no piloto ou depois)
2. O número de WhatsApp do piloto é novo ou já é o número em uso da clínica? (número em uso tem histórico e
   risco de banimento diferente)
3. Qual VPS e qual dimensionamento inicial? (a conta da §5.3 muda com a RAM disponível)
4. O primeiro plano comercial é por clínica, por número, ou por volume de atendimento?
