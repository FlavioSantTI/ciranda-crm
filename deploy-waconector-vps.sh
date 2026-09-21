#!/usr/bin/env bash
#
# deploy-waconector-vps.sh — Deploy do clinicCRM com adapter waconector na VPS.
#
# Pre-requisitos na VPS: docker, docker compose, git, node/pnpm (so p/ buildar waconector)
#
# Uso:
#   bash deploy-waconector-vps.sh
#
set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────
CLINIC_CRM_REPO="https://github.com/FlavioSantTI/clinicCRM.git"
CLINIC_CRM_BRANCH="cursor/waconector-adapter"
WACONECTOR_REPO="https://github.com/alltomatos/waconector.git"
INSTALL_DIR="${INSTALL_DIR:-/opt/cliniccrm-waconector}"

echo "============================================"
echo "  Deploy clinicCRM + waconector na VPS"
echo "============================================"
echo ""

# ─── 1. Clonar repos ────────────────────────────────────────────────────────
echo "1. Clonando repos..."

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

if [ ! -d "clinicCRM" ]; then
  git clone -b "$CLINIC_CRM_BRANCH" "$CLINIC_CRM_REPO" clinicCRM
else
  echo "   clinicCRM ja existe — pulando clone"
  cd clinicCRM && git pull origin "$CLINIC_CRM_BRANCH" && cd ..
fi

if [ ! -d "waconector" ]; then
  git clone "$WACONECTOR_REPO" waconector
else
  echo "   waconector ja existe — pulando clone"
  cd waconector && git pull && cd ..
fi

# ─── 2. Aplicar patch v2 do waconector ─────────────────────────────────────
echo ""
echo "2. Aplicando patch v2 do waconector (EvoAPI v2 support)..."

cd waconector
if git log --oneline -1 | grep -q "EvoAPI v2"; then
  echo "   Patch ja aplicado — pulando"
else
  git apply ../clinicCRM/waconector-v2.patch
  echo "   Patch aplicado!"
fi
cd ..

# ─── 3. Buildar waconector ──────────────────────────────────────────────────
echo ""
echo "3. Buildando waconector..."

cd waconector
if [ ! -f dist/index.js ] && [ ! -f dist/index.cjs ]; then
  npm install -g pnpm 2>/dev/null || true
  pnpm install --frozen-lockfile
  pnpm build
  echo "   waconector buildado!"
else
  echo "   dist ja existe — pulando build"
fi
cd ..

# ─── 4. Configurar .env ─────────────────────────────────────────────────────
echo ""
echo "4. Configurando .env..."

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
REVERSE_PROXY=caddy

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
APP_IMAGE=deskcomm-app:local
WORKER_IMAGE=deskcomm-worker:local
SCHEDULER_IMAGE=deskcomm-scheduler:local
APP_PULL_POLICY=never
WORKER_PULL_POLICY=never
SCHEDULER_PULL_POLICY=never
ENVEOF

  echo "   .env criado!"
else
  echo "   .env ja existe — pulando"
fi

# ─── 5. Buildar e subir ─────────────────────────────────────────────────────
echo ""
echo "5. Buildando imagens Docker (pode levar 15-25min)..."
echo "   (Use --skip-build se ja buildou antes)"
echo ""

if [ "${1:-}" != "--skip-build" ]; then
  docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build
fi

echo ""
echo "6. Subindo stack..."
docker compose -f docker-compose.prod.yml up -d

echo ""
echo "============================================"
echo "  Deploy concluido!"
echo "============================================"
echo ""
echo "  CRM:      https://$DOMAIN"
echo "  EvoAPI:    $WACONECTOR_BASE_URL"
echo "  Instancia: $WACONECTOR_INSTANCE"
echo ""
echo "  Proximo passo: configurar o webhook da EvoAPI"
echo "  Veja o output do script de webhook abaixo."
echo ""

# ─── 7. Mostrar URL do webhook ─────────────────────────────────────────────
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
