#!/usr/bin/env bash
# Instalador de GraphSQL para Linux y macOS. Lo escribí para que la instalación sea UN comando:
#
#   curl -fsSL https://raw.githubusercontent.com/Arfeon/tfm-sql-agents/main/install.sh | bash
#
# Qué hace: comprueba los requisitos (Git, Node 20+, Docker), pregunta dónde instalar,
# clona el repo (o lo actualiza si ya está), prepara el .env con tu proveedor de IA,
# instala las dependencias y, si quieres, registra el comando global `gsql`. La
# infraestructura (contenedores, datos de prueba) NO la monta este script: la monta el
# propio programa, guiándote, la primera vez que lo arrancas.
#
# Ejecutado con `curl | bash` el stdin es el propio script, así que las preguntas leen
# de /dev/tty; sin terminal (CI), cada pregunta cae a su valor por defecto. Todas se
# pueden fijar por variable de entorno: GRAPHSQL_INSTALL_DIR, GRAPHSQL_PROVIDER
# (openai|local|gateway), GRAPHSQL_OPENAI_KEY, GRAPHSQL_GATEWAY_URL, GRAPHSQL_GATEWAY_KEY,
# GRAPHSQL_GATEWAY_MODEL, GRAPHSQL_GATEWAY_EMBEDDING_MODEL, GRAPHSQL_REGISTER_GSQL (yes|no)
# y GRAPHSQL_REPO_URL.

set -euo pipefail

REPO_URL="${GRAPHSQL_REPO_URL:-https://github.com/Arfeon/tfm-sql-agents.git}"
DEFAULT_DIR="$HOME/graphsql"

cyan()   { printf '\033[36m%s\033[0m\n' "$1"; }
green()  { printf '\033[32m[OK] %s\033[0m\n' "$1"; }
yellow() { printf '\033[33m[!] %s\033[0m\n' "$1"; }
fail()   { printf '\033[31m[X] %s\033[0m\n' "$1"; exit 1; }
step()   { printf '\n'; cyan "== $1"; }

# Pregunta con valor por defecto; una variable de entorno la responde sin preguntar,
# y sin terminal (curl | bash en CI) se toma el defecto directamente.
ask() {
  local question="$1" default="$2" env_value="${3:-}" answer=""
  if [ -n "$env_value" ]; then echo "$env_value"; return; fi
  if [ -r /dev/tty ]; then
    read -r -p "$question [$default]: " answer < /dev/tty || true
  fi
  echo "${answer:-$default}"
}

echo ""
cyan "  GraphSQL — instalador para Linux/macOS"
printf '\033[90m%s\033[0m\n' "  Consultas SQL en lenguaje natural sobre tu base de datos"

# ── 1. Requisitos ────────────────────────────────────────────────────────────────
step "Compruebo los requisitos"

command -v git >/dev/null 2>&1 || fail "Falta Git. Instálalo (p. ej. apt install git) y vuelve a ejecutar."
green "Git: $(git --version)"

command -v node >/dev/null 2>&1 || fail "Falta Node.js 20 o superior. Instala la versión LTS: https://nodejs.org (o usa nvm)."
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
[ "$NODE_MAJOR" -ge 20 ] || fail "Tu Node.js es la versión $NODE_MAJOR y hace falta 20 o superior (https://nodejs.org o nvm)."
green "Node.js: $(node --version)"

if command -v docker >/dev/null 2>&1; then
  green "Docker: $(docker --version)"
else
  yellow "Docker no está instalado. Puedes terminar la instalación igualmente, pero para"
  yellow "arrancar GraphSQL necesitarás Docker Engine + Compose v2: https://docs.docker.com/engine/install/"
fi

# ── 2. Directorio e instalación del código ──────────────────────────────────────
step "Dónde lo instalo"

INSTALL_DIR="$(ask 'Directorio de instalación' "$DEFAULT_DIR" "${GRAPHSQL_INSTALL_DIR:-}")"

if [ -d "$INSTALL_DIR/.git" ]; then
  green "Ya hay una instalación en $INSTALL_DIR — la actualizo (git pull)."
  git -C "$INSTALL_DIR" pull --ff-only || fail "No pude actualizar (git pull falló). Revisa cambios locales en esa carpeta."
