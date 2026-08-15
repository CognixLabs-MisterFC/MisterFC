#!/usr/bin/env bash
#
# Build LOCAL de un APK de DEBUG para QA en la máquina (Chromebook), SIN gastar
# builds de EAS. Es una herramienta de QA, NO el camino de release: EAS sigue
# produciendo los APK/AAB reales y su comportamiento no cambia.
#
# Requisitos (ya instalados por Jose): Java 21, ANDROID_HOME con platforms
# android-34/36, build-tools 34/36, NDK 27.1.12297006, cmdline-tools.
#
# USO:
#   1) Crea apps/native/.env.local (NO se versiona) con los MISMOS valores que el
#      entorno `production` de EAS:
#         EXPO_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
#         EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
#         EXPO_PUBLIC_WEB_URL=https://<dominio-web>
#         EXPO_PUBLIC_SENTRY_DSN=<dsn>          # opcional (sin él, Sentry off)
#         # opcional: ANDROID_ABI=arm64-v8a     # ABI del dispositivo de QA
#         # opcional: GRADLE_WORKERS=1
#      NUNCA pongas aquí SENTRY_AUTH_TOKEN: en local no se suben sourcemaps.
#   2) ./build-apk.sh
#   3) Instala el APK y arranca Metro para el JS (ver el final del script).
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

# --- 1. SDK de Android ---------------------------------------------------------
export ANDROID_HOME="${ANDROID_HOME:-/home/jovimib/Android}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
if [ ! -d "$ANDROID_HOME" ]; then
  echo "❌ ANDROID_HOME no existe: $ANDROID_HOME" >&2
  exit 1
fi

# --- 2. Variables de la app (.env.local, ignorado por git) ---------------------
# La app LANZA una excepción al arrancar si faltan las de Supabase (supabase.ts),
# así que las validamos ANTES de compilar para no generar un APK que se cuelga.
ENV_FILE="$HERE/.env.local"
if [ ! -f "$ENV_FILE" ]; then
  cat >&2 <<'EOF'
❌ Falta apps/native/.env.local
   Créalo (NO se versiona) con, al menos:
     EXPO_PUBLIC_SUPABASE_URL=https://<proyecto>.supabase.co
     EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>
     EXPO_PUBLIC_WEB_URL=https://<dominio-web>
     EXPO_PUBLIC_SENTRY_DSN=<dsn>          # opcional
   Usa los MISMOS valores del entorno production de EAS.
EOF
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

missing=()
for v in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_WEB_URL; do
  if [ -z "${!v:-}" ]; then missing+=("$v"); fi
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo "❌ Faltan variables OBLIGATORIAS en .env.local: ${missing[*]}" >&2
  echo "   Sin SUPABASE_URL/ANON_KEY la app se cuelga al arrancar; sin WEB_URL fallan" >&2
  echo "   las pantallas que llaman a los route handlers de la web." >&2
  exit 1
fi
if [ -z "${EXPO_PUBLIC_SENTRY_DSN:-}" ]; then
  echo "⚠️  EXPO_PUBLIC_SENTRY_DSN vacío: Sentry quedará desactivado (la app arranca igual)."
fi

# --- 3. Sentry: NO subir sourcemaps en local -----------------------------------
# sentry-cli no degrada solo sin token (verificado en #458): fallaría el build.
# Lo desactivamos SOLO en este entorno local; EAS no se toca y sigue subiendo.
export SENTRY_DISABLE_AUTO_UPLOAD=true

# --- 4. android/ (CNG): app.json es la fuente de verdad ------------------------
# Se genera con prebuild si no existe. Si cambias app.json (icono/splash/plugins),
# regenera con:  rm -rf android && ./build-apk.sh   (o `npx expo prebuild -p android`).
if [ ! -d "$HERE/android" ]; then
  echo "▶ Generando android/ con expo prebuild (no se versiona)…"
  npx expo prebuild -p android
fi

# --- 4b. Overrides LOCALES de memoria (android/ es gitignored y regenerable) ----
# La máquina tiene 2 cores y poca RAM (historial de OOM: el daemon de Gradle "desaparece").
# Kotlin IN-PROCESS evita un 2º JVM (ahorra ~1 GB); el resto lo pasamos por CLI/env.
# Marcado con un centinela para no duplicar en re-ejecuciones.
GRADLE_PROPS="$HERE/android/gradle.properties"
if ! grep -q "build-apk.sh overrides" "$GRADLE_PROPS" 2>/dev/null; then
  {
    echo ""
    echo "# --- build-apk.sh overrides (LOCAL, 2 cores/poca RAM; no se versiona) ---"
    # Heap de Gradle a 1.5 GB (el default 2 GB no cabe junto al IDE en 6.5 GB de RAM;
    # el daemon 'desaparecía' por OOM). Esta línea gana sobre el org.gradle.jvmargs de
    # más arriba (en un .properties, la última definición de una clave manda).
    echo "org.gradle.jvmargs=-Xmx1536m -XX:MaxMetaspaceSize=384m -XX:+UseParallelGC"
    # Kotlin IN-PROCESS: evita un 2º JVM (ahorra ~1 GB).
    echo "kotlin.compiler.execution.strategy=in-process"
  } >> "$GRADLE_PROPS"
fi

# --- 5. Build acotado a la máquina (2 cores, poca RAM → historial de OOM) -------
# · Una sola ABI: por defecto trae 4 (armeabi-v7a, arm64-v8a, x86, x86_64) = 4×
#   la compilación C++ nativa. Con una sola bajamos tiempo y memoria a la cuarta parte.
# · CMAKE_BUILD_PARALLEL_LEVEL=1: serializa la compilación nativa (ninja), que si no
#   lanza 1 clang por core (~1.3 GB cada uno) y revienta la RAM.
# · --max-workers=1 y --no-parallel: serializa las tareas de Gradle.
export CMAKE_BUILD_PARALLEL_LEVEL="${CMAKE_JOBS:-1}"
ABI="${ANDROID_ABI:-arm64-v8a}"
WORKERS="${GRADLE_WORKERS:-1}"
echo "▶ ./gradlew assembleDebug  (ABI=$ABI, max-workers=$WORKERS, CMAKE_JOBS=$CMAKE_BUILD_PARALLEL_LEVEL, sin parallel)…"
cd "$HERE/android"
./gradlew assembleDebug \
  -PreactNativeArchitectures="$ABI" \
  --max-workers="$WORKERS" \
  --no-parallel

# --- 6. Resultado --------------------------------------------------------------
APK="$HERE/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "❌ El build terminó pero no se encontró el APK en:" >&2
  echo "   $APK" >&2
  exit 1
fi
SIZE="$(du -h "$APK" | cut -f1)"
cat <<EOF

✅ APK de DEBUG generado:
   $APK   ($SIZE)

Instalar en el dispositivo:
   adb install -r "$APK"

El APK debug carga el JS desde Metro. Arráncalo (Expo lee .env.local solo):
   pnpm --filter native start
   adb reverse tcp:8081 tcp:8081     # si el dispositivo va por USB
EOF
