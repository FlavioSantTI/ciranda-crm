---
title: Runbook do piloto — da VPS ao primeiro agendamento pela IA
parent: ../prd/07-prd-odonto-saas.md
version: 1.0
status: pronto para executar
date: 2026-09-10
owner: Flavio Santiago
---

# Runbook do piloto — da VPS ao primeiro agendamento pela IA

> **Critério de sucesso do piloto, em uma frase:** um paciente real manda mensagem no WhatsApp da clínica,
> a IA entende, oferece horário e marca a consulta — e a consulta aparece na agenda da recepcionista.
>
> Nada além disso conta como piloto concluído. Tela bonita sem esse ciclo é demonstração, não prova.

---

## 0. Antes de tocar em qualquer coisa

### O que você precisa ter em mãos

| Item | Onde conseguir | Obrigatório? |
|---|---|---|
| VPS com Docker, 4 GB de RAM | HostGator (parceria), Hetzner, DigitalOcean | sim |
| Domínio com registro A apontando para o IP | seu registrador | sim |
| Projeto Supabase | conta grátis em supabase.com | sim |
| Chave de IA — OpenRouter, Anthropic ou OpenAI | o instalador pergunta qual | sim |
| **Chave da OpenAI, adicionalmente** | platform.openai.com | **sim, na prática** |
| Número de WhatsApp da clínica | a clínica | sim |
| Conta Resend + domínio verificado | resend.com | não, mas recomendado |

> ⚠️ **A chave da OpenAI é tecnicamente opcional e praticamente obrigatória aqui.** O próprio instalador
> avisa: *"sem ela a IA não ouve áudio nem consulta a base de conhecimento"*. Numa clínica, paciente manda
> áudio o tempo todo, e a base de conhecimento é onde vivem os procedimentos e preços. Sem OpenAI, o piloto
> falha nos dois pontos que mais importam.

### Decisões que precisam estar tomadas antes

1. **O número de WhatsApp é novo ou o que a clínica já usa?**
   Número em uso traz o histórico e a confiança do WhatsApp — melhor para não ser banido. Número novo tem
   reputação zero e exige aquecimento. Se for número novo, comece com volume baixo por uma semana.
2. **Quem é o dono do número?** A conta é da clínica. Se o WhatsApp for banido, o prejuízo é dela. Isso
   precisa estar no contrato antes do pareamento, não depois.
3. **Quantos dentistas entram na agenda?** Cada um precisa de jornada cadastrada (§4.2), senão não aparece
   horário nenhum.
4. **A clínica tem cadeira compartilhada?** Se dois dentistas dividem equipamento, leia
   [`01-mapa-de-configuracao.md`](01-mapa-de-configuracao.md) §4.3 antes de prometer agenda.

---

## 1. Preparar o Supabase

Você pode deixar o instalador criar o projeto (exportando `SUPABASE_ACCESS_TOKEN` antes de rodá-lo), ou
criar pelo painel. Criando pelo painel, anote:

- **Project URL** e **anon key** e **service_role key** — em Settings → API
- **Connection string do Session pooler, modo URI** — em Settings → Database
  (⚠️ o pooler, não a conexão direta)

O instalador aplica o `baseline.sql` e cria as extensões sozinho. **Não rode migrations manualmente.**

