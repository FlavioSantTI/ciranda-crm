---
title: Dimensionamento do WAHA — o teto de escala do SaaS
parent: ../prd/07-prd-odonto-saas.md
version: 1.0
status: modelo calculado, medição pendente de VPS
date: 2026-09-10
owner: Flavio Santiago
---

# Dimensionamento do WAHA — o teto de escala do SaaS

> **Este é o item de infra nº 1 do PRD.** Numa instalação para todas as clínicas, o WAHA é o único serviço
> cujo consumo cresce com o número de clientes — e é o único cuja queda derruba o WhatsApp de **todos** ao
> mesmo tempo.
>
> O modelo abaixo é calculado com números que o próprio projeto mediu. A medição real está pendente e só é
> possível numa VPS com sessões ativas: o §4 traz o procedimento e o script.

---

## 1. Os números de origem

Todos medidos pelo projeto, não estimados por mim.

| Fonte | Número |
|---|---|
| `docs/runbooks/waha-hostgator.md` | **~150 MB por sessão** (engine NOWEB) |
| `docs/runbooks/waha-hostgator.md` | **~300 MB** de overhead do Node |
| `docs/runbooks/waha-hostgator.md` | mínimo recomendado: **2 vCPU / 4 GB** |
| `docker-compose.prod.yml` | `mem_limit` do WAHA: **1280 MiB** |
| `docker-compose.prod.yml` | pico medido do WAHA numa VPS real: **893 MiB** |
| `docker-compose.prod.yml` | `app` 768m · `worker` 512m |
| `docs/white-label.md` | ~150 MB por sessão (confirma o runbook) |

A engine é **NOWEB** (`WHATSAPP_DEFAULT_ENGINE`), que é websocket direto — mais leve e mais estável que a
WEBJS, que sobe um browser por sessão. O compose já força NOWEB, e o comentário explica que o nome errado
da variável fazia cair em WEBJS e corromper sessão quando o WhatsApp Web atualizava.

---

## 2. A fórmula

```
RAM do WAHA (MB) ≈ 300 + (150 × número de sessões)
```

E o teto atual do container:

```
capacidade com mem_limit de 1280 MiB = (1280 − 300) ÷ 150 ≈ 6,5 sessões
```

> **Seis clínicas com um número cada, e o sétimo número mata o container.**
>
> O modo de falha é o OOM kill. O `restart: unless-stopped` traz o serviço de volta, mas
> **todas as sessões precisam ser retomadas** — e `WHATSAPP_RESTART_ALL_SESSIONS=True` faz isso sem pedir QR
> de novo, o que salva a operação. Ainda assim, é uma janela de WhatsApp mudo para todas as clínicas.
>
> O runbook do projeto já nomeia o remédio, e é o mesmo que este documento recomenda:
> *"Container OOMKilled → Sessões demais pro plano → Upgrade, ou **particionar tenants em VPS secundário**."*

---

## 3. Tabela de capacidade

Soma dos tetos: `app` 768 + `worker` 512 + WAHA + ~110 (redis, srh, scheduler, caddy) + ~800 de folga para
o sistema operacional e o agente da hospedagem.

| Clínicas (1 número cada) | RAM do WAHA | `mem_limit` sugerido | Total da stack | VPS mínima | Veredito |
|---|---|---|---|---|---|
| 1 (piloto) | ~450 MB | 1280m (atual) | ~2,7 GB | **4 GB** | ✅ folga confortável |
| 3 | ~750 MB | 1280m (atual) | ~2,7 GB | **4 GB** | ✅ ainda cabe |
| **6** | **~1.200 MB** | **1280m (atual)** | **~2,7 GB** | **4 GB** | ⚠️ **no limite — não passe daqui sem medir** |
| 10 | ~1.800 MB | 2048m | ~3,4 GB | **6 GB** | requer upgrade |
| 20 | ~3.300 MB | 3584m | ~4,9 GB | **8 GB** | requer upgrade + decisão do §5 |
| 40 | ~6.300 MB | 7168m | ~8,5 GB | **16 GB** | não fazer numa instalação só (§5) |

