#!/usr/bin/env bash
# scripts/supabase-cli.sh
#
# Wrapper para `supabase` CLI cuando no podemos usar `supabase link` (token sin
# privilegios sobre el Management API). Carga las vars de apps/web/.env.local,
# construye la URL del proyecto remoto y la inyecta como `--db-url` en cada
# subcomando relevante.
#
# Uso (a través de pnpm scripts):
#   pnpm db:push        → aplica migraciones a la BD remota
#   pnpm db:types       → genera packages/core/src/supabase/database.ts
#   pnpm db:reset       → ⚠️  borra el schema público remoto (pide confirmación)
#
# Doc: docs/architecture/supabase-cli-without-link.md

set -euo pipefail

CMD="${1:-}"
shift || true

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$REPO_ROOT/apps/web/.env.local"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Error: $ENV_FILE no encontrado. Configura las vars de Supabase primero." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${SUPABASE_DB_PASSWORD:?falta SUPABASE_DB_PASSWORD en apps/web/.env.local}"
: "${SUPABASE_PROJECT_REF:?falta SUPABASE_PROJECT_REF en apps/web/.env.local}"

# Región del proyecto Supabase. Necesaria para construir el host del pooler IPv4.
# Default eu-west-1 (MisterFC). Override vía env var si cambia.
SUPABASE_DB_REGION="${SUPABASE_DB_REGION:-eu-west-1}"

# La password puede tener caracteres reservados de URL (@, :, /, etc.).
# Codificamos vía Node para no depender de python.
ENC_PW=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$SUPABASE_DB_PASSWORD")

# Usamos el pooler IPv4 en lugar de la conexión directa porque el host directo
# `db.<ref>.supabase.co` solo resuelve a IPv6 en muchas regiones, y no todos los
# entornos (Vercel runtime, Codespaces, CI con redes limitadas, el harness local)
# rutean IPv6 al puerto 5432. El pooler en modo transaction (6543) sirve para
# DDL de migraciones porque cada statement es una transacción independiente.
REMOTE_DB_URL="postgresql://postgres.${SUPABASE_PROJECT_REF}:${ENC_PW}@aws-0-${SUPABASE_DB_REGION}.pooler.supabase.com:6543/postgres"

SUPABASE_VERSION="2.98.2"

case "$CMD" in
  push)
    exec npx "supabase@${SUPABASE_VERSION}" db push --db-url "$REMOTE_DB_URL" "$@"
    ;;
  types)
    # `gen types --db-url` requiere Docker (bug del CLI 2.98). Usamos
    # `--project-id` que va por el Management API y solo necesita el access
    # token (que sí tiene permiso de lectura para esta operación).
    : "${SUPABASE_ACCESS_TOKEN:?falta SUPABASE_ACCESS_TOKEN en apps/web/.env.local}"
    OUT="$REPO_ROOT/packages/core/src/supabase/database.ts"
    echo "Generando types desde proyecto $SUPABASE_PROJECT_REF → $OUT"
    npx "supabase@${SUPABASE_VERSION}" gen types typescript --project-id "$SUPABASE_PROJECT_REF" "$@" > "$OUT"
    echo "OK"
    ;;
  reset)
    echo "⚠️  db:reset apunta al proyecto REMOTO (ref=$SUPABASE_PROJECT_REF)." >&2
    echo "   Esto borra TODO el schema public. Solo usar en proyectos vacíos o de prueba." >&2
    echo "   Confirma escribiendo exactamente: reset $SUPABASE_PROJECT_REF" >&2
    read -r CONFIRM
    if [[ "$CONFIRM" != "reset $SUPABASE_PROJECT_REF" ]]; then
      echo "Abortado." >&2
      exit 1
    fi
    exec npx "supabase@${SUPABASE_VERSION}" db reset --db-url "$REMOTE_DB_URL" "$@"
    ;;
  *)
    echo "Uso: $0 {push|types|reset} [args adicionales pasados al CLI]" >&2
    echo "Ver docs/architecture/supabase-cli-without-link.md" >&2
    exit 1
    ;;
esac