> 💡 Exporte `SUPABASE_ACCESS_TOKEN` mesmo criando o projeto à mão. Sem ele, o Site URL do projeto fica em
> `localhost:3000`, e reset de senha, confirmação de e-mail e aceite de convite chegam com link para uma
> máquina que não existe. Era o estado de toda instalação feita pelo caminho documentado (issues #431/#426).

---

## 2. Instalar

```bash
ssh -p PORTA root@SEU_IP

git clone https://github.com/FlavioSantTI/clinicCRM.git
cd clinicCRM
bash hostgator-setup-kit/install.sh
```

O instalador é **idempotente** — rodar de novo não duplica cron nem recria usuário; retoma de onde parou.

### O que ele pergunta, na ordem

`DOMAIN` · `ACME_EMAIL` · `APP_IMAGE` · as quatro credenciais do Supabase · `SUPABASE_ACCESS_TOKEN`
(opcional) · o provedor de IA e sua chave · a chave da OpenAI · `OWNER_EMAIL` · `OWNER_PASSWORD` ·
`APP_NAME` · `APP_LOCALE` · `APP_ACCENT_HEX` · `SUPPORT_EMAIL` · `RESEND_API_KEY` · `RESEND_FROM_EMAIL`

Em qualquer pergunta, digite `voltar` para refazer a anterior.

### Para o modelo SaaS, preencha assim

| Campo | Valor | Por quê |
|---|---|---|
| `APP_NAME` | o nome da **sua** operação | é a marca do login, que é a sua; a marca da clínica é por organização |
| `APP_ACCENT_HEX` | a **sua** cor, formato `#rrggbb` completo | os e-mails de acesso leem esta chave e só entendem essa forma |
| `SUPPORT_EMAIL` | **o seu** suporte | aparece nas telas de conta suspensa e cobrança; vazio significa vazio, nunca cai no do projeto |
| `RESEND_FROM_EMAIL` | remetente de domínio verificado **seu** | sem ele, convite de time vira copy-and-paste na tela |

### Se a VPS já tiver proxy próprio

Hostinger, Coolify, Dokploy e CapRover ocupam as portas 80 e 443. O instalador **detecta e publica através
do proxy existente**. No caso de proxy em `--network host` (Hostinger), ele **pergunta em vez de adivinhar**
— responda com atenção: publicar atrás do proxy errado instala "com sucesso" um site mudo.

### Conferir

```bash
bash hostgator-setup-kit/healthcheck.sh
```

O cadeado do HTTPS leva cerca de um minuto para aparecer no primeiro acesso.

---

## 3. Primeiro acesso e o número de WhatsApp

1. Abra `https://<seu-domínio>` e entre com o admin criado.
2. A verificação em duas etapas é **opcional** e fica em Configurações → Segurança. O primeiro login não a
   exige. **Para SaaS, ligue no seu usuário admin de plataforma** — é a conta que enxerga todas as clínicas.
3. No onboarding, escaneie o QR com o WhatsApp da clínica.

> ⚠️ Guarde os códigos de recuperação do MFA. `reset-mfa.sh` existe justamente porque trocar de celular sem
> eles é a chamada de suporte mais comum.

### Medir o WAHA agora

Assim que a sessão parear, rode a medição de [`02-dimensionamento-waha.md`](02-dimensionamento-waha.md) §4.
**Esta é a primeira medição, e ela resolve a maior incerteza do modelo de escala.** Anote o resultado.

---

## 4. Configurar a clínica

### 4.1 O funil

No onboarding, escolha **"Clínica, consultório ou salão"**. Isso instancia o funil *Agendamentos*:

```
Novo contato → Já respondi → Entendendo o caso → Quer agendar
→ Escolhendo horário → Consulta marcada → Não vai marcar
```

Renomeie as etapas para o vocabulário da clínica em `/app/settings/tenant/pipelines`. Cadastre os motivos de
perda reais: preço, distância, convênio não atendido, foi em outra clínica, sumiu.

### 4.2 A equipe e as jornadas

Em **Equipe**, cadastre cada dentista e **configure a jornada semanal de cada um**.

> 🔴 **Armadilha que custa uma tarde:** dentista sem jornada cadastrada gera **zero horários livres**, e a
> tela não explica por quê. Para o roteamento de atendimento, jornada vazia significa 24/7; para a agenda,
> significa nada. Não são a mesma regra.

Cadastre também as exceções: feriados e o sábado que a clínica atende.

### 4.3 Os procedimentos, como tipos de agendamento

Em `/app/settings/tenant/agenda`, crie um tipo por procedimento. A tela expõe nome, categoria, duração,
local e dono padrão:

| Nome | Categoria | Duração |
|---|---|---|
| Avaliação inicial | `consulta` | 30 min |
| Limpeza / profilaxia | `procedimento` | 40 min |
| Restauração | `procedimento` | 60 min |
| Endodontia — sessão | `procedimento` | 90 min |
| Retorno | `retorno` | 20 min |
| Urgência | `consulta` | 30 min |

Depois, **pela API** (buffers e antecedência não estão na tela):

```bash
curl -X PATCH "https://<dominio>/api/v1/agenda/tipos" \
  -H "Authorization: Bearer tok_..." \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<uuid do tipo>",
    "buffer_after_minutes": 10,
    "minimum_notice_minutes": 120,
    "booking_window_days": 60
  }'
```

> **O buffer não é detalhe.** Sem tempo entre pacientes para esterilizar e limpar, a agenda marca gente
> colada e a clínica atrasa o dia inteiro a partir das 10h. Comece com 10 minutos e ajuste com a recepção.

### 4.4 O agente de recepção

**Conhecimento** (`/app/ai/knowledge/sources`) — suba, como FAQ ou documento:

- tabela de procedimentos e preços
- convênios aceitos e o que cada um cobre
- endereço, ponto de referência, estacionamento
- horários de funcionamento
- política de remarcação e de falta
- formas de pagamento e parcelamento

**Skills** (`/app/ai/skills`) — instale **`agendamento`**, que vem de fábrica e é um playbook de marcar e
remarcar horário escrito para clínicas e serviços.

**Tools** (`/app/ai/agents/[id]`, pacote `vender`) — ligue:
`crm_list_event_types`, `crm_find_free_slots`, `crm_list_appointments`, `crm_book_appointment`,
`crm_reschedule_appointment`, `crm_confirm_appointment`.

> **Deixe `crm_cancel_appointment` desligada.** Ela é classificada como risco crítico e não vem ligada por
> pacote. Cancelar consulta é decisão da recepção, não da IA.

**Handoff obrigatório** — cadastre estas palavras-chave:

```
dor, dor forte, sangrando, sangramento, inchado, inchaço, urgência, urgente,
quebrou, caiu, acidente, criança caiu, reclamação, advogado, processo
```

Dor e trauma nunca são conversa de robô. Este é o item que protege a clínica e você.

**Teto de gasto** (`/app/ai/usage`) — configure em modo `avisar` no piloto. Lembre que o valor é em
**centavos de dólar**, não em reais.

### 4.5 Ajustes que só existem por SQL

Rode no SQL Editor do Supabase. Sem isso, o Radar de risco usa 24h para "em risco" e 72h para "crítico" —
curto demais para decisão de tratamento odontológico.

```sql
-- Janela de esfriamento por etapa (em horas).
-- Ajuste os nomes para os que você usou no funil.
update crm_stages set expected_duration_hours = 48
 where name ilike '%entendendo o caso%';

update crm_stages set expected_duration_hours = 120   -- 5 dias
 where name ilike '%escolhendo horário%';

-- Etapa que exige humano (força handoff ao entrar).
update crm_stages set requires_human = true
 where name ilike '%urgência%';
```

Confira que pegou a organização certa antes de rodar — a instalação é compartilhada.

---

## 5. O lembrete de consulta em D-1

🔴 **Não existe no produto.** As colunas estão lá, sem nenhum leitor, e não há cron de lembrete entre os 15
do `scheduler`. Detalhes e prova em [`01-mapa-de-configuracao.md`](01-mapa-de-configuracao.md) §5.

Para o piloto, o fluxo em n8n está especificado em
[`04-integracao-clinicorp.md`](04-integracao-clinicorp.md) §6 — ele lê
`GET /api/v1/agenda/agendamentos` e dispara a confirmação pelo próprio CRM.

**Não venda redução de no-show antes desse fluxo estar de pé.** É a promessa mais fácil de fazer e a mais
visível quando não se cumpre.

---

## 6. O ensaio antes do paciente real

Faça este roteiro do seu próprio celular, com o número da clínica, antes de abrir para pacientes.

| # | O que fazer | O que tem de acontecer |
|---|---|---|
| 1 | "Oi, quanto custa uma limpeza?" | IA responde com o preço da base de conhecimento |
| 2 | "Queria marcar" | IA oferece horários reais da agenda |
| 3 | Escolher um horário | Consulta aparece em `/app/agenda`, autor "Marcado pelo atendente de IA" |
| 4 | Mandar um **áudio** perguntando algo | IA transcreve e responde *(falha sem chave OpenAI)* |
| 5 | "Estou com muita dor" | Conversa vai para humano na hora, IA silencia |
| 6 | Esperar 1 dia com a consulta marcada | Follow-up **não** cobra — a proteção da agenda funcionou |
| 7 | Marcar horário que já está ocupado | IA não oferece — o slot não aparece |
| 8 | Cadastrar um dentista sem jornada | Nenhum horário dele aparece *(comportamento esperado, §4.2)* |

O passo 6 é o mais importante e o mais fácil de esquecer. Cobrar "ainda tem interesse?" de quem marcou para
amanhã é, nas palavras do próprio código, "o tipo de erro que faz desinstalar o produto".

---

## 7. Operação da semana 1

### Todo dia

```bash
bash hostgator-setup-kit/healthcheck.sh
```

### Verificar que os crons estão andando

🔴 **Este é o modo de falha silencioso do produto.** Sem o `scheduler`, não há drenagem de fila, automação,
follow-up nem recall — e **não aparece erro nenhum**. A tela só fica velha.

```bash
docker ps --filter name=scheduler --format '{{.Names}} {{.Status}}'
docker logs --tail 50 $(docker ps -qf name=scheduler)
```

Agende `healthcheck.sh` no cron com alerta. Não é opcional.

### Backup

O plano grátis do Supabase **não faz backup sozinho**.

```bash
crontab -e
# 0 3 * * * cd /root/clinicCRM && bash hostgator-setup-kit/backup.sh >> /var/log/deskcomm-backup.log 2>&1
```

O `update.sh` já roda um backup antes de cada atualização, mas não substitua o diário por ele.

### Medir o WAHA de novo no dia 7

O consumo cresce com o histórico carregado. A medição do dia 1 subestima.

---

## 8. Atualizar

Pela tela: Configurações → Atualização, quando "Nova versão" acender no rodapé. Faz backup do banco sozinha
e acompanha cada fase. O agente confere a cada 5 minutos, então a atualização começa em até 5 minutos depois
do clique.

Pelo terminal:

```bash
cd /root/clinicCRM
bash hostgator-setup-kit/update.sh
```

**Leia a seção da versão no `CHANGELOG.md` antes.** O alvo é sempre a última release marcada, nunca o topo
da `main`.

> **No modelo SaaS, atualizar atinge todas as clínicas de uma vez.** Combine janela de manutenção e avise
> antes. Se subir quebrada, o agente volta para a imagem anterior sozinho e grava a volta no `.env`.

Ruído esperado e inofensivo durante a atualização do banco: muitos `already exists` e
`multiple primary keys`. O script filtra e mostra `✓ banco atualizado`. Só guarde a mensagem se aparecer
`⚠ avisos que não são os esperados`.

Deu ruim: `bash hostgator-setup-kit/restore.sh`.

---

## 9. Critérios de saída do piloto

Só passe para a segunda clínica quando todos estiverem verdes.

- [ ] Os 8 passos do ensaio (§6) passaram
- [ ] Um paciente **real** foi agendado pela IA, sem toque humano
- [ ] Medição do WAHA feita no dia 1 e no dia 7, com resultado abaixo de 60% do teto
- [ ] `healthcheck.sh` agendado com alerta
- [ ] Backup diário rodando e **um restore testado** — backup não testado não é backup
- [ ] Fluxo de confirmação D-1 no n8n funcionando
- [ ] Handoff por dor validado com caso real
- [ ] Recepção treinada na tela de agenda e no Radar
- [ ] Razão social da organização conferida em Configurações → Empresa *(sai no relatório de LGPD)*
- [ ] DPA assinado com a clínica
- [ ] Números da semana anotados: tempo de primeira resposta, agendamentos pela IA, no-show
