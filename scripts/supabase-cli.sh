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

# ─────────────────────────────────────────────────────────────────────────────
# URL de la BD. Dos modos:
#
#  · OVERRIDE (CI / BD efímera): si DATABASE_URL viene en el entorno, se usa TAL
#    CUAL y NO se lee apps/web/.env.local. Lo usa el job de pgTAP del CI (F15-B)
#    apuntando a la BD local efímera (127.0.0.1:54322) creada por `supabase start`.
#    Así el CI no necesita NINGÚN secret ni las credenciales de prod.
#
#  · LOCAL (comportamiento de SIEMPRE, sin cambios): si NO hay DATABASE_URL, se
#    construye la URL del pooler de PRODUCCIÓN desde apps/web/.env.local, igual que
#    antes. `pnpm db:test` sin variable sigue funcionando exactamente como hoy.
# ─────────────────────────────────────────────────────────────────────────────
if [[ -n "${DATABASE_URL:-}" ]]; then
  DB_URL="$DATABASE_URL"
else
  ENV_FILE="$REPO_ROOT/apps/web/.env.local"

  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Error: $ENV_FILE no encontrado. Configura las vars de Supabase primero" >&2
    echo "       (o exporta DATABASE_URL para apuntar a otra BD, p.ej. en CI)." >&2
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
  # rutean IPv6 al puerto 5432.
  #
  # Puerto 5432 = pooler en modo SESSION (statements + prepared statements completos).
  # Puerto 6543 = pooler en modo TRANSACTION (no soporta named prepared statements,
  #                ni cosas tipo `set local`, lo que rompe `supabase db push` con
  #                `prepared statement "lrupsc_1_0" already exists`).
  # Para migraciones (DDL) usamos session mode siempre.
  DB_URL="postgresql://postgres.${SUPABASE_PROJECT_REF}:${ENC_PW}@aws-0-${SUPABASE_DB_REGION}.pooler.supabase.com:5432/postgres"
fi

SUPABASE_VERSION="2.98.2"

case "$CMD" in
  push)
    exec npx "supabase@${SUPABASE_VERSION}" db push --db-url "$DB_URL" "$@"
    ;;
  types)
    # `gen types --db-url` requiere Docker (bug del CLI 2.98). Usamos
    # `--project-id`, que va por el Management API y solo necesita el access
    # token (que sí tiene permiso de lectura para esta operación).
    #
    # LO QUE HAY QUE SABER DE ESTE SUBCOMANDO: con `--project-id` el TypeScript
    # NO lo genera el CLI. Lo genera SUPABASE, en el servidor. El CLI es un
    # cliente HTTP de `GET /v1/projects/{ref}/types/typescript`. Comprobado:
    # la respuesta cruda de esa ruta y la salida del CLI son BYTE A BYTE
    # idénticas, con 2.98.2 y con 2.117.0.
    #
    # Dos consecuencias que ahorran depuraciones:
    #  · La versión del CLI aquí da igual. Lo único en lo que se diferencian
    #    2.98.2 y 2.117.0 es qué esquemas piden por defecto (ver --schema abajo).
    #  · El fichero puede cambiar SIN que cambie ni el esquema ni el CLI, porque
    #    el generador del servidor se actualiza solo. Pasó entre julio y hoy:
    #    paréntesis nuevos en los genéricos y otro `PostgrestVersion`.
    : "${SUPABASE_ACCESS_TOKEN:?falta SUPABASE_ACCESS_TOKEN en apps/web/.env.local}"
    OUT="$REPO_ROOT/packages/core/src/supabase/database.ts"

    # `--schema public` EXPLÍCITO, y no por gusto: 2.98.2 pide `public` a secas y
    # 2.99+ pide `public,graphql_public`, así que sin esta línea la salida depende
    # de qué CLI tengas instalado. Con ella, el fichero es el mismo con cualquiera.
    ARGS=("$@")
    if [[ " ${ARGS[*]-} " != *" --schema "* ]]; then
      ARGS+=(--schema public)
    fi

    # NO se escribe sobre el fichero hasta que la generación haya salido bien.
    # Antes esto era `... > "$OUT"`, y el `>` TRUNCA ANTES de ejecutar nada: un
    # timeout, un token caducado o un 500 del Management API dejaban database.ts
    # vacío, y el error que veías después era un typecheck con mil fallos en vez
    # del fallo de red que lo había causado.
    TMP="$(mktemp)"
    trap 'rm -f "$TMP"' EXIT

    echo "Generando types desde proyecto $SUPABASE_PROJECT_REF → $OUT"
    if ! npx "supabase@${SUPABASE_VERSION}" gen types typescript \
           --project-id "$SUPABASE_PROJECT_REF" "${ARGS[@]}" > "$TMP"; then
      echo "Error: la generación falló. $OUT NO se ha tocado." >&2
      exit 1
    fi

    # Salió con código 0, pero eso no basta: comprobamos que lo que hay dentro es
    # un fichero de tipos y no una página de error, un JSON de la API o vacío.
    if [[ ! -s "$TMP" ]] || ! grep -q '^export type Database' "$TMP"; then
      echo "Error: la salida no parece un database.ts ($(wc -c < "$TMP") bytes)." >&2
      echo "       $OUT NO se ha tocado. Primeras líneas de lo recibido:" >&2
      head -5 "$TMP" >&2
      exit 1
    fi

    mv "$TMP" "$OUT"
    trap - EXIT
    echo "OK ($(wc -l < "$OUT") líneas)"
    ;;
  test)
    # Ejecuta los .sql de supabase/tests/ contra la BD remota.
    # Cada test se envuelve en BEGIN/ROLLBACK, así que NO deja rastros en la BD.
    # Requiere `psql` instalado localmente.
    if ! command -v psql >/dev/null 2>&1; then
      echo "Error: necesitas psql instalado. Apt: 'sudo apt install postgresql-client'." >&2
      exit 1
    fi
    cd "$REPO_ROOT"
    shopt -s nullglob
    files=(supabase/tests/*.sql)
    if [ "${#files[@]}" -eq 0 ]; then
      echo "No hay tests en supabase/tests/" >&2
      exit 1
    fi
    rc=0
    for f in "${files[@]}"; do
      echo ""
      echo "▶ $f"
      if ! psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f"; then
        echo "✗ Falló: $f" >&2
        rc=1
      fi
    done
    exit $rc
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
    exec npx "supabase@${SUPABASE_VERSION}" db reset --db-url "$DB_URL" "$@"
    ;;
  *)
    echo "Uso: $0 {push|types|reset} [args adicionales pasados al CLI]" >&2
    echo "Ver docs/architecture/supabase-cli-without-link.md" >&2
    exit 1
    ;;
esac
