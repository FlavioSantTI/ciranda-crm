#!/usr/bin/env bash
#
# deploy-waconector-vps.sh — Deploy do clinicCRM com adapter waconector na VPS.
#
# O waconector está VENDORizado em vendor/waconector/ (build self-contained,
# zero-deps). Não precisa clonar nem buildar nada extra — o docker build do
# clinicCRM pega o vendored direto via `file:vendor/waconector` no package.json.
#
# Pre-requisitos na VPS: docker, docker compose, git
#
# Uso:
#   bash deploy-waconector-vps.sh              # build + up
#   bash deploy-waconector-vps.sh --skip-build # só up (já buildou antes)
#
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
# Repositório privado. O clone na VPS precisa de acesso (gh auth login
# ou uma deploy key). O fork público clinicCRM não tem a marca Ciranda.
CLINIC_CRM_REPO="https://github.com/FlavioSantTI/ciranda-crm.git"
CLINIC_CRM_BRANCH="cursor/waconector-adapter"
INSTALL_DIR="${INSTALL_DIR:-/opt/cliniccrm-waconector}"

echo "============================================"
echo "  Deploy clinicCRM + waconector na VPS"
echo "  (waconector vendorizado — sem clone extra)"
echo "============================================"
echo ""

# ─── 1. Clonar clinicCRM ────────────────────────────────────────────────────
echo "1. Clonando clinicCRM..."

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ ! -d "clinicCRM" ]; then
    git clone -b "$CLINIC_CRM_BRANCH" "$CLINIC_CRM_REPO" clinicCRM
else
  echo "   clinicCRM ja existe — atualizando"
  cd clinicCRM && git pull origin "$CLINIC_CRM_BRANCH" && cd ..
fi

# ─── 2. Configurar .env ─────────────────────────────────────────────────────
echo ""
echo "2. Configurando .env..."

cd clinicCRM

if [ ! -f .env ]; then
  echo ""
  echo "   Preencha as variaveis abaixo (Enter = valor default):"
  echo ""

  # Defaults baseados na VPS do Flavio
  DEFAULT_DOMAIN="${DOMAIN:-crm.flaviosantiago.com.br}"
  DEFAULT_EMAIL="${ACME_EMAIL:-flavio@flaviosantiago.com.br}"
  DEFAULT_SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL:-https://supabase.flaviosantiago.com.br}"
  DEFAULT_EVOAPI_URL="${WACONECTOR_BASE_URL:-https://evoapi.flaviosantiago.com.br}"
  DEFAULT_EVOAPI_KEY="${WACONECTOR_API_KEY:-}"
  DEFAULT_EVOAPI_INSTANCE="${WACONECTOR_INSTANCE:-Bertuol-TI}"

  read -rp "   Dominio do CRM [$DEFAULT_DOMAIN]: " DOMAIN; DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
  read -rp "   Email ACME [$DEFAULT_EMAIL]: " ACME_EMAIL; ACME_EMAIL="${ACME_EMAIL:-$DEFAULT_EMAIL}"
  read -rp "   Supabase URL [$DEFAULT_SUPABASE_URL]: " SUPABASE_URL; SUPABASE_URL="${SUPABASE_URL:-$DEFAULT_SUPABASE_URL}"
  read -rp "   Supabase Anon Key: " SUPABASE_ANON_KEY
  read -rp "   Supabase Service Role Key: " SUPABASE_SERVICE_KEY
  read -rp "   EvoAPI URL [$DEFAULT_EVOAPI_URL]: " EVOAPI_URL; EVOAPI_URL="${EVOAPI_URL:-$DEFAULT_EVOAPI_URL}"
  read -rp "   EvoAPI API Key [$DEFAULT_EVOAPI_KEY]: " EVOAPI_KEY; EVOAPI_KEY="${EVOAPI_KEY:-$DEFAULT_EVOAPI_KEY}"
  read -rp "   EvoAPI Instancia [$DEFAULT_EVOAPI_INSTANCE]: " EVOAPI_INST; EVOAPI_INST="${EVOAPI_INST:-$DEFAULT_EVOAPI_INSTANCE}"

  # Gerar secrets internos
  INTERNAL_SECRET=$(openssl rand -hex 32)
  WAHA_HMAC_SECRET=$(openssl rand -hex 32)
  SRH_TOKEN=$(openssl rand -hex 32)

  cat > .env << ENVEOF
