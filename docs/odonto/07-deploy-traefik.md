# Deploy no ambiente Traefik + Portainer

> Adaptado para a VPS de Flavio Santiago: Traefik + rede `Favucanet` + Docker Swarm.
> O compose adaptado está em `docker-compose.traefik.yml` (sem Caddy).

---

## Pré-requisitos na VPS

```bash
# confirmar que Swarm está ativo
docker info | grep "Swarm: active"

# confirmar que a rede Favucanet existe
docker network ls | grep Favucanet

# confirmar RAM livre (precisa de ~3 GB para o clinicCRM)
free -h
```

---

## Passo 1 — Criar o projeto Supabase

1. Criar projeto em [supabase.com](https://supabase.com) — anote a região (preferir São Paulo)
2. No SQL Editor, rodar as extensões e depois o baseline:

```sql
create extension if not exists vector with schema public;
create extension if not exists citext with schema public;
create extension if not exists pg_trgm with schema public;
```

3. Colar o conteúdo de `supabase/baseline.sql` no SQL Editor (em partes se necessário)
4. Anotar de Settings → API: `Project URL`, `anon key`, `service_role key`
5. Anotar de Settings → Database: connection string do **Session pooler** (modo URI)

---

## Passo 2 — Clonar o repo na VPS

```bash
cd /opt
git clone https://github.com/FlavioSantTI/clinicCRM.git
cd clinicCRM
```

---

## Passo 3 — Criar o `.env`

```bash
cp .env.example .env
```

Preencher **obrigatoriamente** (não deixar vazio — vazio quebra o app):

```bash
DOMAIN=crm.flaviosantiago.com.br
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
SUPABASE_DB_URL=postgresql://postgres:<senha>@<host>:6543/postgres
```

Gerar os secrets internos:

```bash
# WAHA API key + hash sha512 dela
WAHA_KEY=$(openssl rand -hex 24)
echo "WAHA_API_KEY=$WAHA_KEY"
echo "WAHA_API_KEY_SHA512=$(echo -n "$WAHA_KEY" | sha512sum | cut -d' ' -f1)"

# SRH token
echo "SRH_TOKEN=$(openssl rand -hex 24)"

# Internal secret (scheduler → app)
echo "INTERNAL_SECRET=$(openssl rand -hex 24)"

# WAHA HMAC
echo "WAHA_HMAC_SECRET=$(openssl rand -hex 24)"
```

Colar esses valores no `.env`.

**Importante sobre o webhook do WAHA:** o compose adaptado usa
`WHATSAPP_HOOK_URL: http://app:3000/api/v1/webhooks/waha` (interno), então
**não preencha `WAHA_WEBHOOK_BASE_URL`** — o compose já resolve na rede interna.

Provedor de IA (mínimo para o piloto):

```bash
OPENROUTER_API_KEY=<sua chave>
# OU
ANTHROPIC_API_KEY=<sua chave>
```

Chave OpenAI (necessária para áudio e RAG):

```bash
OPENAI_API_KEY=<sua chave>
```

Admin inicial:

```bash
OWNER_EMAIL=seu@email.com
OWNER_PASSWORD=<mínimo 8 caracteres>
```

---

## Passo 4 — Apontar o DNS

Criar registro A `crm.flaviosantiago.com.br` → IP da VPS.

O Traefik com `letsencryptresolver` emite o certificado automaticamente
no primeiro acesso.

---

## Passo 5 — Deploy via Portainer

### Opção A — Portainer Stacks (Swarm)

1. No Portainer: **Stacks → Add stack**
2. Nome: `deskcomm`
3. **Web editor** — colar o conteúdo de `docker-compose.traefik.yml`
4. **Environment variables** — ou colar o `.env` no campo de env, ou usar
   `env_file: .env` (precisa que o arquivo exista no path do stack)
5. **Deploy**

> Se o Portainer não encontrar o `.env`, cole as variáveis direto no campo
> de environment do stack. Remova a linha `env_file: .env` do compose e
> adicione as variáveis na seção `environment` de cada serviço, ou use
> o campo de env vars do Portainer.

### Opção B — CLI (Swarm)

```bash
cd /opt/clinicCRM
docker stack deploy -c docker-compose.traefik.yml --env-file .env deskcomm
```

---

## Passo 6 — Verificar

```bash
# containers no ar
docker service ls --filter name=deskcomm

# logs do app
docker service logs deskcomm_app --tail 30

# health do app (pelo Traefik)
curl -s https://crm.flaviosantiago.com.br/api/v1/health | head -5
```

---

## Passo 7 — Primeiro login + WhatsApp

1. Abrir `https://crm.flaviosantiago.com.br`
2. Entrar com o admin criado
3. No onboarding, escanear o QR com o WhatsApp da clínica
4. **Rodar a medição do WAHA** (doc `02-dimensionamento-waha.md` §4)

---

## Diferenças do compose original

| Item | Original (`prod.yml`) | Adaptado (`traefik.yml`) |
|---|---|---|
| HTTPS | Caddy (próprio) | Traefik (existente) |
| Rede externa | nenhuma | `Favucanet` (app only) |
| WAHA webhook | URL pública | `http://app:3000` (interno) |
| `mem_limit` | Compose v2 | `deploy.resources.limits` |
| `depends_on` | sim | removido (Swarm não suporta) |
| `build:` | sim (fallback) | removido (Swarm não builda) |
| `restart:` | `unless-stopped` | `deploy.restart_policy` |

---

## ⚠️ Segurança

As credenciais compartilhadas no chat (API keys, senhas de banco, SMTP)
ficaram expostas. **Rotacione após o deploy**:

- EvoAPI: nova API key
- PostgreSQL: nova senha
- n8n: nova encryption key
- SMTP: nova senha

---

## Sobre o EvoAPI

Você já tem Evolution API rodando — é uma API de WhatsApp, mesmo papel do WAHA.
As APIs não são compatíveis (endpoints diferentes), então o clinicCRM não consegue
falar com o EvoAPI direto. Para o piloto, o WAHA do clinicCRM roda como serviço
separado na mesma VPS, sem conflito.

**Depois do piloto**, há dois caminhos para explorar:
1. **Adapter EvoAPI → WAHA** no clinicCRM (degrau 4 — código no core, evitar)
2. **Bridge via n8n**: EvoAPI recebe mensagens → n8n traduz → envia pro clinicCRM
   como webhook WAHA (degrau 2 — viável, sem tocar no core)

Nenhum é para agora. O piloto valida o produto com WAHA; a consolidação
com EvoAPI é otimização de infra, não requisito de produto.