> ⚠️ **A conta acima considera um número de WhatsApp por clínica.** Clínica com dois números (recepção e
> comercial, ou duas unidades) conta como duas sessões. Pergunte isso na qualificação.

### O CPU também tem limite

O runbook é explícito: 1 vCPU / 2 GB "é insuficiente — puppeteer/baileys + 5+ sessões saturam". Para além de
10 sessões, dimensione **4 vCPU**, não só RAM.

### E o disco cresce sozinho

O volume `waha-data` (`/app/.sessions`) cresce com o histórico do WhatsApp de cada número. Mínimo
recomendado de 80 GB SSD, e ele é para o conjunto — com 20 clínicas, monitore.

---

## 4. Procedimento de medição — a fazer na VPS do piloto

**Enquanto não houver medição real, a tabela do §3 é modelo, não fato.** Rode isto na VPS assim que o
piloto tiver a primeira sessão pareada, e de novo a cada clínica nova.

### O script

Salve como `medir-waha.sh` na VPS e rode com `bash medir-waha.sh`.

```bash
#!/usr/bin/env bash
# Mede o consumo real do WAHA por sessão e projeta a capacidade restante.
# Rode na VPS, com a stack de pé. Não altera nada.
set -euo pipefail

LIMITE_MIB=$(docker inspect --format '{{.HostConfig.Memory}}' waha 2>/dev/null \
  | awk '{ printf "%d", $1/1024/1024 }')
USO_MIB=$(docker stats --no-stream --format '{{.MemUsage}}' waha \
  | awk '{ print $1 }' | sed 's/MiB//; s/GiB/*1024/' | bc 2>/dev/null || echo "0")

API_KEY=$(grep -E '^WAHA_API_KEY=' .env | cut -d= -f2-)
SESSOES=$(curl -s -H "X-Api-Key: ${API_KEY}" http://127.0.0.1:3000/api/sessions \
  | grep -o '"name"' | wc -l)

echo "=== WAHA — medição de $(date -Iseconds) ==="
echo "sessões ativas.......: ${SESSOES}"
echo "uso atual............: ${USO_MIB} MiB"
echo "teto (mem_limit).....: ${LIMITE_MIB} MiB"

if [ "${SESSOES}" -gt 0 ]; then
  POR_SESSAO=$(echo "(${USO_MIB} - 300) / ${SESSOES}" | bc)
  RESTANTE=$(echo "(${LIMITE_MIB} - ${USO_MIB}) / ${POR_SESSAO}" | bc)
  echo "MB por sessão (real).: ${POR_SESSAO}   (modelo prevê ~150)"
  echo "cabem mais...........: ${RESTANTE} sessões antes do teto"
fi

echo ""
echo "=== stack inteira ==="
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}'
echo ""
echo "=== RAM do host ==="
free -m | head -2
```

### Quando medir

1. **Logo após parear o primeiro número.** Estabelece o overhead real, que o modelo assume em 300 MB.
2. **Após 7 dias de operação.** O consumo cresce com o histórico carregado; a primeira medição subestima.
3. **A cada clínica nova**, antes de parear o número seguinte.
4. **Em horário de pico** da clínica, não de madrugada.

### O que fazer com o resultado

| Resultado | Ação |
|---|---|
| Uso abaixo de 60% do teto | seguir, medir de novo na próxima clínica |
| Uso entre 60% e 80% | **parar de vender** até subir o teto e a VPS |
| Uso acima de 80% | subir `mem_limit` e a VPS **hoje**, antes do próximo pareamento |
| OOM kill no log | ler o §5, a decisão já não é de RAM |

Para ver se já houve OOM:

```bash
docker inspect waha --format '{{.State.OOMKilled}} reinícios={{.RestartCount}}'
```

---

## 5. A decisão de arquitetura, e quando tomá-la

