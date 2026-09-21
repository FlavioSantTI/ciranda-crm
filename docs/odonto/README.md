---
title: Vertical odontologia — índice
parent: ../prd/07-prd-odonto-saas.md
version: 1.0
date: 2026-09-10
owner: Flavio Santiago
---

# Vertical odontologia — índice

Documentação da adequação do DeskcommCRM para operar como **SaaS de odontologia**, com escopo comercial e
a parte clínica delegada ao Clinicorp.

**Comece pelo PRD:** [`../prd/07-prd-odonto-saas.md`](../prd/07-prd-odonto-saas.md)

| Doc | Conteúdo | Estado |
|---|---|---|
| [`00-estado-do-ambiente.md`](00-estado-do-ambiente.md) | Toolchain, resultado da suíte, a armadilha do `.env.local`, o que falta para o banco | medido |
| [`01-mapa-de-configuracao.md`](01-mapa-de-configuracao.md) | Onde cada requisito se resolve nos 5 módulos, e o que **não existe** | medido |
| [`02-dimensionamento-waha.md`](02-dimensionamento-waha.md) | O teto de escala, a fórmula, o script de medição, as três topologias | modelo + procedimento |
| [`03-runbook-piloto.md`](03-runbook-piloto.md) | Da VPS ao primeiro agendamento pela IA | executável |
| [`04-camada-odonto.md`](04-camada-odonto.md) | Configuração replicável por clínica: campos, tags, automações, fluxos, prompt | executável |
| [`05-integracao-clinicorp.md`](05-integracao-clinicorp.md) | Os 4 fluxos n8n, incluindo o lembrete D-1 | especificado |
| [`06-operacao-saas.md`](06-operacao-saas.md) | Cobrança, LGPD como operador, backup, incidente, onboarding comercial | executável |
| [`07-deploy-traefik.md`](07-deploy-traefik.md) | Deploy na VPS com Traefik + Portainer + Favucanet (Swarm) | executável |
| [`08-prd-waconector-adapter.md`](08-prd-waconector-adapter.md) | PRD do adapter waconector: multi-provider de WhatsApp não-oficial no clinicCRM | em execução |

---

## O princípio que governa tudo

> **Configurar e integrar por fora. Nunca forkar o core.**

O upstream move ~1.000 commits em duas semanas. Código próprio no core custa o caminho de atualização e
transforma você em mantenedor de um fork de 4.000 arquivos. A escada de decisão está no
[PRD §2](../prd/07-prd-odonto-saas.md).

---

## Os quatro achados que mais mudam decisão

**1. Não existe lembrete de consulta em D-1.**
As colunas existem, sem nenhum leitor, e não há cron. É a lacuna mais cara para uma clínica, porque
confirmação é o principal redutor de falta. Resolve-se no n8n, e depois vira contribuição upstream.
→ [`01`](01-mapa-de-configuracao.md) §5 e [`05`](05-integracao-clinicorp.md) §6

**2. O WAHA é o teto do SaaS.**
Cerca de 6 clínicas por container com o `mem_limit` atual, e a queda derruba o WhatsApp de todas.
Meça antes de vender a segunda. → [`02`](02-dimensionamento-waha.md)

**3. WhatsApp não custa licença.**
O WAHA Plus foi fundido no Core gratuito na versão 2026.6.1. Dois documentos do repositório ainda dizem
que custa US$ 30/mês. → [`02`](02-dimensionamento-waha.md) §6

**4. Copiar o `.env.example` quebra 245 testes.**
Exatamente o que a documentação manda fazer. Causa provada, correção de uma linha.
→ [`00`](00-estado-do-ambiente.md) §3

---

## Candidatos a contribuição upstream

Em ordem de valor. Todos nascem de medição, não de opinião.

| # | O quê | Tamanho | Por que entra |
|---|---|---|---|
| 1 | **Cron de lembrete de consulta** | médio | o schema já está pronto esperando; serve todo o vertical de clínicas |
| 2 | Corrigir `??=` para `||=` no setup do vitest | 1 linha | atinge todo dev novo; reprodução de 30 segundos |
| 3 | Remover a menção a licença paga do WAHA | 2 linhas | informação obsoleta em 2 arquivos |
| 4 | Corrigir separador de caminho nos testes de varredura | pequeno | destrava desenvolvimento no Windows |
| 5 | Expor buffers e antecedência na tela de tipos de agendamento | pequeno | existe na API, falta na UI |