# ─── Dominio / HTTPS ──────────────────────────
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
REVERSE_PROXY=traefik
TRAEFIK_NETWORK=${TRAEFIK_NETWORK:-Favucanet}

# ─── Supabase ────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_KEY

# ─── Secrets internos ────────────────────────
INTERNAL_SECRET=$INTERNAL_SECRET
WAHA_HMAC_SECRET=$WAHA_HMAC_SECRET
SRH_TOKEN=$SRH_TOKEN

# ─── WAHA (desligado — vamos usar waconector) ─
WAHA_API_BASE_URL=
WAHA_API_KEY=

# ─── WACONECTOR (EvoAPI v2) ─────────────────
WACONECTOR_BASE_URL=$EVOAPI_URL
WACONECTOR_API_KEY=$EVOAPI_KEY
WACONECTOR_BACKEND=evolution
WACONECTOR_INSTANCE=$EVOAPI_INST

# ─── Build local (nao puxar do registry) ────
APP_IMAGE=ciranda-app:local
WORKER_IMAGE=ciranda-worker:local
SCHEDULER_IMAGE=ciranda-scheduler:local
APP_PULL_POLICY=never
WORKER_PULL_POLICY=never
SCHEDULER_PULL_POLICY=never
ENVEOF

  echo "   .env criado!"
else
  echo "   .env ja existe — pulando"
fi

# ─── 3. Buildar e subir ─────────────────────────────────────────────────────
echo ""
echo "3. Buildando imagens Docker (pode levar 15-25min)..."
echo "   (waconector vendored entra no build automaticamente)"
echo ""

if [ "${1:-}" != "--skip-build" ]; then
  docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build
fi

echo ""
echo "4. Subindo stack (Traefik da VPS faz o HTTPS; o Caddy fica de fora)..."
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml -f docker-compose.build.yml up -d

echo ""
echo "============================================"
echo "  Deploy concluido!"
echo "============================================"
DOMAIN="${DOMAIN:-$(grep -E '^DOMAIN=' .env | cut -d= -f2-)}"
EVOAPI_URL="${EVOAPI_URL:-$(grep -E '^WACONECTOR_BASE_URL=' .env | cut -d= -f2-)}"
EVOAPI_INST="${EVOAPI_INST:-$(grep -E '^WACONECTOR_INSTANCE=' .env | cut -d= -f2-)}"
echo ""
echo "  CRM:       https://$DOMAIN"
echo "  EvoAPI:     $EVOAPI_URL"
echo "  Instancia:  $EVOAPI_INST"
echo ""
echo "  Proximo passo: configurar o webhook da EvoAPI"
echo ""

# ─── 5. Mostrar URL do webhook ─────────────────────────────────────────────
WEBHOOK_TOKEN=$(grep -oP 'waconectorbertuolti[a-f0-9]+' .env 2>/dev/null || echo "")
if [ -z "$WEBHOOK_TOKEN" ]; then
  echo "  AVISO: Token do webhook nao encontrado no .env."
  echo "  Configure o webhook manualmente na EvoAPI apontando para:"
  echo "  https://$DOMAIN/api/v1/webhooks/channel/<SEU_TOKEN>"
else
  echo "  Webhook URL (configure na EvoAPI):"
  echo "  https://$DOMAIN/api/v1/webhooks/channel/$WEBHOOK_TOKEN"
fi

echo ""
echo "  Logs: docker compose -f docker-compose.prod.yml logs -f app"
echo "  Stop: docker compose -f docker-compose.prod.yml down"
echo ""