Subir RAM resolve o consumo. **Não resolve o raio de alcance da falha.** Com 20 clínicas num WAHA só, uma
atualização malsucedida ou um OOM deixa 20 clientes sem WhatsApp ao mesmo tempo — e você descobre pelo
telefone tocando 20 vezes.

### As três topologias

**A — Um WAHA para todos** *(o que o compose entrega)*
Mais barato e mais simples. Raio de falha total. **Serve até ~6 clínicas.**

**B — Vários containers WAHA na mesma VPS, agrupados**
Cada grupo de 4 a 6 clínicas com seu container (`waha-a`, `waha-b`), cada um com seu volume e sua porta
interna. O `WAHA_API_BASE_URL` passa a variar por sessão de canal — **e é aqui que mora o custo**: o app
resolve o WAHA por variável de ambiente única, então esta topologia **exige mudança de código** e cai no
degrau 4 da escada. Falha isolada por grupo, custo de infra ainda baixo.

**C — Uma instalação dedicada por clínica**
Zero divergência de código, falha isolada de verdade, marca própria até no login, atualização escalonada,
dado fisicamente separado — e é a resposta mais simples de dar quando a clínica pergunta "onde ficam meus
dados?". Custo: uma VPS por cliente, e atualizar N instalações.

### Recomendação

| Fase | Topologia | Gatilho para a próxima |
|---|---|---|
| Piloto e clínicas 1–5 | **A** | medição do §4 passar de 60% |
| Clínicas 6–15 | **A com VPS maior** (6–8 GB, `mem_limit` 2048–3584m) | segunda clínica de alto volume, ou primeira queda que atinja todas |
| Acima de 15, ou cliente exigente | **C, dedicada** | vender como plano superior, com preço próprio |

**A topologia B fica fora até que exista uma razão que C não resolva.** Ela é a única que exige tocar no
código, e o PRD é explícito: divergência do upstream custa mais do que uma VPS a mais.

### A conta comercial que fecha isso

Uma VPS de 4 GB custa da ordem de R$140/mês. Distribuída entre 5 clínicas, é R$28 por clínica por mês.
Uma instalação dedicada custa os mesmos R$140 para uma clínica só — que é preço perfeitamente vendável para
uma clínica que fatura em tratamento o que fatura, **e que compra o argumento de dado separado e marca
própria**. A dedicada não é a saída cara; é o plano superior.

---

## 6. Custo que este estudo eliminou

O runbook `waha-hostgator.md` lista como pré-requisito:

> *"4. Licença ativa **WAHA Plus** (`https://waha.devlike.pro` — ~$30/mês)."*

**Isso não vale mais.** O WAHA Plus foi fundido no WAHA Core na versão **2026.6.1**: sessões ilimitadas,
mídia, todos os storages e as features de segurança passaram a ser gratuitas e open source, sem imagem
separada e sem chave de Docker. O `docker-compose.prod.yml` deste repositório já usa
`devlikeapro/waha:latest-2026.7.2`, posterior à fusão.

**Economia: US$ 30/mês por instalação** — e, no modelo de instalação dedicada do §5, isso é US$ 30 por
clínica por mês que sai da conta.

Duas afirmações obsoletas ficam para corrigir upstream, e ambas são de uma linha:
o pré-requisito 4 deste runbook, e o comentário do `docker-compose.prod.yml` que diz
*"troque para `devlikeapro/waha-plus` … (licença paga)"*.

---

## 7. O que ainda não foi medido

Honestidade sobre os limites deste documento:

- **Nada aqui foi medido numa VPS.** O modelo usa os números que o projeto publicou; o §4 existe para
  substituí-los por medição real.
- **O pico de 893 MiB do compose não diz quantas sessões havia.** Se foi com uma sessão, o overhead real é
  bem maior que os 300 MB do modelo, e a capacidade cai para ~2 ou 3 clínicas. **Esta é a incerteza mais
  relevante do documento, e a primeira medição a resolve.**
- **Consumo de CPU por sessão não tem número publicado**, só a recomendação de 2 vCPU mínimos.
- **Crescimento do volume `.sessions` ao longo do tempo** não tem número. Monitore.
