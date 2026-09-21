#!/usr/bin/env bash
# Re-vendoriza o waconector a partir de um checkout local do repo upstream.
#
# Uso:
#   bash scripts/vendor-waconector.sh /caminho/para/waconector-checkout
#
# O que faz:
#   1. Copia dist/ (build compilado) para vendor/waconector/dist/
#   2. Gera um package.json limpo (sem devDeps, scripts, bin)
#   3. Atualiza o v2-patch.patch (se houver diff contra o upstream)
#   4. Não commita — revise e commit você mesmo.
#
# Pré-requisitos:
#   - O checkout do waconector upstream deve estar BUILDADO (pnpm build)
#   - Se o patch v2 ainda não foi mergeado upstream, aplique-o ANTES de buildar
#
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Uso: bash scripts/vendor-waconector.sh /caminho/para/waconector-checkout"
  exit 1
fi

SRC="$1"
DEST="$(cd "$(dirname "$0")/.." && pwd)/vendor/waconector"

if [ ! -d "$SRC/dist" ]; then
  echo "ERRO: $SRC/dist não encontrado. Rode 'pnpm build' no checkout do waconector primeiro."
  exit 1
fi

echo "→ Copiando dist/ de $SRC para $DEST"
rm -rf "$DEST/dist"
cp -R "$SRC/dist" "$DEST/dist"

echo "→ Gerando package.json limpo"
# Extrai só os campos necessários do package.json upstream
node -e "
const pkg = require('$SRC/package.json');
const clean = {
  name: pkg.name,
  version: pkg.version + '-vendored',
  description: pkg.description + ' (vendorizado no clinicCRM com patch EvoAPI v2)',
  license: pkg.license,
  author: pkg.author,
  type: pkg.type || 'module',
  exports: pkg.exports,
  main: pkg.main,
  module: pkg.module,
  types: pkg.types,
  files: pkg.files,
  sideEffects: pkg.sideEffects ?? false,
  engines: pkg.engines,
};
require('fs').writeFileSync('$DEST/package.json', JSON.stringify(clean, null, 2) + '\n');
"

echo "→ Atualizando v2-patch.patch (se houver diff)"
if [ -d "$SRC/.git" ]; then
  (cd "$SRC" && git diff > "$DEST/v2-patch.patch" 2>/dev/null) || true
  if [ ! -s "$DEST/v2-patch.patch" ]; then
    echo "  (nenhum diff local — patch v2 já mergeado upstream ou checkout limpo)"
    rm -f "$DEST/v2-patch.patch"
  fi
fi

echo ""
echo "✓ Vendorização concluída em $DEST"
echo ""
echo "Próximos passos:"
echo "  1. Revise as mudanças: git diff vendor/waconector/"
echo "  2. Atualize a versão em vendor/waconector/README.md se necessário"
echo "  3. Rode 'pnpm install' e 'pnpm typecheck' no clinicCRM"
echo "  4. Commit: git add vendor/waconector/ && git commit"