elif [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  fail "La carpeta $INSTALL_DIR existe y no está vacía (y no es una instalación de GraphSQL). Elige otra."
else
  echo "Clonando el proyecto en $INSTALL_DIR..."
  git clone "$REPO_URL" "$INSTALL_DIR" || fail "El git clone falló. Revisa tu conexión (o el proxy corporativo)."
  green "Proyecto descargado."
fi

# ── 3. Configuración (.env y descripciones de la demo) ──────────────────────────
step "Preparo la configuración"

ENV_FILE="$INSTALL_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  green "Ya tienes un .env: conservo tu configuración tal cual."
else
  cp "$INSTALL_DIR/.env.example" "$ENV_FILE"

  PROVIDER="$(ask 'Proveedor de IA: "openai" (nube, necesita clave), "local" (LM Studio, gratis y offline) o "gateway" (servidor LLM de tu organizacion)' 'openai' "${GRAPHSQL_PROVIDER:-}")"
  PROVIDER="$(echo "$PROVIDER" | tr '[:upper:]' '[:lower:]')"
  if [ "$PROVIDER" = "local" ]; then
    # sed -i.bak funciona igual en GNU (Linux) y BSD (macOS); el .bak se borra después.
    sed -i.bak 's/^LLM_PROVIDER=.*/LLM_PROVIDER=local/; s/^EMBEDDING_PROVIDER=.*/EMBEDDING_PROVIDER=local/' "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    green "Configurado para LM Studio. Recuerda: modelo de chat + modelo de embeddings cargados y servidor arrancado."
  elif [ "$PROVIDER" = "gateway" ]; then
    # El gateway publica ALIAS de modelo propios, así que pregunto el nombre en vez de
    # suponerlo: se ven con `curl -H "Authorization: Bearer <clave>" <URL>/models`.
    GW_URL="$(ask 'URL del gateway (terminada en /v1)' 'http://localhost:4000/v1' "${GRAPHSQL_GATEWAY_URL:-}")"
    GW_KEY="$(ask 'Clave del gateway (déjalo vacío para ponerla luego a mano en el .env)' '' "${GRAPHSQL_GATEWAY_KEY:-}")"
    GW_MODEL="$(ask 'Alias del modelo de chat que publica el gateway' '' "${GRAPHSQL_GATEWAY_MODEL:-}")"
    GW_EMB="$(ask 'Alias del modelo de embeddings (vacío si los embeddings no van por el gateway)' '' "${GRAPHSQL_GATEWAY_EMBEDDING_MODEL:-}")"
    sed -i.bak "s/^LLM_PROVIDER=.*/LLM_PROVIDER=gateway/; s|^GATEWAY_BASE_URL=.*|GATEWAY_BASE_URL=$GW_URL|; s|^GATEWAY_API_KEY=.*|GATEWAY_API_KEY=$GW_KEY|; s|^GATEWAY_MODEL=.*|GATEWAY_MODEL=$GW_MODEL|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    if [ -n "$GW_EMB" ]; then
      sed -i.bak "s/^EMBEDDING_PROVIDER=.*/EMBEDDING_PROVIDER=gateway/; s|^GATEWAY_EMBEDDING_MODEL=.*|GATEWAY_EMBEDDING_MODEL=$GW_EMB|" "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
      yellow "Revisa GATEWAY_EMBEDDING_DIMENSIONS en $ENV_FILE: debe ser la dimensión real de $GW_EMB (1024 para bge-m3, 1536 para text-embedding-3-small)."
    else
      yellow "Los embeddings siguen configurados con OpenAI: o pones tu OPENAI_API_KEY en $ENV_FILE, o cambias EMBEDDING_PROVIDER a local/gateway."
    fi
    if [ -z "$GW_KEY" ]; then
      yellow "Sin clave aún: antes de usarlo, edita $ENV_FILE y pon tu GATEWAY_API_KEY."
    fi
    if [ -z "$GW_MODEL" ]; then
      yellow "Sin modelo aún: edita $ENV_FILE y pon en GATEWAY_MODEL uno de los alias que publique tu gateway."
    fi
    green "Configurado para el gateway en $GW_URL."
  else
    API_KEY="$(ask 'Tu OPENAI_API_KEY (déjalo vacío para ponerla luego a mano en el .env)' '' "${GRAPHSQL_OPENAI_KEY:-}")"
    if [ -n "$API_KEY" ]; then
      sed -i.bak "s|^OPENAI_API_KEY=.*|OPENAI_API_KEY=$API_KEY|" "$ENV_FILE"
      rm -f "$ENV_FILE.bak"
      green "Clave de OpenAI guardada en el .env."
    else
      yellow "Sin clave aún: antes de usarlo, edita $ENV_FILE y pon tu OPENAI_API_KEY."
    fi
  fi
fi

if [ ! -f "$INSTALL_DIR/descriptions/descriptions.json" ]; then
  cp "$INSTALL_DIR/descriptions/descriptions.example.json" "$INSTALL_DIR/descriptions/descriptions.json"
  green "Descripciones de la base de demo activadas."
fi

# ── 4. Dependencias ──────────────────────────────────────────────────────────────
step "Instalo las dependencias (npm install)"

cd "$INSTALL_DIR/backend"
npm install || fail "npm install falló. Revisa el error de arriba."
green "Dependencias instaladas."

# ── 5. Comando global gsql (opcional) ────────────────────────────────────────────
step "Comando global gsql"

LINK="$(ask '¿Registro el comando global "gsql" para invocarlo desde cualquier carpeta? (yes/no)' 'yes' "${GRAPHSQL_REGISTER_GSQL:-}")"
LINK="$(echo "$LINK" | tr '[:upper:]' '[:lower:]')"
if [ "$LINK" = "yes" ] || [ "$LINK" = "y" ] || [ "$LINK" = "si" ] || [ "$LINK" = "s" ]; then
  if npm link; then
    green "Comando gsql registrado (en el prefix global de npm)."
  else
    yellow "npm link falló — con el Node del sistema suele ser un tema de permisos. Dos salidas:"
    yellow "  npm config set prefix ~/.local   (y añade ~/.local/bin al PATH), y reintenta npm link"
    yellow "  o arranca sin comando global: npm start (desde $INSTALL_DIR/backend)"
  fi
else
  echo "Sin comando global. Se arranca con: npm start (desde $INSTALL_DIR/backend)."
fi

# ── Final ─────────────────────────────────────────────────────────────────────────
echo ""
printf '\033[32m%s\033[0m\n' "  GraphSQL instalado."
echo ""
echo "  Instalado en:  $INSTALL_DIR"
echo "  Para arrancar: gsql        (o: cd $INSTALL_DIR/backend && npm start)"
echo "                 La primera vez, el propio programa monta su infraestructura"
echo "                 (contenedores y datos de prueba) guiándote paso a paso."
echo "  Actualizar:    vuelve a ejecutar este instalador (hace git pull)."
echo "  Desinstalar:   docs/instalacion.md#desinstalar (docker compose down -v,"
echo "                 npm unlink -g y borrar la carpeta)."
echo ""
